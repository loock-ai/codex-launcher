// Trusted local plugins execute in their own Node process; this is not a sandbox.
const pending=new Map(),actions=new Map(),listeners=new Set(),cleanups=[];
const controller=new AbortController();let sequence=0,runtime={};
const send=message=>{if(process.connected)process.send(message)};
function host(method,params){return new Promise((resolve,reject)=>{const id=++sequence;const timer=setTimeout(()=>{pending.delete(id);reject(Object.assign(Error('宿主请求超时，写入结果未知'),{code:'ACTION_WRITE_UNKNOWN'}))},45000);pending.set(id,{resolve,reject,timer});send({kind:'host',id,method,params})})}
process.on('message',async message=>{
 if(message.kind==='reply'){const p=pending.get(message.id);if(p){pending.delete(message.id);clearTimeout(p.timer);message.error?p.reject(Object.assign(Error(message.error),{code:message.errorCode})):p.resolve(message.result)}return}
 if(message.kind==='event'){for(const listener of listeners)Promise.resolve().then(()=>listener(message.event)).catch(e=>send({kind:'log',message:String(e)}));return}
 if(message.kind!=='request')return;
 try{let result;
 switch(message.method){
 case 'activate':{const ctx={pluginDir:message.params.pluginDir,dataDir:message.params.dataDir,signal:controller.signal,onDispose(fn){cleanups.push(fn)},log(...args){send({kind:'log',message:args.map(String).join(' ')})},actions:{register(name,handler){if(actions.has(name))throw Error('重复 action: '+name);actions.set(name,handler);return ()=>actions.delete(name)}},config:{read:defaults=>host('config.read',defaults),write:value=>host('config.write',value)},host:{call:(method,params)=>host('bridge.call',{method,params}),subscribe(fn){listeners.add(fn);return ()=>listeners.delete(fn)}},status:{publish(status){send({kind:'status',status})}}};const module=require(message.params.entry);if(typeof module.activate!=='function')throw Error('main 必须导出 activate');runtime=await module.activate(ctx)||{};break}
 case 'start':result=await runtime.start?.();break;
 case 'stop':result=await runtime.stop?.();break;
 case 'deactivate':controller.abort();await runtime.deactivate?.();for(const cleanup of cleanups.splice(0).reverse())await cleanup();listeners.clear();break;
 case 'invoke':{const {action,args}=message.params;const fn=actions.get(action);if(fn)result=await fn(args);else if(action==='status.get')result=await runtime.getStatus?.();else throw Error('未知插件 action: '+action);break}
 default:throw Error('未知生命周期');
 }send({kind:'response',id:message.id,result});}catch(error){send({kind:'response',id:message.id,error:error instanceof Error?error.message:String(error),errorCode:error?.code})}
});
process.on('disconnect',()=>process.exit(0));
