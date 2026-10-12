#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_stable_supported_versions() {
        assert_eq!(version("v20.0.0"), Some((20, 0, 0)));
        assert_eq!(version("v24.2.1"), Some((24, 2, 1)));
        for bad in ["v19.9.9", "v24.0.0-rc.1", "not node", "v20.1"] {
            assert_eq!(version(bad), None)
        }
    }
    #[test]
    fn path_order_skips_relative_and_empty() {
        let first = std::env::temp_dir().join("first");
        let second = std::env::temp_dir().join("second");
        let path = std::env::join_paths([
            first.as_path(),
            Path::new("relative"),
            Path::new(""),
            second.as_path(),
        ])
        .unwrap();
        assert_eq!(
            path_candidates(&path),
            vec![first.join(node_name()), second.join(node_name())]
        );
    }
    #[test]
    fn explicit_override_does_not_fall_back() {
        assert!(explicit_candidate(Some(std::ffi::OsString::from("relative/node"))).is_err());
        let absolute = std::env::temp_dir().join("missing/node");
        assert_eq!(
            explicit_candidate(Some(absolute.as_os_str().to_owned())).unwrap(),
            Some(absolute)
        );
    }
    #[cfg(unix)]
    #[test]
    fn probe_timeout_is_bounded() {
        use std::os::unix::fs::PermissionsExt;
        let file = std::env::temp_dir().join(format!("codex-node-timeout-{}", std::process::id()));
        std::fs::write(&file, "#!/bin/sh\nexec sleep 5\n").unwrap();
        std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o700)).unwrap();
        let start = std::time::Instant::now();
        let result =
            tauri::async_runtime::block_on(probe_once(&file, std::time::Duration::from_millis(50)));
        let _ = std::fs::remove_file(file);
        assert!(result.unwrap_err().contains("超时"));
        assert!(start.elapsed() < std::time::Duration::from_secs(2));
    }
}

use std::{
    ffi::{OsStr, OsString},
    path::{Path, PathBuf},
    time::Duration,
};
use tokio::process::Command;
#[derive(Debug)]
pub struct NodeRuntime {
    pub executable: PathBuf,
    pub version: String,
}
fn node_name() -> &'static str {
    if cfg!(windows) {
        "node.exe"
    } else {
        "node"
    }
}
fn version(raw: &str) -> Option<(u64, u64, u64)> {
    let parts: Vec<_> = raw.strip_prefix('v')?.split('.').collect();
    if parts.len() != 3
        || parts
            .iter()
            .any(|p| p.is_empty() || !p.bytes().all(|b| b.is_ascii_digit()))
    {
        return None;
    }
    let major = parts[0].parse().ok()?;
    if major < 20 {
        return None;
    }
    Some((major, parts[1].parse().ok()?, parts[2].parse().ok()?))
}
fn explicit_candidate(value: Option<OsString>) -> Result<Option<PathBuf>, String> {
    match value {
        Some(value) => {
            let path = PathBuf::from(value);
            if !path.is_absolute() {
                return Err("CODEX_LAUNCHER_NODE 必须为 Node 可执行文件的绝对路径".into());
            }
            Ok(Some(path))
        }
        None => Ok(None),
    }
}
fn path_candidates(value: &OsStr) -> Vec<PathBuf> {
    std::env::split_paths(value)
        .filter(|p| p.is_absolute())
        .map(|p| p.join(node_name()))
        .collect()
}
fn candidates() -> Result<Vec<PathBuf>, String> {
    if let Some(explicit) = explicit_candidate(std::env::var_os("CODEX_LAUNCHER_NODE"))? {
        return Ok(vec![explicit]);
    }
    let mut paths = path_candidates(&std::env::var_os("PATH").unwrap_or_default());
    #[cfg(target_os = "macos")]
    {
        paths.extend([
            PathBuf::from("/opt/homebrew/bin/node"),
            PathBuf::from("/usr/local/bin/node"),
        ]);
        if let Some(home) = std::env::var_os("HOME") {
            let home = PathBuf::from(home);
            if home.is_absolute() {
                paths.push(home.join(".volta/bin/node"));
                let mut versions: Vec<_> = std::fs::read_dir(home.join(".nvm/versions/node"))
                    .into_iter()
                    .flatten()
                    .filter_map(Result::ok)
                    .filter_map(|e| {
                        version(&e.file_name().to_string_lossy())
                            .map(|v| (v, e.path().join("bin/node")))
                    })
                    .collect();
                versions.sort_by(|a, b| b.0.cmp(&a.0));
                paths.extend(versions.into_iter().map(|(_, p)| p));
            }
        }
    }
    #[cfg(windows)]
    {
        for variable in ["ProgramFiles", "ProgramW6432"] {
            if let Some(dir) = std::env::var_os(variable) {
                let dir = PathBuf::from(dir);
                if dir.is_absolute() {
                    paths.push(dir.join("nodejs/node.exe"));
                }
            }
        }
        if let Some(dir) = std::env::var_os("NVM_SYMLINK") {
            let dir = PathBuf::from(dir);
            if dir.is_absolute() {
                paths.push(dir.join("node.exe"));
            }
        }
    }
    let mut seen = std::collections::HashSet::new();
    paths.retain(|p| seen.insert(p.clone()));
    Ok(paths)
}
async fn probe_once(path: &Path, timeout: Duration) -> Result<NodeRuntime, String> {
    let mut command = Command::new(path);
    command
        .args([
            "-p",
            "JSON.stringify({version:process.version,execPath:process.execPath})",
        ])
        .env_remove("NODE_OPTIONS")
        .env_remove("ELECTRON_RUN_AS_NODE")
        .env_remove("NODE_PATH")
        .kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    let output = tokio::time::timeout(timeout, command.output())
        .await
        .map_err(|_| "检测超时（2 秒）".to_string())?
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(format!("检测退出码 {}", output.status));
    }
    let value: serde_json::Value = serde_json::from_slice(&output.stdout)
        .map_err(|_| "不是可识别的 Node.js 运行时".to_string())?;
    let raw = value["version"].as_str().ok_or("缺少Node版本")?;
    if version(raw).is_none() {
        return Err(format!(
            "版本 {raw} 不受支持，需要稳定版 Node.js 20 或更高版本"
        ));
    }
    let executable = PathBuf::from(value["execPath"].as_str().ok_or("缺少execPath")?);
    if !executable.is_absolute() || !executable.is_file() {
        return Err("Node execPath 不是存在的绝对文件路径".into());
    }
    Ok(NodeRuntime {
        executable,
        version: raw.into(),
    })
}
pub async fn resolve() -> Result<NodeRuntime, String> {
    let paths = candidates()?;
    let explicit = std::env::var_os("CODEX_LAUNCHER_NODE").is_some();
    let mut errors = Vec::new();
    let deadline = std::time::Instant::now() + Duration::from_secs(8);
    let mut attempts = 0;
    for candidate in paths {
        if !explicit && !candidate.is_file() {
            continue;
        }
        if attempts >= 16 || std::time::Instant::now() >= deadline {
            errors.push("已达到检测上限（8秒、16个候选），可用CODEX_LAUNCHER_NODE直接指定".into());
            break;
        }
        attempts += 1;
        let remaining = || {
            deadline
                .saturating_duration_since(std::time::Instant::now())
                .min(Duration::from_secs(2))
        };
        match probe_once(&candidate, remaining()).await {
            Ok(found) => match probe_once(&found.executable, remaining()).await {
                Ok(actual) => return Ok(actual),
                Err(e) => errors.push(format!("{}: {e}", found.executable.display())),
            },
            Err(e) => errors.push(format!("{}: {e}", candidate.display())),
        }
    }
    Err(format!("{}请安装稳定版 Node.js 20 或更高版本，然后退出并重新打开启动器；也可用 CODEX_LAUNCHER_NODE 指定绝对路径。{}",if explicit{"指定的 Node 无法使用。"}else{"未找到可用的 Node.js。"},if errors.is_empty(){String::new()}else{format!("\n检测结果：\n{}",errors.join("\n"))}))
}
impl NodeRuntime {
    pub fn path_env(&self) -> Result<OsString, String> {
        let mut paths = vec![self
            .executable
            .parent()
            .ok_or("Node缺少父目录")?
            .to_path_buf()];
        paths.extend(
            std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default())
                .filter(|p| p.is_absolute()),
        );
        std::env::join_paths(paths).map_err(|e| e.to_string())
    }
}
