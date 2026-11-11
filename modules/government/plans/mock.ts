import type { Json, Role, Snapshot, Permissions, ExecutionFeedback } from '../../../contracts/index.ts';
import type { RoleReport, Proposal } from './validation.ts';

export interface MockInput { goal:string; snapshot:Snapshot; permissions:Permissions; previousReports:Array<{role:Role; report:RoleReport}>; feedback:ExecutionFeedback[]; phase:string; }
const number=(x:unknown,fallback=0)=>typeof x==='number'&&Number.isFinite(x)?x:fallback;
export function goalFocus(goal:string): 'research'|'economy'|'military' {
  const military=/(战争|宣战|进攻|防御|防守|边境|舰队|军事|war|defen|fleet|military)/i.test(goal);
  const research=/(科研|科技|研究|research|science|tech)/i.test(goal);
  const economy=/(经济|生产|能源|矿物|建设|economic|energy|mineral|build)/i.test(goal);
  if(research)return 'research';
  if(military)return 'military';
  if(economy)return 'economy';
  return 'research';
}
export function mockReport(role:Role,input:MockInput):RoleReport {
  const {goal,snapshot:s,permissions:p,previousReports,feedback,phase}=input;
  const focus=goalFocus(goal);
  const energy=s.resources.energy ?? s.resources.energy_credits;
  const mineral=s.resources.minerals;
  const alloy=s.resources.alloys;
  const deficit=Object.entries(s.resources).filter(([,r])=>r.net<0).map(([key])=>key);
  const shortage=feedback.filter(f=>/不足|缺口|预算|资源|insuff|budget/i.test(f.reason));
  const stock=(key:string)=>number(s.resources[key]?.stockpile);
  const budget=(key:string,desired:number)=>Math.max(0,Math.min(stock(key),number(p.budgets[key],desired),desired));
  const observation=`依据 ${s.source==='mock'?'模拟':'实际'}对局 ${s.gameDate}、状态 v${s.version}；资源与候选取自该轮输入。`;
  const blank:RoleReport={title:'',summary:'',recommendations:[],rationale:observation,requests:[],priorities:[],constraints:{},budgets:{},contingencies:[],proposals:[]};
  if(role==='president'){
    const priorities=focus==='research'?['科研能力','经济底线','边境防御']:focus==='military'?['边境防御','可负担军力','经济稳定']:['资源收支','建设能力','持续科研'];
    const constraints:Json={resourceFloor:{energy:Math.min(200,number(energy?.stockpile)),minerals:Math.min(100,number(mineral?.stockpile)),alloys:Math.min(100,number(alloy?.stockpile))},respectPlayerPermissions:true,visibleObjectsOnly:true};
    const recommendations=phase==='final'?previousReports.flatMap(x=>x.report.recommendations.slice(0,1)).slice(-3):['各部门按共同状态提出方案，发展参谋统筹能力路线。'];
    return {...blank,title:phase==='final'?'国家阶段战略与会议决议':'总统阶段方向',summary:`围绕“${goal}”按${priorities.join('、')}排序。${deficit.length?`先处理 ${deficit.join('、')} 的负收支。`:''}${shortage.length?'已有资源阻塞，缩减投入并请求重新评估。':''}`,priorities,constraints,budgets:{minerals:budget('minerals',shortage.length?150:600),alloys:budget('alloys',focus==='military'?300:150),energy:budget('energy',200)},contingencies:['资源低于底线时暂停新增支出并通知经济部','新威胁或执行阻塞触发局部重评'],recommendations,requests:phase==='final'?[]:['经济部提交可负担投入，军事部提交防御需求，发展参谋统一技术排序。']};
  }
  if(role==='economy'){
    const wantConstruction=focus==='economy'||deficit.length>0||focus==='research';
    const constructionBudget=budget('minerals',shortage.length?100:400);
    const buildingPreference=deficit.includes('energy')||deficit.includes('energy_credits')?'energy':focus==='research'?'research':'minerals';
    const proposals:Proposal[]=wantConstruction?[{kind:'construction',title:buildingPreference==='research'?'科研设施投入':buildingPreference==='energy'?'修复能源收支':'提高资源生产',goal:buildingPreference==='research'?'在经济底线内增加科研供给':`增加 ${buildingPreference} 生产能力`,scope:{buildingPreference,planetIds:s.planets.map(x=>x.id??x.planet_id).filter(x=>typeof x==='number'),desiredCount:1},budget:{minerals:constructionBudget},priority:deficit.length?95:focus==='economy'?90:65,completion:'一项符合目标的建设完成且资源底线仍满足',termination:'预算不足、玩家撤销或战略替换'}]:[];
    return {...blank,title:'经济部投入与资源报告',summary:`当前${energy?`能源库存 ${energy.stockpile}、净收支 ${energy.net}`:'能源读数缺失'}，矿物库存 ${number(mineral?.stockpile)}。${deficit.length?`需修复 ${deficit.join('、')} 负收支。`:'按授权额度控制新增投入。'}${shortage.length?'对失败项目先缩减预算，不重复下单。':''}`,recommendations:[focus==='research'?'科研设施与研究选择并行，建设以合法候选和可用资源为准。':'优先有明确收益且可负担的生产项目。'],requests:['发展参谋提供产业能力排序；军事部给出维护负担和期限。'],budgets:{minerals:constructionBudget},proposals};
  }
  if(role==='military'){
    const militaryRequested=focus==='military'||/(边境|防御|防守|舰队|defen|fleet)/i.test(goal);
    const fleets=s.fleets.map(x=>x.id??x.fleet_id).filter(x=>typeof x==='number');
    const proposals:Proposal[]=militaryRequested?[{kind:'defense',title:'维持边境防御能力',goal:'在可负担范围内补充现有舰队防御缺口',scope:{fleetIds:fleets,posture:'defend',visibleTargetsOnly:true},budget:{alloys:budget('alloys',focus==='military'?200:100)},priority:focus==='military'?95:60,completion:'授权舰队缺额得到补充，或已确认没有缺额',termination:'威胁变化需重评、授权撤销或战略替换'}]:[];
    return {...blank,title:'军事部威胁与能力报告',summary:`可见舰队 ${s.fleets.length} 支；合金库存 ${number(alloy?.stockpile)}。${militaryRequested?'优先保持防御能力，不自行扩大为主动宣战。':'维持现有防御，新增军费不挤占当前首要目标。'}`,recommendations:[militaryRequested?'优先观察现有舰队缺额与维护能力，再申请增援。':'保持威胁监测，按变化请求调整。'],requests:['经济部评估合金及维护能力；发展参谋纳入防御相关技术需求。'],proposals};
  }
  if(role==='development'){
    const candidateAreas=Object.keys(s.research??{}).filter(key=>['physics','society','engineering'].includes(key));
    const activeCheck=(v:any)=>v?.current??v?.active??v?.current_research;
    const availableArea=candidateAreas.find(key=>!activeCheck(s.research[key]))??'physics';
    const preferences=focus==='military'?['weapons','armor','shields','military']:focus==='economy'?['energy','minerals','production','economy']:['research','science','computing','physics'];
    const proposals:Proposal[]=[{kind:'research',title:focus==='military'?'防御能力研究':focus==='economy'?'产业能力研究':'优先科研能力研究',goal:`结合经济供给与军事需求，优先提升${focus==='military'?'防御':focus==='economy'?'生产':'科研'}能力`,scope:{area:availableArea,preferences,targetCapability:focus,allowSwitch:false},budget:{},priority:focus==='research'?95:75,completion:'按路线从当前合法候选中选择研究，并观察其完成',termination:'候选失效、路线重评或玩家撤销'}];
    return {...blank,title:'统一发展路线报告',summary:`综合经济部的投入边界与军事部的能力需求，当前候选按 ${preferences.join('、')} 排序。行政层读取真实候选后完成局部选择。`,recommendations:['优先研究不额外消耗库存的当前合法候选；保持既有研究，除非有明确改线授权。'],requests:['总统裁决无法同时满足的产业与军事路线需求。'],priorities:preferences,proposals};
  }
  throw new Error(`不支持的政府角色 ${role}`);
}
