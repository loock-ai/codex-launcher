import {it,expect} from 'vitest';import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {PluginRepositoriesPanel} from '../../launcher/PluginRepositories';
it('官方仓库也可编辑和删除，并可以添加新仓库',async()=>{
 let repos=[{id:'official',repository:'https://github.com/loock-ai/codex-launcher-plugins',branch:'main',enabled:true}];const calls:any[]=[];
 const api:any={listPluginRepositories:async()=>repos,addPluginRepository:async(v:any)=>{calls.push(['add',v]);return repos},editPluginRepository:async(id:string,v:any)=>{calls.push(['edit',id,v]);return repos},setPluginRepositoryEnabled:async(id:string,v:boolean)=>{calls.push(['enable',id,v]);return repos},removePluginRepository:async(id:string)=>{calls.push(['remove',id]);repos=[];return repos}};
 render(<PluginRepositoriesPanel api={api} onChanged={()=>{}}/>);await screen.findByText(repos[0].repository);fireEvent.click(screen.getByRole('button',{name:'编辑'}));fireEvent.change(screen.getByLabelText('仓库分支'),{target:{value:'stable'}});fireEvent.click(screen.getByRole('button',{name:'测试并保存'}));await waitFor(()=>expect(calls).toContainEqual(['edit','official',{repository:repos[0].repository,branch:'stable'}]));
 fireEvent.click(screen.getByRole('button',{name:'删除'}));await waitFor(()=>expect(calls).toContainEqual(['remove','official']));fireEvent.change(screen.getByLabelText('仓库地址'),{target:{value:'other/plugins'}});fireEvent.click(screen.getByRole('button',{name:'测试并添加'}));await waitFor(()=>expect(calls).toContainEqual(['add',{repository:'other/plugins',branch:'main'}]));
});
