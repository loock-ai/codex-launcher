// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {openNativeManager,closeNativeManager,NativeControlTransport} from '../../server/cdp/native-control-transport.js';
afterEach(()=>{document.head.replaceChildren();delete (window as any).__nativeFixture;});
it('从已加载服务取得同一本机RPC句柄，仅读取时不启动新的服务',async()=>{
 const entry=document.createElement('script');entry.type='module';entry.src='/assets/123456.abcdef.js';document.head.append(entry);
 const dispose=vi.fn(),sendRequest=vi.fn(async(method:string)=>method==='thread/loaded/list'?{data:['existing-thread']}:{status:'connected'});
 const manager={sendRequest,[Symbol.dispose]:dispose};
 const open=vi.fn(async()=>({status:'ready',manager}));
 await openNativeManager('__nativeFixture',async()=>({__webpack_require__:{c:{host:{exports:{setAppServices(){},appServices:{appServerManagers:{open}}}}}}}));
 expect(open).toHaveBeenCalledExactlyOnceWith('local');
 expect(await (window as any).__nativeFixture.manager.sendRequest('thread/loaded/list',{})).toEqual({data:['existing-thread']});
 closeNativeManager('__nativeFixture');
 expect(dispose).toHaveBeenCalledOnce();
 expect((window as any).__nativeFixture).toBeUndefined();
});
it('停止后晚到的原生句柄立即释放，避免在桌面残留新连接',async()=>{
 const entry=document.createElement('script');entry.type='module';entry.src='/assets/123456.abcdef.js';document.head.append(entry);
 let finish!:(value:any)=>void;
 const dispose=vi.fn(),open=vi.fn(()=>new Promise(resolve=>{finish=resolve;}));
 const work=openNativeManager('__nativeFixture',async()=>({__webpack_require__:{c:{host:{exports:{setAppServices(){},appServices:{appServerManagers:{open}}}}}}}));
 await vi.waitFor(()=>expect(open).toHaveBeenCalledOnce());
 closeNativeManager('__nativeFixture');
 finish({status:'ready',manager:{[Symbol.dispose]:dispose}});
 await expect(work).rejects.toThrow(/关闭|取消/);
 expect(dispose).toHaveBeenCalledOnce();
 expect((window as any).__nativeFixture).toBeUndefined();
});
it('原生业务拒绝保留JSON-RPC错误码，不被当作连接丢失',async()=>{
 (window as any).__nativeFixture={manager:{sendRequest:async()=>{throw Object.assign(Error('invalid thread'),{jsonRpcCode:-32602});}}};
 const {sendNativeRequest}=await import('../../server/cdp/native-control-transport.js');
 expect(await sendNativeRequest({key:'__nativeFixture',method:'thread/read',params:{threadId:'invalid'}})).toEqual({error:{code:-32602,message:'invalid thread',data:undefined}});
});

it('原生模式保留桌面远程机器目录并按hostId路由其他机器',async()=>{
 const transport=new NativeControlTransport('http://127.0.0.1:9333');
 const hosts=[{hostId:'local',displayName:'本机'},{hostId:'ssh:mini',displayName:'Mac mini'}];
 const base={readHosts:vi.fn(async()=>hosts),send:vi.fn(async()=>{})};
 const evaluate=vi.fn();Object.assign(transport,{base,page:{evaluate}});
 expect(await transport.readHosts()).toEqual(hosts);
 const request={type:'mcp-request',hostId:'ssh:mini',request:{id:'fixture',method:'thread/list',params:{}}};
 await transport.send(request);
 expect(base.send).toHaveBeenCalledExactlyOnceWith(request);
 expect(evaluate).not.toHaveBeenCalled();
});
