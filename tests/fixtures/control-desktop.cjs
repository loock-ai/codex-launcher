const {app,BrowserWindow,protocol,ipcMain}=require('electron');
const path=require('node:path');
app.setPath('userData',process.env.CDP_FIXTURE_PROFILE);
app.commandLine.appendSwitch('remote-debugging-port',process.env.CDP_FIXTURE_PORT);
app.commandLine.appendSwitch('remote-debugging-address','127.0.0.1');
protocol.registerSchemesAsPrivileged([{scheme:'app',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
let mainWindow,phoneWindow,approvalPending=false,approvalThread='fixture-thread';const timers=new Set(),files=new Map();
const pendingQuestions=new Map(),questionAnswers=[],activeTurns=new Map();
const questionKey=(host,thread)=>JSON.stringify([host,thread]);
ipcMain.handle('fixture:questions',(_event,host,thread)=>({id:thread,requests:pendingQuestions.has(questionKey(host,thread))?[pendingQuestions.get(questionKey(host,thread))]:[]}));
ipcMain.handle('fixture:answer-question',(_event,host,thread,id,result)=>{const key=questionKey(host,thread),question=pendingQuestions.get(key);if(!question||question.id!==id)throw Error('expired');questionAnswers.push({host,thread,id,result});pendingQuestions.delete(key);return {};});
ipcMain.handle('fixture:question-answers',()=>questionAnswers);
const png="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZ8AAAAASUVORK5CYII=";
ipcMain.handle('codex_desktop:message-from-view',async(event,message)=>{
 const send=m=>event.sender.send('codex_desktop:message-for-view',{hostId:message.hostId,...m});
 if(message.type==='mcp-response'){
  if(!approvalPending||message.response.id!=='fixture-approval')throw new Error('expired');approvalPending=false;
  send({type:'mcp-notification',method:'serverRequest/resolved',params:{threadId:approvalThread,requestId:'fixture-approval'}});return;
 }
 if(message.type!=='mcp-request')return;
 const {id,method,params:p}=message.request;
 const remote=message.hostId!=='local',modelPrefix=remote?'remote-':'fixture-';
 const reply=result=>send({type:'mcp-response',message:{id,result}});
 switch(method){
  case 'permissionProfile/list':reply({data:[{id:':workspace',allowed:true},{id:':read-only',allowed:true},{id:':danger-full-access',allowed:false}],nextCursor:null});break;
  case 'fs/createDirectory':reply({});break;
  case 'fs/writeFile':files.set(message.hostId+'|'+p.path,p.dataBase64);reply({});break;
  case 'fs/readFile':send({type:'mcp-notification',method:'fixture/fileRead',params:{path:p.path}});reply({dataBase64:files.get(message.hostId+'|'+p.path)??(p.path.endsWith('/settings.png')?png:'')});break;
  case 'model/list':reply({data:[{id:modelPrefix+(p.cursor?'pro':'base'),model:modelPrefix+(p.cursor?'pro':'base'),displayName:(remote?'远程':'测试')+(p.cursor?'推理模型':'标准模型'),defaultReasoningEffort:'high',supportedReasoningEfforts:[{reasoningEffort:'low',description:'quick'},{reasoningEffort:'high',description:'deep'}]}],nextCursor:p.cursor?null:'models2'});break;
  case 'project/list':reply({data:[{id:p.cursor?'p2':'p1',name:p.cursor?'项目二':'项目一',roots:[{path:remote?'/remote/sub2api-codex-api':'/fixture'}]}],nextCursor:p.cursor?null:'page2'});break;
  case 'project/read':reply({project:{id:p.projectId,name:'项目一',roots:[{path:'/fixture'}]}});break;
  case 'thread/list':reply({data:[{id:'fixture-thread',name:remote?'远程会话':'受控会话',projectId:'p1',cwd:remote?'/remote/sub2api-codex-api':'/fixture'}],nextCursor:null});break;
  case 'thread/start':reply({thread:{id:'fixture-created',name:'新建会话',cwd:p.cwd??'/fixture',turns:[]}});break;
  case 'thread/read':case 'thread/resume':reply({thread:{id:p.threadId,name:remote?'远程会话':'受控会话',cwd:remote?'/remote/sub2api-codex-api':'/fixture',turns:[]},model:modelPrefix+'base',reasoningEffort:'high',activePermissionProfile:{id:':workspace'},approvalPolicy:'on-request',approvalsReviewer:'user'});break;
  case 'thread/turns/list':reply({data:[{id:'fixture-turn',status:'completed',itemsView:'notLoaded'}],nextCursor:null});break;
  case 'thread/items/list':reply({data:[{id:'history-user',type:'userMessage',content:[{type:'text',text:remote?'远程历史输入':'历史输入'}]},{id:'history-image',type:'agentMessage',text:'![settings.png](settings.png)'}],nextCursor:null});break;
  case 'turn/steer':{
   if(activeTurns.get(questionKey(message.hostId,p.threadId))!==p.expectedTurnId){send({type:'mcp-response',message:{id,error:{code:-32001,message:'active turn mismatch'}}});break;}
   send({type:'mcp-notification',method:'fixture/steered',params:p});
   send({type:'mcp-notification',method:'item/started',params:{threadId:p.threadId,turnId:p.expectedTurnId,item:{id:'guide-'+p.clientUserMessageId,clientId:p.clientUserMessageId,type:'userMessage',content:p.input}}});
   reply({turnId:p.expectedTurnId});send({type:'mcp-notification',method:'item/agentMessage/delta',params:{threadId:p.threadId,turnId:p.expectedTurnId,itemId:'agent',delta:'；已收到引导'}});break;
  }
  case 'turn/start':{
   activeTurns.set(questionKey(message.hostId,p.threadId),'fixture-live');
   send({type:'mcp-notification',method:'fixture/submitted',params:{threadId:p.threadId,model:p.model??null,effort:p.effort??null,hasPermissions:'permissions'in p||'approvalPolicy'in p||'approvalsReviewer'in p,permissions:p.permissions??null,inputTypes:p.input.map(i=>i.type),fileInputs:p.input.filter(i=>i.type==='text').map(i=>i.text)}});
   send({type:'mcp-notification',method:'turn/started',params:{threadId:p.threadId,turn:{id:'fixture-live',status:'inProgress'}}});
   send({type:'mcp-notification',method:'item/started',params:{threadId:p.threadId,turnId:'fixture-live',item:{id:'user',type:'userMessage',content:p.input}}});
   send({type:'mcp-notification',method:'item/started',params:{threadId:p.threadId,turnId:'fixture-live',item:{id:'agent',type:'agentMessage',text:''}}});
   send({type:'mcp-notification',method:'item/started',params:{threadId:p.threadId,turnId:'fixture-live',item:{id:'reasoning',type:'reasoning',summary:['**Editing the documentation note**','**Reviewing the staged changes**','**Preparing fresh npm checks**']}}});
   reply({turn:{id:'fixture-live',status:'inProgress'}});
   if((p.input.find(i=>i.type==='text')?.text??'').includes('运行中问题')){
    pendingQuestions.set(questionKey(message.hostId,p.threadId),{id:'host-question',method:'item/tool/requestUserInput',params:{threadId:p.threadId,turnId:'fixture-live',itemId:'ask',isBlocking:false,questions:[{id:'format',header:'格式',question:'希望哪种格式？',options:[{label:'简短',description:'只给结论'},{label:'详细',description:'包括过程'}]}]}});
    timers.add(setTimeout(()=>send({type:'mcp-notification',method:'item/agentMessage/delta',params:{threadId:p.threadId,turnId:'fixture-live',itemId:'agent',delta:'任务继续执行'}}),80));break;
   }
   const delay=(p.input.find(i=>i.type==='text')?.text??'').includes('停止')?2000:80;
   timers.add(setTimeout(()=>send({type:'mcp-notification',method:'item/agentMessage/delta',params:{threadId:p.threadId,turnId:'fixture-live',itemId:'agent',delta:'结构化回复'}}),delay));
   timers.add(setTimeout(()=>{activeTurns.delete(questionKey(message.hostId,p.threadId));send({type:'mcp-notification',method:'turn/completed',params:{threadId:p.threadId,turn:{id:'fixture-live',status:'completed',items:[{id:'user',type:'userMessage',content:p.input},{id:'reasoning',type:'reasoning',summary:['**Editing the documentation note**','**Reviewing the staged changes**','**Preparing fresh npm checks**']},{id:'agent',type:'agentMessage',text:'结构化回复'}]}}});approvalPending=true;approvalThread=p.threadId;send({type:'mcp-request',request:{id:'fixture-approval',method:'item/commandExecution/requestApproval',params:{threadId:p.threadId,turnId:'fixture-live',reason:'受控审批'}}});},delay+80));break;
  }
  case 'turn/interrupt':activeTurns.delete(questionKey(message.hostId,p.threadId));for(const timer of timers)clearTimeout(timer);timers.clear();send({type:'mcp-notification',method:'turn/completed',params:{threadId:p.threadId,turn:{id:p.turnId,status:'interrupted'}}});reply({});break;
  default:send({type:'mcp-response',message:{id,error:{code:-32601,message:'fixture unsupported'}}});
 }
});
app.whenReady().then(()=>{
 protocol.handle('app',request=>{if(new URL(request.url).pathname.endsWith('.js'))return new Response(`export const aj={appServerManagers:{open:async(host)=>({status:'ready',manager:{getConversation:thread=>window.electronBridge.fixtureQuestions(host,thread),replyWithUserInputResponse:(thread,id,result)=>window.electronBridge.fixtureAnswer(host,thread,id,result)}})}}`,{headers:{'content-type':'text/javascript'}});return new Response(`<!doctype html><meta charset="UTF-8"><h1>结构化通道受控窗口</h1><main></main><script>
 window.received=[];window.addEventListener('message',event=>{const m=event.data;if(m?.type==='mcp-notification'){window.received.push(m);if(m.method==='item/started'&&m.params.item.type==='userMessage')document.querySelector('main').textContent+=m.params.item.content[0].text;if(m.method==='item/agentMessage/delta')document.querySelector('main').textContent+=m.params.delta;}});
 </script>`,{headers:{'content-type':'text/html; charset=utf-8'}});});
 mainWindow=new BrowserWindow({show:false,webPreferences:{preload:path.join(__dirname,'control-preload.cjs'),contextIsolation:true,nodeIntegration:false}});mainWindow.loadURL('app://-/index.html');
 phoneWindow=new BrowserWindow({show:false,webPreferences:{contextIsolation:true,nodeIntegration:false}});phoneWindow.webContents.setUserAgent(process.env.CDP_FIXTURE_PHONE_UA||'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1');phoneWindow.loadURL('about:blank');
});
