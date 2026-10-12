// @vitest-environment node
import {it,expect} from 'vitest';
import {createRequire} from 'node:module';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const {resolveConfigDirectory}=createRequire(import.meta.url)('../../launcher/config-directory.cjs');
it('Electron迁移插件、设置和访问口令，不重置或覆盖已有目录',()=>{
 const root=mkdtempSync(join(tmpdir(),'launcher-config-'));
 try{
  const home=join(root,'home'),data=join(root,'data'),old=join(data,'codex-mobile');
  mkdirSync(join(old,'plugins/demo'),{recursive:true});
  writeFileSync(join(old,'config.json'),'saved-token');
  writeFileSync(join(old,'plugins/demo/inject.js'),'user-code');
  const dest=resolveConfigDirectory(home,data);
  expect(dest).toBe(join(home,'.codex-launcher'));
  expect(readFileSync(join(dest,'config.json'),'utf8')).toBe('saved-token');
  expect(readFileSync(join(dest,'plugins/demo/inject.js'),'utf8')).toBe('user-code');
  expect(existsSync(old)).toBe(false);
  mkdirSync(old,{recursive:true});writeFileSync(join(old,'config.json'),'older');
  expect(resolveConfigDirectory(home,data)).toBe(dest);
  expect(readFileSync(join(dest,'config.json'),'utf8')).toBe('saved-token');
  expect(readFileSync(join(old,'config.json'),'utf8')).toBe('older');
  expect(resolveConfigDirectory(home,data,join(root,'custom'))).toBe(join(root,'custom'));
 }finally{rmSync(root,{recursive:true,force:true});}
});
