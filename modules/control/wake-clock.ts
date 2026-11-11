import type {Context,Role,Snapshot,Strategy,WakeSchedule} from '../../contracts/index.js';
import {defaultWakeSchedules} from '../../contracts/index.js';

type Clock={policy:string;identity:string|null;realAt:number;gameAt:number|null;lastGameSeen:number|null;held:boolean;lastWakeAt?:string};
export function gameDay(date:string|undefined):number|null {
 const m=date?.trim().match(/^(\d{1,6})[.\/-](\d{1,2})[.\/-](\d{1,2})$/);if(!m)return null;
 const [,y,month,day]=m.map(Number);if(month<1||month>12||day<1||day>30)return null;
 return y*360+(month-1)*30+day-1;
}
export class WakeClock {
 constructor(private ctx:Pick<Context,'store'|'config'>){}
 policy(role:Role):WakeSchedule{return {...defaultWakeSchedules()[role],...this.ctx.config.wakeSchedules?.[role]};}
 private identity(s?:Snapshot){return s?`${s.source}:${s.sessionId}:${s.timelineId}`:null;}
 private sync(role:Role,snapshot?:Snapshot,hold=false):Clock {
  const policy=JSON.stringify(this.policy(role)),identity=this.identity(snapshot),now=Date.now(),day=gameDay(snapshot?.gameDate);
  const old=this.ctx.store.get<Clock>('wake_clocks',role);
  const reset=!old||old.policy!==policy||old.identity!==identity||(!hold&&old.held)||(day!==null&&old.lastGameSeen!==null&&day<old.lastGameSeen)||(day!==null&&old.gameAt===null);
  const next:Clock=reset?{policy,identity,realAt:now,gameAt:day,lastGameSeen:day,held:hold,lastWakeAt:old?.lastWakeAt}:{...old,lastGameSeen:day??old.lastGameSeen,held:hold};
  if(JSON.stringify(old)!==JSON.stringify(next))this.ctx.store.set('wake_clocks',role,next);
  return next;
 }
 reset(role:Role,snapshot?:Snapshot){const old=this.ctx.store.get<Clock>('wake_clocks',role),p=this.ctx.store.get<any>('control','permissions'),day=gameDay(snapshot?.gameDate);this.ctx.store.set('wake_clocks',role,{policy:JSON.stringify(this.policy(role)),identity:this.identity(snapshot),realAt:Date.now(),gameAt:day,lastGameSeen:day,held:p?.aiEnabled===false||!!p?.pausedDepartments?.includes(role),lastWakeAt:old?.lastWakeAt});}
 hold(role:Role,snapshot?:Snapshot){this.sync(role,snapshot,true);}
 due(role:Role,snapshot?:Snapshot):boolean {
  const permissions=this.ctx.store.get<any>('control','permissions');
  if(permissions?.aiEnabled===false||permissions?.pausedDepartments?.includes(role)){this.hold(role,snapshot);return false;}
  const clock=this.sync(role,snapshot),p=this.policy(role),day=gameDay(snapshot?.gameDate);
  return p.mode==='real'?Date.now()-clock.realAt>=p.interval*1000:day!==null&&clock.gameAt!==null&&day-clock.gameAt>=p.interval;
 }
 reserve(role:Role,snapshot?:Snapshot){const c=this.sync(role,snapshot);this.ctx.store.set('wake_clocks',role,{...c,realAt:Date.now(),gameAt:gameDay(snapshot?.gameDate)});}
 mark(role:Role,snapshot?:Snapshot){const c=this.sync(role,snapshot);this.ctx.store.set('wake_clocks',role,{...c,realAt:Date.now(),gameAt:gameDay(snapshot?.gameDate),lastWakeAt:new Date().toISOString()});}
 status(snapshot?:Snapshot):Record<Role,any>{
  return Object.fromEntries((Object.keys(defaultWakeSchedules()) as Role[]).map(role=>{
   const policy=this.policy(role),clock=this.ctx.store.get<Clock>('wake_clocks',role),permissions=this.ctx.store.get<any>('control','permissions');
   const held=permissions?.aiEnabled===false||!!permissions?.pausedDepartments?.includes(role);
   const matching=!!clock&&!clock.held&&clock.policy===JSON.stringify(policy)&&clock.identity===this.identity(snapshot);
   const day=gameDay(snapshot?.gameDate),elapsed=matching?(policy.mode==='real'?(Date.now()-clock.realAt)/1000:day!==null&&clock.gameAt!==null?day-clock.gameAt:0):0;
   return [role,{...policy,held,lastWakeAt:clock?.lastWakeAt??null,waitingForGameDate:policy.mode==='game'&&day===null,remaining:Math.max(0,policy.interval-elapsed)}];
  })) as Record<Role,any>;
 }
}
export function strategyExpired(strategy:Strategy,snapshot?:Snapshot):boolean {
 if(strategy.validity?.mode==='game'){
  const v=strategy.validity,day=gameDay(snapshot?.gameDate);
  return !snapshot||snapshot.sessionId!==v.sessionId||snapshot.timelineId!==v.timelineId||day===null||v.untilGameDay===null||day>=v.untilGameDay;
 }
 return Date.parse(strategy.validUntil)<Date.now();
}
