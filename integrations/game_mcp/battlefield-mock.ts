import type {Json} from '../../contracts/index.js';
export function extendBattlefield(s:Json){
 if(!s.battlefieldVersion){
  const extra=[{id:2,name:'北望边境',owner:0,neighbors:[0,3],planets:[],x:20,y:90,starbase:{power:120}},{id:3,name:'灰烬前沿',owner:9,neighbors:[2,4],planets:[90],x:130,y:60,starbase:null},{id:4,name:'远星通道',owner:null,neighbors:[1,3],planets:[],x:180,y:-60,starbase:null}];
  for(const system of extra)if(!s.systems.some((x:any)=>x.id===system.id))s.systems.push(system);
  Object.assign(s.systems.find((x:any)=>x.id===0),{x:0,y:0,neighbors:[1,2],starbase:{power:200}});Object.assign(s.systems.find((x:any)=>x.id===1),{x:90,y:-80,neighbors:[0,4],starbase:null});
  if(!s.fleets.some((f:any)=>f.id===4))s.fleets.push({id:4,name:'第二防卫舰队',type:'military',power:300,deficit:0,reinforcementCost:{alloys:200},queue:[],system_id:2});
  if(!s.fleets.some((f:any)=>f.id===5))s.fleets.push({id:5,name:'登陆运输队',type:'army',power:0,deficit:0,queue:[],system_id:0});
  s.enemy_fleets=[{id:900,name:'灰烬突击群（模拟）',owner_id:9,hostile:true,type:'military',system_id:3,power:220,ship_count:3,hull_ratio:1,shield_ratio:1,in_combat:false,orders:[],visible:true,destroyed:false}];s.foreignPlanets=[{id:90,name:'灰烬据点',owner_id:9,system_id:3}];s.blocked_lanes=[];s.battlefieldVersion=1;
 }
 for(const f of s.fleets){f.type??='military';if(f.system_id===undefined)f.system_id=0;f.owner_id=0;f.hull_ratio??=1;f.shield_ratio??=1;f.ship_count??=f.power>0?Math.max(1,Math.round(f.power/100)):1;f.in_combat??=false;f.orders??=[];}
 for(const p of s.planets){p.owner_id??=0;p.system_id??=0;}
 s.capital_system_id=0;
}
export function mockPath(s:Json,fid:number,destination:number):Json {
 const f=s.fleets.find((f:any)=>f.id===fid);if(!f)throw new Error('舰队不存在');const queue:number[][]=[[f.system_id]],seen=new Set<number>();while(queue.length){const path=queue.shift()!,last=path.at(-1)!;if(last===destination)return {reachable:true,path,jumps:path.length-1,travel_days:(path.length-1)*15};if(seen.has(last))continue;seen.add(last);for(const n of s.systems.find((x:any)=>x.id===last)?.neighbors??[])if(!seen.has(n)&&!s.blocked_lanes.some((l:number[])=>l.includes(last)&&l.includes(n)))queue.push([...path,n]);}return {reachable:false,path:[],reason:'模拟路线被阻断或目标未知'};
}
export function battlefieldRead(s:Json,name:string,a:Json):Json|undefined{
 if(name==='get_galaxy_overview')return {capital_system_id:0,topology_version:1,systems:s.systems.map((x:any)=>({id:x.id,name:x.name,owner_id:x.owner})),source:'mock'};
 if(name==='get_galaxy_map'){const center=a.center_system_id??0,distance=new Map<number,number>([[center,0]]),queue=[center];while(queue.length){const current=queue.shift()!;if(distance.get(current)!>=(a.jumps??3))continue;for(const n of s.systems.find((x:any)=>x.id===current)?.neighbors??[])if(!distance.has(n)){distance.set(n,distance.get(current)!+1);queue.push(n);}}const systems=s.systems.filter((x:any)=>distance.has(x.id));return {systems:systems.map((x:any)=>[x.id,x.name,x.x,x.y,x.owner,'full',distance.get(x.id),x.starbase?'B':'']),hyperlanes:systems.flatMap((x:any)=>x.neighbors.filter((n:number)=>distance.has(n)&&x.id<n).map((n:number)=>[x.id,n])),source:'mock'};}
 if(name==='get_system'){const x=s.systems.find((x:any)=>x.id===a.system_id);if(!x)throw new Error('星系不存在');return {...x,owner_id:x.owner,owner_known:true,unowned:x.owner===null,intel:'full',fleets:[...s.fleets.filter((f:any)=>f.system_id===x.id),...s.enemy_fleets.filter((f:any)=>f.system_id===x.id&&f.visible)],planets:[...s.planets,...s.foreignPlanets].filter((p:any)=>p.system_id===x.id).map((p:any)=>({id:p.id,name:p.name,owner_id:p.owner_id})),source:'mock'};}
 if(name==='find_path')return mockPath(s,a.fleet_id,a.to_system_id);
}
export function battleScenario(s:Json,scenario:string){const enemy=s.enemy_fleets[0],own=s.fleets.find((f:any)=>f.id===0);
 switch(scenario){case 'enemy_border':Object.assign(enemy,{system_id:2,visible:true,destroyed:false,power:220});break;case 'enemy_reinforcements':Object.assign(enemy,{system_id:2,visible:true,destroyed:false,power:1200});break;case 'target_lost':enemy.visible=false;break;case 'route_blocked':s.blocked_lanes=[[0,1],[0,2],[2,3],[3,4],[1,4]];break;case 'route_restore':s.blocked_lanes=[];break;case 'combat_loss':Object.assign(own,{system_id:2,power:Math.max(30,own.power*.45),hull_ratio:.25,in_combat:true});Object.assign(enemy,{system_id:2,visible:true,destroyed:false,power:500});break;case 'victory':Object.assign(enemy,{destroyed:true,visible:true,power:0,in_combat:false});for(const f of s.fleets)f.in_combat=false;break;case 'reset_battlefield':Object.assign(enemy,{system_id:3,power:220,visible:true,destroyed:false,in_combat:false});s.blocked_lanes=[];for(const f of s.fleets){f.in_combat=false;f.hull_ratio=1;}break;default:throw new Error('未知模拟战场场景');}
}
export function cancelBattleOrders(s:Json,fid:number){const f=s.fleets.find((f:any)=>f.id===fid);if(!f)throw new Error('舰队不存在');f.orders=[];delete f.following;delete f.orbiting;for(const o of s.operationLog)if((o.args.fleet_id===fid||o.args.fleet_ids?.includes(fid))&&!o.completed&&!o.external)o.cancelled=true;}
export function advanceBattlefield(s:Json,days:number){
 for(const o of s.operationLog.filter((o:any)=>o.battle&&!o.completed&&!o.cancelled)){
  const a=o.args,fs=s.fleets.filter((f:any)=>f.id===a.fleet_id||a.fleet_ids?.includes(f.id));
  if(o.tool==='stellaris_follow_fleet'){
   const target=[...s.fleets,...s.enemy_fleets].find((f:any)=>f.id===a.target_fleet_id&&f.visible!==false);if(!target)continue;const f=fs[0];if(target.destroyed){o.completed=true;f.in_combat=false;f.orders=f.orders.filter((x:any)=>x.id!==o.id);continue;}
   if(f.system_id!==target.system_id){const route=mockPath(s,f.id,target.system_id);if(!route.reachable)continue;o.remaining_days-=days;if(o.remaining_days>0)continue;f.system_id=target.system_id;o.remaining_days=15;}
   if(a.attack){f.in_combat=true;target.in_combat=true;const own=s.fleets.filter((x:any)=>x.system_id===target.system_id&&x.type==='military').reduce((n:number,x:any)=>n+x.power,0);if(own>=target.power*1.2&&days>=15){target.destroyed=true;target.power=0;target.in_combat=false;f.in_combat=false;f.hull_ratio=Math.max(.1,f.hull_ratio-.1);o.completed=true;f.orders=f.orders.filter((x:any)=>x.id!==o.id);}else {f.power=Math.max(0,f.power*(1-Math.min(.4,days/300)));f.hull_ratio=Math.max(.05,f.hull_ratio-days/300);}}
  }else{
   if(o.tool==='stellaris_move_fleet'&&!mockPath(s,fs[0].id,a.system_id).reachable)continue;o.remaining_days-=days;if(o.remaining_days>0)continue;
   if(o.tool==='stellaris_move_fleet'){fs[0].system_id=a.system_id;fs[0].in_combat=false;}
   if(o.tool==='stellaris_fleet_mia')for(const f of fs){f.system_id=0;f.in_combat=false;f.mia=false;}
   if(o.tool==='stellaris_land_armies'){const planet=s.foreignPlanets.find((p:any)=>p.id===a.planet_id);if(planet)planet.owner_id=0;}
   if(o.tool==='stellaris_orbit_planet'){fs[0].orbiting=a.planet_id;continue;}
   o.completed=true;for(const f of fs)f.orders=f.orders.filter((x:any)=>x.id!==o.id);
  }
 }
 for(const f of s.fleets)if(!f.in_combat&&s.systems.some((x:any)=>x.id===f.system_id&&x.owner===0&&x.starbase))f.hull_ratio=Math.min(1,f.hull_ratio+days/150);
}
