import {randomUUID} from 'node:crypto';
export interface UserQuestionTarget {hostId:string;threadId:string}
export interface UserQuestionSnapshot extends UserQuestionTarget {requests:any[]}
export interface ControlTransport {
 readHosts?():Promise<DesktopHost[]>;
 readUserQuestions?(targets:UserQuestionTarget[]):Promise<UserQuestionSnapshot[]>;
 respondUserQuestion?(hostId:string,request:any,result:unknown):Promise<void>;
 connect():Promise<void>;send(message:unknown):Promise<void>;subscribe(listener:(message:any)=>void):()=>void;close():Promise<void>;
}
function approvalKey(hostId:string,threadId:unknown,id:unknown){return JSON.stringify([hostId,typeof threadId==='string'?threadId:null,id]);}
function questionFingerprint(request:any):string{
 const stable=(value:any):any=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
 return JSON.stringify(stable({method:request.method,params:request.params}));
}
export class DesktopControlChannel {
 readonly sessionId=randomUUID();
 private sequence=0;private connected=false;private disposed=false;private attemptedConnection=false;private lost=false;private unsubscribe?:()=>void;
 private listeners=new Set<(event:ControlEvent)=>void>();
 private pending=new Map<string,{hostId:string;method:string;write:boolean;resolve:(value:any)=>void;reject:(error:unknown)=>void;timer:ReturnType<typeof setTimeout>}>();
 private approvals=new Map<string,{hostId:string;request:any;submitted:boolean;managed?:boolean;receivedAt:number}>();
 private questionTargets=new Map<string,UserQuestionTarget>();private questionGeneration=0;private questionRefresh?:Promise<void>;private questionsResolvedDuringRefresh=new Set<string>();
 private approvalAttempts=new Map<string,{reject:(error:unknown)=>void;timer:ReturnType<typeof setTimeout>}>();
 constructor(private transport:ControlTransport){}
 async hosts(){if(!this.connected)throw new ControlError('CHANNEL_LOST','桌面通道未连接');return this.transport.readHosts?this.transport.readHosts():[{hostId:'local',displayName:'本机'}];}
 async connect(){if(this.disposed)throw new Error('通道已关闭');if(this.connected)return;if(this.attemptedConnection)throw new ControlError('CHANNEL_LOST','请关闭旧通道并创建新实例，以恢复快照和订阅');this.attemptedConnection=true;this.unsubscribe=this.transport.subscribe(m=>this.receive(m));try{await this.transport.connect();if(this.lost)throw new ControlError('CHANNEL_LOST','连接期间通道已失效');this.connected=true;}catch(e){this.unsubscribe();await this.transport.close();throw e;}}
 subscribe(listener:(event:ControlEvent)=>void){this.listeners.add(listener);return()=>{this.listeners.delete(listener);};}
 status(){return {connected:this.connected,channelSessionId:this.sessionId,sequence:this.sequence,capabilities:{structured:true,approvalSnapshot:false,userInputSnapshot:!!this.transport.readUserQuestions&&!!this.transport.respondUserQuestion,steering:true,chunkedMessages:true,dots:false}};}
 private emit(event:Omit<ControlEvent,'sequence'|'channelSessionId'>){const value={...event,sequence:++this.sequence,channelSessionId:this.sessionId};for(const listener of this.listeners){try{listener(value);}catch{/* 消费者错误不影响其他消费者 */}}}
 private receive(message:any){
  if(message?.type==='control-lost'){this.lose(message.reason??'桌面连接中断');return;}
  if(typeof message?.hostId!=='string')return;
  if(message.type==='mcp-response'){
   const reply=message.message,p=reply&&this.pending.get(String(reply.id));if(!p||p.hostId!==message.hostId)return;
   clearTimeout(p.timer);this.pending.delete(String(reply.id));
   if(reply.error){const large=reply.error.code==='RESPONSE_TOO_LARGE';p.reject(new ControlError(large?(p.write?'ACTION_WRITE_UNKNOWN':'RESPONSE_TOO_LARGE'):'UPSTREAM_ERROR',large&&p.write?'写入已提交但响应过大，请核对会话，不要重复发送':reply.error.message??'桌面请求失败',reply.error));}
   else p.resolve(['thread/turns/list','thread/items/list'].includes(p.method)&&reply.result&&typeof reply.result==='object'?{...reply.result,__desktopSnapshotSequence:this.sequence}:reply.result);return;
  }
  if(message.type==='mcp-notification'&&typeof message.method==='string'){
   if(message.method==='serverRequest/resolved'&&this.questionRefresh)this.questionsResolvedDuringRefresh.add(approvalKey(message.hostId,message.params?.threadId,message.params?.requestId));
   if(message.method==='serverRequest/resolved')for(const [id,a]of this.approvals)if(approvalKey(a.hostId,a.request.params?.threadId,a.request.id)===approvalKey(message.hostId,message.params?.threadId,message.params?.requestId)){this.approvals.delete(id);this.emit({hostId:a.hostId,method:'desktop/approval/resolved',params:{id,threadId:a.request.params?.threadId}});}
   this.emit({hostId:message.hostId,method:message.method,params:message.params});return;
  }
  if(message.type==='mcp-request'&&typeof message.request?.method==='string'&&approvalMethods.has(message.request.method)&&['string','number'].includes(typeof message.request.id)){
   const key=approvalKey(message.hostId,message.request.params?.threadId,message.request.id),existing=[...this.approvals].find(([,a])=>approvalKey(a.hostId,a.request.params?.threadId,a.request.id)===key);
   if(existing){if(message.request.method!=='item/tool/requestUserInput'||questionFingerprint(existing[1].request)===questionFingerprint(message.request))return;this.resolveApproval(existing[0],false);}
   const id=`control-approval:${randomUUID()}`;this.approvals.set(id,{hostId:message.hostId,request:message.request,submitted:false,receivedAt:this.sequence+1});this.emit({id,hostId:message.hostId,method:message.request.method,params:message.request.params});
  }
 }
 setUserQuestionTargets(targets:UserQuestionTarget[]){
  const next=new Map<string,UserQuestionTarget>();
  for(const target of targets){if(typeof target?.hostId!=='string'||!target.hostId||typeof target.threadId!=='string'||!target.threadId)continue;const key=JSON.stringify([target.hostId,target.threadId]);if(next.size<8)next.set(key,{hostId:target.hostId,threadId:target.threadId});}
  if(next.size!==this.questionTargets.size||[...next.keys()].some(key=>!this.questionTargets.has(key))){this.questionTargets=next;this.questionGeneration++;}
 }
 async refreshUserQuestions(targets:UserQuestionTarget[]):Promise<void>{
  this.setUserQuestionTargets(targets);
  if(!this.connected||this.disposed||!this.transport.readUserQuestions||this.questionTargets.size===0)return;
  if(this.questionRefresh)return this.questionRefresh;
  this.questionsResolvedDuringRefresh.clear();
  const generation=this.questionGeneration,at=this.sequence,requested=[...this.questionTargets.values()];
  const refresh=(async()=>{
   let snapshots:UserQuestionSnapshot[];try{snapshots=await this.transport.readUserQuestions!(requested);}catch{return;}
   if(!this.connected||this.disposed||generation!==this.questionGeneration||!Array.isArray(snapshots))return;
   for(const snapshot of snapshots){
    if(!snapshot||!Array.isArray(snapshot.requests)||!this.questionTargets.has(JSON.stringify([snapshot.hostId,snapshot.threadId])))continue;
    const requests=snapshot.requests.filter(request=>request?.method==='item/tool/requestUserInput'&&['string','number'].includes(typeof request.id)&&(!request.params?.threadId||request.params.threadId===snapshot.threadId));
    for(const [id,a]of this.approvals){if(a.hostId===snapshot.hostId&&a.request.params?.threadId===snapshot.threadId&&a.request.method==='item/tool/requestUserInput'&&a.receivedAt<=at&&!requests.some(request=>request.id===a.request.id))this.resolveApproval(id);}
    for(const raw of requests){
     if(this.questionsResolvedDuringRefresh.has(approvalKey(snapshot.hostId,snapshot.threadId,raw.id)))continue;
     const existing=[...this.approvals].find(([,a])=>approvalKey(a.hostId,a.request.params?.threadId,a.request.id)===approvalKey(snapshot.hostId,snapshot.threadId,raw.id));
     const request={...raw,params:{...raw.params,threadId:snapshot.threadId}};
     if(existing){
      const [existingId,a]=existing;
      if(a.request.method!=='item/tool/requestUserInput'||a.receivedAt>at)continue;
      if(questionFingerprint(a.request)===questionFingerprint(request)){a.managed=true;continue;}
      this.resolveApproval(existingId,false);
     }
     const id=`control-approval:${randomUUID()}`;this.approvals.set(id,{hostId:snapshot.hostId,request,submitted:false,managed:true,receivedAt:this.sequence+1});this.emit({id,hostId:snapshot.hostId,method:request.method,params:request.params});
    }
   }
  })();
  this.questionRefresh=refresh;try{await refresh;}finally{if(this.questionRefresh===refresh){this.questionRefresh=undefined;this.questionsResolvedDuringRefresh.clear();}}
 }
 private resolveApproval(id:string,remember=true){const a=this.approvals.get(id);if(!a)return;if(remember&&this.questionRefresh)this.questionsResolvedDuringRefresh.add(approvalKey(a.hostId,a.request.params?.threadId,a.request.id));this.approvals.delete(id);this.emit({hostId:a.hostId,method:'desktop/approval/resolved',params:{id,threadId:a.request.params?.threadId}});}
 async request(hostId:string,method:string,params:unknown={},timeoutMs=15000):Promise<any>{
  if(!this.connected)throw new ControlError('CHANNEL_LOST','桌面通道未连接');
  if(!hostId||typeof hostId!=='string'||!methods.has(method))throw new ControlError('UNSUPPORTED_METHOD',`不支持 ${method}`);
  if(!params||typeof params!=='object'||Array.isArray(params))throw new ControlError('INVALID_PARAMS','params 必须是对象');
  if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>120000)throw new ControlError('INVALID_PARAMS','超时必须为 1–120000 毫秒');
  const id=`mobile-control:${this.sessionId}:${randomUUID()}`,write=writeMethods.has(method);
  return new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{if(!this.pending.delete(id))return;reject(new ControlError(write?'ACTION_WRITE_UNKNOWN':'REQUEST_TIMEOUT',write?'已提交但未确认，不会重发':'读取请求超时'));},timeoutMs);
   this.pending.set(id,{hostId,method,write,resolve,reject,timer});
   void this.transport.send({type:'mcp-request',hostId,request:{id,method,params}}).catch(error=>{const p=this.pending.get(id);if(!p)return;clearTimeout(timer);this.pending.delete(id);reject(new ControlError(write?'ACTION_WRITE_UNKNOWN':'CHANNEL_LOST',String(error)));});
  });
 }
 pendingApprovals():ControlEvent[]{return [...this.approvals].filter(([,a])=>!a.submitted).map(([id,a])=>({id,hostId:a.hostId,method:a.request.method,params:a.request.params,channelSessionId:this.sessionId,sequence:this.sequence}));}
 async respond(id:string|number,result:unknown,timeoutMs=15000){
  const a=this.approvals.get(String(id));if(!this.connected||!a||a.submitted)throw new ControlError('APPROVAL_EXPIRED','审批已失效或已提交');
  if(!result||typeof result!=='object'||Array.isArray(result))throw new ControlError('INVALID_PARAMS','审批回答必须是对象');
  if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>120000)throw new ControlError('INVALID_PARAMS','无效审批超时');
  a.submitted=true;
  const key=String(id);
  return new Promise<void>((resolve,reject)=>{
   const timer=setTimeout(()=>{this.approvalAttempts.delete(key);reject(new ControlError('ACTION_WRITE_UNKNOWN','审批提交超时，不会重发'));},timeoutMs);
   this.approvalAttempts.set(key,{reject,timer});
   const submit=()=>a.managed&&this.transport.respondUserQuestion?this.transport.respondUserQuestion(a.hostId,a.request,result):this.transport.send({type:'mcp-response',hostId:a.hostId,...typeof a.request.params?.threadId==='string'?{threadId:a.request.params.threadId}:{},response:{id:a.request.id,result}});
   void Promise.resolve().then(submit).then(()=>{if(!this.approvalAttempts.delete(key))return;clearTimeout(timer);resolve();},error=>{
    if(!this.approvalAttempts.delete(key))return;clearTimeout(timer);
    if(error instanceof ControlError&&error.code==='APPROVAL_EXPIRED'){this.resolveApproval(key);reject(error);return;}
    if(error instanceof ControlError&&['HOST_UNAVAILABLE','INVALID_PARAMS'].includes(error.code)){a.submitted=false;reject(error);return;}
    reject(new ControlError('ACTION_WRITE_UNKNOWN',`审批提交结果未知，不会重发：${String(error)}`));
   });
  });
 }
 private lose(reason:string){this.questionGeneration++;this.questionTargets.clear();this.connected=false;this.lost=true;for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new ControlError(p.write?'ACTION_WRITE_UNKNOWN':'CHANNEL_LOST',reason));}for(const attempt of this.approvalAttempts.values()){clearTimeout(attempt.timer);attempt.reject(new ControlError('ACTION_WRITE_UNKNOWN',reason));}this.approvalAttempts.clear();this.pending.clear();this.approvals.clear();this.emit({method:'desktop/disconnected',params:{reason}});}
 async close(){if(this.disposed)return;this.disposed=true;this.lose('通道已关闭');this.unsubscribe?.();await this.transport.close();this.listeners.clear();}
}
export interface ControlEvent {id?:string|number;hostId?:string;method:string;params:any;channelSessionId:string;sequence:number}
export class ControlError extends Error {constructor(public code:string,message:string,public details?:unknown){super(message);}}
export const methods=new Set(['model/list','permissionProfile/list','fs/readFile','fs/createDirectory','fs/writeFile','project/list','project/read','thread/loaded/list','thread/list','thread/read','thread/search','thread/turns/list','thread/items/list','thread/start','thread/resume','turn/start','turn/steer','turn/interrupt']);
export interface DesktopHost {hostId:string;displayName:string}
const writeMethods=new Set(['thread/start','thread/resume','turn/start','turn/steer','turn/interrupt','fs/createDirectory','fs/writeFile']);
const approvalMethods=new Set(['item/commandExecution/requestApproval','item/fileChange/requestApproval','item/permissions/requestApproval','item/tool/requestUserInput','item/tool/requestOptionPicker','mcpServer/elicitation/request']);
