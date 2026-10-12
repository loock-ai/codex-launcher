// @vitest-environment node
import {it,expect} from 'vitest';
import {createRequire} from 'node:module';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const require=createRequire(import.meta.url);
it('插件协议按固定host解析身份，交controller校验资源并返回受限CSP和MIME',async()=>{const{createPluginProtocolHandler}=require('../../launcher/plugin-protocol.cjs');const dir=await mkdtemp(join(tmpdir(),'ui-protocol-'));try{await writeFile(join(dir,'index.html'),'<h1>fixture</h1>');const calls:any[]=[];const handler=createPluginProtocolHandler({resolvePluginUiAsset:async(id:string,asset:string)=>{calls.push([id,asset]);return join(dir,'index.html')}});const response=await handler({url:'launcher-plugin://plugin/Example/ui/index.html'});expect(await response.text()).toBe('<h1>fixture</h1>');expect(calls).toEqual([['Example','ui/index.html']]);expect(response.headers.get('Content-Type')).toContain('text/html');expect(response.headers.get('Content-Security-Policy')).toContain("connect-src 'none'");expect(response.headers.get('Content-Security-Policy')).toContain("script-src 'self'");expect((await handler({url:'launcher-plugin://other/Example/ui/index.html'})).status).toBe(403);expect((await handler({url:'launcher-plugin://plugin/Example/ui/%2e%2e%2fsecret'})).status).toBe(403);}finally{await rm(dir,{recursive:true,force:true})}});
it('协议不返回校验失败的宿主文件',async()=>{const{createPluginProtocolHandler}=require('../../launcher/plugin-protocol.cjs');const response=await createPluginProtocolHandler({resolvePluginUiAsset:async()=>{throw Error('outside plugin')}})({url:'launcher-plugin://plugin/test/ui/main.js'});expect(response.status).toBe(403);expect(await response.text()).not.toContain('outside plugin')});
