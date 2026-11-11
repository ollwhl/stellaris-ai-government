import {createHash} from 'node:crypto';
import type {Context,GameIncident,IncidentDecision,IncidentInput,Json,Project,Snapshot,Strategy} from '../../contracts/index.js';
import {z} from 'zod';
const canonical=(v:any):any=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().filter(k=>!['observedAt','collectedAt','remaining_days','remaining_time','expires_in','elapsed','updated_at'].includes(k)).map(k=>[k,canonical(v[k])])):v;
export const digest=(v:any)=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
export const incidentFingerprint=(kind:GameIncident['kind'],payload:Json)=>digest(kind==='notification'?{...payload,index:undefined}:payload);
export const unwrap=(v:any)=>v?.data??v;
export function windows(v:any):Json[]{if(Array.isArray(v))return v;for(const key of ['events','windows','event_windows','pending_events'])if(Array.isArray(v?.[key]))return v[key];return [];}
export function eventOptions(payload:Json):Json[]{return (Array.isArray(payload.options)?payload.options:[]).filter((o:any)=>Number.isInteger(o.index)&&o.hidden!==true&&o.visible!==false&&o.enabled!==false&&o.can_select!==false&&o.allowed!==false);}
export function optionCost(option:Json):{known:boolean;cost:Json}{
 const supplied=option.cost??option.resource_cost??option.costs;if(supplied===0)return {known:true,cost:{}};
 if(supplied&&typeof supplied==='object'&&!Array.isArray(supplied)&&Object.values(supplied).every(v=>typeof v==='number'&&Number.isFinite(v)&&v>=0))return {known:true,cost:Object.fromEntries(Object.entries(supplied).filter(([,v])=>Number(v)>0))};
 if(option.free===true||option.no_cost===true)return {known:true,cost:{}};
 if(supplied!==undefined)return {known:false,cost:{}};
 // The bridge omits effects for choices without immediate effects. Do not infer spending from tooltip prose.
 if(/花费|消耗|支付|costs?\b|spend|pay\b/i.test(String(option.description??'')))return {known:false,cost:{}};
 return option.effects===undefined||option.effects===null||option.effects===''?{known:true,cost:{}}:{known:false,cost:{}};
}
export function criticalSignal(v:any):boolean{return /宣战|战争爆发|遭到.{0,12}进攻|war[ _.-]*declar|declar(?:ed|ation).{0,30}war|has declared war|crisis[ _.-]*attack/i.test(typeof v==='string'?v:JSON.stringify(v));}
export function importantEvent(payload:Json):boolean{return criticalSignal(payload)||payload.important===true||payload.irreversible===true||/不可逆|割让|投降|灭绝|政体变更|surrender|cede|annex|irreversible|genocide/i.test(JSON.stringify(payload));}
export function latestStrategy(ctx:Context){return ctx.store.list<Strategy>('strategies').sort((a,b)=>b.revision-a.revision||b.at.localeCompare(a.at))[0];}
export function policySignature(ctx:Context):string {const strategy=latestStrategy(ctx);return digest({strategy,goal:ctx.store.get('government_meta','goal')});}
export function canAttend(ctx:Context,role:'administration'|'president'):boolean {const p=ctx.store.get<any>('control','permissions');return p?.aiEnabled!==false&&!p?.pausedDepartments?.includes(role);}
export function validateIncidentDecision(value:unknown,payload:Json):IncidentDecision {
 const result=z.object({action:z.enum(['choose','escalate','observe']),optionIndex:z.number().int().optional(),reason:z.string().trim().min(1).max(2000),importance:z.enum(['routine','important','critical']).optional(),replan:z.boolean().optional(),directive:z.string().max(4000).optional()}).parse(value);
 if(result.action==='choose'&&!eventOptions(payload).some(o=>o.index===result.optionIndex))throw new Error('裁决选项不在当前可见且可用的选项中');
 return result;
}
export function incidentProject(ctx:Context,incident:GameIncident):Project {
 const s=latestStrategy(ctx),p=ctx.store.get<any>('control','permissions');
 return {id:'incident:'+incident.id,revision:1,strategyId:s?.id??'standing-event-policy',strategyRevision:s?.revision??0,traceId:incident.traceId,department:'administration',kind:'generic',title:incident.title,goal:'按当前方针处理该事件',scope:{domain:'state',allowedTools:['stellaris_resolve_event','stellaris_open_notification','stellaris_open_alert']},budget:Object.fromEntries(Object.entries(p?.budgets??{}).map(([key,value])=>[key,Math.min(Number(value),Number(s?.budgets?.[key]??value))])),priority:100,dependencies:[],completion:'观察所选事件已处理',termination:'授权撤销或事件变化',status:'ready',at:incident.at};
}
export function verifyIncidentGrant(ctx:Context,incident:GameIncident|undefined,name:string,args:Json,snapshot?:Snapshot){
 const p=ctx.store.get<any>('control','permissions');
 if(!incident||!['ready','submitting'].includes(incident.status)||incident.permissionRevision!==p?.revision||incident.policySignature!==policySignature(ctx))throw new Error('事件处理依据或授权已变化，需要重新判断');
 if(!snapshot||incident.source!==snapshot.source||incident.sessionId!==snapshot.sessionId||incident.timelineId!==snapshot.timelineId)throw new Error('事件所属对局或时间线已变化');
 if(p?.mode==='advice'||p?.stopped||p?.aiEnabled===false||!p?.domains?.state||!canAttend(ctx,'administration')||incident.decisionRole==='president'&&!canAttend(ctx,'president'))throw new Error('当前权限禁止事件自动写入');
 if(p.controlledObjects?.includes(`event:${incident.payload.window_id}`))throw new Error('该事件已被玩家人工接管');
 const expected=incident.kind==='popup'?'stellaris_resolve_event':incident.kind==='notification'?'stellaris_open_notification':incident.kind==='alert'?'stellaris_open_alert':undefined;
 if(name!==expected)throw new Error('工具不属于该事件的有限处置范围');
 if(name==='stellaris_resolve_event'&&(args.window_id!==incident.payload.window_id||args.option_index!==incident.selectedIndex))throw new Error('事件或选项超出当前裁决');
 if(name==='stellaris_open_notification'&&args.index!==incident.payload.index)throw new Error('通知序号已变化');
 if(name==='stellaris_open_alert'&&args.alert_id!==incident.payload.alert_id)throw new Error('预警编号不匹配');
}

export function optionFits(input:IncidentInput,option:Json):boolean {
 const quote=optionCost(option);if(!quote.known)return false;
 return Object.entries(quote.cost).every(([key,value])=>{const amount=Number(value);const reserved=(input.reservations??[]).filter(r=>['reserved','submitted','unknown'].includes(r.status)).reduce((n,r)=>n+(r.resources[key]??0),0);return amount<=Math.min(input.permissions.budgets[key]??0,input.strategy?.budgets?.[key]??Infinity)&&amount<=(input.snapshot.resources[key]?.stockpile??0)-Number(input.strategy?.constraints?.resourceFloor?.[key]??0)-reserved;});
}
