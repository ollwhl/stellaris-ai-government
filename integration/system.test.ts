import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startApp} from '../app/server.ts';
import {SqliteStore,EventBus} from '../app/store.ts';
import {loadConfig,publicConfig,patchConfig} from '../app/config.ts';
import {createModels} from '../app/models.ts';
import {now,uid,type Project,type Task} from '../contracts/index.ts';
const wait=async(check:()=>boolean,ms=10000)=>{const end=Date.now()+ms;while(!check()){if(Date.now()>end)throw new Error('等待条件超时');await new Promise(r=>setTimeout(r,20));}};
const project=(kind:Project['kind'],scope:any={},budget:any={}):Project=>({id:uid('project'),revision:1,strategyId:'fixture',strategyRevision:1,traceId:uid('trace'),department:kind==='research'?'development':kind==='defense'?'military':'economy',title:'测试项目',goal:kind==='research'?'科研':kind==='defense'?'防御':'科研建设',kind,scope,budget,priority:80,dependencies:[],completion:'观察实际完成',termination:'撤销',status:'ready',at:now()});
async function fixture(dbPath=':memory:'){return startApp({port:0,host:'127.0.0.1',dbPath,serveUi:false,autoTick:false});}

test('SQLite事务回滚和事件持久化顺序',()=>{const store=new SqliteStore(':memory:');const bus=new EventBus(store);assert.throws(()=>store.transaction(()=>{store.set('test','value',{x:1});throw new Error('rollback');}));assert.equal(store.get('test','value'),undefined);bus.emit('one',{x:1});const next=new EventBus(store);next.emit('two',{x:2});assert.deepEqual(next.since(0).map(e=>e.seq),[1,2]);store.close();});

test('OpenAI兼容URL、密钥、模型参数、工具协议和行政并发',async()=>{
 const seen:any[]=[];let presidentStarted=false;
 const http=createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);seen.push({url:req.url,auth:req.headers.authorization,body});if(body.model==='planner'){presidentStarted=true;await new Promise(r=>setTimeout(r,180));}res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:body.tools?{content:null,tool_calls:[{id:'call_a',type:'function',function:{name:'read_status',arguments:'{}'}}]}:{content:JSON.stringify({ok:true})}}],usage:{prompt_tokens:4,completion_tokens:3}}));});
 await new Promise<void>(r=>http.listen(0,'127.0.0.1',r));const port=(http.address() as any).port;
 const store=new SqliteStore(':memory:');const config=loadConfig(store);config.models[0]={...config.models[0],baseUrl:`http://127.0.0.1:${port}/v1`,apiKey:'private-test-token',mock:false,model:'planner',concurrency:1};config.models.push({...config.models[0],id:'admin',model:'executor'});config.roleModels.administration='admin';const models=createModels({store,bus:new EventBus(store),config});
 try{
  const slow=models.json('president','Return JSON',{},()=>({ok:false}));await wait(()=>presidentStarted);let slowDone=false;void slow.then(()=>{slowDone=true;});
  const fast=await models.json('administration','Return JSON',{},()=>({ok:false}));assert.deepEqual(fast,{ok:true});assert.equal(slowDone,false);await slow;
  const tool=await models.complete('administration',[{role:'user',content:'status'}],[{type:'function',function:{name:'read_status',parameters:{type:'object',properties:{}}}}]);assert.equal(tool.toolCalls[0].function.name,'read_status');assert.equal(seen[0].url,'/v1/chat/completions');assert.equal(seen[0].auth,'Bearer private-test-token');
  assert(!JSON.stringify(publicConfig(config)).includes('private-test-token'));patchConfig(config,{models:publicConfig(config).models},store);assert.equal(config.models[0].apiKey,'private-test-token');
  config.models[0].baseUrl=`http://127.0.0.1:${port}/v1/chat/completions`;await models.json('president','JSON',{},()=>({}));assert.equal(seen.at(-1).url,'/v1/chat/completions');
  assert(!JSON.stringify(store.list('modelRuns')).includes('private-test-token'));
 }finally{store.close();await new Promise<void>(r=>http.close(()=>r()));}
});

test('玩家目标→政府会议/报告→行政下令，快照不变且等待不重复',async()=>{
 const app=await fixture();const {gov,admin,intel,context}=app.services;
 try{
  assert.equal((await admin.tools()).length,123);const response=await fetch(`http://127.0.0.1:${app.port}/api/chat`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:'优先科研，维持经济底线，保留边境防御能力'})});assert.equal(response.status,202);
  await wait(()=>gov.decisions().some(d=>d.status==='completed'));
  let d=gov.decisions().find(d=>d.status==='completed')!;assert.equal(d.participants.length,4);assert.equal(d.reports.length,5);assert(d.messages.some(m=>m.kind==='ruling'));for(const role of d.participants)assert(d.roleViews[role]?.calls?.[0]?.input?.globalReport);assert.equal(admin.calls().filter(c=>c.origin==='agent').length,0);
  const snapshotBefore=JSON.stringify(d.snapshot);const id=d.id;
  admin.updatePermissions({mode:'partial',research:true,construction:true,military:true,budgets:{minerals:1000,alloys:400,energy:1000}});await gov.replan('权限变化');await wait(()=>gov.decisions().some(x=>x.status==='completed'&&x.id!==id));
  await admin.tick();const writes=admin.calls().filter(c=>c.origin==='agent'&&c.status==='observed');assert(writes.some(c=>c.tool==='stellaris_select_research'));assert(writes.some(c=>c.tool==='stellaris_build_building'));assert(admin.tasks().some(t=>t.status==='waiting'));
  const count=admin.calls().filter(c=>c.origin==='agent').length;await admin.tick();assert.equal(admin.calls().filter(c=>c.origin==='agent').length,count);
  await admin.advanceMock(130);await new Promise(r=>setTimeout(r,520));await intel.refresh();await admin.tick();assert(admin.tasks().some(t=>t.status==='completed'));assert.equal(JSON.stringify(context.store.get<any>('decisions',id).snapshot),snapshotBefore);
  const exported=await fetch(`http://127.0.0.1:${app.port}/api/export?traceId=${d.traceId}`);assert.equal(exported.status,200);const out:any=await exported.json();assert(out.decisions.length>0);assert(!JSON.stringify(out).includes('apiKey'));
 }finally{await app.close();}
});

test('撤权/人工接管/参数校验/调试授权不能绕过',async()=>{
 const app=await fixture();const {admin,context}=app.services;try{
  const p=project('research',{area:'physics'});context.store.set('projects',p.id,p);let perm=admin.updatePermissions({mode:'partial',research:true});const revision=perm.revision;admin.updatePermissions({research:false});
  let call=await admin.call('stellaris_select_research',{area:'physics',tech_key:'tech_physics_1'},{origin:'agent',projectId:p.id,permissionRevision:revision});assert.equal(call.status,'denied');
  perm=admin.updatePermissions({research:true,controlledObjects:['research:physics']});call=await admin.call('stellaris_select_research',{area:'physics',tech_key:'tech_physics_1'},{origin:'agent',projectId:p.id,permissionRevision:perm.revision});assert.equal(call.status,'denied');
  call=await admin.call('stellaris_select_research',{slot:'physics',tech_key:'tech_physics_1'},{origin:'debug'});assert.equal(call.status,'error');
  call=await admin.call('stellaris_set_speed',{speed:4},{origin:'debug',debugAuthorized:true});assert.equal(call.status,'denied');admin.updatePermissions({debugWrite:true});call=await admin.call('stellaris_set_speed',{speed:4},{origin:'debug',debugAuthorized:false});assert.equal(call.status,'denied');call=await admin.call('stellaris_set_speed',{speed:4},{origin:'debug',debugAuthorized:true});assert.equal(call.status,'accepted');
  admin.updatePermissions({stopped:true,controlledObjects:[]});call=await admin.call('stellaris_select_research',{area:'physics',tech_key:'tech_physics_1'},{origin:'agent',projectId:p.id});assert.equal(call.status,'denied');
  const crossOrigin=await fetch(`http://127.0.0.1:${app.port}/api/permissions`,{method:'PATCH',headers:{'Content-Type':'application/json',Origin:'https://unrelated.example'},body:'{"research":true}'});assert.equal(crossOrigin.status,403);
 }finally{await app.close();}
});

test('未知写结果重启后观察恢复，无重复订单和资源支出',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'stellaris-recovery-'));const path=join(dir,'test.sqlite');let app=await fixture(path);
 try{
  let {admin,context}=app.services;const p=project('construction',{buildingPreference:'research',planetIds:[0]}, {minerals:800});context.store.set('projects',p.id,p);const perms=admin.updatePermissions({mode:'partial',construction:true,budgets:{minerals:1000}});
  const task:Task&any={id:uid('task'),projectId:p.id,projectRevision:1,traceId:p.traceId,status:'running',step:'准备提交',callIds:[],retries:0,at:now(),timelineId:'mock-timeline-1',expected:{tool:'stellaris_build_building',args:{planet_id:0,building_key:'building_research_lab_1'},baselineOrderIds:[],baselineBuilt:0}};context.store.set('tasks',task.id,task);await admin.mockControl({unknownNext:true});
  const call=await admin.call('stellaris_build_building',task.expected.args,{origin:'agent',projectId:p.id,taskId:task.id,permissionRevision:perms.revision});assert.equal(call.status,'unknown');assert(admin.reservations().some(r=>r.status==='unknown'));await app.close();
  app=await fixture(path);({admin,context}=app.services);await admin.tick();const recovered=admin.tasks().find(t=>t.id===task.id)!;assert.equal(recovered.status,'waiting');assert.equal(admin.calls().filter(c=>c.tool==='stellaris_build_building').length,1);assert.equal(context.store.get<any>('mock','state').resources.minerals.stockpile,1400);assert.equal(admin.reservations()[0].status,'spent');
 }finally{await app.close();await rm(dir,{recursive:true,force:true});}
});

test('共享资源原子预留，军事路径和不同目标方案',async()=>{
 const app=await fixture();const {admin,gov,context}=app.services;try{
  admin.updatePermissions({mode:'partial',construction:true,military:true,research:true,budgets:{minerals:1000,alloys:400,energy:1000}});await admin.mockControl({resources:{minerals:500}});
  const a=project('construction',{planetIds:[0]}, {minerals:800}),b=project('construction',{planetIds:[0]}, {minerals:800});context.store.set('projects',a.id,a);context.store.set('projects',b.id,b);
  const results=await Promise.all([a,b].map(p=>admin.call('stellaris_build_building',{planet_id:0,building_key:'building_research_lab_1'},{origin:'agent',projectId:p.id})));assert.equal(results.filter(r=>r.status==='accepted').length,1);assert.equal(context.store.get<any>('mock','state').resources.minerals.stockpile,100);
  // New independent goal must produce military priorities and capability preferences.
  await gov.submitGoal('优先增强舰队边境防御');await wait(()=>gov.decisions().some(d=>d.status==='completed'));const strategy=gov.strategies()[0];assert.equal(strategy.priorities[0],'边境防御');await admin.tick();assert(admin.calls().some(c=>c.tool==='stellaris_reinforce_fleet'&&['accepted','observed'].includes(c.status)));
 }finally{await app.close();}
});

test('慢战略期间行政推进，撤权使在途规划失效',async()=>{
 const app=await fixture();const {admin,gov,context}=app.services;try{
  admin.updatePermissions({mode:'partial',research:true});const p=project('research',{area:'physics',preferences:['research']});context.store.set('projects',p.id,p);context.config.planningDelayMs=80;
  await gov.submitGoal('重新评估科研方向');await wait(()=>gov.status().planning);await admin.tick();assert(gov.status().planning);assert(admin.calls().some(c=>c.tool==='stellaris_select_research'&&c.origin==='agent'));
  admin.updatePermissions({research:false,stopped:true});await wait(()=>gov.decisions().some(d=>d.status==='stale'));assert(gov.decisions().some(d=>/权限|候选/.test(d.error??'')));
 }finally{await app.close();}
});

test('仅建议模式的一次性项目批准不扩大领域权限',async()=>{
 const app=await fixture();const {admin,gov}=app.services;try{
  await gov.submitGoal('优先科研');await wait(()=>gov.decisions().some(d=>d.status==='completed'));const p=gov.projects().find(p=>p.kind==='research')!;const before=gov.decisions().length;
  admin.updatePermissions({oneTimeProjectIds:[p.id]});await gov.tick();await admin.tick();assert.equal(admin.permissions().mode,'advice');assert.equal(admin.permissions().research,false);assert(admin.calls().some(c=>c.origin==='agent'&&c.projectId===p.id&&c.status==='observed'));assert.equal(gov.decisions().length,before);assert(!admin.calls().some(c=>c.origin==='agent'&&c.projectId!==p.id));
  await admin.advanceMock(130);await admin.tick();assert(!admin.permissions().oneTimeProjectIds?.includes(p.id));
 }finally{await app.close();}
});

test('知识导入保存版本来源，拒绝HTML，失败与中断状态可恢复',async()=>{
 const {createRequire}=await import('node:module');const require=createRequire(import.meta.url);const live=require('../vendor/mcp-stellaris/lib/live.js');const original=live.fetchRaw;const {createKnowledge}=await import('../modules/knowledge/index.ts');
 const dir=await mkdtemp(join(tmpdir(),'stellaris-knowledge-'));const store=new SqliteStore(':memory:');const config=loadConfig(store);config.gameMode='real';config.knowledgeMcp={...config.knowledgeMcp,command:'',env:{STELLARIS_KB_DIR:dir}};const base={store,bus:new EventBus(store),config};const context={...base,models:createModels(base)};
 live.fetchRaw=async(title:string)=>({ok:true,title,raw:title==='BadPage'?'<html><title>Client Challenge</title><body>denied</body></html>':'{{Version|4.5}}\n== Research mechanics ==\nResearch technologies provide deterministic research capacity and resource efficiency.\n'});
 const knowledge=createKnowledge(context);
 try{
  await knowledge.importPages(['Technology','BadPage']);await wait(()=>!knowledge.status().running,5000);const status=knowledge.status();assert.equal(status.success,1);assert.equal(status.failed,1);const results=await knowledge.search('research technologies');assert(results.some(r=>r.source==='wiki'&&r.applicableVersion==='4.5'));assert(!results.some(r=>r.title==='BadPage'));assert.match(store.get<any>('knowledge_meta','Technology').hash,/^[a-f0-9]{64}$/);
  store.set('knowledge_import','Interrupted',{title:'Interrupted',status:'running',attempts:1,at:now()});const resumed=createKnowledge(context);assert.equal(resumed.status().items.find((i:any)=>i.title==='Interrupted')?.status,'pending');await resumed.shutdown();
 }finally{live.fetchRaw=original;await knowledge.shutdown();store.close();await rm(dir,{recursive:true,force:true});}
});

test('局部战略重评承接已入队建设，完成后不重复支出',async()=>{
 const app=await fixture();const {gov,admin,context}=app.services;try{
  admin.updatePermissions({mode:'partial',research:true,construction:true});await gov.submitGoal('优先科研，维持经济底线');await wait(()=>gov.decisions().some(d=>d.status==='completed'));await admin.tick();const original=gov.projects().find(p=>p.kind==='construction')!;assert(admin.tasks().some(t=>t.projectId===original.id&&t.status==='waiting'));
  const before=gov.decisions().filter(d=>d.status==='completed').length;await gov.replan('军事威胁变化');await wait(()=>gov.decisions().filter(d=>d.status==='completed').length>before);const rebased=gov.projects().find(p=>p.id===original.id)!;assert.equal(rebased.revision,original.revision+1);assert.deepEqual(rebased.scope,original.scope);assert.equal(rebased.strategyRevision,gov.strategies()[0].revision);
  await admin.tick();assert.equal(admin.tasks().find(t=>t.projectId===original.id&&t.status==='waiting')?.projectRevision,rebased.revision);await admin.advanceMock(130);await admin.tick();assert.equal(admin.calls().filter(c=>c.tool==='stellaris_build_building'&&c.origin==='agent').length,1);assert(context.store.list<any>('feedback').some(f=>f.projectId===original.id&&f.projectRevision===rebased.revision&&f.status==='completed'));
 }finally{await app.close();}
});
