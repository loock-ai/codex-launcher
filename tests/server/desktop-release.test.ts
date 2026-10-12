import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error release utility is deliberately standalone Node ESM
import { resolveVersion, releaseConfig, collectArtifacts, generateIndex, verifyUpdaterSignature, publicationMode, validateInstallerArtifacts } from '../../scripts/desktop-release.mjs';

// Interoperability vector from jedisct1/rust-minisign-verify 0.3.0 verify_prehashed.
const publicKey = Buffer.from('untrusted comment: minisign public key E7620F1842B4E81F\nRWQf6LRCGA9i53mlYecO4IzT51TGPpvWucNSCh1CBM0QTaLn73Y7GFO3').toString('base64');
const signature = Buffer.from('untrusted comment: signature from minisign secret key\nRUQf6LRCGA9i559r3g7V1qNyJDApGip8MfqcadIgT9CuhV3EMhHoN1mGTkUidF/z7SrlQgXdy8ofjb7bNJJylDOocrCo8KLzZwo=\ntrusted comment: timestamp:1556193335\tfile:test\ny/rUw2y8/hOUYjZU71eHp/Wo1KZ40fGy2VJEDl34XMJM+TX48Ss/17u3IvIfbVR1FkZZSNCisQbuQY+bHwhEBg==').toString('base64');

describe('独立桌面发布' , () => {
  it('只递增桌面tag且拒绝不安全版本和已存在tag', () => {
    expect(resolveVersion('1.0.0', ['desktop-v0.1.9'])).toBe('1.0.0');
    expect(() => resolveVersion('0.1.0', ['desktop-v1.0.0'], '0.9.0')).toThrow();
    expect(resolveVersion('0.1.0', ['v99.0.0'])).toBe('0.1.0');
    expect(resolveVersion('0.1.0', ['desktop-v0.1.9','desktop-v0.2.0'])).toBe('0.2.1');
    expect(() => resolveVersion('0.1.0', [], '1.0.0\nBAD=1')).toThrow();
    expect(() => resolveVersion('0.1.0', [], '01.0.0')).toThrow();
    expect(() => resolveVersion('0.1.0', ['desktop-v1.0.0'], '1.0.0')).toThrow();
  });
  it('正式配置需要公钥，使用独立固定频道', () => {
    expect(() => releaseConfig('0.1.0','loock-ai/codex-launcher','',true)).toThrow();
    const config = releaseConfig('0.1.0','loock-ai/codex-launcher','public-key',true);
    expect(config.bundle.createUpdaterArtifacts).toBe(true);
    expect(config.plugins.updater.endpoints[0]).toContain('/desktop-updates/latest.json');
  });
  it('索引必须有三个平台的完整资产，拒绝被篡改的包', () => {
    const root = mkdtempSync(join(tmpdir(),'desktop-release-'));
    for (const platform of ['darwin-aarch64','darwin-x86_64','windows-x86_64']) {
      const arch = platform.split('-')[1];
      const source = join(root,platform); mkdirSync(source);
      writeFileSync(join(source,'App.dmg'),'dmg');
      writeFileSync(join(source,'App.app.tar.gz'),'test');
      writeFileSync(join(source,'App.app.tar.gz.sig'),signature);
      if (platform.startsWith('windows')) {
        writeFileSync(join(source,'App-setup.exe'),'test');
        writeFileSync(join(source,'App-setup.exe.sig'),signature);
      }
      collectArtifacts(source, join(root,'out'), '0.1.0', arch, true, publicKey, platform);
    }
    const index = generateIndex(join(root,'out'),'0.1.0','loock-ai/codex-launcher',publicKey);
    expect(Object.keys(index.platforms)).toEqual(['darwin-aarch64','darwin-x86_64','windows-x86_64']);
    expect(index.platforms['windows-x86_64'].url).toMatch(/windows-x86_64\.exe$/);
    expect(index.platforms['darwin-aarch64'].signature).toBe(signature);
    const winManifest = join(root,'out','manifest-windows-x86_64.json');
    renameSync(winManifest, `${winManifest}.held`);
    expect(() => generateIndex(join(root,'out'),'0.1.0','loock-ai/codex-launcher',publicKey)).toThrow();
    renameSync(`${winManifest}.held`, winManifest);
    writeFileSync(join(root,'out','CodexLauncher-0.1.0-darwin-aarch64.app.tar.gz'),'tampered');
    expect(() => generateIndex(join(root,'out'),'0.1.0','loock-ai/codex-launcher',publicKey)).toThrow(/hash/);
  });
  it('缺失或不匹配的签名不能进入发布资产', () => {
    const root = mkdtempSync(join(tmpdir(),'desktop-missing-'));
    writeFileSync(join(root,'App.dmg'),'dmg');
    writeFileSync(join(root,'App.app.tar.gz'),'test');
    expect(() => collectArtifacts(root,join(root,'out'),'0.1.0','aarch64',true)).toThrow();
    writeFileSync(join(root,'Other.app.tar.gz.sig'),'signature');
    expect(() => collectArtifacts(root,join(root,'out'),'0.1.0','aarch64',true)).toThrow(/mismatch/);
  });
  it('验签使用官方测试向量，拒绝错误公钥、包和可信注释', () => {
    expect(verifyUpdaterSignature(Buffer.from('test'),signature,publicKey)).toBe(true);
    expect(() => verifyUpdaterSignature(Buffer.from('tamper'),signature,publicKey)).toThrow();
    const keyText = Buffer.from(publicKey,'base64').toString().replace('53mlY','53nlY');
    expect(() => verifyUpdaterSignature(Buffer.from('test'),signature,Buffer.from(keyText).toString('base64'))).toThrow();
    const changed = Buffer.from(signature,'base64').toString().replace('file:test','file:evil');
    expect(() => verifyUpdaterSignature(Buffer.from('test'),Buffer.from(changed).toString('base64'),publicKey)).toThrow();
  });
  it('workflow隔离latest且只在main完成所有构建后发布', () => {
    const workflow = readFileSync('.github/workflows/build-desktop.yml','utf8');
    expect(workflow).toContain("github.ref == 'refs/heads/main'");
    expect(workflow).toContain('needs: [version, verify, build]');
    expect(workflow).toContain('runner: windows-latest');
    expect(workflow).toContain('shell: bash');
    expect(workflow).toContain('npm run typecheck');
    expect(workflow).toContain('npm test');
    expect(workflow).toContain('contents: read');
    expect(workflow).toContain('cancel-in-progress: false');
    const script = readFileSync('scripts/desktop-release.mjs','utf8');
    expect(script).toContain("'--latest=false'");
    expect(script).not.toContain("'--latest'");
  });
});

it('main发布安装包不依赖更新签名，只有密钥齐全才更新频道',()=>{
 const main={ref:'refs/heads/main',event:'push',requested:false};
 expect(publicationMode({...main,privateKeyAvailable:false,publicKey:''})).toMatchObject({publish:true,signed:false});
 expect(publicationMode({...main,privateKeyAvailable:true,publicKey:'key'})).toMatchObject({publish:true,signed:true});
 expect(publicationMode({...main,privateKeyAvailable:true,publicKey:''})).toMatchObject({publish:true,signed:false});
 expect(publicationMode({...main,ref:'refs/heads/feature',privateKeyAvailable:true,publicKey:'key'}).publish).toBe(false);
 expect(publicationMode({...main,event:'workflow_dispatch',privateKeyAvailable:true,publicKey:'key'}).publish).toBe(false);
 expect(publicationMode({...main,event:'workflow_dispatch',requested:true,privateKeyAvailable:false,publicKey:''})).toMatchObject({publish:true,signed:false});
});
it('未签名发布要求三个平台安装包齐全且哈希正确',()=>{
 const root=mkdtempSync(join(tmpdir(),'desktop-installers-'));
 const output=join(root,'out');
 for(const platform of ['darwin-aarch64','darwin-x86_64','windows-x86_64']){
  const source=join(root,platform);mkdirSync(source);
  writeFileSync(join(source,platform.startsWith('windows')?'App.exe':'App.dmg'),platform);
  collectArtifacts(source,output,'0.1.0',platform.split('-')[1],false,'',platform);
 }
 expect(validateInstallerArtifacts(output,'0.1.0').map((p:string)=>p.split('/').at(-1))).toEqual([
  'CodexLauncher-0.1.0-darwin-aarch64.dmg',
  'CodexLauncher-0.1.0-darwin-x86_64.dmg',
  'CodexLauncher-0.1.0-windows-x86_64.exe',
 ]);
 const win=join(output,'manifest-windows-x86_64.json');renameSync(win,win+'.held');
 expect(()=>validateInstallerArtifacts(output,'0.1.0')).toThrow();renameSync(win+'.held',win);
 writeFileSync(join(output,'CodexLauncher-0.1.0-darwin-aarch64.dmg'),'tampered');
 expect(()=>validateInstallerArtifacts(output,'0.1.0')).toThrow(/hash/);
});
