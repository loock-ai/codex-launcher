import { describe, expect, it } from 'vitest';
import { DotsAdapter } from '../../server/dots/adapter.js';
import { DotsError, type DesktopHttpRequest, type DesktopHttpTransport } from '../../server/dots/types.js';

class Fixture implements DesktopHttpTransport {
  calls: DesktopHttpRequest[] = [];
  closed = false;
  constructor(public reply: (r: DesktopHttpRequest) => Promise<{status:number;body:unknown}> = async r => r.path.startsWith('/tbo') ? {status:200,body:{items:[{id:'dot',name:'小点',aeon_kind:'orbit',messaging_room_id:'room'}]}} : {status:200,body:{id:'sent',account_user_id:'u',content:{text:'你好'},created_at:'now'}}) {}
  async status() { return {available:true}; }
  async request(r:DesktopHttpRequest) { this.calls.push(r); return this.reply(r); }
  async close() { this.closed=true; }
}
const input = {dotId:'dot',text:'你好',requestId:'req-1'};
describe('DotsAdapter', () => {
  it('reports polling capabilities and closes transport', async()=>{
    const t=new Fixture(), a=new DotsAdapter(t);
    expect(await a.status()).toEqual({available:true,mode:'polling',capabilities:{messages:true,history:true,attachments:true,voice:false,approvals:false}});
    await a.close();expect(t.closed).toBe(true);
  });
  it('lists only orbit profiles and preserves pagination',async()=>{
    const t=new Fixture(async()=>({status:200,body:{items:[{id:'task',aeon_kind:'codex'},{id:'dot',name:'点',aeon_kind:'orbit',is_paused:true}],cursor:'next?&'}}));
    expect(await new DotsAdapter(t).list('cursor?&')).toEqual({dots:[{id:'dot',name:'点',roomId:null,paused:true}],nextCursor:'next?&'});
    expect(new URL(t.calls[0].path,'https://fixture').searchParams.get('cursor')).toBe('cursor?&');
  });
  it('looks up profile through pages and never accepts ordinary tasks',async()=>{
    const t=new Fixture(async r=>({status:200,body:r.path.startsWith('/tbo') ? r.path.includes('cursor=next')?{items:[{id:'dot',aeon_kind:'orbit',messaging_room_id:'room'}]}:{items:[{id:'task',aeon_kind:'codex',messaging_room_id:'private'}],cursor:'next'} : {items:[],prev_cursor:null}}));
    const a=new DotsAdapter(t);expect((await a.messages('dot')).roomId).toBe('room');
    await expect(a.messages('task')).rejects.toMatchObject({code:'DOTS_NOT_FOUND'});
    expect(t.calls.some(r=>r.path.includes('private'))).toBe(false);
  });
  it('normalizes modern messages while excluding hidden and analysis content',async()=>{
    const t=new Fixture(async r=>({status:200,body:r.path==='/messaging/rooms/room'?{members:[{account_user_id:'user'},{account_user_id:'u'}]}:r.path.startsWith('/tbo')?{items:[{id:'dot',aeon_kind:'orbit',messaging_room_id:'room'}]}:{items:[
      {id:'u',account_user_id:'user',content:{text:'hi'},created_at:'today',request_id:'r'},
      {id:'a',raw_messages:[{author:{role:'assistant'},channel:'analysis',content:{parts:['secret']}},{author:{role:'assistant'},metadata:{hidden:true},content:{parts:['hidden']}},{author:{role:'tool'},content:{parts:['tool']}},{author:{role:'assistant'},channel:'final',content:{parts:['hello',{text:'world'}]}}],created_at:'later'},
      {id:'d',deleted_at:'today',account_user_id:'u',content:{text:'deleted secret'}},
    ],prev_cursor:'older'}}));
    const out=await new DotsAdapter(t).messages('dot','before&x');
    expect(out.before).toBe('older');expect(out.messages.map(m=>m.text)).toEqual(['hi','hello\nworld','']);
    expect(out.messages[0]).toMatchObject({role:'user',requestId:'r'});expect(out.messages[2].deleted).toBe(true);
    expect(new URL(t.calls.at(-1)!.path,'https://fixture').searchParams.get('before')).toBe('before&x');
  });
  it('rejects uninitialized rooms without creating one',async()=>{
    const t=new Fixture(async()=>({status:200,body:{items:[{id:'dot',aeon_kind:'orbit'}]}}));
    await expect(new DotsAdapter(t).send(input)).rejects.toMatchObject({code:'DOTS_ROOM_UNINITIALIZED'});
    expect(t.calls.every(r=>r.method==='GET')).toBe(true);
  });
  it('deduplicates concurrent and completed sends with matching idempotency fields',async()=>{
    const t=new Fixture(),a=new DotsAdapter(t);
    const [x,y]=await Promise.all([a.send(input),a.send(input)]);expect(x).toEqual(y);expect(await a.send(input)).toEqual(x);
    const posts=t.calls.filter(r=>r.method==='POST');expect(posts).toHaveLength(1);
    expect(posts[0]).toEqual({method:'POST',path:'/messaging/rooms/room/messages',body:{content:{text:'你好'},request_id:'req-1',idempotency_token:'req-1'}});
    await expect(a.send({...input,text:'different'})).rejects.toMatchObject({code:'DOTS_REQUEST_CONFLICT'});
  });
  it.each([403,408,500])('classifies upstream %s and never resends same request',async status=>{
    const t=new Fixture(async r=>r.method==='GET'?{status:200,body:{items:[{id:'dot',aeon_kind:'orbit',messaging_room_id:'room'}]}}:{status,body:{error:'sensitive upstream detail'}}),a=new DotsAdapter(t);
    const code=status===403?'DOTS_WRITE_REJECTED':'DOTS_WRITE_UNKNOWN';
    await expect(a.send(input)).rejects.toMatchObject({code});await expect(a.send(input)).rejects.toMatchObject({code});
    expect(t.calls.filter(r=>r.method==='POST')).toHaveLength(1);
  });
  it('keeps unknown writes and rejects new sends when ledger is full',async()=>{
    const t=new Fixture(async r=>{if(r.method==='POST')throw new Error('network');return {status:200,body:{items:[{id:'dot',aeon_kind:'orbit',messaging_room_id:'room'}]}};}),a=new DotsAdapter(t,{maxRequests:1});
    await expect(a.send(input)).rejects.toMatchObject({code:'DOTS_WRITE_UNKNOWN'});
    await expect(a.send({...input,requestId:'new'})).rejects.toMatchObject({code:'DOTS_LEDGER_FULL'});
    await expect(a.send(input)).rejects.toMatchObject({code:'DOTS_WRITE_UNKNOWN'});
    expect(t.calls.filter(r=>r.method==='POST')).toHaveLength(1);
  });
  it('preserves pre-dispatch unavailable errors instead of reporting unknown delivery',async()=>{
    const t=new Fixture(async r=>{if(r.method==='POST')throw new DotsError('DOTS_UNAVAILABLE','桌面不可用',503);return {status:200,body:{items:[{id:'dot',aeon_kind:'orbit',messaging_room_id:'room'}]}};});
    await expect(new DotsAdapter(t).send(input)).rejects.toMatchObject({code:'DOTS_UNAVAILABLE',status:503});
  });
  it('keeps visible system notices but excludes errors and non-text assistant payloads',async()=>{
    const t=new Fixture(async r=>({status:200,body:r.path.startsWith('/tbo')?{items:[{id:'dot',aeon_kind:'orbit',messaging_room_id:'room'}]}:{items:[
      {id:'s',content:{type:'notice',text:'暂停通知'}},
      {id:'e',content:{type:'message_error',text:'internal'}},
      {id:'a',raw_messages:[{author:{role:'assistant'},content:{content_type:'tool_result',text:'private'}}]},
    ],prev_cursor:null}}));
    expect((await new DotsAdapter(t).messages('dot')).messages).toEqual([{id:'s',role:'system',text:'暂停通知',createdAt:''}]);
  });
  it('does not accept a receipt for another request',async()=>{
    const t=new Fixture(async r=>r.method==='GET'?{status:200,body:{items:[{id:'dot',aeon_kind:'orbit',messaging_room_id:'room'}]}}:{status:200,body:{id:'other',account_user_id:'u',request_id:'another-request',content:{text:'你好'}}});
    await expect(new DotsAdapter(t).send(input)).rejects.toMatchObject({code:'DOTS_WRITE_UNKNOWN'});
  });
  it('never treats an opaque Dot ID as a URL and rejects empty/oversized sends',async()=>{
    const t=new Fixture(),a=new DotsAdapter(t);
    await expect(a.messages('https://evil/')).rejects.toMatchObject({status:404});
    expect(t.calls.every(r=>r.method==='GET'&&r.path.startsWith('/tbo'))).toBe(true);
    t.calls=[];
    await expect(a.send({...input,text:'  '})).rejects.toMatchObject({status:400});
    await expect(a.send({...input,text:'x'.repeat(65537)})).rejects.toMatchObject({status:400});
    expect(t.calls).toHaveLength(0);
  });
});

it('兼容旧Dot无aeon_kind的房间记录，仍排除明确的普通任务',async()=>{
 const t=new Fixture(async r=>({status:200,body:r.path==='/tbo/primary'?{selection:null}:{items:[
  {id:'legacy',name:'旧版小点',messaging_room_id:'legacy-room'},
  {id:'task',aeon_kind:'codex',messaging_room_id:'task-room'},
  {id:'unrelated',name:'普通对象'},
 ]}}));
 expect((await new DotsAdapter(t).list()).dots.map(dot=>dot.id)).toEqual(['legacy']);
});
it('列表为空时通过官方primary入口找回主Dot并读取它的房间',async()=>{
 const t=new Fixture(async r=>({status:200,body:r.path==='/tbo/primary'?{selection:{available:true,thread_id:'thread'},profile:{id:'main-dot',name:'主Dot',messaging_room_id:'main-room'}}:r.path.startsWith('/tbo')?{items:[],cursor:null}:{items:[{id:'hello',account_user_id:'u',content:{text:'hi'}}],prev_cursor:null}}));
 const a=new DotsAdapter(t);expect((await a.list()).dots[0]).toMatchObject({id:'main-dot',name:'主Dot'});
 expect((await a.messages('main-dot')).roomId).toBe('main-room');
});
it('primary明确未授权时不把列表包装成暂无Dots',async()=>{
 const t=new Fixture(async r=>r.path==='/tbo/primary'?{status:403,body:{error:'private'}}:{status:200,body:{items:[]}});
 await expect(new DotsAdapter(t).list()).rejects.toMatchObject({code:'DOTS_READ_FAILED',status:403});
});
it('primary确认的Dot即使尚无房间也展示，诊断只保留结构统计',async()=>{
 const t=new Fixture(async r=>({status:200,body:r.path==='/tbo/primary'?{selection:{available:true,aeon_id:'primary',thread_id:'thread'},profile:{id:'primary',name:'private-name'}}:{items:[]}}));
 const a=new DotsAdapter(t);expect((await a.list()).dots).toEqual([{id:'primary',name:'private-name',roomId:null}]);
 expect(JSON.stringify(a.diagnostics())).not.toContain('private-name');
 await expect(a.messages('primary')).rejects.toMatchObject({code:'DOTS_ROOM_UNINITIALIZED'});
});
it('主Dot由primary可用状态确认，支持display_name和active_root_thread_id',async()=>{
 const p={id:'real-dot',display_name:'真实字段 Dot',active_root_thread_id:'root-thread',messaging_room_id:'room',aeon_kind:'primary_agent'};
 const t=new Fixture(async r=>({status:200,body:r.path==='/tbo/primary'?{selection:{available:true},profile:p}:{items:[p]}}));
 expect((await new DotsAdapter(t).list()).dots).toEqual([{id:'real-dot',name:'真实字段 Dot',threadId:'root-thread',roomId:'room'}]);
});
it('primary部分信息不能覆盖列表中已有房间与名称',async()=>{
 const t=new Fixture(async r=>({status:200,body:r.path==='/tbo/primary'?{selection:{available:true,aeon_id:'dot'}}:{items:[{id:'dot',display_name:'已有名称',messaging_room_id:'room',aeon_kind:'orbit'}]}}));
 expect((await new DotsAdapter(t).list()).dots).toEqual([{id:'dot',name:'已有名称',roomId:'room'}]);
});

it('根据当前房间成员区分人类与Dot，保留文本并使用成员名称',async()=>{
 const t=new Fixture(async r=>({status:200,body:r.path.startsWith('/tbo')?{items:[{id:'dot',aeon_kind:'orbit',messaging_room_id:'room'}]}:r.path==='/messaging/rooms/room'?{
  members:[{account_user_id:'human',aeon_id:null},{account_user_id:'agent',aeon_id:'dot',name:'当前小点'},{account_user_id:'snapshot-agent'}],
  member_profile_snapshots:[{account_user_id:'human',aeon_id:'old-dot'},{account_user_id:'agent',aeon_id:'stale',name:'旧名称'},{account_user_id:'snapshot-agent',aeon_id:'other-dot',name:'快照小点'},{account_user_id:'removed',aeon_id:'removed-dot',name:'已移除'}]
 }:{items:[
  {id:'human-message',account_user_id:'human',content:{text:'你好'}},
  {id:'dot-message',account_user_id:'agent',content:{text:'我是小点'}},
  {id:'snapshot-message',account_user_id:'snapshot-agent',content:{text:'另一个小点'}},
  {id:'unknown-message',account_user_id:'unknown',content:{text:'未知成员'}},
  {id:'removed-message',account_user_id:'removed',content:{text:'已移除成员'}},
 ],prev_cursor:null}}));
 const result=await new DotsAdapter(t).messages('dot');
 expect(result.messages.map(m=>[m.role,m.text])).toEqual([['user','你好'],['assistant','我是小点'],['assistant','另一个小点'],['system','未知成员'],['system','已移除成员']]);
 expect(result).toMatchObject({dotName:'当前小点'});
});
it('每次读取当前房间成员且不复用旧身份，名称可来自当前成员的快照',async()=>{
 let isDot=true;
 const t=new Fixture(async r=>({status:200,body:r.path.startsWith('/tbo')?{items:[{id:'dot',aeon_kind:'orbit',messaging_room_id:'room'}]}:r.path==='/messaging/rooms/room'?{
  members:[{account_user_id:'sender',aeon_id:isDot?'dot':null}],member_profile_snapshots:[{account_user_id:'sender',name:'快照名称'}]
 }:{items:[{id:'message',account_user_id:'sender',content:{text:'内容'}}],prev_cursor:null}}));
 const a=new DotsAdapter(t);
 expect(await a.messages('dot')).toMatchObject({dotName:'快照名称',messages:[{role:'assistant',text:'内容'}]});
 isDot=false;
 const next=await a.messages('dot');expect(next.messages[0].role).toBe('user');expect(next).not.toHaveProperty('dotName');
 expect(t.calls.filter(r=>r.path==='/messaging/rooms/room')).toHaveLength(2);
});
it('POST自己的回执无需房间成员信息也明确标记user',async()=>{
 const t=new Fixture();const result=await new DotsAdapter(t).send(input);
 expect(result.message).toMatchObject({role:'user',text:'你好'});
 expect(t.calls.some(r=>r.path==='/messaging/rooms/room')).toBe(false);
});
