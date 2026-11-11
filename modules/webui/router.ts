import { Router, type RequestHandler } from 'express';
import {fleetScopeSchema} from '../control/fleet-policy.js';
import {WakeClock} from '../control/wake-clock.js';
import { z } from 'zod';
import type { Services } from '../../contracts/index.js';

const permissionsSchema = z.object({
  aiEnabled:z.boolean().optional(),
  domains:z.record(z.boolean()).optional(),
  mode:z.enum(['advice','partial','global']).optional(), stopped:z.boolean().optional(),
  offensiveMilitary:z.boolean().optional(),emergencyRetreat:z.boolean().optional(),research:z.boolean().optional(), construction:z.boolean().optional(), military:z.boolean().optional(),
  pause:z.boolean().optional(), resume:z.boolean().optional(), speed:z.boolean().optional(), debugWrite:z.boolean().optional(),
  budgets:z.record(z.number().finite().nonnegative()).optional(), controlledObjects:z.array(z.string()).optional(),
  oneTimeProjectIds:z.array(z.string().min(1)).optional(), pausedDepartments:z.array(z.enum(['president','economy','military','development','administration'])).optional(),
}).strict();
export function createWebRouter(s:Services) {
  const r=Router();
  const route=(fn:(req:any,res:any)=>Promise<any>|any):RequestHandler=>(req,res,next)=>{Promise.resolve().then(()=>fn(req,res)).catch(error=>{
    if(res.headersSent) return next(error);
    res.status(error instanceof z.ZodError?400:400).json({error:error instanceof Error?error.message:String(error)});
  });};
  const wakeClock=new WakeClock(s.context);
  const bootstrap=()=>({fleetMissions:s.admin.fleetMissions?.()??[],fleetCommands:(s.admin.fleetCommands?.()??[]).slice(-200),fleetDecisions:s.context.store.list('fleet_decisions',{limit:40,reverse:true}).map((d:any)=>({id:d.id,missionId:d.missionId,at:d.at,output:d.output})),battleEvents:s.context.store.list('battle_events',{limit:80,reverse:true}),incidents:s.admin.incidents?.()??[],incidentReports:s.context.store.list('incident_reports',{limit:100,reverse:true}),incidentAssessments:s.context.store.list('incident_assessments',{limit:100,reverse:true}),wakeStatus:wakeClock.status(s.intel.snapshot()),config:s.publicConfig(),permissions:s.admin.permissions(),snapshot:s.intel.snapshot()??null,
    govStatus:s.gov.status(),messages:s.gov.messages(),decisions:s.gov.decisions(),projects:s.gov.projects(),strategies:s.gov.strategies(),
    tasks:s.admin.tasks(),calls:s.admin.calls({limit:200}),reservations:s.admin.reservations(),importStatus:s.intel.importStatus(),
    modelRuns:s.context.store.list('modelRuns').slice(-100)});
  r.post('/military/missions',route(async(req,res)=>{const p=z.object({title:z.string().trim().min(1).max(180).optional(),scope:fleetScopeSchema}).strict().parse(req.body);if(!s.gov.createFleetMission)throw new Error('舰队任务服务不可用');const project=await s.gov.createFleetMission(p.scope,p.title);await s.admin.militaryTick?.();res.status(201).json(project);}));
  r.patch('/military/missions/:id',route((req,res)=>{const {action}=z.object({action:z.enum(['pause','resume','cancel'])}).strict().parse(req.body);res.json(s.admin.controlFleetMission?.(req.params.id,action));}));
  r.get('/military/evidence',route((req,res)=>{const id=z.string().min(1).parse(req.query.missionId);res.json({mission:s.admin.fleetMissions?.().find(m=>m.id===id),commands:s.admin.fleetCommands?.().filter(c=>c.missionId===id),decisions:s.context.store.list<any>('fleet_decisions').filter(d=>d.missionId===id)});}));
  r.get('/bootstrap',route((_q,res)=>res.json(bootstrap())));
  r.post('/chat',route(async(req,res)=>{const {text}=z.object({text:z.string().trim().min(1).max(12000)}).parse(req.body);res.status(202).json(await s.gov.submitGoal(text));}));
  r.patch('/permissions',route((req,res)=>res.json(s.admin.updatePermissions(permissionsSchema.parse(req.body)))));
  r.get('/events',route((req,res)=>{
    res.setHeader('Content-Type','text/event-stream');res.setHeader('Cache-Control','no-cache');res.setHeader('Connection','keep-alive');res.flushHeaders();
    const cursor=Number(req.headers['last-event-id']??req.query.since??0);
    const send=(event:any)=>res.write(`id: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`);
    if(req.headers['last-event-id']!==undefined||req.query.since!==undefined)for(const event of s.context.bus.since(Number.isFinite(cursor)?cursor:0))send(event);
    const unsubscribe=s.context.bus.subscribe(send);const heartbeat=setInterval(()=>res.write(': keepalive\n\n'),20000);
    req.on('close',()=>{unsubscribe();clearInterval(heartbeat);});
  }));
  r.get('/tools',route(async(_req,res)=>res.json(await s.admin.tools())));
  r.post('/tools/call',route(async(req,res)=>{
    const p=z.object({name:z.string().min(1),args:z.record(z.unknown()).default({}),debugAuthorized:z.boolean().default(false),permissionRevision:z.number().int().optional()}).parse(req.body);
    res.json(await s.admin.call(p.name,p.args,{origin:'debug',debugAuthorized:p.debugAuthorized,permissionRevision:p.permissionRevision}));
  }));
  r.get('/calls',route((req,res)=>res.json(s.admin.calls(typeof req.query.traceId==='string'?{traceId:req.query.traceId}:{limit:200}))));
  r.patch('/calls/:id/annotation',route((req,res)=>{const p=z.object({verdict:z.enum(['matched','mismatched','uncertain','unchecked']),note:z.string().max(12000).default('')}).parse(req.body);s.admin.annotate(req.params.id,p.verdict,p.note);res.json({ok:true});}));
  r.get('/export',route((req,res)=>{
    const trace=typeof req.query.traceId==='string'?req.query.traceId:undefined;
    const take=(v:any[])=>trace?v.filter(x=>x.traceId===trace):v;
    const data={fleetMissions:take(s.admin.fleetMissions?.()??[]),fleetCommands:take(s.admin.fleetCommands?.()??[]),fleetDecisions:take(s.context.store.list('fleet_decisions')),battleEvents:s.context.store.list('battle_events'),exportedAt:new Date().toISOString(),environment:s.context.config.gameMode,permissions:s.admin.permissions(),snapshot:s.intel.snapshot(),decisions:take(s.gov.decisions()),projects:take(s.gov.projects()),tasks:take(s.admin.tasks()),calls:take(s.admin.calls()),messages:take(s.gov.messages()),incidents:take(s.admin.incidents?.()??[]),incidentReports:take(s.context.store.list('incident_reports')),incidentAssessments:take(s.context.store.list('incident_assessments'))};
    res.setHeader('Content-Disposition',`attachment; filename="stellaris-trace-${new Date().toISOString().slice(0,10)}.json"`);res.json(data);
  }));
  r.post('/state/refresh',route(async(_req,res)=>res.json(await s.intel.refresh())));
  r.post('/mock/advance',route(async(req,res)=>{const {days}=z.object({days:z.number().int().min(1).max(3650)}).parse(req.body);await s.admin.advanceMock(days);res.json(await s.intel.refresh());}));
  r.post('/mock/control',route(async(req,res)=>{if(s.context.config.gameMode!=='mock')throw new Error('仅 mock 环境可使用场景控制');res.json(await s.admin.mockControl(z.record(z.unknown()).parse(req.body)));}));
  r.post('/government/replan',route(async(req,res)=>{const p=z.object({trigger:z.string().max(1000).optional()}).parse(req.body??{});void s.gov.replan(p.trigger).catch(error=>s.context.bus.emit('government.error',{message:String(error)}));res.status(202).json({ok:true});}));
  r.get('/config',route((_req,res)=>res.json(s.publicConfig())));
  r.patch('/config',route(async(req,res)=>res.json(await s.updateConfig(z.record(z.unknown()).parse(req.body)))));
  r.get('/knowledge/search',route(async(req,res)=>res.json(await s.intel.searchKnowledge(z.string().trim().min(1).max(1000).parse(req.query.q)))));
  r.post('/knowledge/import',route(async(req,res)=>{const {titles}=z.object({titles:z.array(z.string().trim().min(1).max(200)).max(200).optional()}).parse(req.body??{});res.status(202).json(await s.intel.importKnowledge(titles));}));
  return r;
}
