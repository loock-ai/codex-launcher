// @vitest-environment node
import {expect,it} from 'vitest';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
it('命令在初始化后执行，已有实例命令也能启动并打开 Web',async()=>{
 const {createCommandHandler}=require('../../launcher/commands.cjs');
 const events:string[]=[];
 let ready!:()=>void;
 const initialized=new Promise<void>(resolve=>{ready=resolve;});
 const run=createCommandHandler({ready:initialized,start:async()=>{events.push('start');},openWeb:async()=>{events.push('open');},showPanel:()=>events.push('panel')});
 const first=run(['app','--open-web']);await Promise.resolve();expect(events).toEqual([]);
 ready();await first;await run(['app','--open-web']);expect(events).toEqual(['start','open','start','open']);
 await run(['app']);expect(events.slice(-2)).toEqual(['panel','start']);
});
it('连接失败不打开网页，后续命令仍可继续',async()=>{
 const {createCommandHandler}=require('../../launcher/commands.cjs');
 let fail=true;const events:string[]=[];
 const run=createCommandHandler({ready:Promise.resolve(),start:async()=>{if(fail)throw new Error('CDP unavailable');},openWeb:async()=>{events.push('open');},showPanel:()=>{}});
 await expect(run(['--open-web'])).rejects.toThrow('CDP unavailable');expect(events).toEqual([]);
 fail=false;await run(['--open-web']);expect(events).toEqual(['open']);
});
it('普通启动自动启动服务，先展示面板且不弹出浏览器',async()=>{
 const {createCommandHandler}=require('../../launcher/commands.cjs');const events:string[]=[];let ready!:()=>void;
 const run=createCommandHandler({ready:new Promise<void>(r=>{ready=r}),showPanel:()=>events.push('panel'),start:async()=>events.push('start'),openWeb:async()=>events.push('browser')});
 const opening=run(['app']);await Promise.resolve();expect(events).toEqual([]);ready();await opening;expect(events).toEqual(['panel','start']);
});
it('自动启动失败仍已展示面板，后续启动可以恢复',async()=>{
 const {createCommandHandler}=require('../../launcher/commands.cjs');let fail=true;const events:string[]=[];
 const run=createCommandHandler({ready:Promise.resolve(),showPanel:()=>events.push('panel'),start:async()=>{events.push('start');if(fail)throw Error('未连接');},openWeb:async()=>events.push('browser')});
 await expect(run(['app'])).rejects.toThrow('未连接');expect(events).toEqual(['panel','start']);fail=false;await run(['app']);expect(events).toEqual(['panel','start','panel','start']);
});
