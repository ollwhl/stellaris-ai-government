import {z} from 'zod';
import type {BattlefieldState,Context,FleetMissionScope,Json,Project,Snapshot} from '../../contracts/index.js';
export const fleetScopeSchema=z.object({mission:z.enum(['defend','regroup','attack','pursue','escort','retreat','resupply','assault']),fleetIds:z.array(z.number().int().nonnegative()).min(1).max(32).transform(a=>[...new Set(a)]),targetSystemId:z.number().int().nonnegative().optional(),targetFleetId:z.number().int().nonnegative().optional(),targetPlanetId:z.number().int().nonnegative().optional(),rallySystemId:z.number().int().nonnegative().optional(),homeSystemId:z.number().int().nonnegative().optional(),transportFleetIds:z.array(z.number().int().nonnegative()).max(16).optional(),minimumAdvantage:z.number().min(1).max(5).default(1.2),retreatHull:z.number().min(0.05).max(0.9).default(0.4),retreatLoss:z.number().min(0.05).max(0.9).default(0.3),allowEmergencyFtl:z.boolean().default(false),requireRepair:z.boolean().default(false)}).superRefine((s,c)=>{if(['defend','regroup','attack','pursue','escort','assault'].includes(s.mission)&&s.targetSystemId===undefined&&s.targetFleetId===undefined)c.addIssue({code:'custom',message:'任务需要明确目标星系或舰队'});if(['attack','pursue','escort'].includes(s.mission)&&s.targetFleetId===undefined)c.addIssue({code:'custom',message:'进攻、追击或护航需要明确目标舰队'});if(s.mission==='assault'&&(s.targetPlanetId===undefined||!s.transportFleetIds?.length))c.addIssue({code:'custom',message:'登陆任务需要目标星球与运输舰队'});if(s.transportFleetIds?.some(id=>!s.fleetIds.includes(id)))c.addIssue({code:'custom',message:'运输舰队必须属于本任务舰队范围'});});
export const fleetTools=new Set(['stellaris_move_fleet','stellaris_cancel_fleet_orders','stellaris_follow_fleet','stellaris_set_fleet_stance','stellaris_fleet_mia','stellaris_orbit_planet','stellaris_land_armies','stellaris_reinforce_fleet','stellaris_upgrade_fleet']);
export const ownFleetIds=(args:Json):number[]=>[...new Set([...(Number.isInteger(args.fleet_id)?[args.fleet_id]:[]),...(Array.isArray(args.fleet_ids)?args.fleet_ids:[])])];
export const canonical=(v:any):any=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
export const equal=(a:any,b:any)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
export function battleIdentity(b:Pick<BattlefieldState,'source'|'sessionId'|'timelineId'>){return `${b.source}:${b.sessionId}:${b.timelineId}`;}
export function verifyFleetAction(ctx:Context,project:Project,tool:string,args:Json,snapshot?:Snapshot){
 const b=snapshot?.battlefield,p=ctx.store.get<any>('control','permissions'),scope=fleetScopeSchema.parse(project.scope);
 if(!fleetTools.has(tool)||!b)throw new Error('舰队任务工具或战场态势尚不可用');
 if(b.source!==ctx.config.gameMode||Date.now()-Date.parse(b.at)>(ctx.config.battlefield?.staleAfterMs??30000))throw new Error('战场态势过期，等待重新采集');
 const ids=ownFleetIds(args);if(!ids.length||ids.some(id=>!scope.fleetIds.includes(id)))throw new Error('命令舰队超出任务范围');
 const fleets=ids.map(id=>b.fleets.find(f=>f.id===id&&f.relation==='own'&&f.freshness==='fresh'&&!f.destroyed));if(fleets.some(f=>!f))throw new Error('命令舰队当前未被可靠观察为己方有效舰队');
 const destinations=[scope.targetSystemId,scope.rallySystemId,scope.homeSystemId,b.homeSystemId,b.fleets.find(f=>f.id===scope.targetFleetId&&f.visible&&f.freshness==='fresh')?.systemId].filter(x=>x!==undefined&&x!==null);
 if(tool==='stellaris_move_fleet'&&!destinations.includes(args.system_id))throw new Error('移动目的地超出任务边界');
 if(tool==='stellaris_move_fleet'&&!b.systems.some(s=>s.id===args.system_id))throw new Error('目标星系尚未进入已知地图');
 if(tool==='stellaris_move_fleet'){
  const enemies=b.fleets.filter(f=>f.relation==='hostile'&&f.visible&&f.freshness==='fresh'&&!f.destroyed&&f.systemId===args.system_id);
  if(enemies.length){const available=b.fleets.filter(f=>f.relation==='own'&&f.freshness==='fresh'&&!f.destroyed&&(f.systemId===args.system_id||ids.includes(f.id)));if(enemies.some(f=>f.power===null)||available.some(f=>f.power===null)||available.reduce((n,f)=>n+(f.power??0),0)<enemies.reduce((n,f)=>n+(f.power??0),0)*scope.minimumAdvantage)throw new Error('进入敌舰星系前尚未核验足够力量优势');if(fleets.some(f=>f?.type==='army'||f?.type==='transport'))throw new Error('运输舰队应等待目标区域无可见敌舰后再进入');}
 }
 if(tool==='stellaris_follow_fleet'){
  const target=b.fleets.find(f=>f.id===args.target_fleet_id&&f.visible&&f.freshness==='fresh'&&!f.destroyed);if(!target||target.id!==scope.targetFleetId&&!(['defend','assault'].includes(scope.mission)&&target.systemId===scope.targetSystemId))throw new Error('跟随目标不可见或不属于任务');
  if(target.id===args.fleet_id)throw new Error('不能命令舰队跟随自己');if(args.attack===true){const defensive=scope.mission==='defend'&&target.relation==='hostile'&&b.systems.some(s=>s.id===target.systemId&&s.ownership==='own');if(!defensive&&!p.offensiveMilitary)throw new Error('主动进攻未授权');if(target.relation!=='hostile')throw new Error('不能把中立或未知势力当作敌人攻击');const own=b.fleets.filter(f=>f.relation==='own'&&f.freshness==='fresh'&&f.systemId===target.systemId&&f.power!==null&&!f.destroyed).reduce((n,f)=>n+f.power!,0);const hostile=b.fleets.filter(f=>f.relation==='hostile'&&f.visible&&f.freshness==='fresh'&&f.systemId===target.systemId&&!f.destroyed);if(target.power===null||hostile.some(f=>f.power===null)||own<hostile.reduce((n,f)=>n+f.power!,0)*scope.minimumAdvantage)throw new Error('当前可核验的局部力量优势不足，先集结或撤退');}
 }
 if(tool==='stellaris_fleet_mia'&&args.type==='emergency_ftl'&&(!p.emergencyRetreat||!scope.allowEmergencyFtl))throw new Error('紧急跃迁撤退未授权');
 if(tool==='stellaris_land_armies'){
  if(scope.mission!=='assault'||args.planet_id!==scope.targetPlanetId||!scope.transportFleetIds?.includes(args.fleet_id))throw new Error('登陆对象超出任务');
  if(!p.offensiveMilitary)throw new Error('登陆进攻未授权');const target=b.systems.find(s=>s.planets.some(x=>x.id===args.planet_id));if(!target||target.freshness!=='fresh'||fleets[0]?.systemId!==target.id)throw new Error('登陆舰尚未抵达已核验目标');if(b.fleets.some(f=>f.relation==='hostile'&&f.visible&&f.freshness==='fresh'&&f.systemId===target.id&&!f.destroyed))throw new Error('登陆区域仍有可见敌舰，先处理制空权');
 }
 if(tool==='stellaris_orbit_planet'&&args.planet_id!==scope.targetPlanetId)throw new Error('环绕星球超出任务范围');
}
