const {app,BrowserWindow,protocol,ipcMain}=require('electron');
const path=require('node:path');
app.setPath('userData',process.env.CDP_FIXTURE_PROFILE);
app.commandLine.appendSwitch('remote-debugging-port',process.env.CDP_FIXTURE_PORT||'19336');
app.commandLine.appendSwitch('remote-debugging-address','127.0.0.1');
protocol.registerSchemesAsPrivileged([{scheme:'app',privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true}}]);
const history=[{id:'first',account_user_id:'user',created_at:'2026-10-09T01:00:00Z',content:{text:'历史问题'}},{id:'second',account_user_id:'agent-user',role:'user',created_at:'2026-10-09T01:00:01Z',content:{text:'**Dots 历史回复**'+ '\n\n这里是完整的助手回复，消息列表与普通对话保持一致。'.repeat(8)}}];
const uploaded=[];const requests=[];let desktop,phone;let holdIdentity=null,releaseIdentity=null;let identity={accountId:"fixture-account",userId:"fixture-user"};
ipcMain.handle("dots-fixture-identity",async()=>{if(holdIdentity)await holdIdentity;return {status:"ready",data:identity};});
ipcMain.handle("dots-fixture-hold-identity",()=>{holdIdentity=new Promise(resolve=>{releaseIdentity=resolve;});});
ipcMain.handle("dots-fixture-release-identity",()=>{releaseIdentity?.();holdIdentity=null;});
ipcMain.handle("dots-fixture-switch-identity",()=>{identity={accountId:"another-account",userId:"another-user"};});
ipcMain.handle('dots-fixture-request',async(_event,request)=>{
 const u=new URL(request.url,'https://example.invalid');const isUpload=u.pathname.endsWith('/files');requests.push({method:request.method,path:u.pathname,body:!isUpload&&request.body?JSON.parse(request.body):undefined});
 if(isUpload){const bytes=Buffer.from(request.body);const text=bytes.toString('utf8');const name=/filename="([^"]+)"/.exec(text)?.[1];const type=/Content-Type: ([^\r\n]+)/.exec(text)?.[1];const start=bytes.indexOf(Buffer.from('\r\n\r\n'))+4;const end=bytes.lastIndexOf(Buffer.from('\r\n--'));const file={id:'file-'+uploaded.length,name,mime_type:type,size_bytes:end-start,status:'available',data:[...bytes.subarray(start,end)]};uploaded.push(file);requests.at(-1).file=file;return {status:201,body:file};}
 const dot={id:'tbo:dot-a.v1',display_name:'031b504d-e8c1-40c3-8b07-profile',aeon_kind:'orbit',messaging_room_id:'room:dot-a.v1',active_root_thread_id:'dot-thread'};
 if(u.pathname==='/tbo')return {status:200,body:{items:[dot],cursor:null}};
 if(u.pathname==='/tbo/primary')return {status:200,body:{selection:{available:true,thread_id:'dot-thread'},profile:dot}};
 if(decodeURIComponent(u.pathname)==='/messaging/rooms/room:dot-a.v1')return {status:200,body:{id:'room:dot-a.v1',members:[{account_user_id:'user',name:'用户'},{account_user_id:'agent-user',aeon_id:'tbo:dot-a.v1',name:'测试 Dot'}],member_profile_snapshots:[]}};
 if(decodeURIComponent(u.pathname)==='/messaging/rooms/room:dot-a.v1/messages'){
  if(request.method==='GET')return {status:200,body:{items:[...history],prev_cursor:null,next_cursor:null}};
  const body=JSON.parse(request.body);
  if(body.content.text==='cancelled-host')return {hostError:{status:499,responseStatus:null,error:'aborted'}};
  const message={id:'sent-'+history.length,account_user_id:'user',created_at:new Date().toISOString(),request_id:body.request_id,content:{text:body.content.text,...body.content.attachments?.length?{attachments:body.content.attachments.map(a=>({...a,...uploaded.find(f=>f.id===a.file_id)}))}:{}}};history.push(message);
  setTimeout(()=>history.push({id:'reply-'+history.length,created_at:new Date().toISOString(),account_user_id:'agent-user',role:'user',content:{text:'收到手机消息：'+body.content.text}}),100);
  return {status:201,body:message};
 }
 return {status:404,body:{error:'not found'}};
});
ipcMain.handle('dots-fixture-inspect',()=>requests);
app.whenReady().then(()=>{
 protocol.handle('app',request=>{
  if(new URL(request.url).pathname.endsWith('.js'))return new Response(`export const aj={accessInputs:{readAccountInfo:async()=>{try{return await window.electronBridge.fixtureIdentity();}finally{window.fixtureIdentitySettled=(window.fixtureIdentitySettled||0)+1;}}},httpFetch:{fetch:async(_id,request)=>{const result=await window.electronBridge.fixtureFetch(request);if(result.hostError)return result.hostError;return {response:new Response(JSON.stringify(result.body),{status:result.status,headers:{'content-type':'application/json'}})};},cancel:async()=>{}}};`,{headers:{'content-type':'text/javascript'}});
  return new Response('<!doctype html><meta charset="utf-8"><h1>Dots 受控宿主</h1><script type="module" src="./assets/app-shared-6c00c2afcf84.js"></script>',{headers:{'content-type':'text/html'}});
 });
 desktop=new BrowserWindow({show:false,webPreferences:{preload:path.join(__dirname,'dots-preload.cjs'),contextIsolation:true,nodeIntegration:false}});desktop.loadURL('app://-/index.html');
 phone=new BrowserWindow({show:false,webPreferences:{contextIsolation:true,nodeIntegration:false}});phone.webContents.setUserAgent(process.env.CDP_FIXTURE_PHONE_UA||'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1');phone.loadURL('about:blank');
});
