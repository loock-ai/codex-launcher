export type PluginPhase='inactive'|'stopped'|'starting'|'waiting'|'running'|'stopping'|'error';
export interface PluginSummary {id:string;name:string;description:string;version:string;enabled:boolean;autoStart:boolean;state:PluginPhase;error?:string;path:string;hasUi:boolean;uiEntry?:string;}
export interface PluginSnapshot {directory:string;plugins:PluginSummary[];}
export interface PluginBridge {call(pluginId:string,method:string,params:unknown):Promise<unknown>;release(pluginId:string):Promise<void>;}
export interface DesktopSettings {appPath:string;cdpPort:number;}
export interface LauncherHostStatus {desktop:DesktopSettings&{connected:boolean;consumers:number;error:string};logs:string[];}
