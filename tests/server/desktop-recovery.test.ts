// @vitest-environment node
import {expect,it} from 'vitest';
import {DesktopRecovery} from '../../server/launcher/desktop-recovery.js';
const down={wanted:true,healthy:false,restartable:true,activity:'unknown' as const};
it('先重连，经过宽限与失败次数后才重启，并遵守冷却',()=>{
 const r=new DesktopRecovery();r.decide({...down,healthy:true,activity:'idle'},0,{});
 expect(r.decide(down,1000,{})).toBe('reconnect');
 expect(r.decide(down,1100,{})).toBeNull();
 for(const at of [4000,10000,21000,42000])expect(r.decide(down,at,{})).toBe('reconnect');
 expect(r.decide(down,73000,{})).toBe('restart');
 expect(r.decide(down,104000,{restartDuringTasks:true})).toBe('reconnect');
});
it('活动任务和未知状态阻止自动重启，显式允许才覆盖保护',()=>{
 for(const activity of ['busy','unknown'] as const){
  const r=new DesktopRecovery();r.decide({...down,healthy:true,activity},0,{});
  for(const at of [1000,4000,10000,21000,42000])r.decide(down,at,{});
  expect(r.decide(down,73000,{})).toBe('reconnect');
  expect(r.decide(down,104000,{restartDuringTasks:true})).toBe('restart');
 }
});
it('关闭恢复或停止全部桌面插件后不拉起，恢复成功重置故障计数',()=>{
 const r=new DesktopRecovery();expect(r.decide(down,0,{autoReconnect:false})).toBeNull();
 expect(r.decide({...down,wanted:false},1000,{})).toBeNull();
 expect(r.decide(down,2000,{})).toBe('reconnect');
 r.decide({...down,healthy:true,activity:'idle'},3000,{});expect(r.status().attempts).toBe(0);
});
it('休眠醒来不会立即重启；非CDP故障也不重启',()=>{
 const r=new DesktopRecovery();for(const at of [0,3000,9000,20000,41000])r.decide(down,at,{restartDuringTasks:true});
 expect(r.decide(down,400000,{restartDuringTasks:true})).toBe('reconnect');
 for(const at of [403000,409000,420000,441000])r.decide({...down,restartable:false},at,{restartDuringTasks:true});
 expect(r.decide({...down,restartable:false},472000,{restartDuringTasks:true})).toBe('reconnect');
});
it('持续故障一小时最多自动重启三次',()=>{
 const r=new DesktopRecovery();let restarts=0;for(let now=0;now<3600000;now+=5000)if(r.decide(down,now,{restartDuringTasks:true})==='restart')restarts++;expect(restarts).toBe(3);
});
it('等待插件不累计桌面故障，也不能用旧空闲快照覆盖新的活动状态',()=>{
 const r=new DesktopRecovery();r.decide({...down,healthy:true,activity:'idle'},0,{});
 for(const now of [1000,4000,10000,21000,42000])r.decide({...down,healthy:true,activity:'busy',pendingPlugins:true},now,{});
 expect(r.decide(down,73000,{})).toBe('reconnect');
 for(const now of [76000,82000,93000,114000])r.decide(down,now,{});
 expect(r.decide(down,145000,{})).toBe('reconnect');
});
