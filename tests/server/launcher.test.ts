// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { mkdtemp, stat, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultConfig, validateConfig, saveConfig, loadConfig, startArguments } from '../../server/launcher/config.js';

describe('启动器配置', () => {
  it('拒绝任意远端 CDP、无口令 LAN 和冲突端口', () => {
    expect(() => validateConfig({...defaultConfig(), cdpPort: -1})).toThrow();
    expect(() => validateConfig({...defaultConfig(), token: ''})).toThrow();
    expect(() => validateConfig({...defaultConfig(), gatewayPort: 9222, cdpPort: 9222})).toThrow();
    expect(() => validateConfig({...defaultConfig(), mode: 'shell' as any})).toThrow();
  });
  it('原模式配置保存后回读，权限为 0600，未知字段不保留', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'launcher-'));
    const file = join(dir,'config.json');
    const config = {...defaultConfig(), mode: 'managed' as const, gatewayPort: 19901};
    await saveConfig(file, {...config, injected: 'bad'} as any);
    expect(await loadConfig(file)).toEqual(config);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(await readFile(file,'utf8')).not.toContain('injected');
  });
  it('CDP 与原 app-server 使用独立启动参数，不经过 shell', () => {
    const cdp = startArguments(defaultConfig());
    expect(cdp.command).toBe('control');
    expect(cdp.environment.CODEX_MOBILE_CDP_URL).toBe('http://127.0.0.1:9333');
    const old = startArguments({...defaultConfig(),mode:'external',upstreamUrl:'ws://127.0.0.1:18765'});
    expect(old.command).toBe('start');
    expect(old.environment.CODEX_APP_SERVER_MODE).toBe('external');
  });
  it('已有 CDP 端口保持原值，仅新配置采用新默认值', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'launcher-existing-'));
    const file = join(dir, 'config.json');
    await saveConfig(file, {...defaultConfig(), cdpPort: 9222});
    const previous = await readFile(file, 'utf8');
    expect((await loadConfig(file)).cdpPort).toBe(9222);
    expect(await readFile(file, 'utf8')).toBe(previous);
    expect((await loadConfig(join(dir, 'new.json'))).cdpPort).toBe(9333);
  });
});

import {writeFile,mkdir,rm} from 'node:fs/promises';
import {discoverDesktopCli} from '../../server/launcher/config.js';
it('CLI 从所选 Desktop 安装包布局查找，不回退全局 PATH',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'desktop-layout-')),app=join(dir,'ChatGPT.app'),resources=join(app,'Contents/Resources/codex-cli');
 await mkdir(join(resources,'bin'),{recursive:true});await writeFile(join(resources,'codex-package.json'),JSON.stringify({layoutVersion:1,entrypoint:'bin/codex'}));await writeFile(join(resources,'bin/codex'),'#!/bin/sh\nexit 0\n',{mode:0o700});
 expect(discoverDesktopCli(app)).toBe(join(resources,'bin/codex'));
 expect(()=>discoverDesktopCli(join(dir,'Missing.app'))).toThrow('Desktop');
});
import {desktopProcessIds} from '../../server/launcher/desktop-process.js';
it('强制终止仅匹配配置安装包的准确主进程路径',()=>{
 const target='/Applications/ChatGPT.app/Contents/MacOS/ChatGPT';
 expect(desktopProcessIds(`123 ${target}\n124 /Other/ChatGPT.app/Contents/MacOS/ChatGPT\n125 ${target} Helper\n1 ${target}\n${process.pid} ${target}`,target)).toEqual([123]);
});
