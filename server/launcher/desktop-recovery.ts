export type DesktopActivity='idle'|'busy'|'unknown';
export interface RecoveryPolicy {autoReconnect?:boolean;autoRestart?:boolean;restartDuringTasks?:boolean;}
export interface RecoveryObservation {wanted:boolean;healthy:boolean;restartable:boolean;activity:DesktopActivity;pendingPlugins?:boolean;}
export interface RecoveryStatus {phase:'idle'|'healthy'|'reconnecting'|'restarting'|'waiting'|'cooldown'|'paused';attempts:number;message:string;}
/** 决策与进程操作分离；恢复动作只能由Controller串行执行。 */
export class DesktopRecovery {
 private firstFailure:number|null=null;private nextAttempt=0;private lastTick:number|null=null;
 private activity:DesktopActivity='unknown';private activityAt=-Infinity;private restarts:number[]=[];
 private value:RecoveryStatus={phase:'idle',attempts:0,message:''};
 status(){return {...this.value};}
 reset(){this.firstFailure=null;this.nextAttempt=0;this.value={phase:'idle',attempts:0,message:''};this.activity='unknown';this.activityAt=-Infinity;}
 decide(observation:RecoveryObservation,now:number,policy:RecoveryPolicy):'reconnect'|'restart'|null{
  if(this.lastTick!==null&&now-this.lastTick>45000){this.reset();this.activity='unknown';this.activityAt=-Infinity;}
  this.lastTick=now;
  if(!observation.wanted||policy.autoReconnect===false){this.reset();this.value.phase=policy.autoReconnect===false?'paused':'idle';return null;}
  if(observation.healthy){
   if(!observation.pendingPlugins){this.reset();this.activity=observation.activity;this.activityAt=now;this.value.phase='healthy';return null;}
   this.activity=observation.activity;this.activityAt=now;this.firstFailure=null;
  }else if(this.firstFailure===null){this.firstFailure=now;this.value.attempts=0;this.nextAttempt=now;}
  if(now<this.nextAttempt)return null;
  this.restarts=this.restarts.filter(at=>now-at<3600000);
  const canInterrupt=policy.restartDuringTasks===true||(this.activity==='idle'&&now-this.activityAt<=120000);
  const cooled=this.restarts.length===0||now-this.restarts.at(-1)!>=600000;
  const restart=policy.autoRestart!==false&&!observation.healthy&&this.firstFailure!==null&&observation.restartable&&now-this.firstFailure>=60000&&this.value.attempts>=3&&canInterrupt&&cooled&&this.restarts.length<3;
  this.value.attempts++;
  const delay=[2000,5000,10000,20000,30000][Math.min(this.value.attempts-1,4)];this.nextAttempt=now+delay;
  if(restart){this.restarts.push(now);this.value.phase='restarting';this.value.message='持续连接失败，正在重启桌面';return 'restart';}
  this.value.phase=!canInterrupt?'waiting':!cooled||this.restarts.length>=3?'cooldown':'reconnecting';
  this.value.message=!canInterrupt?'正在重连；任务运行中或状态不明，暂缓重启':!cooled||this.restarts.length>=3?'正在重连；桌面重启处于冷却期':'正在重新连接桌面';
  return 'reconnect';
 }
}
