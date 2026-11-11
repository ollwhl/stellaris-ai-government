import { Ajv } from 'ajv';
import type { AdminService, Context, IntelService, Json, ToolDefinition, CallRecord, Task, Project, Reservation, ExecutionFeedback, Strategy,GameIncident,IncidentInput,IncidentDecision } from '../../contracts/index.js';
import { now, uid } from '../../contracts/index.js';
import {FleetController} from './fleet-missions.js';
import {verifyFleetAction,equal,ownFleetIds,battleIdentity} from '../control/fleet-policy.js';
import {assertFleetLease,claimFleetLeases,markFleetLeaseResult,reapFleetLeases} from '../control/fleet-leases.js';
import {mockCost} from '../../integrations/game_mcp/extended-mock.js';
import {IncidentController} from './incidents.js';
import {verifyIncidentGrant,incidentProject,digest,incidentFingerprint,eventOptions,optionCost,windows} from '../control/incident-policy.js';
import {genericStep,observeGeneric,genericCost,type GenericRuntime} from './generic.js';
import {domainEnabled,projectDomain,allowedGenericTool,objectRefs} from '../../integrations/game_mcp/registry.js';
import {WakeClock,strategyExpired} from '../control/wake-clock.js';
import { Ledger } from '../control/ledger.js';
import { mockTools } from '../../integrations/game_mcp/catalog.js';
import { MockGame } from '../../integrations/game_mcp/mock.js';
import { RealGameClient } from '../../integrations/game_mcp/client.js';
type ExtendedTask=Task&{timelineId?:string;expected?:Json;reservationId?:string;permissionRevision?:number;lastObservedAt?:string;inputSnapshotVersion?:number;rebaseIds?:string[];rebasedFromRevision?:number};
interface Action {tool:string;args:Json;reason:string;wait?:boolean;}
class PermissionDenied extends Error {readonly permissionDenied=true;constructor(message:string){super(message);this.name='PermissionDenied';}}
export function createAdministration(ctx:Context,getIntel:()=>IntelService,judgeIncident?:(input:IncidentInput)=>Promise<IncidentDecision>):AdminService {
 const wakeClock=new WakeClock(ctx);const ledger=new Ledger(ctx),mock=new MockGame(ctx),real=new RealGameClient(ctx);const ajv=new Ajv({allErrors:true,strict:false});let busy=false,closed=false;const idleWaiters:Array<()=>void>=[];let writeTail=Promise.resolve();let catalogCache:ToolDefinition[]=[];let cacheMode='';
 const tasks=()=>ctx.store.list<ExtendedTask>('tasks').sort((a,b)=>a.at.localeCompare(b.at));
 const calls=(options:{limit?:number;taskId?:string;traceId?:string}={})=>{const fields=options.taskId?{taskId:options.taskId}:options.traceId?{traceId:options.traceId}:undefined;const records=fields&&ctx.store.find?ctx.store.find<CallRecord>('calls',fields):ctx.store.list<CallRecord>('calls',options.limit===undefined?{}:{limit:options.limit,reverse:true});return records.filter(c=>(!options.taskId||c.taskId===options.taskId)&&(!options.traceId||c.traceId===options.traceId)).sort((a,b)=>a.at.localeCompare(b.at));};
 const saveTask=(t:ExtendedTask)=>{ctx.store.set('tasks',t.id,t);ctx.bus.emit('task.updated',t,t.traceId);};
 const feedback=(t:ExtendedTask,status:string,reason:string)=>{if(t.feedback===`${status}:${reason}`)return;t.feedback=`${status}:${reason}`;saveTask(t);const f:ExecutionFeedback&{projectRevision:number}={id:uid('feedback'),projectId:t.projectId,projectRevision:t.projectRevision,traceId:t.traceId,status,reason,at:now()};ctx.store.set('feedback',f.id,f);ctx.bus.emit('execution.feedback',f,t.traceId);};
 async function tools(){const mode=ctx.config.gameMode;const fingerprint=mode+JSON.stringify(ctx.config.gameMcp);if(cacheMode===fingerprint&&catalogCache.length)return structuredClone(catalogCache);catalogCache=mode==='mock'?structuredClone(mockTools):await real.tools();cacheMode=fingerprint;return structuredClone(catalogCache);}
 const raw=async(name:string,args:Json)=>{try{return await (ctx.config.gameMode==='mock'?mock.call(name,args):real.call(name,args));}catch(e:any){if(ctx.config.gameMode==='mock'&&!e.unknownResult)e.knownFailure=true;throw e;}};
 const data=(x:any)=>x?.data??x;
 function permissionCheck(tool:ToolDefinition,args:Json,options:NonNullable<Parameters<AdminService['call']>[2]>,p=ledger.permissions()){
  if(tool.effect==='read')return;
  if(closed)throw new PermissionDenied('行政服务正在关闭，停止新提交');
  if(options.origin==='intel')throw new PermissionDenied('情报入口仅可使用已登记只读工具');
  if(options.origin==='debug'){if(!p.debugWrite||!options.debugAuthorized)throw new PermissionDenied('请开启调试写权限并明确确认本次操作');return;}
  if(p.aiEnabled===false)throw new PermissionDenied('AI 总开关已关闭');
  if(p.stopped)throw new PermissionDenied('AI 已停止新提交');const authorizedProject=options.projectId?ctx.store.get<Project>('projects',options.projectId):undefined;const once=authorizedProject?ledger.onceAuthorized(authorizedProject):false;if(p.mode==='advice'&&!once)throw new PermissionDenied('当前为仅建议模式');
  if(options.permissionRevision!==undefined&&options.permissionRevision!==p.revision)throw new PermissionDenied('授权已变化，旧动作失效');
  if(!tool.supported||tool.effect==='unknown')throw new PermissionDenied('该工具尚未登记自主执行路径');
  if(options.eventId){try{verifyIncidentGrant(ctx,ctx.store.get<GameIncident>('incidents',options.eventId),tool.name,args,getIntel().snapshot());}catch(error){throw new PermissionDenied(error instanceof Error?error.message:'事件授权失效');}return;}
  if(!options.projectId)throw new PermissionDenied('自主写入必须关联有效项目');
  const project=ctx.store.get<Project>('projects',options.projectId);if(!project||['cancelled','completed','blocked'].includes(project.status))throw new PermissionDenied('项目已失效或不可执行');
  const strategy=ctx.store.list<Strategy>('strategies').filter(s=>s.id===project.strategyId).sort((a,b)=>b.revision-a.revision)[0];if(strategy&&strategy.revision!==project.strategyRevision)throw new PermissionDenied('战略版本已变化，旧项目失效');if(strategy&&strategyExpired(strategy,getIntel().snapshot()))throw new PermissionDenied('战略已过期');
  const t=options.taskId?ctx.store.get<ExtendedTask>('tasks',options.taskId):undefined;if(t&&t.projectRevision!==project.revision)throw new PermissionDenied('项目版本已变化');
  if(args.planet_id!==undefined&&project.scope.planetIds?.length&&!project.scope.planetIds.includes(args.planet_id))throw new PermissionDenied('星球超出项目对象范围');
  if(args.fleet_id!==undefined&&project.scope.fleetIds?.length&&!project.scope.fleetIds.includes(args.fleet_id))throw new PermissionDenied('舰队超出项目对象范围');
  if(ownFleetIds(args).length){try{const snapshot=getIntel().snapshot();if(!snapshot)throw new Error('尚无舰队态势');reapFleetLeases(ctx,snapshot);assertFleetLease(ctx,project.id,options.taskId??'',tool.name,args,snapshot);
   if(project.kind==='fleet'){verifyFleetAction(ctx,project,tool.name,args,snapshot);const command=options.fleetCommandId?ctx.store.get<any>('fleet_commands',options.fleetCommandId):undefined;const mission=ctx.store.get<any>('fleet_missions',project.id);if(!command||command.state!=='prepared'||command.projectRevision!==project.revision||command.permissionRevision!==p.revision||command.taskId!==options.taskId||command.tool!==tool.name||!equal(command.args,args)||!mission||mission.control!=='auto'||battleIdentity(command)!==battleIdentity(snapshot))throw new Error('舰队命令批次或任务授权已失效');}
   if(tool.name==='stellaris_follow_fleet'&&args.attack===true){const b=snapshot.battlefield,target=b?.fleets.find(f=>f.id===args.target_fleet_id&&f.relation==='hostile'&&f.visible&&f.freshness==='fresh');if(!target)throw new Error('攻击目标必须是当前可见敌舰');if(!p.offensiveMilitary&&!(project.kind==='fleet'&&project.scope.mission==='defend'&&b?.systems.some(s=>s.id===target.systemId&&s.ownership==='own')))throw new Error('主动进攻未授权');}
   if(tool.name==='stellaris_land_armies'&&!p.offensiveMilitary)throw new Error('登陆进攻未授权');if(tool.name==='stellaris_fleet_mia'&&args.type==='emergency_ftl'&&!p.emergencyRetreat)throw new Error('紧急跃迁未授权');
   if(tool.name==='stellaris_move_fleet'&&!p.offensiveMilitary&&snapshot.battlefield?.fleets.some(f=>f.relation==='hostile'&&f.visible&&f.freshness==='fresh'&&f.systemId===args.system_id&&!f.destroyed)&&!(project.kind==='fleet'&&project.scope.mission==='defend'&&snapshot.battlefield.systems.some(s=>s.id===args.system_id&&s.ownership==='own')))throw new Error('进入有敌舰的星系会触发交战，主动进攻未授权');
  }catch(e){throw new PermissionDenied(e instanceof Error?e.message:'舰队控制冲突');}}
  const normalizedArea=typeof args.area==='number'?['physics','society','engineering'][args.area]:args.area;
  if(normalizedArea&&project.scope.area&&normalizedArea!==project.scope.area)throw new PermissionDenied('科研领域超出项目范围');
  const expectedDomain=projectDomain(project);if(project.kind==='generic'&&!allowedGenericTool(project,tool.name))throw new PermissionDenied('工具不在通用项目的明确授权清单中');
  if(expectedDomain&&tool.domain!==expectedDomain)throw new PermissionDenied('工具超出项目业务范围');
  if(p.pausedDepartments.includes(project.department)||p.pausedDepartments.includes('administration'))throw new PermissionDenied('相关部门已暂停');
  if(!['research','construction','military','time'].includes(tool.domain)&&!domainEnabled(p,tool.domain)&&!once)throw new PermissionDenied('该领域未授权');
  if(tool.domain==='research'&&!p.research&&!once)throw new PermissionDenied('科研写入未授权');
  if(tool.domain==='construction'&&!p.construction&&!once)throw new PermissionDenied('建设写入未授权');
  if(tool.domain==='military'&&!p.military&&!once)throw new PermissionDenied('军事写入未授权');
  if(tool.name==='stellaris_set_paused'&&!(args.paused?p.pause:p.resume))throw new PermissionDenied(args.paused?'暂停游戏未授权':'继续游戏未授权');
  if(tool.name==='stellaris_set_speed'&&!p.speed)throw new PermissionDenied('调速未授权');
  if(objectRefs(args).some(ref=>p.controlledObjects.includes(ref)))throw new PermissionDenied('该操作包含玩家人工接管对象');
  if(tool.name==='stellaris_run_until'&&(!p.resume||!p.pause||(args.speed!==undefined&&!p.speed)))throw new PermissionDenied('推进时间需要继续、暂停及相应调速授权');
  for(const [field,scopeField] of [['fleet_ids','fleetIds'],['system_id','systemIds'],['species_id','speciesIds'],['leader_id','leaderIds']] as const){const targets=[args[field]].flat().filter(x=>x!==undefined);if(project.scope[scopeField]?.length&&targets.some(x=>!project.scope[scopeField].includes(x)))throw new PermissionDenied('对象超出项目范围');}
  const object=args.planet_id!==undefined?`planet:${args.planet_id}`:args.fleet_id!==undefined?`fleet:${args.fleet_id}`:args.area!==undefined?`research:${normalizedArea}`:null;
  if(object&&p.controlledObjects.includes(object))throw new PermissionDenied('该对象已被玩家接管');
 }
 async function prepareCost(name:string,args:Json,options:NonNullable<Parameters<AdminService['call']>[2]>):Promise<Json>{if(options.eventId){
 const incident=ctx.store.get<GameIncident>('incidents',options.eventId);if(!incident)throw new PermissionDenied('事件不存在');
 const readName=incident.kind==='popup'?'stellaris_get_active_events':incident.kind==='notification'?'stellaris_get_notifications':'stellaris_get_alerts';
 const live=await preflightRead(readName,{},options);const list=incident.kind==='popup'?windows(live):(Array.isArray(live)?live:live?.[incident.kind==='notification'?'notifications':'alerts']??[]);
 const current=list.find((item:any)=>incident.kind==='popup'?item.window_id===args.window_id:incident.kind==='notification'?item.index===args.index:item.alert_id===args.alert_id);
 if(!current||incidentFingerprint(incident.kind,current)!==incident.fingerprint)throw new PermissionDenied('窗口、消息或选项已经改变，请自动重新判断');
 if(incident.kind!=='popup')return {};
 const option=eventOptions(current).find(o=>o.index===args.option_index);if(!option)throw new PermissionDenied('当前选项已不可用');const quote=optionCost(option);if(!quote.known)throw new PermissionDenied('选项成本尚无法核验，请上级重新选择可核验方案');return quote.cost;
 }const project=options.projectId?ctx.store.get<Project>('projects',options.projectId):undefined;if(project?.kind==='generic'){const history=options.taskId?ctx.store.get<Json>('generic_tasks',options.taskId)?.history??[]:[];return genericCost(ctx,mock.state(),name,args,history.filter((h:any)=>h.kind==='read').map((h:any)=>h.result),project);}if(name==='stellaris_build_building'){const r=await preflightRead('stellaris_get_buildable_buildings',{planet_id:args.planet_id,building_key:args.building_key},options);const candidates=[...(r.buildings??[]),...(r.zones??[]).flatMap((z:any)=>z.buildable??[])];const b=candidates.find((b:any)=>(b.key??b.building_key)===args.building_key&&b.can_build!==false);if(!b)throw new Error('当前无可建候选或建设条件不足');return b.cost??{};}if(name==='stellaris_reinforce_fleet'){const r=await preflightRead('stellaris_get_fleets',{fleet_id:args.fleet_id},options);const f=(r.fleets??[]).find((f:any)=>f.id===args.fleet_id);if(!f)throw new Error('当前舰队不存在');if(f.queue?.length)throw new Error('舰队已有增援订单');const quote=f.reinforcementCost??f.reinforcement_cost;if(!quote||typeof quote!=='object')throw new Error('增援费用未知，不能视为免费');return quote;}if(name==='stellaris_upgrade_fleet'){if(ctx.config.gameMode==='mock')return mockCost(mock.state(),name,args);const r=await preflightRead('stellaris_get_fleets',{fleet_id:args.fleet_id},options);const f=(r.fleets??[]).find((f:any)=>f.id===args.fleet_id);if(!f?.upgrade_cost)throw new Error('当前升级费用无法核验');return f.upgrade_cost;}return {};}
 async function perform(name:string,args:Json,options:NonNullable<Parameters<AdminService['call']>[2]>):Promise<CallRecord>{
  const started=Date.now();const rec:CallRecord={id:uid('call'),traceId:options.traceId??uid('trace'),taskId:options.taskId,projectId:options.projectId??(options.eventId?'incident:'+options.eventId:undefined),eventId:options.eventId,fleetCommandId:options.fleetCommandId,tool:name,args:structuredClone(args),origin:options.origin??'debug',status:'submitted',at:now(),durationMs:0,source:ctx.config.gameMode};let sent=false;let reservation:Reservation|undefined;
  try{if(closed)throw new Error('行政服务已关闭');const tool=(await tools()).find(t=>t.name===name);if(!tool)throw new Error('工具不存在');const validate=ajv.compile(tool.inputSchema);if(!validate(args))throw new Error(`参数不匹配：${ajv.errorsText(validate.errors)}`);permissionCheck(tool,args,options);
   if(tool.effect!=='read'){
    const pre=await preflightRead('stellaris_get_status',{},options);const task=options.taskId?ctx.store.get<ExtendedTask>('tasks',options.taskId):undefined;const timeline=pre.timeline_id??pre.timelineId;if(options.fleetCommandId){const command=ctx.store.get<any>('fleet_commands',options.fleetCommandId);const session=pre.session_id??pre.sessionId;if(session&&command?.sessionId!==String(session))throw new PermissionDenied('对局会话已变化，旧舰队命令失效');}if(task?.timelineId&&timeline&&task.timelineId!==timeline)throw new PermissionDenied('对局时间线变化，请重新规划');
    if(options.origin==='agent'&&name==='stellaris_select_research'){const r=await preflightRead('stellaris_get_research_state',{},options);const area=typeof args.area==='number'?['physics','society','engineering'][args.area]:args.area;const slot=r[area]??r.areas?.find((a:any)=>a.area===area);const project=ctx.store.get<Project>('projects',options.projectId!);if(!slot)throw new Error('科研领域不存在');if(slot.current&&project?.scope.allowSwitch!==true)throw new Error('当前研究已变化，不允许替换进行中的研究');if(!(slot.candidates??[]).some((c:any)=>(c.key??c.tech_key)===args.tech_key))throw new Error('科技不在当前候选中');}
    if(options.origin==='agent'){const cost=await prepareCost(name,args,options);if(Object.keys(cost).length)reservation=ledger.reserve(options.eventId?incidentProject(ctx,ctx.store.get<GameIncident>('incidents',options.eventId)!):ctx.store.get<Project>('projects',options.projectId!),options.taskId??rec.id,cost,pre.resources??{});}
    if(options.origin==='agent'&&name==='stellaris_move_fleet'){const route=await preflightRead('stellaris_find_path',{fleet_id:args.fleet_id,to_system_id:args.system_id},options);if(route.reachable!==true)throw new PermissionDenied('当前路线不可达或无法核验');}
    if(reservation)rec.reservationId=reservation.id;
    // Recheck after asynchronous preflight: stop/revoke cannot race the actual submission.
    permissionCheck(tool,args,options);if(options.origin==='agent'&&options.projectId&&options.taskId&&ownFleetIds(args).length){claimFleetLeases(ctx,options.projectId,options.taskId,name,args,getIntel().snapshot()!);if(options.fleetCommandId){const command=ctx.store.get<any>('fleet_commands',options.fleetCommandId)!;command.state='submitted';command.callId=rec.id;command.baseline.operationIds=(pre.operationLog??[]).map((o:any)=>o.id);ctx.store.set('fleet_commands',command.id,command);}}if(options.eventId){const incident=ctx.store.get<GameIncident>('incidents',options.eventId)!;incident.baselineOperationIds=(pre.operationLog??[]).map((o:any)=>o.id);incident.callIds=[...new Set([...incident.callIds,rec.id])];if(reservation)incident.reservationId=reservation.id;ctx.store.set('incidents',incident.id,incident);}ctx.store.set('calls',rec.id,rec);ctx.bus.emit('call.submitted',rec,rec.traceId);if(reservation)ledger.transition(reservation.id,'submitted');sent=true;
   }
   const result=await raw(name,args);if(tool.effect==='read'&&data(result)?.error)throw Object.assign(new Error(String(data(result).error)),{knownFailure:true,result});if(tool.effect!=='read'&&(data(result)?.success===false||data(result)?.ok===false))throw Object.assign(new Error(String(data(result)?.error??data(result)?.message??'游戏明确拒绝命令')),{knownFailure:true,result});if(ctx.config.gameMode==='mock'&&options.origin==='agent'&&name==='stellaris_set_monthly_trade'&&!args.cancel){const project=ctx.store.get<Project>('projects',options.projectId!);mock.authorizeMonthly(data(result).order_id,Math.max(1,Math.min(12,Number(project?.scope.months)||1)));}rec.result=result;rec.status=tool.effect==='read'?'observed':'accepted';if(reservation){if(options.taskId){const t=ctx.store.get<ExtendedTask>('tasks',options.taskId);if(t){t.reservationId=reservation.id;saveTask(t);}}ledger.transition(reservation.id,'spent');}
   if(tool.effect!=='read')ctx.bus.emit('game.changed',{tool:name,origin:rec.origin,objects:args},rec.traceId);
  }catch(e:any){rec.error=e.message??String(e);if(e.result)rec.result=e.result;const tool=(await tools().catch(()=>[])).find(t=>t.name===name);rec.status=sent&&tool?.effect!=='read'&&!e.knownFailure?'unknown':(e instanceof PermissionDenied?'denied':'error');if(reservation)ledger.transition(reservation.id,rec.status==='unknown'?'unknown':'released');if(reservation&&options.taskId){const t=ctx.store.get<ExtendedTask>('tasks',options.taskId);if(t){t.reservationId=reservation.id;saveTask(t);}}}
  if(options.origin==='agent')markFleetLeaseResult(ctx,options.projectId,options.taskId,args,rec.status==='unknown');rec.durationMs=Date.now()-started;ctx.store.transaction(()=>{ctx.store.set('calls',rec.id,rec);ctx.bus.emit('call.completed',rec,rec.traceId);});return rec;
 }
 async function call(name:string,args:Json,options:Parameters<AdminService['call']>[2]={}){const opts={origin:'debug' as const,...options};const tool=(await tools()).find(t=>t.name===name);if(tool?.effect==='read')return perform(name,args,opts);let resolve!:(r:CallRecord)=>void;let reject!:(e:unknown)=>void;const result=new Promise<CallRecord>((r,j)=>{resolve=r;reject=j;});writeTail=writeTail.then(async()=>{try{resolve(await perform(name,args,opts));}catch(e){reject(e);}});return result;}
 async function preflightRead(name:string,args:Json,options:NonNullable<Parameters<AdminService['call']>[2]>):Promise<any>{const r=await call(name,args,{origin:'intel',traceId:options.traceId,projectId:options.projectId,taskId:options.taskId});if(r.status!=='observed')throw new Error(r.error??'提交前状态查询失败');return data(r.result);}
 async function observe(t:ExtendedTask):Promise<boolean>{
  if(!t.expected)return false;if(t.expected.generic)return observeGeneric(t,genericRuntime);const e=t.expected;let observation:any;let done=false;let accepted=false;
  if(e.tool==='stellaris_select_research'){const r=await call('stellaris_get_research_state',{}, {origin:'intel',traceId:t.traceId,taskId:t.id});if(r.status!=='observed')return false;observation=data(r.result);const area=typeof e.args.area==='number'?['physics','society','engineering'][e.args.area]:e.args.area;const slot=observation[area]??observation.areas?.find((a:any)=>a.area===area);done=Boolean(slot?.completed?.includes(e.args.tech_key));accepted=(slot?.current?.key??slot?.current?.tech_key)===e.args.tech_key||done;
  }else if(e.tool==='stellaris_build_building'){const r=await call('stellaris_get_planet_details',{planet_id:e.args.planet_id},{origin:'intel',traceId:t.traceId,taskId:t.id});if(r.status!=='observed')return false;observation=data(r.result);const queued=(observation.queue??observation.construction_queue??[]).find((q:any)=>(q.key??q.building_key)===e.args.building_key&&!(e.baselineOrderIds??[]).includes(q.id));const built=(observation.buildings??[]).filter((b:any)=>(typeof b==='string'?b:b.key??b.building_key)===e.args.building_key).length;done=built>(e.baselineBuilt??0);accepted=!!queued||done;
  }else if(e.tool==='stellaris_reinforce_fleet'){const r=await call('stellaris_get_fleets',{fleet_id:e.args.fleet_id},{origin:'intel',traceId:t.traceId,taskId:t.id});if(r.status!=='observed')return false;observation=data(r.result);const f=observation.fleets?.find((f:any)=>f.id===e.args.fleet_id);accepted=!!f&&(f.queue?.length>0||f.power>(e.baselinePower??0));done=!!f&&f.power>(e.baselinePower??0)&&!f.queue?.length;
  }
  t.lastObservedAt=now();if(accepted){if(t.reservationId)ledger.transition(t.reservationId,'spent');const last=t.callIds.map(id=>ctx.store.get<CallRecord>('calls',id)).find(c=>c&&c.tool===e.tool&&['accepted','unknown','submitted'].includes(c.status));if(last){last.status='observed';last.observation=observation;ctx.store.set('calls',last.id,last);ctx.bus.emit('call.observed',last,t.traceId);}t.status=done?'completed':'waiting';t.step=done?'后置观察确认完成':'命令已入队，等待实际完成';if(done)ledger.revokeOnce(t.projectId);if(done)feedback(t,'completed',e.tool==='stellaris_select_research'?'已观察到所选科技研究完成':'已观察到目标实际完成');else feedback(t,'waiting','命令已被观察接受，等待游戏内完成');saveTask(t);return true;}
  if(t.status==='unknown'){t.step='结果未知：保持资源预留，等待后续观察或人工核对';saveTask(t);return false;}
  saveTask(t);return false;
 }
 function candidateFallback(project:Project,snapshot:any,detail:Json):Action{
  if(project.kind==='research'){
   const areas=detail.areas??Object.entries(detail).filter(([k])=>['physics','society','engineering'].includes(k)).map(([k,v]:any)=>({...v,area:k}));const allowed=areas.filter((a:any)=>(!project.scope.area||a.area===project.scope.area)&&(!a.current||project.scope.allowSwitch===true));
   const preferences=[...(project.scope.preferences??[]),project.scope.targetCapability??'',project.goal].join(' ').toLowerCase();let best:any;
   for(const a of allowed)for(const c of a.candidates??[]){const text=`${c.key} ${c.name} ${c.capability??''}`.toLowerCase();let score=0;if(/科研|研究|research/.test(preferences)&&/research|_1$/.test(text))score+=5;if(/军事|军备|military|defense/.test(preferences)&&/military|fusion|corvette/.test(text))score+=6;if(/经济|economy|energy|能源/.test(preferences)&&/economy|energy|hydroponic/.test(text))score+=5;for(const p of project.scope.preferences??[])if(text.includes(String(p).toLowerCase()))score+=10;if(!best||score>best.score)best={a,c,score};}
   return best?{tool:'stellaris_select_research',args:{area:best.a.area,tech_key:best.c.key??best.c.tech_key},reason:'依据项目技术偏好，从当前空闲领域的合法候选中选择'}:{tool:'',args:{},reason:'当前没有符合范围的空闲科研领域或合法候选',wait:true};
  }
  if(project.kind==='construction'){
   const candidates=detail.candidates??[];let pref=String(project.scope.buildingPreference??project.goal);const key=/合金|foundry|军/.test(pref)?'foundry':/矿物|minerals|mineral/.test(pref)?'mineral':/能源|energy|经济/.test(pref)?'energy':'research';const c=candidates.find((x:any)=>String(x.key??x.building_key).includes(pref))??candidates.find((x:any)=>String(x.key??x.building_key).includes(key));return c?{tool:'stellaris_build_building',args:{planet_id:c.planet_id,building_key:c.key??c.building_key,...(c.zone_id!==undefined?{slot_index:c.zone_id}:{})},reason:'依据建设目标在可用星球当前可建列表中选择'}:{tool:'',args:{},reason:'当前对象范围内无符合条件的可建建筑',wait:true};
  }
  if(project.kind==='defense'){const f=(detail.fleets??[]).find((f:any)=>(!project.scope.fleetIds?.length||project.scope.fleetIds.includes(f.id))&&f.deficit>0&&!f.queue?.length);return f?{tool:'stellaris_reinforce_fleet',args:{fleet_id:f.id},reason:'按防守项目补充已授权舰队的实际编制缺口'}:{tool:'',args:{},reason:'当前舰队无待增援缺口，保持防守观察',wait:true};}
  return {tool:'',args:{},reason:'该项目尚无已登记的自主执行路径',wait:true};
 }
 async function detailFor(project:Project):Promise<Json>{
  if(project.kind==='research'){const c=await call('stellaris_get_research_state',{}, {origin:'intel',traceId:project.traceId});if(c.status!=='observed')throw new Error(c.error??'科研查询失败');return data(c.result);}
  if(project.kind==='construction'){const snap=getIntel().snapshot();const planets=(snap?.planets??[]).filter((p:any)=>!project.scope.planetIds?.length||project.scope.planetIds.includes(p.id??p.planet_id));const candidates:any[]=[];for(const p of planets){const id=p.id??p.planet_id;if(id===undefined)continue;const c=await call('stellaris_get_buildable_buildings',{planet_id:id},{origin:'intel',traceId:project.traceId});if(c.status!=='observed')continue;const r=data(c.result);for(const z of r.zones??[])for(const b of z.buildable??[])if(b.can_build!==false)candidates.push({...b,planet_id:id,zone_id:z.zone_id});if(!r.zones?.length)for(const b of r.buildings??p.buildableBuildings??[])if(b.can_build!==false)candidates.push({...b,planet_id:id});}return {candidates};}
  if(project.kind==='defense'){const c=await call('stellaris_get_fleets',{}, {origin:'intel',traceId:project.traceId});if(c.status!=='observed')throw new Error(c.error??'舰队查询失败');return data(c.result);}
  return {};
 }
 function rebasePath(projectId:string,from:number,to:number):Json[]|undefined {
  if(from>=to)return undefined;
  const links=ctx.store.list<Json>('project_rebases').filter(r=>r.projectId===projectId&&Number.isInteger(r.fromRevision)&&Number.isInteger(r.toRevision)&&r.toRevision>r.fromRevision&&r.toRevision<=to);
  const queue:Array<{revision:number;path:Json[]}>= [{revision:from,path:[]}];const seen=new Set<number>();
  while(queue.length){const next=queue.shift()!;if(next.revision===to)return next.path;if(seen.has(next.revision))continue;seen.add(next.revision);for(const edge of links.filter(r=>r.fromRevision===next.revision))queue.push({revision:edge.toRevision,path:[...next.path,edge]});}
  return undefined;
 }
 function adoptRebasedTasks(snapshotTimeline:string){
  for(const t of tasks()){
   if(!t.expected||t.status==='cancelled'||(t.timelineId&&t.timelineId!==snapshotTimeline))continue;
   const current=ctx.store.get<Project>('projects',t.projectId);if(!current||current.status==='cancelled'||current.revision<=t.projectRevision)continue;
   const path=rebasePath(t.projectId,t.projectRevision,current.revision);if(!path?.length)continue;
   const submitted=calls({taskId:t.id}).some(c=>c.taskId===t.id&&c.tool===t.expected?.tool&&['submitted','accepted','observed','unknown'].includes(c.status));if(!submitted&&t.status!=='completed')continue;
   const oldRevision=t.projectRevision;t.projectRevision=current.revision;t.rebasedFromRevision=oldRevision;t.rebaseIds=[...(t.rebaseIds??[]),...path.map(r=>r.id)];t.feedback=undefined;saveTask(t);
   for(const duplicate of tasks().filter(x=>x.id!==t.id&&x.projectId===t.projectId&&x.projectRevision===current.revision&&!x.expected&&!['completed','cancelled'].includes(x.status))){duplicate.status='cancelled';duplicate.step='已由明确 rebase 链承接原有任务，不重复提交';saveTask(duplicate);}
   ctx.bus.emit('task.rebased',{taskId:t.id,projectId:t.projectId,fromRevision:oldRevision,toRevision:current.revision,rebaseIds:path.map(r=>r.id)},t.traceId);
   if(t.status==='completed')feedback(t,'completed','已完成的原任务经明确 rebase 链承接，未重复提交游戏操作');
  }
 }
 const fleets=new FleetController({ctx,intel:getIntel,call});
 const incidents=new IncidentController({ctx,intel:getIntel,call,judge:judgeIncident});
 const genericRuntime:GenericRuntime={ctx,intel:getIntel,tools,call,save:saveTask,feedback,mockState:()=>mock.state(),valid:(project,revision)=>{const latest=ctx.store.get<Project>('projects',project.id);return !closed&&ledger.permissions().aiEnabled!==false&&!!latest&&latest.revision===project.revision&&!['cancelled','completed','blocked'].includes(latest.status)&&ledger.permissions().revision===revision;}};
 async function tick(){if(busy||closed)return;busy=true;try{
  const snapshot=getIntel().snapshot();if(!snapshot)return;adoptRebasedTasks(snapshot.timelineId);
  // Recover accepted/submitted work before considering new projects, including after stop/revoke.
  for(const t of tasks())if(['waiting','unknown','running'].includes(t.status)&&t.expected){if(t.timelineId&&t.timelineId!==snapshot.timelineId){t.status='blocked';t.step='时间线已变化，旧动作需人工核对';feedback(t,'blocked','读档或切换对局后，不能沿用旧对象与未决操作');continue;}const recoveredCalls=calls({taskId:t.id}).filter(c=>c.taskId===t.id&&c.tool===t.expected?.tool);t.callIds=[...new Set([...t.callIds,...recoveredCalls.map(c=>c.id)])];saveTask(t);if(t.status==='running'){const sent=recoveredCalls.some(c=>c.taskId===t.id&&c.tool===t.expected?.tool&&['submitted','accepted','unknown','observed'].includes(c.status));if(!sent){for(const r of ctx.store.list<Reservation>('reservations').filter(r=>r.taskId===t.id&&r.status==='reserved'))ledger.transition(r.id,'released');t.status='ready';t.expected=undefined;saveTask(t);continue;}t.status='unknown';}await observe(t);}
  if(ledger.permissions().aiEnabled===false){wakeClock.hold('administration',snapshot);return;}
  if(fleets.hasPriorityWork())return;
  const wakeDue=wakeClock.due('administration',snapshot);let woke=false;
  // Resolve modal choices before requesting more ordinary project decisions; observation above remains live.
  if(Array.isArray(snapshot.global.attention?.events)&&snapshot.global.attention.events.length)return;
  const projects=ctx.store.list<Project>('projects').filter(p=>p.kind!=='fleet'&&!['cancelled','completed','blocked'].includes(p.status)).sort((a,b)=>b.priority-a.priority);
  for(const id of ledger.permissions().oneTimeProjectIds??[]){const project=ctx.store.get<Project>('projects',id);if(!project||['completed','cancelled'].includes(project.status)||!ledger.onceAuthorized(project))ledger.revokeOnce(id);}
  const p=ledger.permissions();for(const project of projects){
   if(ledger.permissions().aiEnabled===false)break;
   let t=tasks().find(t=>t.projectId===project.id&&t.projectRevision===project.revision&&t.status!=='cancelled');
   if(!t){t={id:uid('task'),projectId:project.id,projectRevision:project.revision,traceId:project.traceId,status:'ready',step:'等待有效授权与当前状态',callIds:[],retries:0,at:now(),timelineId:snapshot.timelineId};saveTask(t);}
   if(['completed','cancelled','waiting','unknown','running'].includes(t.status))continue;
   const once=ledger.onceAuthorized(project);const enabled=once||domainEnabled(p,projectDomain(project));
   if(p.stopped||(p.mode==='advice'&&!once)||!enabled||p.pausedDepartments.includes(project.department)||p.pausedDepartments.includes('administration'))continue;
   if(t.status==='blocked'&&t.inputSnapshotVersion===snapshot.version)continue;
   if(project.dependencies.some(id=>!tasks().some(x=>x.projectId===id&&x.status==='completed'))){t.status='ready';t.step='等待依赖项目完成';saveTask(t);continue;}
   // Conflicting old accepted orders remain under observation and prevent a replacement project spending twice.
   if(tasks().some(x=>x.id!==t!.id&&['waiting','unknown','running'].includes(x.status)&&x.expected&&((project.kind==='construction'&&x.expected.tool==='stellaris_build_building')||(project.kind==='defense'&&x.expected.tool==='stellaris_reinforce_fleet'))))continue;
   const currentStrategy=ctx.store.list<Strategy>('strategies').filter(s=>s.id===project.strategyId).sort((a,b)=>b.revision-a.revision)[0];
   if(currentStrategy&&(currentStrategy.revision!==project.strategyRevision||strategyExpired(currentStrategy,snapshot))){if(t.step!=='等待有效的最新战略'){t.step='等待有效的最新战略';saveTask(t);}continue;}
   if(!woke){if(!wakeDue)break;wakeClock.mark('administration',snapshot);woke=true;}
   t.status='running';t.step='行政部门查询当前合法候选并制定具体操作';t.permissionRevision=p.revision;t.inputSnapshotVersion=snapshot.version;saveTask(t);
   try{if(project.kind==='generic'){await genericStep(project,t,genericRuntime);if(ctx.store.get<Task>('tasks',t.id)?.status==='completed')ledger.revokeOnce(project.id);continue;}const detail=await detailFor(project);const allowed=(await tools()).filter(x=>x.supported&&x.effect==='write'&&x.domain===(project.kind==='research'?'research':project.kind==='construction'?'construction':'military'));
    const input={project,permissions:p,snapshot,detail,tools:allowed};ctx.store.set('admin_decisions',t.id,{taskId:t.id,projectId:project.id,at:now(),input});
    const action=await ctx.models.json<Action>('administration','你是行政部门。依据有效项目与当前真实候选选择一次具体操作，只输出 JSON {tool,args,reason,wait?}。不得改变国家战略、扩大授权或虚构对象；无合法候选时 wait=true。tool 必须来自提供的 tools。参数按 schema。候选是当前事实。不要输出隐藏推理，只给简短操作依据。',input,()=>candidateFallback(project,snapshot,detail),t.traceId);
    ctx.store.set('admin_decisions',t.id,{taskId:t.id,projectId:project.id,at:now(),input,output:action});ctx.bus.emit('administration.decision',{taskId:t.id,projectId:project.id,action},t.traceId);
    const latest=ctx.store.get<Project>('projects',project.id);if(!latest||latest.revision!==project.revision||['cancelled','completed','blocked'].includes(latest.status)||ledger.permissions().revision!==p.revision){t.status='ready';t.step='输入版本已变化，丢弃旧行政决策';saveTask(t);continue;}
    if(!action||typeof action!=='object'||typeof action.reason!=='string')throw new Error('行政模型返回结构无效');
    if(action.wait){t.status='blocked';t.step=action.reason;feedback(t,'blocked',action.reason);continue;}
    if(!allowed.some(x=>x.name===action.tool))throw new Error('模型选择的工具不属于当前项目可用路径');
    if(!action.args||typeof action.args!=='object'||Array.isArray(action.args))throw new Error('行政模型参数必须为 JSON 对象');
    t.expected={tool:action.tool,args:action.args};t.object=action.args.planet_id!==undefined?`planet:${action.args.planet_id}`:action.args.fleet_id!==undefined?`fleet:${action.args.fleet_id}`:action.args.area!==undefined?`research:${action.args.area}`:undefined;
    if(action.tool==='stellaris_build_building'){const c=await call('stellaris_get_planet_details',{planet_id:action.args.planet_id},{origin:'intel',traceId:t.traceId});const planet=data(c.result);t.expected.baselineOrderIds=(planet.queue??planet.construction_queue??[]).map((q:any)=>q.id);t.expected.baselineBuilt=(planet.buildings??[]).filter((b:any)=>(typeof b==='string'?b:b.key)===action.args.building_key).length;}
    if(action.tool==='stellaris_reinforce_fleet'){const f=detail.fleets?.find((f:any)=>f.id===action.args.fleet_id);t.expected.baselinePower=f?.power??0;}
    saveTask(t);const c=await call(action.tool,action.args,{origin:'agent',traceId:t.traceId,projectId:project.id,taskId:t.id,permissionRevision:p.revision});t=ctx.store.get<ExtendedTask>('tasks',t.id)??t;t.callIds.push(c.id);t.status=c.status==='unknown'?'unknown':c.status==='accepted'?'waiting':c.status==='denied'?'ready':'blocked';t.step=c.error??'已提交 MCP，等待后置观察';t.waitCondition=c.status==='unknown'?'先查询实际状态，禁止重复支出':'观察选择、队列或目标完成';saveTask(t);if(c.status==='accepted'||c.status==='unknown')await observe(t);else if(c.status!=='denied')feedback(t,'blocked',c.error??'调用失败');
   }catch(e:any){if(e.name==='ModelCancelled'||ledger.permissions().aiEnabled===false){t.status='ready';t.step='AI 总开关已关闭，本轮未提交决策已取消';saveTask(t);continue;}t.status='blocked';t.step=e.message??String(e);t.retries++;feedback(t,'blocked',t.step);saveTask(t);}
  }
  // Cancel only work that has not entered the game. In-flight observations survive project cancellation.
  for(const t of tasks())if(['ready','blocked'].includes(t.status)){const project=ctx.store.get<Project>('projects',t.projectId);if(!project||project.revision!==t.projectRevision||project.status==='cancelled'){t.status='cancelled';t.step='项目撤销或已被新版本替代';saveTask(t);}}
 }finally{busy=false;for(const resolve of idleWaiters.splice(0))resolve();}}
 return {tools,call,tick,militaryTick:()=>fleets.tick(),fleetMissions:()=>fleets.list(),fleetCommands:()=>fleets.commands(),controlFleetMission:(id,action)=>fleets.control(id,action),attentionTick:()=>incidents.tick(),incidents:()=>incidents.list(),permissions:()=>ledger.permissions(),updatePermissions:patch=>ledger.update(patch),tasks,calls,reservations:()=>ctx.store.list<Reservation>('reservations'),annotate(id,verdict,note){if(!['matched','mismatched','uncertain','unchecked','匹配','不匹配','无法判断','未检查'].includes(verdict))throw new Error('无效观察标记');const c=ctx.store.get<CallRecord>('calls',id);if(!c)throw new Error('调用不存在');c.annotation={verdict,note:String(note).slice(0,10000)};ctx.store.set('calls',id,c);ctx.bus.emit('call.annotated',c,c.traceId);},async advanceMock(days){if(ctx.config.gameMode!=='mock')throw new Error('当前不是 mock 环境');const s=mock.advance(days);ctx.bus.emit('game.changed',{source:'mock',advancedDays:days});await getIntel().refresh();await tick();return s;},async mockControl(patch){if(ctx.config.gameMode!=='mock')throw new Error('当前不是 mock 环境');const s=mock.control(patch);ctx.bus.emit('game.changed',{source:'mock',control:true});await getIntel().refresh();return s;},async shutdown(){closed=true;await Promise.all([incidents.shutdown(),fleets.shutdown()]);if(busy)await new Promise<void>(resolve=>idleWaiters.push(resolve));await writeTail;await real.close();}};
}
