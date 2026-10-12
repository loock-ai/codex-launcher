// @vitest-environment node
import {afterEach,expect,test} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,stat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {LauncherDiagnostics} from '../../server/launcher/diagnostics.js';
const roots:string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(x=>rm(x,{recursive:true,force:true})));});
test('atomic private whitelist snapshots and redaction cover URL, headers and stored mobile token',async()=>{
 const root=await mkdtemp(join(tmpdir(),'launcher-diag-'));roots.push(root);await mkdir(join(root,'plugin-data/mobile'),{recursive:true});await writeFile(join(root,'plugin-data/mobile/config.json'),JSON.stringify({token:'stored-secret',password:'never-copy-config'}));
 const d=new LauncherDiagnostics(join(root,'config.json'));let snap:any={desktop:{connected:false,consumers:0,error:'https://x.test/?token=url-secret&password=pwd-secret',appPath:'/private/path'},logs:[],config:{token:'never-copy-config'}};
 d.setSnapshotSource(()=>({status:snap,plugins:[{id:'demo',state:'error',error:'Authorization: Bearer header-secret',path:'/private/plugin',result:'never-copy-result'}]}));
 d.append('stored-secret authorization="Bearer json-secret" password: log-secret');d.recordError('invokePlugin',Object.assign(Error('token=error-secret'),{code:'FAILED',args:'never-copy-args'}));d.schedule();await d.flush();
 const raw=await readFile(join(root,'launcher-diagnostics.json'),'utf8');for(const secret of ['stored-secret','url-secret','pwd-secret','header-secret','json-secret','log-secret','error-secret','never-copy','/private'])expect(raw).not.toContain(secret);
 const data=JSON.parse(raw);expect(Object.keys(data).sort()).toEqual(['desktop','error','logs','plugins','timestamp']);expect(data.error).toEqual({method:'invokePlugin',message:'token=[REDACTED]',code:'FAILED'});expect(Object.keys(data.desktop).sort()).toEqual(['connected','consumers','error']);expect((await stat(join(root,'launcher-diagnostics.json'))).mode&0o777).toBe(0o600);
 snap={desktop:{connected:false,consumers:0,error:''},logs:[]};for(let i=0;i<100;i++)d.append('line '+i);await d.flush();expect(JSON.parse(await readFile(join(root,'launcher-diagnostics.json'),'utf8')).logs).toHaveLength(80);
});
