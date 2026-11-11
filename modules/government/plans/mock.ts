import {roleNames as defaultNames} from '../../../contracts/index.ts';
import type { Json, Role, Snapshot, Permissions, ExecutionFeedback } from '../../../contracts/index.ts';
import {domainOwner,queryTools} from '../../../integrations/game_mcp/registry.js';
import type { RoleReport, Proposal } from './validation.ts';

export interface MockInput { roleNames?:Partial<Record<Role,string>>;goal:string; snapshot:Snapshot; permissions:Permissions; previousReports:Array<{role:Role; report:RoleReport}>; feedback:ExecutionFeedback[]; phase:string; }
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
function coreMockReport(role:Role,input:MockInput):RoleReport {
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
    const b=s.battlefield,combat=b?.fleets.filter(f=>f.relation==='own'&&f.type==='military'&&!f.destroyed&&f.freshness==='fresh')??[];
    const target=b?.fleets.find(f=>f.relation==='hostile'&&f.visible&&f.freshness==='fresh'&&!f.destroyed),home=b?.homeSystemId;
    const requestedMission=/(撤退|撤离|retreat)/i.test(goal)?'retreat':/(整补|维修|resupply)/i.test(goal)?'resupply':/(集结|regroup)/i.test(goal)?'regroup':/(追击|pursu)/i.test(goal)&&p.offensiveMilitary&&target?'pursue':/(进攻|攻击|attack)/i.test(goal)&&p.offensiveMilitary&&target?'attack':'defend';
    const threatened=b?.threats.find(t=>b.systems.some(s=>s.id===t.systemId&&s.ownership==='own'));
    const destination=['attack','pursue'].includes(requestedMission)?target?.systemId:threatened?.systemId??home;
    const proposals:Proposal[]=militaryRequested&&combat.length&&home!==null&&home!==undefined&&destination!==null&&destination!==undefined?[{kind:'fleet',title:requestedMission==='defend'?'持续保卫己方边境':'执行舰队'+requestedMission,goal:'按当前可见战场态势持续执行任务，保留损伤撤退边界',scope:{mission:requestedMission,fleetIds:combat.map(f=>f.id),targetSystemId:destination,homeSystemId:home,rallySystemId:home,...(['attack','pursue'].includes(requestedMission)?{targetFleetId:target!.id}:{}),minimumAdvantage:1.2,retreatHull:0.4,retreatLoss:0.3,allowEmergencyFtl:p.emergencyRetreat===true,requireRepair:requestedMission==='resupply'},budget:{alloys:budget('alloys',200)},priority:95,completion:'按实际回读确认任务条件；防守为持续任务，失联不等于被击败',termination:'玩家取消、授权撤回或军事任务结构变更'}]:[];
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


export function mockReport(role:Role,input:MockInput):RoleReport {
 const report=coreMockReport(role,input);
 const requests:Array<{pattern:RegExp;domain:string;tools:string[];title:string;budget:Json}>=[
  {pattern:/市场|买入|购买矿物|交易|market/i,domain:'market',tools:['market_trade'],title:'通过市场补充矿物',budget:{energy:150}},
  {pattern:/传统|tradition/i,domain:'traditions',tools:['adopt_tradition'],title:'采用探索传统',budget:{unity:100}},
  {pattern:/法令|edict/i,domain:'traditions',tools:['toggle_edict'],title:'启用科研补贴法令',budget:{unity:50}},
  {pattern:/调查星系|探索|survey|explor/i,domain:'exploration',tools:['survey'],title:'调查邻近星系',budget:{}},
  {pattern:/区划|district/i,domain:'construction',tools:['build_district'],title:'增加发电区划',budget:{minerals:100}},
  {pattern:/领袖|leader/i,domain:'leaders',tools:['hire_leader'],title:'招聘可用领袖',budget:{energy:100}},
  {pattern:/议程|agenda/i,domain:'government',tools:['set_council_agenda'],title:'设置科学发展议程',budget:{}},
  {pattern:/遗珍|relic/i,domain:'relics',tools:['activate_relic'],title:'激活古代档案库',budget:{unity:50}},
  {pattern:/岗位|workforce|job/i,domain:'construction',tools:['set_job_workforce_limit'],title:'设置技工岗位上限',budget:{}},
 ];
 for(const request of requests){if(!request.pattern.test(input.goal)||domainOwner(request.domain)!==role)continue;report.proposals.push({kind:'generic',title:request.title,goal:request.title,scope:{domain:request.domain,allowedTools:[...queryTools(request.domain),...request.tools.map(n=>'stellaris_'+n)],maxActions:1},budget:request.budget,priority:90,completion:'从实际回读中确认该领域操作已完成',termination:'权限撤销、玩家取消或候选失效'});}
 const names={...defaultNames,...input.roleNames};const rename=(text:string)=>text.replace(/发展参谋|行政部门|经济部|军事部|总统/g,label=>names[(Object.entries(defaultNames).find(([,name])=>name===label)?.[0]??'president') as Role]);report.title=rename(report.title);report.summary=rename(report.summary);report.recommendations=report.recommendations.map(rename);report.requests=report.requests.map(rename);return report;
}
