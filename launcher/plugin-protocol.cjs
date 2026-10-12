const {readFile}=require('node:fs/promises');
const {extname}=require('node:path');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.woff':'font/woff','.woff2':'font/woff2'};
exports.createPluginProtocolHandler=controller=>async request=>{
 try{
  const url=new URL(request.url);
  if(url.protocol!=='launcher-plugin:'||url.hostname!=='plugin'||url.port||url.username||url.password)throw Error('invalid origin');
  const segments=url.pathname.slice(1).split('/').map(decodeURIComponent);
  if(segments.length<2||segments.some(s=>!s||s==='.'||s==='..'||/[\\/\0]/.test(s)))throw Error('invalid path');
  const id=segments.shift(),asset=segments.join('/');
  const file=await controller.resolvePluginUiAsset(id,asset);
  const body=await readFile(file);
  return new Response(body,{headers:{'Content-Type':types[extname(file).toLowerCase()]||'application/octet-stream','Access-Control-Allow-Origin':'*','X-Content-Type-Options':'nosniff','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"}});
 }catch{return new Response('插件资源不可用',{status:403})}
};
