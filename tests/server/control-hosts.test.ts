// @vitest-environment jsdom
import {it,expect,vi,afterEach} from 'vitest';
import {readDesktopHosts} from '../../server/cdp/control-transport.js';
afterEach(()=>{document.head.innerHTML='';vi.useRealTimers();vi.restoreAllMocks();delete (window as any).electronBridge;});
function moduleLink(){const link=document.createElement('link');link.rel='modulepreload';link.href=new URL('/assets/app-shared-new.js',location.href).href;document.head.append(link);}
it('旧版共享状态保留标识和名称，不暴露凭据，不加载其他模块',async()=>{
 (window as any).electronBridge={getSharedObjectSnapshotValue:(key:string)=>key==='remote_ssh_connections'?[{hostId:'remote-ssh-discovered:macmini',displayName:'macmini',autoConnect:true,identity:'private-key-path'},{hostId:'disabled',autoConnect:false}]:[]};
 const loader=vi.fn();
 expect(await readDesktopHosts(loader)).toEqual([{hostId:'local',displayName:'本机'},{hostId:'remote-ssh-discovered:macmini',displayName:'macmini'}]);expect(loader).not.toHaveBeenCalled();
});
it('新版从目录订阅读取SSH、WSL和远控，过滤禁用与重复ID并释放订阅',async()=>{
 (window as any).electronBridge={getSharedObjectSnapshotValue:()=>undefined};moduleLink();
 const unsubscribe=vi.fn(),dispose=vi.fn();
 const subscribe=vi.fn(async(callback:any)=>{callback({ssh:[{hostId:'ssh:mini',displayName:'mini',autoConnect:true,key:'secret'},{hostId:'disabled',autoConnect:false}],wsl:[{hostId:'wsl:ubuntu'}],remoteControl:[{hostId:'rc:mac',displayName:'mac'},{hostId:'ssh:mini',displayName:'duplicate'}]});return {unsubscribe,[Symbol.dispose]:dispose};});
 const loader=vi.fn(async()=>({changedExport:{remoteConnections:{catalog:{subscribe}}}}));
 expect(await readDesktopHosts(loader)).toEqual([{hostId:'local',displayName:'本机'},{hostId:'ssh:mini',displayName:'mini'},{hostId:'wsl:ubuntu',displayName:'wsl:ubuntu'},{hostId:'rc:mac',displayName:'mac'}]);
 expect(subscribe).toHaveBeenCalledOnce();expect(unsubscribe).toHaveBeenCalledOnce();expect(dispose).toHaveBeenCalledOnce();
});
it('超时之后到达的订阅也清理，不遗留监听或迟到主机',async()=>{
 vi.useFakeTimers();moduleLink();(window as any).electronBridge={getSharedObjectSnapshotValue:()=>undefined};
 let finish!:(value:any)=>void;const unsubscribe=vi.fn(),dispose=vi.fn();
 const work=readDesktopHosts(async()=>({s:{remoteConnections:{catalog:{subscribe:()=>new Promise(resolve=>{finish=resolve})}}}}));
 const rejected=expect(work).rejects.toThrow('超时');await vi.advanceTimersByTimeAsync(8000);await rejected;
 finish({unsubscribe,[Symbol.dispose]:dispose});await vi.advanceTimersByTimeAsync(0);expect(unsubscribe).toHaveBeenCalledOnce();expect(dispose).toHaveBeenCalledOnce();
});
it('不导入异源或非共享模块，接口缺失应报错而不是假装只有本机',async()=>{
 (window as any).electronBridge={getSharedObjectSnapshotValue:()=>undefined};
 document.head.innerHTML='<link rel="modulepreload" href="https://other.invalid/assets/app-shared-bad.js"><link rel="modulepreload" href="/assets/unrelated.js">';
 const loader=vi.fn();await expect(readDesktopHosts(loader)).rejects.toThrow('远程主机');expect(loader).not.toHaveBeenCalled();
});
