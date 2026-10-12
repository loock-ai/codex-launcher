import {it,expect} from 'vitest';import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {PluginUpdates} from '../../launcher/PluginUpdates';
it('检查更新显示版本，含本地修改时显式保留备份后更新',async()=>{
 const calls:any[]=[];const api:any={checkPluginUpdates:async()=>[{id:'mobile',name:'Mobile',description:'手机',version:'1.1.0',installedVersion:'1.0.0',compatible:true,updateAvailable:true,locallyModified:true,git:{url:'https://github.com/loock-ai/codex-launcher-plugins.git'}}],updatePlugin:async(...args:any[])=>{calls.push(args)}};
 render(<PluginUpdates api={api} onChanged={()=>{}}/>);fireEvent.click(screen.getByRole('button',{name:'检查插件更新'}));await screen.findByText(/1.0.0 → 1.1.0/);expect(calls).toHaveLength(0);fireEvent.click(screen.getByRole('button',{name:'保留备份并更新'}));await waitFor(()=>expect(calls).toEqual([['mobile',{allowLocalChanges:true}]]));
});
