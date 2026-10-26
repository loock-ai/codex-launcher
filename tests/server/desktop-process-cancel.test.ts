// @vitest-environment node
import {expect,it,vi,afterEach} from 'vitest';
const f=vi.hoisted(()=>({query:vi.fn()}));
vi.mock('../../server/launcher/platform.js',async importOriginal=>({...await importOriginal<any>(),runPlatformCommand:f.query}));
import {forceStopDesktop} from '../../server/launcher/desktop-process.js';
afterEach(()=>vi.restoreAllMocks());
it('枚举进程期间取消后不执行任何kill',async()=>{
 let current=true,finish!:(value:string)=>void;f.query.mockImplementation(()=>new Promise(resolve=>{finish=resolve}));const kill=vi.spyOn(process,'kill').mockImplementation(()=>true);
 const stopping=forceStopDesktop('/fake/ChatGPT.app/Contents/MacOS/ChatGPT','darwin',()=>current);await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));current=false;finish('12345 /fake/ChatGPT.app/Contents/MacOS/ChatGPT\n');await stopping;expect(kill).not.toHaveBeenCalled();
});
