// @vitest-environment node
import {describe,it,expect} from 'vitest';
import {execFileSync} from 'node:child_process';
import {DotsAdapter} from '../../server/dots/adapter.js';
import {validateDotsRequest} from '../../server/dots/paths.js';
import {dotsRequestScript} from '../../server/dots/desktop-script.js';
import type {DesktopHttpRequest} from '../../server/dots/types.js';
function setup(failure?:number|'throw') {
 const calls:DesktopHttpRequest[]=[];
 const adapter=new DotsAdapter({status:async()=>({available:true}),close:async()=>{},request:async r=>{
  calls.push(r);
  if(r.method==='GET')return {status:200,body:r.path.startsWith('/tbo')?{items:[{id:'dot',aeon_kind:'orbit',messaging_room_id:'room'},{id:'other',aeon_kind:'orbit',messaging_room_id:'other-room'}]}:{items:[{id:'attachment-only',content:{text:'',attachments:[{type:'file',file_id:'native',name:'图片.png',mime_type:'image/png',size_bytes:3}]}}]}};
  if(r.path.endsWith('/files')){if(failure==='throw')throw Error('network');return {status:typeof failure==='number'?failure:200,body:{id:'native',status:'ready'}};}
  return {status:200,body:{id:'sent',content:(r.body as any).content}};
 }});
 return {adapter,calls};
}
const file={name:'图片.png',type:'image/png',data:Buffer.from([1,2,3])};
describe('Dots attachments',()=>{
 it('uploads into resolved room and sends attachment-only messages using opaque gateway IDs',async()=>{
  const {adapter,calls}=setup();const upload=await adapter.upload({dotId:'dot',...file});
  expect(upload).toMatchObject({attachment:{name:file.name,type:file.type,size:3}});expect(upload.attachment.id).not.toBe('native');
  expect(calls.find(r=>r.path.endsWith('/files'))).toEqual({method:'POST',path:'/messaging/rooms/room/files',body:{file:{name:file.name,type:file.type,base64:'AQID'}}});
  expect(await adapter.status()).toMatchObject({capabilities:{attachments:true}});
  const input={dotId:'dot',text:'',requestId:'send-file',attachmentIds:[upload.attachment.id]};
  expect((await adapter.send(input)).message).toMatchObject({text:'',attachments:[{id:'native',name:file.name,type:file.type,size:3}]});
  expect((calls.at(-1)!.body as any).content).toEqual({text:'',attachments:[{type:'file',file_id:'native'}]});
  await adapter.send(input);expect(calls.filter(r=>r.path.endsWith('/messages')&&r.method==='POST')).toHaveLength(1);
  await expect(adapter.send({...input,attachmentIds:[]})).rejects.toMatchObject({code:'DOTS_INVALID_INPUT'});
  await expect(adapter.send({...input,text:'changed'})).rejects.toMatchObject({code:'DOTS_REQUEST_CONFLICT'});
 });
 it('requires a matching attachment receipt and snapshots caller IDs before asynchronous room lookup',async()=>{
  const {adapter,calls}=setup();const {attachment}=await adapter.upload({dotId:'dot',...file});const ids=[attachment.id];
  const pending=adapter.send({dotId:'dot',text:'x',requestId:'snapshot',attachmentIds:ids});ids.length=0;await pending;
  expect((calls.at(-1)!.body as any).content.attachments).toEqual([{type:'file',file_id:'native'}]);
  const missing=new DotsAdapter({status:async()=>({available:true}),close:async()=>{},request:async r=>({status:200,body:r.method==='GET'?{items:[{id:'dot',aeon_kind:'orbit',messaging_room_id:'room'}]}:r.path.endsWith('/files')?{id:'native',status:'ready'}:{id:'sent',content:{text:'x'}}})});
  const uploaded=await missing.upload({dotId:'dot',...file});
  await expect(missing.send({dotId:'dot',text:'x',requestId:'receipt',attachmentIds:[uploaded.attachment.id]})).rejects.toMatchObject({code:'DOTS_WRITE_UNKNOWN'});
 });
 it('refuses old-room uploads after the same Dot changes room without sending a message',async()=>{
  let room='room-a';const calls:DesktopHttpRequest[]=[];
  const adapter=new DotsAdapter({status:async()=>({available:true}),close:async()=>{},request:async r=>{
    calls.push(r);
    return {status:200,body:r.method==='GET'?{items:[{id:'dot',aeon_kind:'orbit',messaging_room_id:room}]}:r.path.endsWith('/files')?{id:'native',status:'ready'}:{id:'sent',content:(r.body as any).content}};
  }});
  const {attachment}=await adapter.upload({dotId:'dot',...file});room='room-b';
  await expect(adapter.send({dotId:'dot',text:'原草稿',requestId:'room-changed',attachmentIds:[attachment.id]})).rejects.toMatchObject({code:'DOTS_ROOM_CHANGED',status:400});
  expect(calls.filter(r=>r.method==='POST').map(r=>r.path)).toEqual(['/messaging/rooms/room-a/files']);
 });
 it('rejects native IDs, cross-Dot IDs, duplicate and excessive attachments before dispatch',async()=>{
  const {adapter,calls}=setup();const {attachment}=await adapter.upload({dotId:'dot',...file});const before=calls.length;
  for(const attachmentIds of [['native'],[attachment.id,attachment.id],Array(5).fill(attachment.id)])await expect(adapter.send({dotId:'dot',text:'x',requestId:'invalid',attachmentIds})).rejects.toMatchObject({code:'DOTS_INVALID_INPUT'});
  await expect(adapter.send({dotId:'other',text:'x',requestId:'other',attachmentIds:[attachment.id]})).rejects.toMatchObject({code:'DOTS_INVALID_INPUT'});
  expect(calls.length).toBe(before);
 });
 it('rejects non-array attachment IDs and blocks new uploads when its bounded registry is full',async()=>{
  const {adapter}=setup();await expect(adapter.send({dotId:'dot',text:'x',requestId:'null',attachmentIds:null as any})).rejects.toMatchObject({code:'DOTS_INVALID_INPUT'});
  let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);
  const limited=new DotsAdapter({status:async()=>({available:true}),close:async()=>{},request:async r=>{if(r.method==='GET')return {status:200,body:{items:[{id:'dot',aeon_kind:'orbit',messaging_room_id:'room'}]}};await gate;return {status:200,body:{id:'native',status:'ready'}};}},{maxRequests:1});
  const first=limited.upload({dotId:'dot',...file});
  await expect(limited.upload({dotId:'dot',...file})).rejects.toMatchObject({code:'DOTS_UPLOAD_FULL'});release();await first;
  await expect(limited.upload({dotId:'dot',...file})).rejects.toMatchObject({code:'DOTS_UPLOAD_FULL'});
 });
 it('classifies rejected uploads and preserves pre-dispatch identity/unavailable errors',async()=>{
  const rejected=setup(403);await expect(rejected.adapter.upload({dotId:'dot',...file})).rejects.toMatchObject({code:'DOTS_UPLOAD_REJECTED',status:403});
  const unavailable=new DotsAdapter({status:async()=>({available:false}),close:async()=>{},request:async()=>{throw new (await import('../../server/dots/types.js')).DotsError('DOTS_ACCOUNT_CHANGED','changed',409);}});
  await expect(unavailable.upload({dotId:'dot',...file})).rejects.toMatchObject({code:'DOTS_ACCOUNT_CHANGED'});
 });
 it('keeps visible attachment-only history and excludes malformed attachment IDs',async()=>{
  const {adapter}=setup();expect((await adapter.messages('dot')).messages).toEqual([{id:'attachment-only',role:'system',text:'',createdAt:'',attachments:[{id:'native',name:file.name,type:file.type,size:3}]}]);
 });
 it.each([408,500,'throw'] as const)('reports uncertain upload separately for %s without automatic retry',async failure=>{
  const {adapter,calls}=setup(failure);await expect(adapter.upload({dotId:'dot',...file})).rejects.toMatchObject({code:'DOTS_UPLOAD_UNKNOWN'});expect(calls.filter(r=>r.method==='POST')).toHaveLength(1);
 });
 it('rejects oversized files before reads and permits only POST on the native files path',async()=>{
  const {adapter,calls}=setup();await expect(adapter.upload({dotId:'dot',...file,data:Buffer.alloc(20*1024*1024+1)})).rejects.toMatchObject({status:413});expect(calls).toHaveLength(0);
  expect(()=>validateDotsRequest({method:'POST',path:'/messaging/rooms/room/files',body:{file:{}}})).not.toThrow();
  expect(()=>validateDotsRequest({method:'GET',path:'/messaging/rooms/room/files'})).toThrow();
 });
 it('encodes multipart binary for AppHost preserving bytes and a single boundary header',async()=>{
  const script=`let captured;globalThis.window={electronBridge:{getSentryInitOptions:()=>({appVersion:'test-version'})}};globalThis.location={href:'https://desktop.invalid/'};globalThis.__dotsServices={accessInputs:{readAccountInfo:async()=>({status:'ready',data:{accountId:'account',userId:'user'}})},httpFetch:{cancel:async()=>{},fetch:async(_id,request)=>{captured=request;return {response:new Response(JSON.stringify({id:'file'}),{status:200})};}}};
  const moduleSource="export const services=globalThis.__dotsServices;export const api={getRequestTarget(){return {headers:{'Content-Type':'application/json','content-type':'application/json'}}}};";
  await (${dotsRequestScript})({request:{method:'POST',path:'/messaging/rooms/room/files',body:{file:{name:'图片.png',type:'image/png',base64:'AQID'}}},contract:{version:'test-version',module:'data:text/javascript,'+encodeURIComponent(moduleSource),servicesExport:'services',apiExport:'api'},limit:1024,identity:{accountId:'account',userId:'user'},timeoutMs:1000});
  const header=Object.entries(captured.headers).find(([key])=>key.toLowerCase()==='content-type');
  const response=new Response(captured.body,{headers:{'content-type':header?.[1]??'application/octet-stream'}});const form=await response.formData();const file=form.get('file');
  console.log(JSON.stringify({binary:captured.body instanceof Uint8Array,name:file.name,type:file.type,data:[...new Uint8Array(await file.arrayBuffer())],headers:Object.keys(captured.headers).filter(k=>k.toLowerCase()==='content-type'),retry:captured.retry}));`;
  const result=JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8'}));
  expect(result).toEqual({binary:true,name:file.name,type:file.type,data:[1,2,3],headers:['Content-Type'],retry:'never'});
 });
});
