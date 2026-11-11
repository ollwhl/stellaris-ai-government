import type { AdminService, ChatMessage, Context, Decision, DecisionReport, ExecutionFeedback, GovService, IntelService, Json, Permissions, Project, Role, Snapshot, Strategy } from '../../contracts/index.ts';
import { now, roleNames, uid } from '../../contracts/index.ts';
import { mockReport, type MockInput } from './plans/mock.ts';
import { outputGuide, validateRoleReport, type RoleReport, type Proposal } from './plans/validation.ts';

interface GoalState { text:string; revision:number; traceId:string; at:string; }
interface RunState { role:Role; status:'idle'|'running'|'failed'; decisionId?:string; at?:string; error?:string; }
const roles:Role[]=['president','economy','military','development'];
const copy=<T>(value:T):T=>structuredClone(value);
const activeProject=(p:Project)=>!['completed','cancelled'].includes(p.status);
const sorted=<T extends {at:string;revision?:number}>(items:T[])=>items.sort((a,b)=>b.at.localeCompare(a.at)||(b.revision??0)-(a.revision??0));
const errorText=(e:unknown)=>e instanceof Error?e.message:String(e);

function permissionPolicyFingerprint(permissions:Permissions):string {
  const {revision:_revision,oneTimeProjectIds:_oneTimeProjectIds,...policy}=permissions;
  const canonical=(value:any):any=>Array.isArray(value)?value.map(canonical).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
  return JSON.stringify(canonical(policy));
}

function researchIdentity(snapshot:Snapshot):string {
  const walk=(value:any,key=''):any=>{
    if(value===null||typeof value!=='object')return /progress|remaining|days|cost|percent|points|speed/i.test(key)?undefined:value;
    if(Array.isArray(value))return value.map(v=>walk(v));
    const result:Json={};
    for(const [k,v]of Object.entries(value))if(!/progress|remaining|days|cost|percent|points|speed/i.test(k))result[k]=walk(v,k);
    return result;
  };
  return JSON.stringify(walk(snapshot.research));
}

export function createGovernment(ctx:Context,admin:AdminService,intel:IntelService):GovService {
  let planning=false;
  let queued:string[]=[];
  let scheduled=false;
  let scheduledTimer:ReturnType<typeof setTimeout>|undefined;
  let shuttingDown=false;
  let activeRun:Promise<void>|undefined;
  let shutdownPromise:Promise<void>|undefined;
  let lastError:string|undefined;
  let lastDecisionId:string|undefined;
  const runState=new Map<Role,RunState>(roles.map(role=>[role,{role,status:'idle'}]));
  const getGoal=()=>ctx.store.get<GoalState>('government_meta','goal');
  const permissionPolicyChanged=()=>{
    const current=permissionPolicyFingerprint(admin.permissions());
    const previous=ctx.store.get<string>('government_meta','permissionPolicyFingerprint');
    ctx.store.set('government_meta','permissionPolicyFingerprint',current);
    return previous!==undefined&&previous!==current;
  };
  if(ctx.store.get<string>('government_meta','permissionPolicyFingerprint')===undefined)permissionPolicyChanged();
  const decisions=()=>sorted(ctx.store.list<Decision>('decisions'));
  const projects=()=>sorted(ctx.store.list<Project>('projects'));
  const strategies=()=>sorted(ctx.store.list<Strategy>('strategies'));
  const messages=()=>ctx.store.list<ChatMessage>('chat').sort((a,b)=>a.at.localeCompare(b.at));
  const persistDecision=(d:Decision)=>{ctx.store.set('decisions',d.id,copy(d));ctx.bus.emit('government.decision.updated',{decisionId:d.id,status:d.status},d.traceId);};
  const addMessage=(role:ChatMessage['role'],text:string,traceId?:string,decisionId?:string):ChatMessage=>{
    const message:ChatMessage={id:uid('message'),role,text,at:now(),traceId,decisionId};
    ctx.store.set('chat',message.id,message);ctx.bus.emit('chat.message',message,traceId);return message;
  };
  const status=():Json=>({planning,shuttingDown,queued:[...queued],lastError,lastDecisionId,goal:getGoal(),roles:Array.from(runState.values()),pausedDepartments:admin.permissions().pausedDepartments});
  const emitStatus=()=>ctx.bus.emit('government.status',status(),getGoal()?.traceId);

  // Persisted meetings interrupted by process exit are evidence, not valid plans.
  let recoveredPending=false;
  for(const d of decisions().filter(d=>d.status==='running')){
    d.status='stale';d.completedAt=now();d.error='应用重启，未完成决策需要重新评估';ctx.store.set('decisions',d.id,d);recoveredPending=true;
  }

  const checkValidity=(goal:GoalState,decision:Decision):string|undefined=>{
    if(shuttingDown)return '应用正在退出，本轮未发布结果已失效';
    const current=getGoal();
    if(!current||current.revision!==goal.revision)return '玩家已提交新的目标，本轮结果不再发布';
    const permissions=admin.permissions();
    if(permissions.revision!==decision.inputPermissionRevision)return '权限在规划期间变化，需要基于新权限重新评估';
    const latest=intel.snapshot();
    if(latest&&(latest.timelineId!==decision.snapshot.timelineId||latest.sessionId!==decision.snapshot.sessionId))return '对局会话或时间线已变化';
    if(latest&&latest.source!==decision.snapshot.source)return 'mock 与实际 MCP 环境发生切换';
    if(latest&&researchIdentity(latest)!==researchIdentity(decision.snapshot))return '研究候选或在研项目在规划期间变化，需要重新评估';
    return undefined;
  };
  function enqueue(trigger:string){
    if(shuttingDown)return;
    if(!queued.includes(trigger))queued.push(trigger);
    if(scheduled||planning)return;
    scheduled=true;
    scheduledTimer=setTimeout(()=>{scheduled=false;scheduledTimer=undefined;void runQueued().catch(e=>{lastError=errorText(e);emitStatus();});},0);
  }
  const relevantRoles=(trigger:string,paused:Role[]):Role[]=>{
    if(/玩家目标|手动|启动|权限|战略|时间线|重启|replan/i.test(trigger))return roles.filter(r=>!paused.includes(r));
    if(/research|科研|科技/i.test(trigger))return ['development','president'].filter(r=>!paused.includes(r as Role)) as Role[];
    if(/military|舰队|威胁|防御/i.test(trigger))return ['military','development','president'].filter(r=>!paused.includes(r as Role)) as Role[];
    if(/resource|资源|经济|建设|construction/i.test(trigger))return ['economy','development','president'].filter(r=>!paused.includes(r as Role)) as Role[];
    return roles.filter(r=>!paused.includes(r));
  };

  async function invokeRole(role:Role,phase:string,d:Decision,goal:GoalState,reports:Array<{role:Role;report:RoleReport}>,feedback:ExecutionFeedback[]):Promise<RoleReport>{
    const invalid=checkValidity(goal,d);if(invalid)throw new StaleDecision(invalid);
    const permissions=copy(admin.permissions());
    const lookup=role==='military'?'fleet defense military technology':role==='economy'?'resources production research buildings':'research technology prerequisites';
    let knowledge=await intel.searchKnowledge(lookup).catch(()=>[]);
    // Keep actual citations separate from unavailable knowledge; no synthetic source is substituted.
    knowledge=knowledge.slice(0,5);
    const input={phase,goal:goal.text,trigger:d.trigger,snapshot:copy(d.snapshot),globalReport:{snapshotId:d.snapshot.id,version:d.snapshot.version,source:d.snapshot.source,gameDate:d.snapshot.gameDate,global:copy(d.snapshot.global),resources:copy(d.snapshot.resources),missing:[...d.snapshot.missing]},departmentView:copy(intel.view(role)),permissions:copy(permissions),previousReports:copy(reports),feedback:copy(feedback),knowledge:copy(knowledge),outputFormat:outputGuide};
    const prior=(d.roleViews[role]?.calls as Json[]|undefined)??[];
    d.roleViews[role]={calls:[...prior,{phase,input:copy(input),startedAt:now()}]};
    if(!d.participants.includes(role))d.participants.push(role);
    runState.set(role,{role,status:'running',decisionId:d.id,at:now()});persistDecision(d);emitStatus();
    const description=role==='president'?'确定国家阶段方向、协调跨部门资源取舍，玩家明确指令最高优先级，不能扩大游戏权限。':role==='economy'?'评估资源收支、生产、建设与科研投入；提交可负担方案和对发展参谋、军事部的需求。':role==='military'?'基于可见对局评估威胁、防御与能力期限，不自行授权主动宣战。':'综合经济、军事和长期科研收益维护统一科技、传统、飞升路线；具体候选由行政按实际对局选择。';
    const system=`你是群星外部政府的${roleNames[role]}。${description}当前阶段 ${phase}。只输出一个合法 JSON 对象，遵循 input.outputFormat。所有数字、对象范围和建议必须依据提供的状态；未知信息明确说明，不假定额外数据。proposals 是业务项目，不是具体工具调用。research.scope 使用 area/preferences/targetCapability/allowSwitch；construction.scope 使用 buildingPreference/planetIds/desiredCount；defense.scope 使用 fleetIds/posture。资源库存与维护能力分别考虑。budget 是所需上限，不能更改玩家授权。rationale 仅写简短公开依据，禁止输出内部思维链。proposals 不适用时为空数组。总统 final 阶段汇总实际部门报告、确定优先级和约束，但不要重复生成部门项目。`;
    try{
      const mockInput:MockInput={goal:goal.text,snapshot:d.snapshot,permissions,previousReports:reports,feedback,phase};
      const beforeModel=checkValidity(goal,d);if(beforeModel)throw new StaleDecision(beforeModel);
      const raw=await ctx.models.json<unknown>(role,system,input,()=>mockReport(role,mockInput),d.traceId);
      const inputCalls=d.roleViews[role]!.calls as Json[];inputCalls[inputCalls.length-1].rawOutput=copy(raw);
      const validated=validateRoleReport(raw,role);
      const report:DecisionReport={id:uid('report'),decisionId:d.id,role,title:validated.title,summary:validated.summary,recommendations:validated.recommendations,rationale:validated.rationale,knowledge:copy(knowledge),projectIds:[],at:now()};
      d.reports.push(report);
      d.messages.push({id:uid('meeting_message'),role,kind:role==='president'&&phase==='final'?'ruling':'proposal',content:`${validated.title}\n${validated.summary}\n建议：${validated.recommendations.join('；')}\n依据：${validated.rationale}`,at:now()});
      for(const request of validated.requests)d.messages.push({id:uid('meeting_message'),role,kind:'request',content:request,at:now()});
      const calls=d.roleViews[role]!.calls as Json[];calls[calls.length-1].completedAt=now();calls[calls.length-1].reportId=report.id;calls[calls.length-1].output=copy(validated);
      runState.set(role,{role,status:'idle',decisionId:d.id,at:now()});persistDecision(d);emitStatus();
      const invalidAfter=checkValidity(goal,d);if(invalidAfter)throw new StaleDecision(invalidAfter);
      return validated;
    }catch(e){const calls=d.roleViews[role]?.calls as Json[]|undefined;if(calls?.length){calls[calls.length-1].error=errorText(e);calls[calls.length-1].completedAt=now();}runState.set(role,{role,status:e instanceof StaleDecision?'idle':'failed',decisionId:d.id,at:now(),error:errorText(e)});persistDecision(d);emitStatus();throw e;}
  }

  const eligible=(proposal:Proposal,permissions:Permissions):boolean=>{
    if(permissions.stopped||permissions.mode==='advice')return false;
    return proposal.kind==='research'?permissions.research:proposal.kind==='construction'?permissions.construction:proposal.kind==='defense'?permissions.military:false;
  };

  async function runPlan(goal:GoalState,trigger:string){
    const snapshot=copy(intel.snapshot()??await intel.refresh());
    const permissions=copy(admin.permissions());
    const d:Decision={id:uid('decision'),meetingId:uid('meeting'),traceId:goal.traceId,trigger,goal:goal.text,status:'running',at:now(),snapshot,roleViews:{},participants:[],messages:[],reports:[],projectIds:[],inputPermissionRevision:permissions.revision};
    lastDecisionId=d.id;persistDecision(d);
    const selection=relevantRoles(trigger,permissions.pausedDepartments);
    const reports:Array<{role:Role;report:RoleReport}>=[];
    const feedback=sorted(ctx.store.list<ExecutionFeedback>('feedback')).slice(0,20);
    const results=new Map<Role,RoleReport>();
    try{
      if(ctx.config.planningDelayMs>0)await new Promise(resolve=>setTimeout(resolve,Math.min(60000,ctx.config.planningDelayMs)));
      if(selection.includes('president')){
        const initial=await invokeRole('president','direction',d,goal,reports,feedback);reports.push({role:'president',report:initial});results.set('president',initial);
      }
      const domainRoles=selection.filter(r=>r==='economy'||r==='military');
      const domainResults=await Promise.allSettled(domainRoles.map(async role=>({role,report:await invokeRole(role,'department',d,goal,copy(reports),feedback)})));
      for(const result of domainResults){if(result.status==='rejected')throw result.reason;reports.push(result.value);results.set(result.value.role,result.value.report);}
      if(selection.includes('development')){
        const report=await invokeRole('development','route',d,goal,reports,feedback);reports.push({role:'development',report});results.set('development',report);
      }
      if(selection.includes('president')){
        const final=await invokeRole('president','final',d,goal,reports,feedback);reports.push({role:'president',report:final});results.set('president',final);
      }
      const invalid=checkValidity(goal,d);if(invalid)throw new StaleDecision(invalid);
      if(!selection.length)throw new Error('政府角色均已暂停，没有角色参与本轮决策');
      const previous=strategies()[0];
      const president=results.get('president');
      const strategy:Strategy={id:previous?.id??uid('strategy'),revision:(previous?.revision??0)+1,traceId:goal.traceId,goal:goal.text,priorities:president?.priorities.length?president.priorities:previous?.priorities??['玩家当前目标'],constraints:president?.constraints??previous?.constraints??{},budgets:president?.budgets??previous?.budgets??{},contingencies:president?.contingencies??previous?.contingencies??[],validUntil:new Date(Date.now()+30*60_000).toISOString(),at:now()};
      // Government stores intent only; EXEC remains the sole writer of grants and resource reservations.
      const newProjects:Project[]=[];
      const rebasedProjects:Project[]=[];
      const rebases:Array<{id:string;projectId:string;fromRevision:number;toRevision:number;fromStrategyRevision:number;toStrategyRevision:number;decisionId:string;reason:string;at:string}>=[];
      for(const [role,report]of results){
        for(const proposal of report.proposals){
          if(role==='president'&&Array.from(results).some(([r,v])=>r!=='president'&&v.proposals.some(p=>p.kind===proposal.kind)))continue;
          const existing=projects().find(p=>activeProject(p)&&p.department===role&&p.kind===proposal.kind);
          // A published successor is a revision; already submitted game operations remain in EXEC history.
          const project:Project={id:existing?.id??uid('project'),revision:(existing?.revision??0)+1,strategyId:strategy.id,strategyRevision:strategy.revision,traceId:goal.traceId,department:role,title:proposal.title,goal:proposal.goal,kind:proposal.kind,scope:copy(proposal.scope),budget:copy(proposal.budget),priority:proposal.priority,dependencies:[],completion:proposal.completion,termination:proposal.termination,status:eligible(proposal,permissions)?'ready':'proposed',at:now()};
          newProjects.push(project);
          for(const savedReport of d.reports.filter(r=>r.role===role)){savedReport.projectIds.push(project.id);}
        }
      }
      ctx.store.transaction(()=>{
        const finalInvalid=checkValidity(goal,d);if(finalInvalid)throw new StaleDecision(finalInvalid);
        ctx.store.set('strategies',`${strategy.id}:${strategy.revision}`,strategy);
        const scopeRoles=new Set(results.keys());
        const replacingPlayerGoal=/玩家目标/.test(trigger)||(previous!==undefined&&previous.goal!==goal.text);
        for(const old of projects().filter(activeProject)){
          if(newProjects.some(p=>p.id===old.id)){
            ctx.store.set('project_revisions',`${old.id}:${old.revision}`,copy(old));
            continue;
          }
          ctx.store.set('project_revisions',`${old.id}:${old.revision}`,copy(old));
          if(scopeRoles.has(old.department)||replacingPlayerGoal){
            ctx.store.set('projects',old.id,{...old,revision:old.revision+1,status:'cancelled',feedback:'已由新战略或领域方案替换'});
          }else{
            // A local meeting retains untouched departments' scope, but their next action must use this strategy.
            // Revision invalidation does not cancel orders that have already entered the game.
            const rebased:Project={...old,revision:old.revision+1,strategyId:strategy.id,strategyRevision:strategy.revision,at:now(),feedback:`局部重评保留原目标与对象范围，基于战略 v${strategy.revision} 重新检查后续提交`};
            rebasedProjects.push(rebased);
            ctx.store.set('projects',rebased.id,rebased);
            const rebase={id:uid('rebase'),projectId:old.id,fromRevision:old.revision,toRevision:rebased.revision,fromStrategyRevision:old.strategyRevision,toStrategyRevision:strategy.revision,decisionId:d.id,reason:'未参与本轮领域重评，保留项目作用域并重新绑定当前战略；EXEC 重新检查授权、资源和约束',at:now()};
            rebases.push(rebase);ctx.store.set('project_rebases',rebase.id,rebase);
          }
        }
        for(const project of newProjects)ctx.store.set('projects',project.id,project);
        d.strategy=strategy;d.projectIds=[...newProjects,...rebasedProjects].map(p=>p.id);d.status='completed';d.completedAt=now();ctx.store.set('decisions',d.id,copy(d));
        ctx.store.set('government_meta','lastPlannedGoalRevision',goal.revision);
      });
      lastError=undefined;
      ctx.bus.emit('government.strategy',strategy,d.traceId);
      for(const project of [...newProjects,...rebasedProjects])ctx.bus.emit('government.project',project,d.traceId);
      for(const rebase of rebases)ctx.bus.emit('government.project.rebased',rebase,d.traceId);
      ctx.bus.emit('government.decision.completed',d,d.traceId);
      addMessage('assistant',`本轮${d.participants.map(r=>roleNames[r]).join('、')}已完成评估。${president?.summary??reports.at(-1)?.report.summary??''}\n${newProjects.length?`发布 ${newProjects.length} 个项目：${newProjects.map(p=>`${p.title}（${p.status==='proposed'?'待授权':'可执行'}）`).join('、')}。`:'本轮没有新增项目。'}${rebasedProjects.length?`另有 ${rebasedProjects.length} 个未重评部门项目保留原作用域并重新绑定战略，后续提交重新检查约束。`:''}可在调试模式查看当时全局报告、实际会议记录与各部门报告。`,d.traceId,d.id);
    }catch(e){
      d.status=e instanceof StaleDecision?'stale':'failed';d.error=errorText(e);d.completedAt=now();persistDecision(d);
      lastError=d.error;
      if(e instanceof StaleDecision){
        addMessage('system',`本轮决策已作废：${d.error}。`,d.traceId,d.id);
        const onlyOneTimePermissionChange=admin.permissions().revision!==permissions.revision&&permissionPolicyFingerprint(admin.permissions())===permissionPolicyFingerprint(permissions);
        if(getGoal()?.revision===goal.revision&&!onlyOneTimePermissionChange)enqueue('重新评估最新授权或时间线');
      }else{
        addMessage('assistant',`本轮规划未发布项目：${d.error}。已有有效项目继续由行政层处理。请检查模型或资料后重试。`,d.traceId,d.id);
        ctx.bus.emit('government.error',{decisionId:d.id,error:d.error},d.traceId);
      }
    }
  }

  async function runQueued(){
    if(shuttingDown||planning||!queued.length)return;
    const goal=getGoal();if(!goal){queued=[];return;}
    const trigger=queued.splice(0).join('；');planning=true;emitStatus();
    const execution=(async()=>{
      try{await runPlan(goal,trigger);}finally{
        planning=false;
        for(const [role,state]of runState)if(state.status==='running')runState.set(role,{role,status:'idle'});
        emitStatus();
        if(!shuttingDown&&queued.length)enqueue('合并后续变化');
      }
    })();
    activeRun=execution;
    try{await execution;}finally{if(activeRun===execution)activeRun=undefined;}
  }

  async function submitGoal(text:string){
    if(shuttingDown)throw new Error('应用正在退出');
    const trimmed=text.trim();if(!trimmed)throw new Error('请输入玩家目标');if(trimmed.length>12000)throw new Error('目标文本不能超过 12000 字符');
    const prior=getGoal();const traceId=uid('trace');const goal:GoalState={text:trimmed,revision:(prior?.revision??0)+1,traceId,at:now()};
    ctx.store.set('government_meta','goal',goal);
    const message=addMessage('user',trimmed,traceId);
    enqueue('玩家目标更新');return {traceId,message};
  }
  async function replan(trigger='手动重新评估'){
    if(shuttingDown)throw new Error('应用正在退出');
    if(!getGoal())throw new Error('尚未收到玩家目标');enqueue(trigger);
  }
  async function tick(){
    if(shuttingDown)return;
    const goal=getGoal();if(!goal)return;
    const processed=new Set(ctx.store.get<string[]>('government_meta','processedFeedback')??[]);
    const newFeedback=ctx.store.list<ExecutionFeedback>('feedback').filter(f=>!processed.has(f.id));
    for(const feedback of newFeedback){
      processed.add(feedback.id);
      const project=ctx.store.get<Project>('projects',feedback.projectId);
      if(!project)continue;
      if(feedback.projectRevision!==undefined&&feedback.projectRevision!==project.revision)continue;
      const state=feedback.status.toLowerCase();
      const mapped=state==='completed'||state==='done'?'completed':state==='blocked'||state==='failed'||state==='error'?'blocked':state==='waiting'||state==='unknown'?'waiting':undefined;
      if(mapped&&project.status!=='cancelled')ctx.store.set('projects',project.id,{...project,status:mapped,feedback:feedback.reason});
      if(mapped==='blocked'){
        // One adjustment per distinct blocker and player goal. Repeated identical failures wait for facts/authorization changes.
        const blockerKey=`${goal.revision}:${project.id}:${feedback.reason}`;
        const blockers=ctx.store.get<string[]>('government_meta','reviewedBlockers')??[];
        if(!blockers.includes(blockerKey)){
          ctx.store.set('government_meta','reviewedBlockers',[...blockers,blockerKey].slice(-1000));
          enqueue(`${project.kind} 项目阻塞：${feedback.reason}`);
        }
      }
      if(mapped==='completed'&&project.kind==='research')enqueue('科研完成，重新评估研究路线');
    }
    if(newFeedback.length)ctx.store.set('government_meta','processedFeedback',Array.from(processed).slice(-3000));
    if(permissionPolicyChanged())enqueue('权限变化');
    const latest=intel.snapshot();
    const oldTimeline=ctx.store.get<string>('government_meta','timeline');
    if(latest){ctx.store.set('government_meta','timeline',`${latest.sessionId}:${latest.timelineId}`);if(oldTimeline&&oldTimeline!==`${latest.sessionId}:${latest.timelineId}`)enqueue('时间线变化');}
    const currentStrategy=strategies()[0];
    if(currentStrategy&&new Date(currentStrategy.validUntil).getTime()<Date.now()){
      const lastExpiry=ctx.store.get<string>('government_meta','expiryReviewed');
      const key=`${currentStrategy.id}:${currentStrategy.revision}`;
      if(lastExpiry!==key){ctx.store.set('government_meta','expiryReviewed',key);enqueue('战略到期');}
    }
    if(!planning&&queued.length)enqueue('定期调度');
  }

  // Events carry hints; facts and authorization are always re-read at the next submit boundary.
  const unsubscribe=ctx.bus.subscribe(event=>{
    if(shuttingDown||!getGoal())return;
    if(/^(control\.permissions|permissions\.changed|control\.changed)$/.test(event.type)&&permissionPolicyChanged())enqueue('权限变化');
    if(/^(state\.timeline|timeline\.changed)$/.test(event.type))enqueue('时间线变化');
    if(event.type==='state.significant')enqueue(`领域变化 ${String(event.data?.domain??'全局')}`);
  });
  if(recoveredPending&&getGoal())enqueue('重启恢复重新评估');
  async function shutdown(){
    if(shutdownPromise)return shutdownPromise;
    shuttingDown=true;
    queued=[];
    if(scheduledTimer!==undefined){clearTimeout(scheduledTimer);scheduledTimer=undefined;}
    scheduled=false;
    unsubscribe();
    shutdownPromise=(async()=>{if(activeRun)await activeRun;})();
    return shutdownPromise;
  }
  return {submitGoal,tick,replan,decisions,projects,strategies,messages,status,shutdown};
}
class StaleDecision extends Error {}
