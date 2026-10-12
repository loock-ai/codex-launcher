import {it,expect,vi} from 'vitest';
const mocks=vi.hoisted(()=>({invoke:vi.fn(async()=>({})),listen:vi.fn()}));
vi.mock('@tauri-apps/api/core',()=>({invoke:mocks.invoke}));
vi.mock('@tauri-apps/api/event',()=>({listen:mocks.listen}));
vi.mock('@tauri-apps/plugin-updater',()=>({check:vi.fn()}));
import {check} from '@tauri-apps/plugin-updater';
import {createTauriApi} from '../../launcher/tauri-api';
it('插件操作身份与参数转发且重启走有清理的宿主命令',async()=>{const api=createTauriApi();await api.invokePlugin('demo','config.save',{enabled:true});expect(mocks.invoke).toHaveBeenCalledWith('launcher_call',{method:'invokePlugin',args:['demo','config.save',{enabled:true}]});await api.update!.relaunch();expect(mocks.invoke).toHaveBeenCalledWith('restart_launcher')});
it('在异步事件监听建立前卸载会立即释放稍后建立的监听',async()=>{let ready!:(fn:()=>void)=>void;mocks.listen.mockReturnValue(new Promise(r=>ready=r));const fn=vi.fn(),release=vi.fn();const off=createTauriApi().subscribe(fn);off();ready(release);await Promise.resolve();expect(release).toHaveBeenCalledOnce()});

it('下载中离开页面延后释放，防止下载完成后的Rust资源遗留',async()=>{let finish!:()=>void;const close=vi.fn(async()=>{});vi.mocked(check).mockResolvedValue({version:'2',body:'',download:()=>new Promise<void>(r=>{finish=r}),install:async()=>{},close} as any);const update=await createTauriApi().update!.check();const download=update!.download(()=>{});const cleanup=update!.close!();expect(close).not.toHaveBeenCalled();finish();await download;await cleanup;expect(close).toHaveBeenCalledOnce()});
