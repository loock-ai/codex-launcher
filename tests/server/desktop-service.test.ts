// @vitest-environment node
import {it,expect,vi} from 'vitest';
import {DesktopService} from '../../server/launcher/desktop-service.js';
function fixture(){let listener:(event:any)=>void=()=>{};const channel={connect:vi.fn(async()=>{}),close:vi.fn(async()=>{}),subscribe:(fn:any)=>{listener=fn;return()=>{};},status:()=>({connected:true}),hosts:async()=>[],pendingApprovals:()=>[],request:vi.fn(async(..._args:any[]):Promise<any>=>({ok:true})),respond:async()=>{},setUserQuestionTargets:vi.fn(),refreshUserQuestions:vi.fn(async()=>{})};const transport={apply:vi.fn(async()=>{}),dispose:vi.fn(async()=>{}),close:vi.fn(async()=>{})};const events:any[]=[];const service=new DesktopService({appPath:'/fixture/ChatGPT.app',cdpPort:19340},{ensure:async()=>{},createChannel:()=>channel as any,pluginTransport:()=>transport,onEvent:(owner,event)=>events.push({owner,event})});return {service,channel,transport,events,emit:(event:any)=>listener(event)};}
it('Mobile释放租约后注入插件仍持有共享通道，最后一个消费者退出才关闭',async()=>{const {service,channel,transport}=fixture();const mobile=await service.call('mobile','desktop.acquire') as any;await service.call('time','desktop.inject',{source:'context.onDispose(()=>{})'});expect(channel.connect).toHaveBeenCalledTimes(1);expect(service.status().consumers).toBe(2);await service.call('mobile','desktop.release',mobile);expect(channel.close).not.toHaveBeenCalled();expect(transport.dispose).not.toHaveBeenCalled();expect(service.status().consumers).toBe(1);await service.release('time');expect(transport.dispose).toHaveBeenCalledTimes(1);expect(channel.close).toHaveBeenCalledTimes(1);});
it('租约隔离请求和事件，清理一个插件只移除它的问题订阅',async()=>{const {service,channel,events,emit}=fixture();const a=await service.call('a','desktop.acquire') as any,b=await service.call('b','desktop.acquire') as any;await expect(service.call('b','desktop.control.request',{...a,method:'thread/list'})).rejects.toThrow('租约');await service.call('a','desktop.control.setUserQuestionTargets',{...a,targets:[{hostId:'local',threadId:'a'}]});await service.call('b','desktop.control.setUserQuestionTargets',{...b,targets:[{hostId:'remote',threadId:'b'}]});emit({type:'fixture'});expect(events.map(e=>e.owner)).toEqual(['a','b']);await service.release('a');expect(channel.setUserQuestionTargets).toHaveBeenLastCalledWith([{hostId:'remote',threadId:'b'}]);await service.release('b');});
it('注入失败归还租约，桌面不可用返回可等待的错误码',async()=>{const {service,channel,transport}=fixture();transport.apply.mockRejectedValueOnce(Error('bad') as never);await expect(service.call('time','desktop.inject',{source:'bad'})).rejects.toThrow('bad');expect(service.status().consumers).toBe(0);expect(channel.close).toHaveBeenCalled();const unavailable=new DesktopService({appPath:'/fake.app',cdpPort:1234},{ensure:async()=>{throw Error('not ready')}});await expect(unavailable.call('mobile','desktop.acquire')).rejects.toMatchObject({code:'DESKTOP_NOT_READY'});});
it('仍有消费者时禁止更换共享设置或强制重启',async()=>{const {service}=fixture();await service.call('a','desktop.acquire');expect(()=>service.updateSettings({appPath:'/other.app',cdpPort:9334})).toThrow('停止');await expect(service.restart()).rejects.toThrow('停止');await service.shutdown();});

it('窗口与bridge稍晚就绪时进入等待，真实脚本异常仍原样报告',async()=>{const {service,channel,transport}=fixture();channel.connect.mockRejectedValueOnce(Error('无法唯一识别桌面主窗口'));await expect(service.call('mobile','desktop.acquire')).rejects.toMatchObject({code:'DESKTOP_NOT_READY'});transport.apply.mockRejectedValueOnce(Error('等待桌面 bridge 就绪') as never);await expect(service.call('time','desktop.inject',{source:'test'})).rejects.toMatchObject({code:'DESKTOP_NOT_READY'});transport.apply.mockRejectedValueOnce(Error('script bug') as never);await expect(service.call('time','desktop.inject',{source:'test'})).rejects.toThrow('script bug');expect(service.status().consumers).toBe(0);});

it('健康检查使用只读已加载任务探测，运行中与未知远端不会当作空闲',async()=>{
 const {service,channel}=fixture();await service.call('a','desktop.acquire');
 channel.request.mockImplementation(async(_host:string,method:string)=>method==='thread/loaded/list'?{data:['t'],nextCursor:null}:{thread:{status:{type:'active'}}});
 expect(await service.health()).toMatchObject({healthy:true,activity:'busy'});
 channel.request.mockImplementation(async(_host:string,method:string)=>method==='thread/loaded/list'?{data:[],nextCursor:null}:{});
 expect(await service.health()).toMatchObject({healthy:true,activity:'idle'});
 channel.hosts=async()=>[{hostId:'remote',displayName:'remote'}] as any;
 channel.request.mockImplementation(async(host:string)=>{if(host==='remote')throw Error('offline');return {data:[],nextCursor:null}});
 expect(await service.health()).toMatchObject({healthy:true,activity:'unknown'});await service.shutdown();
});
it('已有桌面消费者时仍能修改恢复策略，不能偷换端口',async()=>{
 const {service}=fixture();await service.call('a','desktop.acquire');
 service.updateSettings({appPath:'/fixture/ChatGPT.app',cdpPort:19340,autoReconnect:false});expect(service.status().autoReconnect).toBe(false);
 expect(()=>service.updateSettings({appPath:'/fixture/ChatGPT.app',cdpPort:19341})).toThrow('停止');await service.shutdown();
});
it('注入刷新挂起不会永久占用释放队列',async()=>{
 vi.useFakeTimers();let refresh!:()=>void;
 const transport={apply:vi.fn(async()=>{}),dispose:vi.fn(async()=>{}),close:vi.fn(async()=>{})};
 const channel={connect:async()=>{},close:async()=>{},subscribe:()=>()=>{},status:()=>({connected:true}),setUserQuestionTargets:()=>{}};
 const service=new DesktopService({appPath:'/fake.app',cdpPort:19340},{ensure:async()=>{},createChannel:()=>channel as any,pluginTransport:(_endpoint,callback)=>{refresh=callback;return transport}});
 try{await service.call('time','desktop.inject',{source:'x'});transport.apply.mockImplementationOnce(()=>new Promise(()=>{}));refresh();const release=service.release('time');await vi.advanceTimersByTimeAsync(16000);await release;expect(service.status().consumers).toBe(0);}finally{vi.useRealTimers();await service.shutdown()}
});
it('自动启动中的二次acquire在取消后不能分配连接或租约',async()=>{
 let current=true,finish!:()=>void;const create=vi.fn();
 const service=new DesktopService({appPath:'/fake.app',cdpPort:19340},{ensure:()=>new Promise<void>(resolve=>{finish=resolve}),createChannel:create});
 const pending=service.withRecoveryGuard('a',()=>current,()=>service.call('a','desktop.acquire'));
 await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));current=false;finish();await expect(pending).rejects.toMatchObject({code:'RECOVERY_CANCELLED'});expect(create).not.toHaveBeenCalled();expect(service.status().consumers).toBe(0);
});
