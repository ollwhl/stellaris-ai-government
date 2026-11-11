import type {Context,Json,Snapshot} from '../../contracts/index.js';
import {now,uid} from '../../contracts/index.js';
import {battleIdentity,ownFleetIds} from './fleet-policy.js';
type Lease={fleetId:number;projectId:string;projectRevision:number;taskId:string;identity:string;unknown:boolean;at:string;};
function unresolved(ctx:Context,taskId:string):boolean {return (ctx.store.find?.<any>('fleet_commands',{taskId})??ctx.store.list<any>('fleet_commands').filter(c=>c.taskId===taskId)).some(c=>['prepared','submitted','accepted','observed','unknown'].includes(c.state));}
export function reapFleetLeases(ctx:Context,snapshot?:Snapshot){
 if(!snapshot)return;const identity=battleIdentity(snapshot);
 for(const lease of ctx.store.list<Lease>('fleet_leases')){const task=ctx.store.get<any>('tasks',lease.taskId);if(lease.identity!==identity||!lease.unknown&&(!task||['completed','cancelled'].includes(task.status))&&!unresolved(ctx,lease.taskId)){ctx.store.transaction(()=>{ctx.store.set('fleet_lease_history',uid('lease'),{...lease,releasedAt:now(),reason:lease.identity!==identity?'对局已变化':'任务已结束且无未决命令'});ctx.store.delete('fleet_leases',String(lease.fleetId));});}}
 // Recover pre-existing in-flight orders before another task can claim their fleets.
 for(const t of ctx.store.list<any>('tasks'))if(['waiting','unknown','running'].includes(t.status)&&t.expected?.args&&(!t.timelineId||t.timelineId===snapshot.timelineId))for(const fid of ownFleetIds(t.expected.args))if(!ctx.store.get('fleet_leases',String(fid)))ctx.store.set('fleet_leases',String(fid),{fleetId:fid,projectId:t.projectId,projectRevision:t.projectRevision,taskId:t.id,identity,unknown:t.status==='unknown',at:now()});
}
export function assertFleetLease(ctx:Context,projectId:string,taskId:string,tool:string,args:Json,snapshot:Snapshot){
 const project=ctx.store.get<any>('projects',projectId);const identity=battleIdentity(snapshot);
 for(const fid of ownFleetIds(args)){const lease=ctx.store.get<Lease>('fleet_leases',String(fid));if(!lease||lease.identity!==identity)continue;if(lease.projectId===projectId&&lease.taskId===taskId)continue;const prior=ctx.store.get<any>('projects',lease.projectId);const invalid=ctx.store.get<any>('fleet_missions',lease.projectId)?.control==='cancelled'||!prior||['cancelled','completed'].includes(prior.status)||prior.revision!==lease.projectRevision;
  if(tool==='stellaris_cancel_fleet_orders'&&invalid&&!lease.unknown)continue;
  throw new Error(`舰队 ${fid} 已由其他有效任务控制${lease.unknown?'，且存在未知命令结果':''}`);
 }
 if(!project)throw new Error('舰队控制任务不存在');
}
export function claimFleetLeases(ctx:Context,projectId:string,taskId:string,tool:string,args:Json,snapshot:Snapshot){
 assertFleetLease(ctx,projectId,taskId,tool,args,snapshot);const project=ctx.store.get<any>('projects',projectId)!;
 ctx.store.transaction(()=>{for(const fleetId of ownFleetIds(args)){const old=ctx.store.get<Lease>('fleet_leases',String(fleetId));if(old&&(old.taskId!==taskId||old.projectId!==projectId))ctx.store.set('fleet_lease_history',uid('lease'),{...old,handedOffAt:now(),nextTaskId:taskId,reason:'旧任务失效，新任务明确提交取消旧指令'});ctx.store.set('fleet_leases',String(fleetId),{fleetId,projectId,projectRevision:project.revision,taskId,identity:battleIdentity(snapshot),unknown:false,at:old?.at??now()});}});
}
export function markFleetLeaseResult(ctx:Context,projectId:string|undefined,taskId:string|undefined,args:Json,unknown:boolean){for(const fid of ownFleetIds(args)){const lease=ctx.store.get<Lease>('fleet_leases',String(fid));if(lease&&lease.projectId===projectId&&lease.taskId===taskId&&lease.unknown!==unknown)ctx.store.set('fleet_leases',String(fid),{...lease,unknown});}}
