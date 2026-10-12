import {randomBytes} from 'node:crypto';
import {mkdir,readFile,writeFile,rename,rm} from 'node:fs/promises';
import {dirname,join} from 'node:path';

type SnapshotSource=()=>{status:unknown;plugins:unknown[]};
const object=(x:unknown):Record<string,unknown>=>x&&typeof x==='object'?x as Record<string,unknown>:{};
/** 独立于协议的持久诊断：只采集状态白名单与脱敏后的短日志。 */
export class LauncherDiagnostics {
 readonly file:string;
 private source?:SnapshotSource;
 private timer?:ReturnType<typeof setTimeout>;
 private pending:Promise<void>=Promise.resolve();
 private logs:string[]=[];
 private seen=new Set<string>();
 private secrets=new Set<string>();
 private lastError?:{method:string;message:string;code?:string};
 constructor(private configFile:string){this.file=join(dirname(configFile),'launcher-diagnostics.json');}
 setSnapshotSource(source:SnapshotSource){this.source=source;}
 append(message:string){this.logs.push(message);this.logs=this.logs.slice(-80);this.schedule();}
 recordError(method:string,error:unknown){const e=object(error);this.lastError={method:method.slice(0,100),message:error instanceof Error?error.message:typeof e.message==='string'?e.message:'后台发生未知错误',...(typeof e.code==='string'?{code:e.code.slice(0,100)}:{})};this.schedule();}
 schedule(){if(this.timer)clearTimeout(this.timer);this.timer=setTimeout(()=>{this.timer=undefined;void this.write();},30);this.timer.unref();}
 private async redactor(){
  // 每次写入重新读 token，使首次迁移和运行中轮换也得到脱敏；不保存配置。
  let token='';try{const value=JSON.parse(await readFile(join(dirname(this.configFile),'plugin-data/mobile/config.json'),'utf8'));if(typeof value.token==='string')token=value.token;}catch{}
  if(token)this.secrets.add(token);
  return (value:unknown)=>{
   let s=typeof value==='string'?value:'';
   for(const secret of this.secrets)s=s.split(secret).join('[REDACTED]');
   s=s.replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi,'$1[REDACTED]@');
   s=s.replace(/(authorization["']?\s*[:=]\s*["']?)(?:Bearer\s+|Basic\s+)?[^\s,;"'<>]+/gi,'$1[REDACTED]');
   s=s.replace(/((?:[\w-]*token|password|passwd|api[_-]?key|secret)["']?\s*[:=]\s*["']?)[^\s&#,;"'<>]+/gi,'$1[REDACTED]');
   return s.slice(0,1000);
  };
 }
 private write(){
  const next=this.pending.then(async()=>{
   let state:{status:unknown;plugins:unknown[]}={status:{},plugins:[]};try{if(this.source)state=this.source();}catch{}
   const status=object(state.status),desktop=object(status.desktop);
   if(Array.isArray(status.logs))for(const line of status.logs){if(typeof line==='string'&&!this.seen.has(line)){this.seen.add(line);this.logs.push(line);}}
   this.seen=new Set(Array.isArray(status.logs)?status.logs.filter((x):x is string=>typeof x==='string'):[]);this.logs=this.logs.slice(-80);
   const redact=await this.redactor();
   const snapshot={timestamp:new Date().toISOString(),desktop:{connected:desktop.connected===true,consumers:typeof desktop.consumers==='number'?desktop.consumers:0,error:redact(desktop.error)},plugins:state.plugins.map(value=>{const p=object(value);return {id:redact(p.id),state:redact(p.state),error:redact(p.error)};}),logs:this.logs.map(redact),...(this.lastError?{error:{method:redact(this.lastError.method),message:redact(this.lastError.message),...(this.lastError.code?{code:redact(this.lastError.code)}:{})}}:{})};
   await mkdir(dirname(this.file),{recursive:true,mode:0o700});const temp=this.file+'.'+process.pid+'.'+randomBytes(6).toString('hex')+'.tmp';
   try{await writeFile(temp,JSON.stringify(snapshot,null,2)+'\n',{flag:'wx',mode:0o600});await rename(temp,this.file);}finally{await rm(temp,{force:true});}
  });
  // 不使用 console，避免诊断文件写入失败触发日志递归。
  this.pending=next.catch(()=>{});return this.pending;
 }
 async flush(timeoutMs=1000){if(this.timer){clearTimeout(this.timer);this.timer=undefined;}const work=this.write();let timer:ReturnType<typeof setTimeout>|undefined;await Promise.race([work,new Promise<void>(resolve=>{timer=setTimeout(resolve,timeoutMs);})]);if(timer)clearTimeout(timer);}
}
