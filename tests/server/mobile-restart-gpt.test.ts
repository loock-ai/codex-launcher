// @vitest-environment node
import {it,expect,vi,afterEach} from 'vitest';
import {LauncherController} from '../../server/launcher/controller.js';
afterEach(()=>vi.useRealTimers());
it('手机重启请求先返回回执，随后复用桌面强制重启入口并合并重复请求',async()=>{
 vi.useFakeTimers();
 const controller=new LauncherController('/tmp/unused-launcher-fixture/config.json','/tmp/unused-launcher-fixture');
 const restart=vi.spyOn(controller,'restartDesktop').mockResolvedValue({} as any);
 try{
  expect(await (controller as any).callHost('mobile','desktop.restart',{})).toEqual({accepted:true});
  await (controller as any).callHost('mobile','desktop.restart',{});
  expect(restart).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(300);
  expect(restart).toHaveBeenCalledOnce();
 }finally{await controller.stop();}
});

it('退出后拒绝迟到的手机重启请求',async()=>{
 const controller=new LauncherController('/tmp/unused-launcher-fixture/config.json','/tmp/unused-launcher-fixture');
 const restart=vi.spyOn(controller,'restartDesktop').mockResolvedValue({} as any);
 await controller.stop();
 await expect((controller as any).callHost('mobile','desktop.restart',{})).rejects.toThrow('正在退出');
 expect(restart).not.toHaveBeenCalled();
});
it('已入队但未执行的手机重启会被退出操作取消',async()=>{
 vi.useFakeTimers();
 const controller=new LauncherController('/tmp/unused-launcher-fixture/config.json','/tmp/unused-launcher-fixture');
 let release!:()=>void;
 (controller as any).queue=new Promise<void>(resolve=>{release=resolve;});
 const desktopRestart=vi.fn();
 (controller as any).desktop={restart:desktopRestart,shutdown:async()=>{},status:()=>({})};
 try{
  await (controller as any).callHost('mobile','desktop.restart',{});
  await vi.advanceTimersByTimeAsync(300);
  const stopping=controller.stop();release();await stopping;
  expect(desktopRestart).not.toHaveBeenCalled();
 }finally{vi.useRealTimers();}
});
