import { readFileSync, writeFileSync, appendFileSync, readdirSync, mkdirSync, copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { createHash, createPublicKey, verify } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const stable = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export function validateVersion(value) {
  if (!stable.test(value) || value.split('.').some(n => !Number.isSafeInteger(Number(n)))) throw new Error('Invalid desktop version');
  return value;
}
function repository(value) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(value)) throw new Error('Invalid repository');
  return value;
}
export function resolveVersion(base, tags, requested = '') {
  validateVersion(base);
  if (!Array.isArray(tags) || tags.some(tag => typeof tag !== 'string')) throw new Error('Invalid tags response');
  const versions = tags.filter(t => t.startsWith('desktop-v')).map(t => validateVersion(t.slice(9)));
  const compare = (a,b) => { const x=a.split('.').map(Number), y=b.split('.').map(Number); return x[0]-y[0] || x[1]-y[1] || x[2]-y[2]; };
  if (requested && versions.some(v => compare(validateVersion(requested),v) <= 0)) throw new Error('Desktop version must increase');
  let version = requested ? validateVersion(requested) : base;
  if (!requested && versions.length) {
    const sorted = versions.map(v => v.split('.').map(Number)).sort((a,b) => a[0]-b[0] || a[1]-b[1] || a[2]-b[2]);
    const [major,minor,patch] = sorted.at(-1);
    const next = validateVersion(`${major}.${minor}.${patch+1}`);
    version = compare(base,next) > 0 ? base : next;
  }
  if (tags.includes(`desktop-v${version}`)) throw new Error('Desktop tag already exists');
  return version;
}
export function publicationMode({ref,event,requested,privateKeyAvailable,publicKey}) {
  const publish = ref === 'refs/heads/main' && (event === 'push' || (event === 'workflow_dispatch' && requested));
  const signed = publish && Boolean(privateKeyAvailable && publicKey?.trim());
  return {publish,signed,notice:publish && !signed ? '更新签名尚未配置，发布安装包但不更新自动更新频道' : ''};
}
export function releaseConfig(version, repo, publicKey, signed) {
  validateVersion(version); repository(repo);
  if (signed && !publicKey?.trim()) throw new Error('Missing TAURI_UPDATER_PUBLIC_KEY');
  return { version, bundle: { createUpdaterArtifacts: signed }, plugins: { updater: {
    pubkey: publicKey?.trim() || '', endpoints: [`https://github.com/${repo}/releases/download/desktop-updates/latest.json`],
  } } };
}
// Mirrors minisign-verify 0.3.0 and tauri-plugin-updater verify_signature:
// Ed25519 over Blake2b-512 (ED), plus the signature + trusted-comment signature.
function decodeBase64(value) {
  if (typeof value !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value) || !value) throw new Error('Invalid minisign base64');
  return Buffer.from(value,'base64');
}
export function verifyUpdaterSignature(data, encodedSignature, encodedPublicKey) {
  const keyLines = decodeBase64(encodedPublicKey?.trim()).toString('utf8').trimEnd().split(/\r?\n/);
  const sigLines = decodeBase64(encodedSignature?.trim()).toString('utf8').trimEnd().split(/\r?\n/);
  if (keyLines.length !== 2 || sigLines.length !== 4 || !sigLines[2].startsWith('trusted comment: ')) throw new Error('Invalid minisign document');
  const key = decodeBase64(keyLines[1]);
  const sig = decodeBase64(sigLines[1]);
  const global = decodeBase64(sigLines[3]);
  if (key.length !== 42 || sig.length !== 74 || global.length !== 64 || !['Ed','ED'].includes(key.subarray(0,2).toString()) || !['Ed','ED'].includes(sig.subarray(0,2).toString())) throw new Error('Invalid minisign algorithm or size');
  if (!key.subarray(2,10).equals(sig.subarray(2,10))) throw new Error('Minisign key ID mismatch');
  const publicKey = createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),key.subarray(10)]),format:'der',type:'spki'});
  const message = sig.subarray(0,2).toString() === 'ED' ? createHash('blake2b512').update(data).digest() : data;
  if (!verify(null,message,publicKey,sig.subarray(10)) || !verify(null,Buffer.concat([sig.subarray(10),Buffer.from(sigLines[2].slice(17))]),publicKey,global)) throw new Error('Invalid updater signature');
  return true;
}
function files(root) {
  return readdirSync(root,{withFileTypes:true}).flatMap(e => e.isDirectory() ? files(join(root,e.name)) : [join(root,e.name)]);
}
function digest(path) { return createHash('sha256').update(readFileSync(path)).digest('hex'); }
export function collectArtifacts(source, output, version, arch, signed, publicKey, platform = `darwin-${arch}`) {
  validateVersion(version);
  if (!['darwin-aarch64','darwin-x86_64','windows-x86_64'].includes(platform) || platform.split('-')[1] !== arch) throw new Error('Invalid platform/architecture');
  const updateExt = platform.startsWith('windows-') ? '.exe' : '.app.tar.gz';
  const extensions = platform.startsWith('windows-') ? ['.exe'] : ['.dmg'];
  if (signed) extensions.push(...(updateExt === '.exe' ? ['.exe.sig'] : ['.app.tar.gz','.app.tar.gz.sig']));
  mkdirSync(output,{recursive:true});
  const all = files(source);
  if (signed) {
    const archive = all.filter(p => p.endsWith(updateExt));
    const signatures = all.filter(p => p.endsWith(`${updateExt}.sig`));
    if (archive.length !== 1 || signatures.length !== 1 || signatures[0] !== `${archive[0]}.sig`) throw new Error('Updater archive/signature mismatch');
    verifyUpdaterSignature(readFileSync(archive[0]),readFileSync(signatures[0],'utf8'),publicKey);
  }
  const entries = {};
  for (const extension of extensions) {
    const matches = all.filter(p => p.endsWith(extension));
    if (matches.length !== 1 || !readFileSync(matches[0]).length) throw new Error(`Expected one nonempty ${extension}`);
    const name = `CodexLauncher-${version}-${platform}${extension}`;
    copyFileSync(matches[0],join(output,name));
    entries[extension] = { name, sha256: digest(join(output,name)) };
  }
  writeFileSync(join(output,`manifest-${platform}.json`),JSON.stringify({version,arch,platform,entries},null,2));
}
export function validateInstallerArtifacts(root, version) {
  validateVersion(version);
  return ['darwin-aarch64','darwin-x86_64','windows-x86_64'].map(platform => {
    const manifest = JSON.parse(readFileSync(join(root,`manifest-${platform}.json`),'utf8'));
    const extension = platform.startsWith('windows-') ? '.exe' : '.dmg';
    const item = manifest.entries[extension];
    if (manifest.version !== version || manifest.platform !== platform || manifest.arch !== platform.split('-')[1]) throw new Error('Manifest version/architecture mismatch');
    if (!item || item.name !== `CodexLauncher-${version}-${platform}${extension}`) throw new Error('Installer name mismatch');
    const path = join(root,item.name);
    if (!readFileSync(path).length || digest(path) !== item.sha256) throw new Error('Installer hash mismatch');
    return path;
  });
}
export function generateIndex(root, version, repo, publicKey) {
  validateVersion(version); repository(repo);
  const platforms = {};
  for (const platform of ['darwin-aarch64','darwin-x86_64','windows-x86_64']) {
    const arch = platform.split('-')[1];
    const updateExt = platform.startsWith('windows-') ? '.exe' : '.app.tar.gz';
    const extensions = platform.startsWith('windows-') ? ['.exe','.exe.sig'] : ['.dmg','.app.tar.gz','.app.tar.gz.sig'];
    const manifest = JSON.parse(readFileSync(join(root,`manifest-${platform}.json`),'utf8'));
    if (manifest.version !== version || manifest.arch !== arch || manifest.platform !== platform) throw new Error('Manifest version/architecture mismatch');
    for (const ext of extensions) {
      const item = manifest.entries[ext];
      if (!item || item.name !== `CodexLauncher-${version}-${platform}${ext}` || digest(join(root,item.name)) !== item.sha256) throw new Error('Artifact hash/name mismatch');
    }
    const archive = manifest.entries[updateExt].name;
    const signature = readFileSync(join(root,manifest.entries[`${updateExt}.sig`].name),'utf8').trim();
    verifyUpdaterSignature(readFileSync(join(root,archive)),signature,publicKey);
    platforms[platform] = { signature, url: `https://github.com/${repo}/releases/download/desktop-v${version}/${archive}` };
  }
  return { version, notes: `Codex Launcher ${version}`, pub_date: new Date().toISOString(), platforms };
}
const gh = (...args) => execFileSync('gh',args,{encoding:'utf8',stdio:['ignore','pipe','inherit']}).trim();
function tags(repo) {
  const pages = JSON.parse(gh('api',`repos/${repository(repo)}/tags?per_page=100`,'--paginate','--slurp'));
  return pages.flat().map(item => item.name);
}
function publish(root, version, repo, signed) {
  if (process.env.GITHUB_REF !== 'refs/heads/main') throw new Error('Publishing requires main');
  resolveVersion(version,tags(repo),version); // recheck immediately before creating release
  const installers = validateInstallerArtifacts(root,version);
  const index = signed ? generateIndex(root,version,repo,process.env.TAURI_UPDATER_PUBLIC_KEY) : null;
  const tag = `desktop-v${version}`;
  const assets = signed ? files(root).filter(p => /\.(dmg|gz|sig|exe)$/.test(p)) : installers;
  const checksumPath = join(root,'SHA256SUMS.txt');
  writeFileSync(checksumPath,assets.map(path => `${digest(path)}  ${basename(path)}`).join('\n')+'\n');
  assets.push(checksumPath);
  const notesPath = join(root,'RELEASE-NOTES.md');
  writeFileSync(notesPath,readFileSync(new URL('../docs/desktop-release-notes.md',import.meta.url),'utf8'));
  gh('release','create',tag,...assets,'--repo',repo,'--target',process.env.GITHUB_SHA,'--title',`Codex Launcher ${version}`,'--notes-file',notesPath,'--draft','--latest=false');
  // Read back all uploaded asset sizes before publishing and advancing the channel.
  const published = JSON.parse(gh('release','view',tag,'--repo',repo,'--json','assets'));
  for (const asset of assets) {
    if (!published.assets.some(a => a.name === basename(asset) && a.size === readFileSync(asset).length)) throw new Error('Release upload verification failed');
  }
  const verification = mkdtempSync(join(tmpdir(),'desktop-upload-'));
  try {
    gh('release','download',tag,'--repo',repo,'--dir',verification);
    for (const asset of assets) {
      if (digest(asset) !== digest(join(verification,basename(asset)))) throw new Error('Uploaded artifact hash mismatch');
    }
  } finally { rmSync(verification,{recursive:true,force:true}); }
  gh('release','edit',tag,'--repo',repo,'--draft=false','--latest=false');
  if (!signed) return;
  const releases = JSON.parse(gh('api',`repos/${repo}/releases?per_page=100`,'--paginate','--slurp')).flat();
  if (!releases.some(r => r.tag_name === 'desktop-updates')) {
    gh('release','create','desktop-updates','--repo',repo,'--target',process.env.GITHUB_SHA,'--title','Desktop update channel','--notes','Desktop updater index; independent of mobile latest.','--prerelease','--latest=false');
  }
  const indexPath = join(root,'latest.json'); writeFileSync(indexPath,JSON.stringify(index,null,2));
  gh('release','upload','desktop-updates',indexPath,'--repo',repo,'--clobber');
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [command,...args] = process.argv.slice(2);
  const repo = process.env.GITHUB_REPOSITORY;
  if (command === 'mode') {
    const mode = publicationMode({ref:process.env.GITHUB_REF,event:process.env.GITHUB_EVENT_NAME,requested:process.env.REQUEST_PUBLISH==='true',privateKeyAvailable:process.env.HAS_SIGNING_PRIVATE_KEY==='true',publicKey:process.env.TAURI_UPDATER_PUBLIC_KEY});
    appendFileSync(process.env.GITHUB_OUTPUT,`publish=${mode.publish}\nsigned=${mode.signed}\n`);
    if(mode.notice)console.log('::notice::'+mode.notice);
  } else if (command === 'version') {
    const version = resolveVersion(JSON.parse(readFileSync('desktop-version.json','utf8')).version,tags(repo),process.env.REQUESTED_VERSION || '');
    appendFileSync(process.env.GITHUB_OUTPUT,`version=${version}\n`);
  } else if (command === 'config') {
    const signed = process.env.SIGNED === 'true';
    if (signed && !process.env.TAURI_SIGNING_PRIVATE_KEY) throw new Error('Missing TAURI_SIGNING_PRIVATE_KEY');
    writeFileSync('tauri.release.conf.json',JSON.stringify(releaseConfig(process.env.DESKTOP_VERSION,repo,process.env.TAURI_UPDATER_PUBLIC_KEY,signed),null,2));
  } else if (command === 'collect') collectArtifacts(args[0],args[1],process.env.DESKTOP_VERSION,process.env.DESKTOP_ARCH,process.env.SIGNED === 'true',process.env.TAURI_UPDATER_PUBLIC_KEY,process.env.DESKTOP_PLATFORM);
  else if (command === 'publish') publish(args[0],process.env.DESKTOP_VERSION,repo,process.env.SIGNED === 'true');
  else throw new Error('Unknown desktop release command');
}
