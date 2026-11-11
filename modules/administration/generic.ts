import type {Context,Project,Task,Json,AdminService,IntelService,ToolDefinition} from '../../contracts/index.js';
import {now} from '../../contracts/index.js';
import {capabilities,queryTools,objectRefs} from '../../integrations/game_mcp/registry.js';
import {mockCandidates,mockCost} from '../../integrations/game_mcp/extended-mock.js';

type GenericTask=Task&Json;
const unwrap=(x:any)=>x?.data??x;
const canonical=(v:any):any=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const same=(a:any,b:any)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
export interface GenericRuntime {
 ctx:Context;intel:()=>IntelService;tools:()=>Promise<ToolDefinition[]>;call:AdminService['call'];save:(t:GenericTask)=>void;
 feedback:(t:GenericTask,status:string,reason:string)=>void;valid:(project:Project,permissionRevision:number)=>boolean;
 mockState:()=>Json;
}
export async function genericStep(project:Project,t:GenericTask,r:GenericRuntime):Promise<void>{
 const state=r.ctx.store.get<Json>('generic_tasks',t.id)??{steps:0,writes:0,history:[]};
 const allowed=await r.tools();const names=new Set<string>([...(project.scope.allowedTools??[]),...queryTools(String(project.scope.domain)),'stellaris_get_status','stellaris_get_outliner']);
 const tools=allowed.filter(tool=>tool.supported&&(tool.effect==='read'||names.has(tool.name)&&tool.domain===project.scope.domain));
 const readOnlyProject=!(project.scope.allowedTools??[]).some((name:string)=>capabilities[name]?.effect==='write');if(!(project.scope.allowedTools??[]).some((name:string)=>tools.some(t=>t.name===name)))throw new Error('项目未指定有效领域工具');
 const maxWrites=Math.max(1,Math.min(12,Number(project.scope.maxActions)||6));
 if(state.steps>=24)throw new Error('通用行政项目达到24轮上限，需重新评估，未宣称完成');
 const permissionRevision=r.ctx.store.get<any>('control','permissions')!.revision;
 const input={project,permissions:r.ctx.store.get('control','permissions'),snapshot:r.intel().snapshot(),tools,history:state.history,candidates:r.ctx.config.gameMode==='mock'?mockCandidates(r.mockState(),String(project.scope.domain)):[],limits:{maxWrites,remainingWrites:maxWrites-state.writes,remainingSteps:24-state.steps}};
 r.ctx.store.set('admin_decisions',`${t.id}:${state.steps}`,{taskId:t.id,projectId:project.id,at:now(),input});
 const action=await r.ctx.models.json<Json>('administration',`你是${r.ctx.config.roleNames?.administration??'行政执行角色'}。针对一个明确业务项目逐步查询与执行。仅返回 JSON {tool,args,reason,complete?,wait?,observe?:{tool,args,path,mode,value}}。tool 必须来自 tools，参数严格遵循 schema；可多轮读取候选后再写入，不得虚构对象、成本、已完成结果或扩大项目范围。真实模式写入需给出 observe：使用已读取过的只读工具、参数与实际返回字段 path（点分路径），mode 为 equals/includes/absent/gte/lte，value 为可观察目标。先读实际结构再定义条件，不能用模型估计成本。history 是实际调用与回读证据，已完成的相同操作不得重复。目标实际完成才 complete=true；无合法操作但目标未完成时 wait=true，并给简短公开原因。complete=true 时不得同时指定写入工具。`,input,()=>{
  const done=state.history.some((h:any)=>h.kind==='write_observed'||readOnlyProject&&h.kind==='read'&&h.status==='observed');if(done)return {complete:true,reason:'已根据模拟回读确认项目的一次业务操作完成'};
  if(readOnlyProject){const tool=tools.find(t=>(project.scope.allowedTools??[]).includes(t.name));return tool?{tool:tool.name,args:project.scope.queryArgs?.[tool.name]??{},reason:'执行项目指定的只读查询'}:{wait:true,reason:'没有合法查询工具'};}
  const candidate=input.candidates.find((c:any)=>names.has(c.tool)&&!state.history.some((h:any)=>h.tool===c.tool&&same(h.args,c.args)));
  return candidate?{tool:candidate.tool,args:candidate.args,reason:'依据当前模拟候选执行已授权项目'}:{wait:true,reason:'当前没有项目允许的合法候选'};
 },t.traceId);
 r.ctx.store.set('admin_decisions',`${t.id}:${state.steps}`,{taskId:t.id,projectId:project.id,at:now(),input,output:action});
 if(!r.valid(project,permissionRevision)){t.status='ready';t.step='输入版本变化，丢弃旧通用行政决策';r.save(t);return;}
 if(typeof action.reason!=='string')throw new Error('行政输出缺少公开操作依据');
 if(action.complete){if(!state.history.some((h:any)=>h.kind==='write_observed'||readOnlyProject&&h.kind==='read'&&h.status==='observed'))throw new Error('尚无写入回读证据，不能宣称业务项目完成');t.status='completed';t.step=action.reason;r.feedback(t,'completed',action.reason);r.save(t);return;}
 if(action.wait){t.status='blocked';t.step=action.reason;r.feedback(t,'blocked',action.reason);r.save(t);return;}
 const tool=tools.find(x=>x.name===action.tool);if(!tool||!action.args||typeof action.args!=='object'||Array.isArray(action.args))throw new Error('通用行政输出工具或参数无效');
 state.steps++;t.object=objectRefs(action.args).join('、')||undefined;
 if(tool.effect==='write'){
  if(state.writes>=maxWrites)throw new Error('项目已达到授权操作次数上限');
  if(r.ctx.config.gameMode==='real'){const probe=observer(action.observe,tools)??realProbe(action.tool,action.args);if(!probe)throw new Error('该实际操作需要明确的只读回读条件 observe');const baseline=await r.call(probe.tool,probe.args,{origin:'intel',traceId:t.traceId,taskId:t.id});if(baseline.status!=='observed')throw new Error('无法读取提交前验证条件');if(probe.matches(unwrap(baseline.result)))throw new Error('目标回读条件已成立，未重复提交；请重新评估项目');}
  if(state.history.some((h:any)=>h.kind==='write_observed'&&h.tool===action.tool&&same(h.args,action.args)))throw new Error('同一项目不重复执行已完成的相同操作');
  const before=await r.call('stellaris_get_status',{}, {origin:'intel',traceId:t.traceId,projectId:project.id,taskId:t.id});if(before.status!=='observed')throw new Error('提交前状态读取失败');
  t.expected={tool:action.tool,args:action.args,generic:true,observer:action.observe,baselineOperationIds:(unwrap(before.result)?.operationLog??[]).map((o:any)=>o.id),before:unwrap(before.result)};
  r.save(t);r.ctx.store.set('generic_tasks',t.id,state);
 }
 const result=await r.call(action.tool,action.args,{origin:tool.effect==='read'?'intel':'agent',traceId:t.traceId,projectId:project.id,taskId:t.id,permissionRevision});
 t.callIds.push(result.id);state.history.push({kind:tool.effect==='read'?'read':'write_submitted',tool:action.tool,args:action.args,result:result.result,status:result.status,error:result.error});
 if(tool.effect==='write'){
  if(['accepted','unknown'].includes(result.status)){state.writes++;t.status=result.status==='unknown'?'unknown':'waiting';t.step='已提交领域操作，等待回读实际结果';t.waitCondition='先观察实际效果，未知结果不重试';t.expected.operationId=unwrap(result.result)?.operation_id;}
  else{t.expected=undefined;t.status=result.status==='denied'?'ready':'blocked';t.step=result.error??'领域写入失败';if(t.status==='blocked')r.feedback(t,'blocked',t.step);}
 }else{t.status=result.status==='observed'?'ready':'blocked';t.step=result.status==='observed'?'已取得候选，下一轮继续行政决策':result.error??'候选查询失败';if(t.status==='blocked')r.feedback(t,'blocked',t.step);}
 r.ctx.store.set('generic_tasks',t.id,state);r.save(t);
}

// In real mode, only verifiable postconditions are accepted; an MCP acknowledgement alone is never completion.
export async function observeGeneric(t:GenericTask,r:GenericRuntime):Promise<boolean>{
 const e=t.expected;if(!e?.generic)return false;
 const status=await r.call('stellaris_get_status',{}, {origin:'intel',traceId:t.traceId,taskId:t.id});if(status.status!=='observed')return false;
 let observed:any,complete=false;
 if(r.ctx.config.gameMode==='mock'){
  const operations=unwrap(status.result)?.operationLog??[];
  observed=operations.find((o:any)=>e.operationId?o.id===e.operationId:!(e.baselineOperationIds??[]).includes(o.id)&&o.tool===e.tool&&same(o.args,e.args));
  if(observed?.cancelled){t.status='blocked';t.step='回读确认原操作已取消，未宣称目标完成';r.feedback(t,'blocked',t.step);r.save(t);return true;}
  complete=!!observed?.completed;
 }else{
  const probe=observer(e.observer,await r.tools())??realProbe(e.tool,e.args);if(probe){const record=await r.call(probe.tool,probe.args,{origin:'intel',traceId:t.traceId,taskId:t.id});if(record.status==='observed'){const data=unwrap(record.result);complete=probe.matches(data);if(complete)observed=data;}}
 }
 if(!observed){t.step=t.status==='unknown'?'操作结果未知，保留预留并等待回读；禁止盲重试':'已提交，暂未取得足够完成证据';r.save(t);return false;}
 const last=t.callIds.map((id:string)=>r.ctx.store.get<any>('calls',id)).find((c:any)=>c&&c.tool===e.tool&&['accepted','submitted','unknown'].includes(c.status));
 if(last){last.status='observed';last.observation=observed;r.ctx.store.set('calls',last.id,last);r.ctx.bus.emit('call.observed',last,t.traceId);}
 if(!complete){t.status='waiting';t.step='已观察到订单，等待实际业务完成';r.save(t);return true;}
 const state=r.ctx.store.get<Json>('generic_tasks',t.id)??{steps:0,writes:1,history:[]};state.writes=Math.max(state.writes??0,(r.ctx.store.find?.<any>('calls',{taskId:t.id})??r.ctx.store.list<any>('calls')).filter(c=>c.taskId===t.id&&capabilities[c.tool]?.effect==='write'&&['accepted','observed','unknown'].includes(c.status)).length);state.history.push({kind:'write_observed',tool:e.tool,args:e.args,observation:observed});r.ctx.store.set('generic_tasks',t.id,state);
 if(t.reservationId){const reservation=r.ctx.store.get<any>('reservations',t.reservationId);if(reservation){reservation.status='spent';r.ctx.store.set('reservations',reservation.id,reservation);}}
 // Return to the model with actual evidence; it decides whether this business goal needs another step.
 t.expected=undefined;t.status='ready';t.step='已回读确认操作完成，继续检查项目目标';r.save(t);return true;
}

function observer(spec:any,tools:ToolDefinition[]):{tool:string;args:Json;matches:(data:any)=>boolean}|undefined {
 if(!spec||typeof spec.tool!=='string'||!tools.some(t=>t.name===spec.tool&&t.supported&&t.effect==='read')||typeof spec.path!=='string'||!spec.path||spec.path.length>200||!['equals','includes','absent','gte','lte'].includes(spec.mode)||!spec.args||typeof spec.args!=='object'||Array.isArray(spec.args))return undefined;
 return {tool:spec.tool,args:spec.args,matches:data=>{let value=data;for(const part of spec.path.split('.')){if(['__proto__','constructor','prototype'].includes(part))return false;value=value?.[part];}if(spec.mode==='absent')return value===undefined||value===null||(Array.isArray(value)&&!value.length);if(spec.mode==='equals')return same(value,spec.value);if(spec.mode==='includes')return Array.isArray(value)&&value.some(x=>same(x,spec.value));if(typeof value!=='number'||typeof spec.value!=='number')return false;return spec.mode==='gte'?value>=spec.value:value<=spec.value;}};
}

function realProbe(tool:string,a:Json):{tool:string;args:Json;matches:(data:any)=>boolean}|undefined {
 if(tool==='stellaris_set_paused')return {tool:'stellaris_get_status',args:{},matches:d=>d.paused===a.paused};
 if(tool==='stellaris_set_speed')return {tool:'stellaris_get_status',args:{},matches:d=>d.speed===a.speed};
 if(tool==='stellaris_set_fleet_stance')return {tool:'stellaris_get_fleets',args:{fleet_id:a.fleet_id},matches:d=>(d.fleets??[]).some((f:any)=>(f.id??f.fleet_id)===a.fleet_id&&f.stance===a.stance)};
 if(tool==='stellaris_adopt_tradition')return {tool:'stellaris_get_traditions',args:{},matches:d=>(d.adopted??d.adopted_traditions??[]).some((x:any)=>(typeof x==='string'?x:x.key)===a.tradition_key)};
 if(tool==='stellaris_toggle_edict')return {tool:'stellaris_get_edicts',args:{},matches:d=>(d.edicts??[]).some((x:any)=>x.key===a.edict_key&&x.enabled===a.enabled)};
 if(tool==='stellaris_move_fleet')return {tool:'stellaris_get_fleets',args:{fleet_id:a.fleet_id},matches:d=>(d.fleets??[]).some((x:any)=>(x.id??x.fleet_id)===a.fleet_id&&x.system_id===a.system_id)};
 return undefined;
}

export function genericCost(ctx:Context,state:Json,name:string,args:Json,observations:Json[],project?:Project):Json {
 if(ctx.config.gameMode==='mock'){const cost=mockCost(state,name,args);const months=name==='stellaris_set_monthly_trade'&&!args.cancel?Math.max(1,Math.min(12,Number(project?.scope.months)||1)):1;return Object.fromEntries(Object.entries(cost).map(([k,v])=>[k,Number(v)*months]));}
 // All costs must come from the actual candidate reads, never from model estimates.
 const paid=new Set('resolve_event claim_system build_outpost upgrade_megastructure build_megastructure colonize change_civics adopt_tradition toggle_edict hire_leader apply_species_template upgrade_fleet build_ship build_district upgrade_building clear_blocker enact_planetary_decision start_terraforming ascend_colony recruit_planet_army market_trade set_monthly_trade activate_relic'.split(' ').map(n=>'stellaris_'+n));
 if(!paid.has(name))return {};
 const identifiers=Object.entries(args).filter(([k])=>/(_key|_id|target_class)$/.test(k));
 const found:Json[]=[];const walk=(v:any)=>{if(!v||typeof v!=='object')return;if(!Array.isArray(v)&&v.cost&&typeof v.cost==='object'&&identifiers.some(([k,x])=>v[k]===x||v.key===x||v.id===x))found.push(v);for(const x of Object.values(v))if(x&&typeof x==='object')walk(x);};
 for(const o of observations)walk(o);
 if(found.length===1)return found[0].cost;
 throw new Error('实际候选未提供唯一可核验成本，暂停支出并请求重新评估');
}
