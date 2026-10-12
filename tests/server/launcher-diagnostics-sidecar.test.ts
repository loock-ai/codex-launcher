// @vitest-environment node
import {afterEach,expect,test} from 'vitest';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {once} from 'node:events';
const roots:string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(x=>rm(x,{recursive:true,force:true})));});
test('real noDesktop sidecar persists RPC errors, plugin summary and final flushed snapshot without protocol secrets',async()=>{
 const root=await mkdtemp(join(tmpdir(),'launcher-diag-process-'));roots.push(root);await mkdir(join(root,'plugins/demo'),{recursive:true});await mkdir(join(root,'plugin-data/mobile'),{recursive:true});await writeFile(join(root,'plugin-data/mobile/config.json'),JSON.stringify({token:'saved-mobile-secret'}));
 await writeFile(join(root,'plugins/demo/manifest.json'),JSON.stringify({id:'demo',entrypoints:{main:'main.cjs'},defaultEnabled:true}));await writeFile(join(root,'plugins/demo/main.cjs'),`exports.activate=ctx=>{ctx.log('plugin token=url-secret saved-mobile-secret');ctx.actions.register('error',()=>{throw Object.assign(Error('authorization: Bearer header-secret saved-mobile-secret'),{code:'TEST_ERROR'})});return {getStatus(){return {}}}}`);
 const child=spawn(process.execPath,['--import','tsx',resolve('server/launcher/sidecar.ts'),'--config',join(root,'config.json'),'--root',root,'--no-desktop'],{stdio:'pipe'});const exited=once(child,'exit');let buf='',stderr='';const messages:any[]=[];child.stderr.on('data',x=>stderr+=x);child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{buf+=chunk;let n;while((n=buf.indexOf('\n'))>=0){messages.push(JSON.parse(buf.slice(0,n)));buf=buf.slice(n+1);}});
 const wait=async(predicate:(v:any)=>boolean)=>{const end=Date.now()+5000;while(Date.now()<end){const i=messages.findIndex(predicate);if(i>=0)return messages.splice(i,1)[0];await new Promise(r=>setTimeout(r,10));}throw Error(stderr||'sidecar timeout');};let seq=0;const call=async(method:string,...args:unknown[])=>{const id=++seq;child.stdin.write(JSON.stringify({id,method,args})+'\n');return wait(m=>m.id===id);};
 try{
  await wait(x=>x.event==='ready');expect((await call('status')).result.desktop.connected).toBe(false);expect((await call('listPlugins')).result.plugins[0].state).toBe('stopped');
  expect((await call('invokePlugin','demo','error',{secret:'never-save-rpc-args'})).error.code).toBe('TEST_ERROR');
  const diagnosticFile=join(root,'launcher-diagnostics.json');let rpcError:any;const end=Date.now()+5000;while(Date.now()<end){try{rpcError=JSON.parse(await readFile(diagnosticFile,'utf8')).error;}catch{}if(rpcError?.code==='TEST_ERROR')break;await new Promise(r=>setTimeout(r,10));}expect(rpcError).toEqual({method:'invokePlugin',message:'authorization: [REDACTED] [REDACTED]',code:'TEST_ERROR'});
  for(const value of [{message:4},{message:'x',args:'never-save-rpc-args'},{message:'x',source:4},{message:'x'.repeat(4001)}])expect((await call('reportError',value)).error.code).toBe('INVALID_PARAMS');
  expect((await call('reportError',{message:'password=ui-secret saved-mobile-secret',source:'ui'})).result).toBeNull();
  expect((await call('status')).result.desktop.connected).toBe(false);await call('shutdown');await exited;expect(child.exitCode).toBe(0);
  const file=join(root,'launcher-diagnostics.json');const raw=await readFile(file,'utf8'),data=JSON.parse(raw);for(const s of ['saved-mobile-secret','url-secret','header-secret','ui-secret','never-save-rpc-args'])expect(raw).not.toContain(s);expect(data.desktop.connected).toBe(false);expect(data.plugins[0]).toEqual({id:'demo',state:'stopped',error:''});expect(data.error.method).toBe('ui');expect(data.error.message).toContain('[REDACTED]');expect(data.logs.join('\n')).toContain('plugin token=[REDACTED]');expect((await stat(file)).mode&0o777).toBe(0o600);
 }finally{if(child.exitCode===null){child.kill('SIGKILL');await exited;}}
});

test('initialize failure is flushed before the real Node sidecar exits',async()=>{
 const root=await mkdtemp(join(tmpdir(),'launcher-diag-init-'));roots.push(root);await writeFile(join(root,'config.json'),JSON.stringify({schemaVersion:123,token:'never-save-config'}));
 const child=spawn(process.execPath,['--import','tsx',resolve('server/launcher/sidecar.ts'),'--config',join(root,'config.json'),'--root',root,'--no-desktop'],{stdio:'pipe'});child.stdout.resume();child.stderr.resume();await once(child,'exit');expect(child.exitCode).toBe(1);
 const raw=await readFile(join(root,'launcher-diagnostics.json'),'utf8');expect(raw).not.toContain('never-save-config');expect(JSON.parse(raw).error).toEqual({method:'initialize',message:'不支持的启动器配置版本'});
});
