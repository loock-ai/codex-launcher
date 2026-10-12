#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod node_runtime;
mod launch_args;
mod config_directory;
use launch_args::{launch_actions, LaunchAction};
use base64::Engine;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc,
    },
    time::Duration,
};
use tauri::{Emitter, Manager};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, Command},
    sync::{oneshot, Mutex, Notify},
};

struct StartupError(String);

struct Backend {
    input: Mutex<ChildStdin>,
    child: Mutex<Child>,
    pending: Mutex<HashMap<u64, oneshot::Sender<Result<Value, String>>>>,
    next: AtomicU64,
    ready: AtomicBool,
    ready_signal: Notify,
    exiting: AtomicBool,
    stopped: AtomicBool,
}
impl Backend {
    async fn call(&self, method: &str, args: Vec<Value>) -> Result<Value, String> {
        let id = self.next.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = oneshot::channel();
        self.pending.lock().await.insert(id, tx);
        let line = format!("{}\n", json!({"id":id,"method":method,"args":args}));
        if line.len() > 1024 * 1024 {
            self.pending.lock().await.remove(&id);
            return Err("调用参数超过 1 MiB 限制".into());
        }
        if let Err(e) = self.input.lock().await.write_all(line.as_bytes()).await {
            self.pending.lock().await.remove(&id);
            return Err(e.to_string());
        }
        let result = tokio::time::timeout(Duration::from_secs(120), rx).await;
        self.pending.lock().await.remove(&id);
        result
            .map_err(|_| "后台请求超时".to_string())?
            .map_err(|_| "后台连接已关闭".to_string())?
    }
    async fn shutdown(&self) {
        if self.exiting.swap(true, Ordering::SeqCst) {
            while !self.stopped.load(Ordering::Acquire) {
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
            return;
        }
        let _ = tokio::time::timeout(Duration::from_secs(20), self.call("shutdown", vec![])).await;
        let mut child = self.child.lock().await;
        if tokio::time::timeout(Duration::from_secs(5), child.wait())
            .await
            .is_err()
        {
            let _ = child.kill().await;
        }
        self.stopped.store(true, Ordering::Release);
    }
}
fn allowed(method: &str) -> bool {
    matches!(
        method,
        "status"
            | "listPlugins"
            | "setPluginEnabled"
            | "setPluginAutoStart"
            | "startPlugin"
            | "stopPlugin"
            | "reloadPlugins"
            | "invokePlugin"
            | "pluginUiUrl"
            | "saveDesktopSettings"
            | "openDesktop"
            | "connectDesktop"
            | "restartDesktop"
            | "start"
            | "stop"
            | "openPluginsFolder"
    )
}
#[tauri::command]
async fn launcher_call(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    method: String,
    args: Vec<Value>,
) -> Result<Value, String> {
    if window.label() != "main" || !allowed(&method) {
        return Err("不允许的宿主调用".into());
    }
    let state = app.try_state::<Arc<Backend>>().ok_or_else(|| {
        app.try_state::<StartupError>()
            .map(|e| e.0.clone())
            .unwrap_or("后台尚未准备好".into())
    })?;
    let result = state.call(&method, args).await?;
    if cfg!(target_os = "windows") && method == "pluginUiUrl" {
        return Ok(json!(result.as_str().ok_or("无效插件URL")?.replacen(
            "launcher-plugin://plugin/",
            "http://launcher-plugin.localhost/",
            1
        )));
    }
    Ok(result)
}
#[tauri::command]
async fn launcher_report_error(window: tauri::WebviewWindow, app: tauri::AppHandle, message: String) -> Result<(), String> {
    if window.label() != "main" || message.chars().count() > 4000 { return Err("无效诊断来源".into()); }
    let state = app.try_state::<Arc<Backend>>().ok_or("后台未就绪")?;
    state.call("reportError", vec![json!({"message":message,"source":"ui"})]).await?;
    Ok(())
}
#[tauri::command]
fn updater_info(app: tauri::AppHandle, window: tauri::WebviewWindow) -> Result<Value, String> {
    if window.label() != "main" {
        return Err("无效窗口".into());
    }
    let configured = app
        .config()
        .plugins
        .0
        .get("updater")
        .and_then(|v| v.get("pubkey"))
        .and_then(Value::as_str)
        .is_some_and(|s| !s.trim().is_empty());
    Ok(json!({"version":app.package_info().version.to_string(),"configured":configured}))
}
#[tauri::command]
async fn restart_launcher(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, Arc<Backend>>,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("无效窗口".into());
    }
    state.shutdown().await;
    app.restart()
}
fn plugin_path(raw: &str) -> Result<(String, String), String> {
    let decoded = percent_encoding::percent_decode_str(raw)
        .decode_utf8()
        .map_err(|_| "无效路径编码")?;
    let path = decoded.strip_prefix('/').ok_or("无效路径")?;
    if path.split('/').any(|part| {
        part.is_empty() || part == "." || part == ".." || part.contains('\\') || part.contains('\0')
    }) {
        return Err("无效资源路径".into());
    }
    let (id, path) = path.split_once('/').ok_or("缺少资源路径")?;
    Ok((id.to_string(), path.to_string()))
}
fn show(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if let Err(error) = window.show() {
            eprintln!("显示主窗口失败: {error}");
        }
        if let Err(error) = window.set_focus() {
            eprintln!("聚焦主窗口失败: {error}");
        }
        eprintln!(
            "主窗口状态: visible={:?}, position={:?}, size={:?}",
            window.is_visible(),
            window.outer_position(),
            window.outer_size()
        );
    } else {
        eprintln!("主窗口尚未创建");
    }
}
async fn report_launch_error(backend: &Backend, message: String) {
    eprintln!("{message}");
    if let Err(error) = backend
        .call("reportError", vec![json!({"message": message, "source": "launch"})])
        .await
    {
        eprintln!("保存启动诊断失败: {error}");
    }
}

async fn execute_launch(backend: Arc<Backend>, args: Vec<String>) {
    let actions = launch_actions(&args);
    if actions.is_empty() {
        return;
    }
    if !backend.ready.load(Ordering::Acquire)
        && tokio::time::timeout(Duration::from_secs(30), backend.ready_signal.notified())
            .await
            .is_err()
        && !backend.ready.load(Ordering::Acquire)
    {
        report_launch_error(&backend, "后台启动超时".into()).await;
        return;
    }
    for action in actions {
        let (description, method, args) = match action {
            LaunchAction::StartPlugins => ("自动启动插件失败", "start", vec![]),
            LaunchAction::OpenWeb => (
                "打开 Mobile 网页失败",
                "invokePlugin",
                vec![json!("mobile"), json!("open-web"), json!({})],
            ),
        };
        if let Err(error) = backend.call(method, args).await {
            report_launch_error(&backend, format!("{description}: {error}")).await;
        }
    }
}

fn main() {
    let app=tauri::Builder::default()
 .plugin(tauri_plugin_single_instance::init(|app,args,_|{
  show(app);
  if let Some(backend) = app.try_state::<Arc<Backend>>() {
   let backend = backend.inner().clone();
   tauri::async_runtime::spawn(execute_launch(backend, args));
  } else {
   let message = app.try_state::<StartupError>().map(|error| error.0.clone()).unwrap_or_else(|| "后台尚未准备好".into());
   eprintln!("处理二次启动失败: {message}");
  }
 }))
 .plugin(tauri_plugin_updater::Builder::new().build())
 .invoke_handler(tauri::generate_handler![launcher_call,launcher_report_error,updater_info,restart_launcher])
 .register_asynchronous_uri_scheme_protocol("launcher-plugin",|context,request,responder|{
  let app=context.app_handle().clone();let uri=request.uri().clone();tauri::async_runtime::spawn(async move{
   let result:Result<tauri::http::Response<Vec<u8>>,String>=async {
    if !matches!(uri.host(),Some("plugin"|"launcher-plugin.localhost")){return Err("无效插件地址".into())}let(id,path)=plugin_path(uri.path())?;
    let backend=app.try_state::<Arc<Backend>>().ok_or("后台未就绪")?;
    let asset=backend.call("pluginUiAsset",vec![json!(id),json!(path)]).await?;
    let bytes=base64::engine::general_purpose::STANDARD.decode(asset["body"].as_str().ok_or("无效资源")?).map_err(|e|e.to_string())?;
    tauri::http::Response::builder().header("Content-Type",asset["mime"].as_str().unwrap_or("application/octet-stream")).header("Content-Security-Policy",asset["csp"].as_str().unwrap_or("default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'" )).header("Access-Control-Allow-Origin","*").header("X-Content-Type-Options","nosniff").body(bytes).map_err(|e|e.to_string())
   }.await;
   responder.respond(result.unwrap_or_else(|_|tauri::http::Response::builder().status(404).body(b"Plugin resource unavailable".to_vec()).unwrap()));
  });
 })
 .setup(|app|{
  let resource=app.path().resource_dir()?;let root=if cfg!(debug_assertions){std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/backend")}else{resource.join("backend")};

  let argv:Vec<String>=std::env::args().collect();
  let explicit_config=argv.iter().position(|a|a=="--config-dir").and_then(|i|argv.get(i+1)).map(std::path::PathBuf::from);
  let config_dir=config_directory::resolve(&app.path().home_dir()?,&app.path().data_dir()?,explicit_config)?;
  let config=config_dir.join("config.json");
  let backend=tauri::async_runtime::block_on(async{
   let node=node_runtime::resolve().await?;
   eprintln!("使用本机 Node {}: {}",node.version,node.executable.display());
   let mut command=Command::new(&node.executable);
   command.env("PATH",node.path_env()?).env_remove("NODE_OPTIONS").env_remove("ELECTRON_RUN_AS_NODE").env_remove("NODE_PATH");
   #[cfg(target_os="windows")]
   command.creation_flags(0x08000000); // CREATE_NO_WINDOW: Node 不创建额外控制台。
   let mut child=command.arg(root.join("npm-dist/server/launcher/sidecar.js")).arg("--config").arg(config).arg("--root").arg(root).args(std::env::args().filter(|a|a=="--no-desktop")).stdin(std::process::Stdio::piped()).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::inherit()).kill_on_drop(true).spawn().map_err(|e|format!("无法启动 Node 后台: {e}"))?;
   let input=child.stdin.take().unwrap();let output=child.stdout.take().unwrap();let backend=Arc::new(Backend{input:Mutex::new(input),child:Mutex::new(child),pending:Mutex::new(HashMap::new()),next:AtomicU64::new(1),ready:AtomicBool::new(false),ready_signal:Notify::new(),exiting:AtomicBool::new(false),stopped:AtomicBool::new(false)});
   let reader=backend.clone();let handle=app.handle().clone();tauri::async_runtime::spawn(async move{let mut lines=BufReader::new(output).lines();while let Ok(Some(line))=lines.next_line().await{let Ok(msg)=serde_json::from_str::<Value>(&line)else{continue};if msg["event"]=="ready"{reader.ready.store(true,Ordering::Release);reader.ready_signal.notify_one();}else if msg["event"]=="status"{let _=handle.emit_to("main","launcher-status",&msg["data"]);}else if let Some(id)=msg["id"].as_u64(){if let Some(tx)=reader.pending.lock().await.remove(&id){let response=if let Some(err)=msg.get("error"){Err(err["message"].as_str().unwrap_or("后台请求失败").to_string())}else{Ok(msg["result"].clone())};let _=tx.send(response);}}}for(_,tx)in reader.pending.lock().await.drain(){let _=tx.send(Err("后台进程已退出".into()));}});
   Ok::<_,String>(backend)
  });
  match backend {
  Ok(backend)=>{app.manage(backend.clone());
  tauri::async_runtime::spawn(execute_launch(backend, argv));
  },Err(error)=>{eprintln!("{error}");app.manage(StartupError(error));}}
  let open=tauri::menu::MenuItem::with_id(app,"open","打开启动器",true,None::<&str>)?;let quit=tauri::menu::MenuItem::with_id(app,"quit","退出启动器",true,None::<&str>)?;let menu=tauri::menu::Menu::with_items(app,&[&open,&quit])?;
  let mut tray=tauri::tray::TrayIconBuilder::new();
  #[cfg(target_os="macos")]
  { tray=tray.title("⌘"); }
  #[cfg(not(target_os="macos"))]
  if let Some(icon)=app.default_window_icon(){tray=tray.icon(icon.clone());}
  tray.tooltip("Codex Launcher").menu(&menu).on_menu_event(|app,event|match event.id.as_ref(){"open"=>show(app),"quit"=>app.exit(0),_=>{}}).build(app)?;
  let window=app.get_webview_window("main").ok_or("主窗口未创建")?;
  window.center()?;
  show(app.handle());
  Ok(())
 })
 .on_window_event(|window,event|{if let tauri::WindowEvent::CloseRequested{api,..}=event{api.prevent_close();let _=window.hide();}})
 .build(tauri::generate_context!()).expect("无法创建 Codex Launcher");
    app.run(|app, event| {
        if matches!(&event, tauri::RunEvent::Ready) {
            show(app);
        }
        #[cfg(target_os = "macos")]
        if matches!(&event, tauri::RunEvent::Reopen { .. }) {
            show(app);
        }
        if let tauri::RunEvent::ExitRequested { api, .. } = event {
            if let Some(backend) = app.try_state::<Arc<Backend>>() {
                if !backend.stopped.load(Ordering::SeqCst) {
                    api.prevent_exit();
                    let backend = backend.inner().clone();
                    let handle = app.clone();
                    tauri::async_runtime::spawn(async move {
                        backend.shutdown().await;
                        handle.exit(0);
                    });
                }
            }
        }
    });
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn renderer_cannot_read_arbitrary_assets_or_shutdown() {
        assert!(!allowed("pluginUiAsset"));
        assert!(!allowed("shutdown"));
        assert!(allowed("invokePlugin"));
        assert_eq!(
            plugin_path("/demo/%E9%A1%B5%E9%9D%A2.html").unwrap(),
            ("demo".into(), "页面.html".into())
        );
        for path in [
            "/demo/%2e%2e/secret",
            "/demo/%00",
            "/demo/foo%5cbar",
            "/demo//x",
        ] {
            assert!(plugin_path(path).is_err());
        }
    }
}
