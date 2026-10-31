import type {DesktopHttpRequest} from './types.js';
import {DotsError} from './types.js';
import {isOpaqueId} from './identifiers.js';
export function validateDotsRequest(request:DesktopHttpRequest){
 const bad=()=>new DotsError('DOTS_INVALID_PATH','不支持的 Dots 接口',400);
 if(!request.path.startsWith('/')||request.path.startsWith('//'))throw bad();
 let url:URL;try{url=new URL(request.path,'https://dots.invalid');}catch{throw bad();}
 if(url.origin!=='https://dots.invalid'||url.hash)throw bad();
 // Reject normalized traversal instead of allowing URL parsing to change the target.
 if(url.pathname!==request.path.split('?')[0])throw bad();
 const voice=/^\/tbo\/([^/]+)\/voice\/calls(?:\/([^/]+)\/(attach|stop))?$/.exec(url.pathname);
 if(voice){
  for(const encoded of [voice[1],voice[2]].filter((id):id is string=>!!id)){
   let id:string;try{id=decodeURIComponent(encoded);}catch{throw bad();}
   if(!isOpaqueId(id)||encodeURIComponent(id)!==encoded)throw bad();
  }
  if(request.method!=='POST'||url.search||voice[2]&&!decodeURIComponent(voice[2]).startsWith('rtc_'))throw bad();
  const body=request.body as {sdp?:unknown}|undefined;
  if(!voice[2]){
   if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>key!=='sdp')||typeof body.sdp!=='string'||!body.sdp.startsWith('v=0')||body.sdp.length>65536)throw bad();
  }else if(body!==undefined&&(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length))throw bad();
  return;
 }
 const catalog=url.pathname==='/tbo'||url.pathname==='/tbo/primary';
 const match=/^\/messaging\/rooms\/([^/]+)(\/(?:messages|files))?$/.exec(url.pathname);
 if(!catalog&&!match)throw bad();
 if(match){
  let id:string;try{id=decodeURIComponent(match[1]);}catch{throw bad();}
  if(!isOpaqueId(id)||encodeURIComponent(id)!==match[1])throw bad();
 }
 if(request.method==='GET'&&match?.[2]==='/files')throw bad();
 if(request.method!=='GET'&&!(request.method==='POST'&&(match?.[2]==='/messages'||match?.[2]==='/files')&&!url.search))throw new DotsError('DOTS_INVALID_METHOD','不支持的 Dots 操作',400);
}
