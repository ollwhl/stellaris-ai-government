import {BattlefieldCollector} from './battlefield.js';
import { createHash } from 'node:crypto';
import { now, uid, type Context, type AdminService, type IntelService, type Snapshot, type Json, type Role } from '../../contracts/index.js';
import { unwrapMcp } from '../../integrations/knowledge_mcp/index.js';
import { createKnowledge } from '../knowledge/index.js';

function object(value:any):Json {return value&&typeof value==='object'&&!Array.isArray(value)?value:{};}
function array(value:any,keys:string[]):any[] {if(Array.isArray(value))return value;for(const key of keys)if(Array.isArray(value?.[key]))return value[key];return [];}
function dateNumber(value:string):number|null {const digits=value.match(/\d+/g);if(!digits||digits.length<3)return null;return Number(digits[0])*372+Number(digits[1])*31+Number(digits[2]);}
function signature(value:any) {return createHash('sha256').update(JSON.stringify(value)).digest('hex');}

export function createIntel(ctx:Context,admin:AdminService):IntelService {
  const knowledge=createKnowledge(ctx);const battlefieldCollector=new BattlefieldCollector(ctx);
  let latest=ctx.store.get<Snapshot>('state','latest');
  let refreshing:Promise<Snapshot>|undefined;let lastRefresh=0;let closed=false;
  let lastContent='';
  function snapshot() {return latest?structuredClone(latest):undefined;}
  async function collect():Promise<Snapshot> {
    const source=ctx.config.gameMode;
    const previous=latest?.source===source?latest:undefined;
    const missing:string[]=[];const raw:Json={};
    let names=new Set<string>();
    try {names=new Set((await admin.tools()).map(t=>t.name));}catch {missing.push('tools: 工具目录暂不可用');}
    async function read(tool:string,args:Json={}):Promise<any> {
      if(!names.has(tool)) {missing.push(`${tool}: 当前目录未提供`);return undefined;}
      try {
        const call=await admin.call(tool,args,{origin:'intel',traceId:uid('intel')});
        if(['error','denied','unknown'].includes(call.status))throw new Error(call.error||call.status);
        const data=unwrapMcp(call.result);raw[`${tool}:${JSON.stringify(args)}`]={tool,callId:call.id,collectedAt:call.at,source,data};return data;
      } catch(error) {missing.push(`${tool}: ${error instanceof Error?error.message:'读取失败'}`);return undefined;}
    }
    const [statusResult,researchResult,outlinerResult,fleetsResult,eventResult,notificationResult,alertResult]=await Promise.all([
      read('stellaris_get_status'),read('stellaris_get_research_state'),
      names.has('stellaris_get_outliner')?read('stellaris_get_outliner'):names.has('stellaris_get_planets')?read('stellaris_get_planets'):Promise.resolve(undefined),
      read('stellaris_get_fleets',{include_civilian:true}),read('stellaris_get_active_events'),read('stellaris_get_notifications'),read('stellaris_get_alerts')
    ]);
    const status=object(statusResult?.status||statusResult);
    const research=object(researchResult?.research||researchResult);
    let planets=array(outlinerResult,['planets','colonies']);
    if(!planets.length)planets=array(status,['planets','colonies']);
    // Only the first few details are proactively sampled; raw output remains available on demand.
    if(planets.length&&names.has('stellaris_get_planet_details')) {
      planets=await Promise.all(planets.slice(0,12).map(async p=>{
        const id=p.id??p.planet_id;
        if(id===undefined||id===null)return p;
        const detail=await read('stellaris_get_planet_details',{planet_id:id});
        return detail?{...p,...object(detail.planet||detail)}:p;
      }));
    }
    if(!outlinerResult)missing.push('planets: 缺少可用的星球索引读取');
    const fleets=fleetsResult?array(fleetsResult,['fleets','military_fleets']):array(outlinerResult,['fleets']);
    const resourceInput=object(status.resources);
    const resources:Snapshot['resources']={};
    for(const [key,value] of Object.entries(resourceInput)) {
      const row=object(value);const stockpile=typeof value==='number'?value:Number(row.stockpile??row.stored??row.amount);
      const net=Number(row.net??row.monthly_net??(Number.isFinite(Number(row.income))&&Number.isFinite(Number(row.expense))?Number(row.income)-Number(row.expense):NaN));
      if(Number.isFinite(stockpile)&&Number.isFinite(net))resources[key]={stockpile,net};
      else missing.push(`resources.${key}: 储量或净收入未知`);
    }
    if(!Object.keys(resourceInput).length)missing.push('resources: 当前读取未提供资源');
    const gameDate=String(status.date??status.game_date??status.gameDate??previous?.gameDate??'未知');
    const empire=status.empire_id??status.player_country_id??status.country_id;
    const observedSession=status.session_id??status.sessionId;
    const previousIdentity=ctx.store.get<Json>('state','identity')||{};
    const backwards=dateNumber(gameDate)!==null&&previous&&dateNumber(previous.gameDate)!==null&&dateNumber(gameDate)!<dateNumber(previous.gameDate)!;
    const identityChanged=Boolean(previous&&((observedSession!==undefined&&previousIdentity.session!==undefined&&String(observedSession)!==String(previousIdentity.session))||(empire!==undefined&&previousIdentity.empire!==undefined&&String(empire)!==String(previousIdentity.empire))||backwards));
    const explicitTimeline=status.timeline_id??status.timelineId;
    const timelineId=String(explicitTimeline??(identityChanged||!previous?uid('timeline'):previous.timelineId));
    const sessionId=String(observedSession??(identityChanged||!previous?uid('session'):previous.sessionId));
    const battlefield=await battlefieldCollector.collect({source,sessionId,timelineId,gameDate,status,fleets,ownFleetsFresh:fleetsResult!==undefined,planets},names,read);
    const next:Snapshot={battlefield,id:uid('snapshot'),version:(latest?.version||0)+1,timelineId,sessionId,at:now(),gameDate,source,
      global:{...status,attention:{events:eventResult===undefined?null:array(eventResult,['events','windows','event_windows','pending_events']),notifications:notificationResult===undefined?null:array(notificationResult,['notifications','queue']),alerts:alertResult===undefined?null:array(alertResult,['alerts','active_alerts'])},source,observedAt:now(),sampling:'工具按各自返回时间采样，非一致性快照',resourceDetails:resourceInput,identity:{empire:empire??null,session:observedSession??null},freshness:{status:statusResult?'fresh':'unavailable',research:researchResult?'fresh':'unavailable',planets:outlinerResult?'fresh':'unavailable',fleets:fleetsResult?'fresh':'unavailable'}},
      research:researchResult?research:{},planets,fleets,resources,raw,missing};
    if(closed) return next;
    const content=signature({timelineId,gameDate,source,status,research,planets,fleets,resources,missing});
    const previousSnapshot=latest;
    latest=next;lastRefresh=Date.now();
    ctx.store.transaction(()=>{
      ctx.store.set('state','latest',next);ctx.store.set('state','identity',{empire,session:observedSession});ctx.store.set('snapshots',next.id,next);
      // Retain every decision's own immutable snapshot separately; bound the polling history.
      const history=ctx.store.list<Snapshot>('snapshots').sort((a,b)=>b.version-a.version);
      for(const old of history.slice(160))ctx.store.delete('snapshots',old.id);
    });
    if(content!==lastContent) {
      lastContent=content;
      const changes:Json={snapshotId:next.id,version:next.version,source,at:next.at,timelineId,gameDate,missing};
      if(previousSnapshot) {
        changes.resources=Object.fromEntries(Object.entries(resources).filter(([key,v])=>JSON.stringify(v)!==JSON.stringify(previousSnapshot.resources[key])).map(([key,v])=>[key,{before:previousSnapshot.resources[key]??null,after:v}]));
        changes.researchChanged=signature(research)!==signature(previousSnapshot.research);
        changes.planetsChanged=signature(planets)!==signature(previousSnapshot.planets);
        changes.fleetsChanged=signature(fleets)!==signature(previousSnapshot.fleets);
      }
      ctx.store.set('state_changes',uid('change'),changes);
      ctx.bus.emit('state.changed',changes);
      if(previousSnapshot&&previousSnapshot.timelineId!==timelineId)ctx.bus.emit('state.timeline.changed',{previousTimelineId:previousSnapshot.timelineId,timelineId,reason:backwards?'game_date_rewound':identityChanged?'identity_changed':'timeline_changed'});
    }
    if(battlefield.changes.length)ctx.bus.emit('battlefield.changed',{battlefieldId:battlefield.id,version:battlefield.version,changes:battlefield.changes});
    return structuredClone(next);
  }
  function refresh():Promise<Snapshot> {
    if(closed)return Promise.reject(new Error('状态服务已关闭'));
    if(refreshing)return refreshing;
    if(latest&&latest.source===ctx.config.gameMode&&Date.now()-lastRefresh<500)return Promise.resolve(structuredClone(latest));
    refreshing=collect().finally(()=>{refreshing=undefined;});return refreshing;
  }
  function view(role?:Role):Json {
    const s=snapshot();if(!s)return {source:ctx.config.gameMode,available:false,missing:['尚未采集对局状态']};
    const strategy=ctx.store.list<any>('strategies').sort((a,b)=>String(b.at).localeCompare(String(a.at)))[0]??null;
    const globalReport={battlefield:s.battlefield,snapshotId:s.id,version:s.version,source:s.source,at:s.at,gameDate:s.gameDate,timelineId:s.timelineId,sessionId:s.sessionId,global:s.global,resources:s.resources,missing:s.missing,strategy,permissions:admin.permissions(),reservations:admin.reservations()};
    switch(role) {
      case 'economy':return {...globalReport,department:'economy',planets:s.planets,research:s.research};
      case 'military':return {...globalReport,department:'military',fleets:s.fleets};
      case 'development':return {...globalReport,department:'development',research:s.research,capacity:{planets:s.planets.length,fleets:s.fleets.length}};
      case 'administration':return {...globalReport,research:s.research,planets:s.planets,fleets:s.fleets};
      default:return {...globalReport,research:s.research,planets:s.planets.map(p=>({id:p.id??p.planet_id,name:p.name,queue:p.queue??null})),fleets:s.fleets.map(f=>({id:f.id??f.fleet_id,name:f.name,power:f.power??null,deficit:f.deficit??null}))};
    }
  }
  return {refresh,snapshot,view,searchKnowledge:knowledge.search,importKnowledge:knowledge.importPages,importStatus:knowledge.status,async shutdown(){closed=true;await knowledge.shutdown();}};
}
