// @vitest-environment node
import {afterEach,expect,it,vi} from 'vitest';
const f=vi.hoisted(()=>{const frame={};const handlers=new Map<string,Function>();const page={url:()=> 'app://-/index.html',isClosed:()=>false,mainFrame:()=>frame,on:(name:string,fn:Function)=>handlers.set(name,fn),evaluate:vi.fn()};const browser={contexts:()=>[{pages:()=>[page]}],on:vi.fn(),close:vi.fn(async()=>{})};return{page,browser,frame,handlers,connect:vi.fn(async()=>browser)}});
vi.mock('playwright-core',()=>({chromium:{connectOverCDP:f.connect}}));
import {CdpControlTransport} from '../../server/cdp/control-transport.js';
afterEach(()=>{vi.useRealTimers();vi.clearAllMocks();f.handlers.clear()});
it('同文档导航保留有效监听，页面真正重载才断开',async()=>{
 vi.useFakeTimers();f.page.evaluate.mockResolvedValue([]);const events:any[]=[];const transport=new CdpControlTransport('http://127.0.0.1:9333');transport.subscribe(e=>events.push(e));await transport.connect();
 f.handlers.get('framenavigated')!(f.frame);await vi.advanceTimersByTimeAsync(1);expect(events).toEqual([]);
 f.page.evaluate.mockResolvedValue(false);f.handlers.get('framenavigated')!(f.frame);await vi.advanceTimersByTimeAsync(1);expect(events).toHaveLength(1);expect(events[0].type).toBe('control-lost');await transport.close();
});
it('renderer无响应触发断链，关闭不会永远等待挂起的evaluate',async()=>{
 vi.useFakeTimers();f.page.evaluate.mockResolvedValueOnce({bridge:true}).mockImplementation(()=>new Promise(()=>{}));
 const events:any[]=[];const transport=new CdpControlTransport('http://127.0.0.1:9333');transport.subscribe(e=>events.push(e));await transport.connect();await vi.advanceTimersByTimeAsync(6000);
 expect(events).toHaveLength(1);expect(events[0].reason).toContain('超时');
 const closing=transport.close();await vi.advanceTimersByTimeAsync(2000);await closing;expect(f.browser.close).toHaveBeenCalledOnce();
});
