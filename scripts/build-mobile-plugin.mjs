import {build} from 'esbuild';
import {cp,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
await build({entryPoints:[root+'plugins/mobile/main.ts'],outfile:root+'plugins/mobile/main.cjs',bundle:true,platform:'node',format:'cjs',target:'node20',packages:'external'});
await rm(root+'plugins/mobile/web',{recursive:true,force:true});
await cp(root+'dist',root+'plugins/mobile/web',{recursive:true});
