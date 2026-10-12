import {build} from 'vite';
import react from '@vitejs/plugin-react';
import {resolve} from 'node:path';
import {mkdir,copyFile} from 'node:fs/promises';
await build({configFile:false,root:resolve('launcher'),base:'./',plugins:[react()],build:{outDir:resolve('launcher-ui'),emptyOutDir:true}});

await mkdir(resolve('npm-dist/server/launcher'),{recursive:true});
await copyFile(resolve('server/launcher/plugin-process-worker.cjs'),resolve('npm-dist/server/launcher/plugin-process-worker.cjs'));
