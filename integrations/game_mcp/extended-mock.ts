import type {Json} from '../../contracts/index.js';
import {uid} from '../../contracts/index.js';
import {extendBattlefield,battlefieldRead,mockPath,cancelBattleOrders,advanceBattlefield} from './battlefield-mock.js';
import {capabilities} from './registry.js';

export function extendWorld(s:Json):Json {
 s.nextOrderId??=100;s.operationLog??=[];s.market??={prices:{minerals:1.3,food:1.1,alloys:5,consumer_goods:2.5},monthly_trades:[]};
 s.government??={authority:'democratic',civics:['civic_meritocracy'],available_civics:[{key:'civic_environmentalist',cost:{unity:100}}],agenda:null,agendaReady:true,available_agendas:[{key:'agenda_science',name:'科学发展',cost:{}}]};
 s.traditions??={adopted:[],available:[{key:'tr_discovery_adopt',name:'探索传统',cost:{unity:100}},{key:'tr_expansion_adopt',name:'扩张传统',cost:{unity:120}}]};
 s.edicts??=[{key:'edict_research_subsidies',name:'科研补贴',enabled:false,cost:{unity:50}}];
 s.leaders??=[{id:1,name:'首席科学家',traits:[],assignment:null,available_traits:['leader_trait_spark_of_genius']}];s.leader_candidates??=[{id:2,name:'候选领袖',cost:{energy:100}}];
 s.species??=[{id:1,name:'曙光公民',traits:['trait_organic'],rights:{living_standards:'normal'},population:30,template:false}];
 s.systems??=[{id:0,name:'曙光星系',owner:0,surveyed:true,planets:[0],neighbors:[1]},{id:1,name:'天门星系',owner:null,surveyed:false,planets:[1],neighbors:[0],anomaly:true,bypass_id:1}];
 s.colonizable??=[{id:1,name:'希望',system_id:1,class:'pc_continental',colonized:false}];
 if(!s.extendedVersion){s.fleets.push({id:1,name:'探索船',type:'science',power:0,deficit:0,queue:[],system_id:0},{id:2,name:'工程船',type:'construction',power:0,deficit:0,queue:[],system_id:0},{id:3,name:'殖民船',type:'colony',power:0,deficit:0,queue:[],system_id:0});s.extendedVersion=1;}
 s.designs??=[{id:1,name:'巡防护卫舰',ship_size:'corvette',cost:{alloys:100},slots:[]}];s.components??=[{key:'SMALL_RED_LASER',name:'红激光',cost:{alloys:10}}];
 s.relics??=[{key:'r_mock_archive',name:'古代档案库（模拟）',active:false,cost:{unity:50}}];s.contacts??=[{id:1,name:'邻近共同体（模拟）',relation:0}];
 s.events??=[{window_id:1,title:'科研资助提案（模拟）',options:[{index:0,name:'批准科研资助',cost:{energy:100}},{index:1,name:'保持现状',cost:{}}]}];
 s.notifications??=[{index:0,title:'边境观测报告',opened:false,clickable:true}];s.alerts??=[{alert_id:1,title:'科研领域空闲',opened:false,clickable:true}];
 s.megastructures??=[{id:1,name:'轨道研究平台（模拟）',level:0,cost:{alloys:200}}];s.situations??=[{id:1,name:'边境探索',approach:'balanced',approaches:['balanced','science']}];s.claims??=[];s.sites??=[{id:1,system_id:1,name:'古代遗迹',excavated:false}];
 s.saves??=[];s.empireDesigns??=[{key:'mock_empire',name:'曙光共同体',authority:'auth_democratic',text:'mock_empire = { name = "曙光共同体" }'}];s.galaxySettings??={template:'small',num_empires:4};s.in_game??=true;
 for(const item of [...s.notifications,...s.alerts])item.clickable??=true;
 s.resources.influence??={stockpile:300,net:3};
 for(const p of s.planets){p.districts??=[];p.available_districts??=[{key:'district_generator',name:'发电区划',cost:{minerals:100}},{key:'district_mining',name:'采矿区划',cost:{minerals:100}},{key:'district_farming',name:'农业区划',cost:{minerals:100}}];p.blockers??=[{id:1,key:'d_mock_blocker',name:'废弃设施（模拟）',cost:{energy:100}}];p.jobs??=[{key:'technician',name:'技工',priority:false,limit:-1}];p.armies??=[{id:1,key:'defense_army',name:'守备军'}];p.army_settings??={deploy_in_orbit:false,include_in_builder:true};p.decisions??=[{key:'decision_planet_luxuries_boost',name:'奢侈品分配',cost:{consumer_goods:100}}];p.terraform_options??=[{link_index:0,target_class:'pc_ocean',cost:{energy:500}}];p.ascension_tier??=0;}
 extendBattlefield(s);return s;
}
const bare=(name:string)=>name.replace(/^stellaris_/,'');
const find=(rows:any[],id:any,label:string)=>{const x=rows.find(x=>x.id===id);if(!x)throw new Error(`${label}不存在：${id}`);return x;};
const byKey=(rows:any[],key:any,label:string)=>{const x=rows.find(x=>x.key===key);if(!x)throw new Error(`${label}不在当前候选中：${key}`);return x;};
export function mockCost(s:Json,name:string,a:Json):Json {
 extendWorld(s);const n=bare(name);const p=()=>find(s.planets,a.planet_id,'星球');const f=()=>find(s.fleets,a.fleet_id,'舰队');
 if(n==='build_building')return byKey(p().buildableBuildings,a.building_key,'建筑').cost;
 if(n==='reinforce_fleet'){if(!f().deficit||f().queue.length)throw new Error('无可增援缺额或已有订单');return f().reinforcementCost;}
 if(['build_district','demolish_district'].includes(n)){const x=byKey(p().available_districts,a.district_key,'区划');if(n==='demolish_district'&&!p().districts.some((d:any)=>d.key===a.district_key))throw new Error('没有可拆除区划');return n==='build_district'?x.cost:{};}
 if(n==='clear_blocker'){const b=p().blockers.find((x:any)=>x.id===a.deposit_id||x.key===a.deposit_key);if(!b)throw new Error('障碍不在当前候选中');return b.cost;}
 if(n==='enact_planetary_decision')return byKey(p().decisions,a.decision_key,'星球决议').cost;
 if(n==='start_terraforming'){if(p().terraforming)throw new Error('已有地貌改造订单');const o=p().terraform_options.find((x:any)=>x.target_class===a.target_class||x.link_index===a.link_index);if(!o)throw new Error('没有该地貌改造选项');return o.cost;}
 if(n==='ascend_colony'){p();return {unity:100};}
 if(n==='build_ship'){const d=find(s.designs,a.design_id,'舰船设计');return Object.fromEntries(Object.entries(d.cost).map(([k,v])=>[k,Number(v)*(a.count??1)]));}
 if(n==='upgrade_building'){const b=p().buildings.find((b:any,i:number)=>(b.id??i)===a.building_id);if(!b)throw new Error('建筑实例不存在');return {minerals:200};}
 if(n==='upgrade_fleet'){f();return {alloys:100};}
 if(n==='recruit_planet_army'){p();if(!['assault_army','defense_army'].includes(a.army_key))throw new Error('兵种不在当前候选中');return {minerals:100};}
 if(n==='hire_leader')return find(s.leader_candidates,a.candidate_id,'领袖候选').cost;
 if(n==='adopt_tradition'){const t=byKey(s.traditions.available,a.tradition_key,'传统');if(s.traditions.adopted.includes(a.tradition_key))throw new Error('该传统已采用');return t.cost;}
 if(n==='toggle_edict'){const e=byKey(s.edicts,a.edict_key,'法令');return a.enabled&&!e.enabled?e.cost:{};}
 if(n==='activate_relic'){const r=byKey(s.relics,a.relic_key,'遗珍');if(r.active)throw new Error('遗珍仍在冷却');return r.cost;}
 if(n==='market_trade'){const price=s.market.prices[a.resource];if(!price||!s.resources[a.resource])throw new Error('该资源不可交易');const units=a.units??1;if(!Number.isInteger(units)||units<=0||units>10000)throw new Error('交易数量必须为1至10000');return a.action==='buy'?{energy:price*units}:{[a.resource]:units};}
 if(n==='set_monthly_trade'&&!a.cancel){if(!s.market.prices[a.resource]||!Number.isFinite(a.amount)||a.amount<=0||a.amount>10000)throw new Error('无效每月交易资源或数量');return a.action==='sell'?{[a.resource]:a.amount}:{energy:s.market.prices[a.resource]*a.amount};}
 if(n==='resolve_event'){const e=s.events.find((e:any)=>e.window_id===a.window_id);const o=e?.options.find((o:any)=>o.index===a.option_index);if(!o)throw new Error('事件选项不存在');return o.cost;}
 if(n==='build_outpost'){const system=find(s.systems,a.system_id,'星系');if(!system.surveyed||system.owner!==null)throw new Error('前哨需要已调查且无主星系');if(f().type!=='construction')throw new Error('需要工程船');return {alloys:100,influence:50};}
 if(n==='claim_system'){find(s.systems,a.system_id,'星系');return a.remove?{}:{influence:50*(a.count??1)};}
 if(n==='build_megastructure'){if(f().type!=='construction'||a.type!=='mock_research_platform')throw new Error('无合法巨构建设候选');return {alloys:300};}
 if(n==='upgrade_megastructure')return find(s.megastructures,a.megastructure_id,'巨构').cost;
 if(n==='colonize'){const x=find(s.colonizable,a.planet_id,'殖民目标');if(x.colonized||f().type!=='colony')throw new Error('殖民目标或殖民船不可用');return {food:100,consumer_goods:100};}
 if(n==='change_civics'){for(const k of a.add??[])byKey(s.government.available_civics,k,'国民理念');for(const k of a.remove??[])if(!s.government.civics.includes(k))throw new Error('没有该已采用理念');return {unity:100};}
 if(['apply_species_template','create_species_template','modify_species_template'].includes(n))return {};
 return {};
}
function templates(s:Json):Record<string,Json>{
 const p=s.planets[0],f=s.fleets[0];return {
 resolve_event:{window_id:s.events[0]?.window_id??1,option_index:1},open_notification:{index:0},open_alert:{alert_id:1},cancel_research:{area:'physics'},move_fleet:{fleet_id:f.id,system_id:1},cancel_fleet_orders:{fleet_ids:[f.id]},follow_fleet:{fleet_id:f.id,target_fleet_id:1},set_fleet_stance:{fleet_id:f.id,stance:'evasive'},fleet_mia:{fleet_ids:[f.id],type:'return_home'},claim_system:{system_id:1},land_armies:{fleet_id:f.id,planet_id:p.id},collect_data:{fleet_id:1,system_id:1},orbit_planet:{fleet_id:f.id,planet_id:p.id},research_anomalies:{fleet_id:1,system_id:1},excavate_site:{fleet_id:1,site_id:1},use_bypass:{fleet_id:1,bypass_id:1,to_system_id:0},explore_bypass:{fleet_id:1,bypass_id:1},build_outpost:{fleet_id:2,system_id:1},upgrade_megastructure:{megastructure_id:1},build_megastructure:{fleet_id:2,type:'mock_research_platform',system_id:0},colonize:{fleet_id:3,planet_id:1},survey:{fleet_id:1,system_id:1},set_situation_approach:{situation_id:1,approach_key:'science'},launch_council_agenda:{},set_council_agenda:{agenda_key:'agenda_science'},change_civics:{add:['civic_environmentalist'],remove:[]},select_leader_trait:{leader_id:1,trait_key:'leader_trait_spark_of_genius'},adopt_tradition:{tradition_key:'tr_discovery_adopt'},toggle_edict:{edict_key:'edict_research_subsidies',enabled:true},hire_leader:{candidate_id:2},dismiss_leader:{leader_id:1},assign_leader:{leader_id:1,assignment_type:1,target_id:p.id},set_species_rights:{species_id:1,category:'living_standards',right_value:'normal'},create_species_template:{base_species_id:1,traits:['trait_organic','trait_intelligent']},modify_species_template:{template_species_id:2,traits:['trait_organic','trait_intelligent']},delete_species_template:{species_id:2},apply_species_template:{template_species_id:2},set_fleet_template_quota:{fleet_id:f.id,design_id:1,target_quota:5},create_ship_design:{ship_size:'corvette',name:'新巡防舰'},update_ship_design:{design_id:1,name:'改良巡防舰'},upgrade_fleet:{fleet_id:f.id},delete_ship_design:{design_id:1},market_trade:{resource:'minerals',action:'buy',units:100},set_monthly_trade:{resource:'minerals',action:'buy',amount:10},activate_relic:{relic_key:'r_mock_archive'},set_district_zone:{planet_id:p.id,district_id:0,slot:0,zone_key:'zone_industrial'},cancel_construction:{item_id:p.queue.find((q:any)=>Number.isInteger(q.id))?.id??s.operationLog.find((o:any)=>!o.completed&&!o.cancelled&&o.order_id)?.order_id??0},build_ship:{design_id:1,count:1,system_id:0},build_district:{planet_id:p.id,district_key:'district_generator'},demolish_district:{planet_id:p.id,district_key:'district_generator'},upgrade_building:{planet_id:p.id,building_id:0},clear_blocker:{planet_id:p.id,deposit_id:1},enact_planetary_decision:{planet_id:p.id,decision_key:'decision_planet_luxuries_boost'},start_terraforming:{planet_id:p.id,target_class:'pc_ocean'},cancel_terraforming:{planet_id:p.id},ascend_colony:{planet_id:p.id},set_job_priority:{planet_id:p.id,job_key:'technician'},set_job_workforce_limit:{planet_id:p.id,job_key:'technician',limit:5},set_planet_army_settings:{planet_id:p.id,deploy_in_orbit:true},embark_all_armies:{planet_id:p.id},disband_planet_army:{planet_id:p.id,army_id:1},recruit_planet_army:{planet_id:p.id,army_key:'assault_army'},load_game:{campaign:'mock',file:'manual'},save_game:{name:'manual'},exit_to_main_menu:{},save_empire_design:{key:'custom_mock',base:'mock_empire',changes:{name:'新共同体'}},delete_empire_design:{key:'custom_mock'},set_galaxy_settings:{settings:{template:'small'}},new_game:{empire:'mock_empire'},run_until:{days:30},set_paused:{paused:false},set_speed:{speed:2}
 };}
export function mockCandidates(s:Json,domain?:string):Json[]{extendWorld(s);return Object.entries(templates(s)).flatMap(([n,args])=>{const tool='stellaris_'+n;if(domain&&capabilities[tool]?.domain!==domain)return [];try{return [{tool,args,cost:mockCost(s,tool,args)}];}catch{return [];}});}

export function extendedRead(s:Json,name:string,a:Json):any {
 extendWorld(s);const n=bare(name);const domain=capabilities[name]?.domain;const actions=()=>mockCandidates(s,domain);const p=()=>find(s.planets,a.planet_id,'星球');
 const battle=battlefieldRead(s,n,a);if(battle)return {...battle,available_actions:actions()};
 let result:Json;
 switch(n){
 case 'get_galaxy_overview':case 'get_galaxy_map':result={systems:s.systems,colonizable:s.colonizable};break;
 case 'get_system':result=find(s.systems,a.system_id,'星系');break;
 case 'find_systems':result={systems:s.systems.filter((x:any)=>a.purpose==='survey'?!x.surveyed:true)};break;
 case 'find_path':find(s.fleets,a.fleet_id,'舰队');find(s.systems,a.to_system_id,'星系');result={path:[0,a.to_system_id]};break;
 case 'get_situation_log':result={situations:s.situations,sites:s.sites};break;
 case 'get_megastructure':result=find(s.megastructures,a.megastructure_id,'巨构');break;
 case 'get_buildable_megastructures':find(s.fleets,a.fleet_id,'舰队');result={candidates:[{key:'mock_research_platform',cost:{alloys:300}}]};break;
 case 'get_government':case 'get_civics':result=s.government;break;
 case 'get_traditions':result=s.traditions;break;
 case 'get_edicts':result={edicts:s.edicts};break;
 case 'get_leaders':result={leaders:s.leaders,candidates:s.leader_candidates};break;
 case 'get_species':result={species:s.species};break;
 case 'get_species_modification_info':result={species:find(s.species,a.species_id,'物种'),available_traits:['trait_organic','trait_intelligent','trait_industrious']};break;
 case 'get_military_fleets':result={fleets:s.fleets.filter((f:any)=>!f.type||f.type==='military')};break;
 case 'get_civilian_fleets':result={fleets:s.fleets.filter((f:any)=>f.type&&f.type!=='military')};break;
 case 'get_ship_designs':case 'get_ship_design_catalog':case 'get_buildable_ships':result={designs:s.designs,components:s.components,ship_sizes:['corvette'],starbases:[{id:0,system_id:0}],ships:s.designs};break;
 case 'get_component_details':result=byKey(s.components,a.key,'组件');break;
 case 'get_market':result=s.market;break;
 case 'get_discoveries':result={relics:s.relics,sites:s.sites};break;
 case 'get_contacts':result={contacts:s.contacts};break;
 case 'get_sectors':result={sectors:[{id:0,name:'核心星区',planets:s.planets}]};break;
 case 'get_armies':result={armies:s.planets.flatMap((p:any)=>p.armies)};break;
 case 'get_available_district_zones':result={districts:p().districts,available_zones:[{district_id:0,slot:0,key:'zone_industrial'}]};break;
 case 'get_buildable_districts':result={districts:p().available_districts};break;
 case 'get_clearable_blockers':result={blockers:p().blockers};break;
 case 'get_planetary_decisions':result={decisions:p().decisions};break;
 case 'get_terraforming_options':result={options:p().terraform_options};break;
 case 'get_planetary_features':result={features:p().blockers};break;
 case 'get_planet_jobs':result={jobs:p().jobs};break;
 case 'get_planet_armies':result={armies:p().armies,settings:p().army_settings,recruitable:[{key:'assault_army',cost:{minerals:100}}]};break;
 case 'list_saves':result={saves:s.saves.map((x:any)=>({campaign:x.campaign,file:x.file,date:x.date}))};break;
 case 'list_empire_designs':result={designs:s.empireDesigns};break;
 case 'get_empire_design':case 'get_empire_design_text':result=byKey(s.empireDesigns,a.key,'帝国设计');break;
 case 'get_new_game_options':result={settings:s.galaxySettings,empires:s.empireDesigns};break;
 default:throw new Error(`模拟读取处理器缺失：${name}`);
 }
 return {...structuredClone(result),available_actions:actions(),source:'mock'};
}

export function extendedWrite(s:Json,name:string,a:Json):Json {
 extendWorld(s);const n=bare(name);const cost=mockCost(s,name,a);const p=()=>find(s.planets,a.planet_id,'星球');const f=()=>find(s.fleets,a.fleet_id,'舰队');
 // Resource checks occur before mutations. The caller operates on a private copy and saves only success.
 for(const [k,v]of Object.entries(cost))if(Number(v)>0&&Number(s.resources[k]?.stockpile??0)<Number(v))throw new Error(`资源不足：${k}`);
 let days=0;let details:Json={};
 switch(n){
 case 'resolve_event':{const event=s.events.find((e:any)=>e.window_id===a.window_id);s.event_resolutions??=[];s.event_resolutions.push({window_id:a.window_id,option_index:a.option_index,title:event?.title,day:s.day});s.events=s.events.filter((e:any)=>e.window_id!==a.window_id);break;}
 case 'open_notification':{const x=s.notifications.find((x:any)=>x.index===a.index);if(!x)throw new Error('通知不存在');x.opened=true;break;}
 case 'open_alert':{const x=s.alerts.find((x:any)=>x.alert_id===a.alert_id);if(!x)throw new Error('预警不存在');x.opened=true;break;}
 case 'cancel_research':{const area=typeof a.area==='number'?['physics','society','engineering'][a.area]:a.area;if(!s.research[area])throw new Error('科研领域不存在');s.research[area].current=null;break;}
 case 'move_fleet':{find(s.systems,a.system_id,'星系');const route=mockPath(s,a.fleet_id,a.system_id);if(!route.reachable)throw new Error('路线不可达');if(!a.queue)cancelBattleOrders(s,a.fleet_id);days=Math.max(1,route.travel_days);break;}
 case 'cancel_fleet_orders':for(const id of a.fleet_ids)cancelBattleOrders(s,id);break;
 case 'follow_fleet':{const target=find([...s.fleets,...s.enemy_fleets].filter((f:any)=>f.visible!==false&&!f.destroyed),a.target_fleet_id,'可见目标舰队');if(!mockPath(s,a.fleet_id,target.system_id).reachable)throw new Error('无法跟随：路线不可达');if(!a.queue)cancelBattleOrders(s,a.fleet_id);f().following=target.id;f().attack=a.attack??false;days=15;break;}
 case 'set_fleet_stance':f().stance=a.stance;break;
 case 'fleet_mia':for(const id of a.fleet_ids){const x=find(s.fleets,id,'舰队');cancelBattleOrders(s,id);x.mia_type=a.type??'return_home';x.mia=true;x.system_id=null;x.in_combat=false;}days=30;break;
 case 'land_armies':{const planet=find([...s.planets,...s.foreignPlanets],a.planet_id,'星球');if(f().type!=='army'||f().system_id!==planet.system_id)throw new Error('需要已抵达目标的运输舰队');if(s.enemy_fleets.some((x:any)=>x.visible&&!x.destroyed&&x.system_id===planet.system_id))throw new Error('登陆区域存在敌舰');cancelBattleOrders(s,a.fleet_id);days=30;break;}
 case 'orbit_planet':find([...s.planets,...s.foreignPlanets],a.planet_id,'星球');cancelBattleOrders(s,a.fleet_id);f().orbiting=a.planet_id;days=1;break;
 case 'collect_data':if(f().type!=='science')throw new Error('需要科研船');f().collected_data=a.project_id??a.system_id??0;break;
 case 'research_anomalies':if(f().type!=='science')throw new Error('需要科研船');if(!find(s.systems,a.system_id,'星系').anomaly)throw new Error('没有待研究异常');days=60;break;
 case 'excavate_site':if(f().type!=='science')throw new Error('需要科研船');find(s.sites,a.site_id,'遗迹');days=60;break;
 case 'use_bypass':f();if(!s.systems.some((x:any)=>x.bypass_id===a.bypass_id))throw new Error('旁路不存在');find(s.systems,a.to_system_id,'星系');f().system_id=a.to_system_id;break;
 case 'explore_bypass':f();{const x=s.systems.find((x:any)=>x.bypass_id===a.bypass_id);if(!x)throw new Error('旁路不存在');x.bypass_explored=true;}break;
 case 'claim_system':if(a.remove)s.claims=s.claims.filter((x:any)=>x.system_id!==a.system_id);else s.claims.push({system_id:a.system_id,count:a.count??1});break;
 case 'build_outpost':case 'upgrade_megastructure':case 'build_megastructure':case 'colonize':days=90;break;
 case 'survey':if(f().type!=='science')throw new Error('需要科研船');find(s.systems,a.system_id??1,'星系');days=60;break;
 case 'set_situation_approach':{const x=s.situations.find((x:any)=>a.situation_id===undefined||x.id===a.situation_id);if(!x?.approaches.includes(a.approach_key))throw new Error('局势应对方式不可用');x.approach=a.approach_key;break;}
 case 'set_council_agenda':byKey(s.government.available_agendas,a.agenda_key,'议程');s.government.agenda=a.agenda_key;break;
 case 'launch_council_agenda':if(!s.government.agenda||!s.government.agendaReady)throw new Error('没有就绪议程');s.government.launched_agendas??=[];s.government.launched_agendas.push(s.government.agenda);s.government.agendaReady=false;break;
 case 'change_civics':s.government.civics=[...new Set([...s.government.civics.filter((x:string)=>!(a.remove??[]).includes(x)),...(a.add??[])])];break;
 case 'select_leader_trait':{const l=find(s.leaders,a.leader_id,'领袖');if(!l.available_traits.includes(a.trait_key))throw new Error('特质不可用');l.traits.push(a.trait_key);l.available_traits=l.available_traits.filter((x:string)=>x!==a.trait_key);break;}
 case 'hire_leader':{const l=find(s.leader_candidates,a.candidate_id,'领袖候选');s.leaders.push({...l,traits:[],available_traits:[]});s.leader_candidates=s.leader_candidates.filter((x:any)=>x.id!==l.id);break;}
 case 'dismiss_leader':find(s.leaders,a.leader_id,'领袖');s.leaders=s.leaders.filter((x:any)=>x.id!==a.leader_id);break;
 case 'assign_leader':{if(a.assignment_type===1)find(s.planets,a.target_id,'星球');else if(a.assignment_type===2)find(s.fleets,a.target_id,'舰队');else if(![3,6].includes(a.assignment_type))throw new Error('无效任命类型');find(s.leaders,a.leader_id,'领袖').assignment={type:a.assignment_type,target_id:a.target_id};break;}
 case 'adopt_tradition':s.traditions.adopted.push(a.tradition_key);s.traditions.available=s.traditions.available.filter((x:any)=>x.key!==a.tradition_key);break;
 case 'toggle_edict':byKey(s.edicts,a.edict_key,'法令').enabled=a.enabled;break;
 case 'set_species_rights':find(s.species,a.species_id,'物种').rights[a.category]=a.right_value;break;
 case 'create_species_template':{const base=find(s.species,a.base_species_id,'基础物种');const id=Math.max(...s.species.map((x:any)=>x.id))+1;s.species.push({...structuredClone(base),id,template:true,base_species_id:base.id,traits:a.traits});details={species_id:id};break;}
 case 'modify_species_template':{const x=find(s.species,a.template_species_id,'模板');if(!x.template)throw new Error('只能修改模板');x.traits=a.traits;break;}
 case 'delete_species_template':{const x=find(s.species,a.species_id,'模板');if(!x.template)throw new Error('不能删除基础物种');s.species=s.species.filter((x:any)=>x.id!==a.species_id);break;}
 case 'apply_species_template':{const x=find(s.species,a.template_species_id,'模板');if(!x.template)throw new Error('需要有效模板');find(s.species,x.base_species_id,'基础物种').applied_template=x.id;break;}
 case 'set_fleet_template_quota':find(s.designs,a.design_id,'舰船设计');f().template??={};f().template[a.design_id]=a.target_quota;break;
 case 'create_ship_design':{if(a.ship_size!=='corvette')throw new Error('当前只解锁护卫舰船体');if(s.designs.some((x:any)=>x.name===a.name))throw new Error('设计名称已存在');const id=Math.max(0,...s.designs.map((x:any)=>x.id))+1;s.designs.push({id,name:a.name,ship_size:a.ship_size,slots:a.slots??[],core_components:a.core_components??[],cost:{alloys:100}});details={design_id:id};break;}
 case 'update_ship_design':Object.assign(find(s.designs,a.design_id,'舰船设计'),Object.fromEntries(Object.entries(a).filter(([k])=>k!=='design_id')));break;
 case 'delete_ship_design':find(s.designs,a.design_id,'舰船设计');s.designs=s.designs.filter((x:any)=>x.id!==a.design_id);break;
 case 'upgrade_fleet':case 'build_ship':case 'recruit_planet_army':days=60;break;
 case 'market_trade':if(a.action==='buy')s.resources[a.resource].stockpile+=a.units??1;else s.resources.energy.stockpile+=(a.units??1)*s.market.prices[a.resource]*0.7;break;
 case 'set_monthly_trade':if(a.cancel){if(!s.market.monthly_trades.some((x:any)=>x.id===a.order_id))throw new Error('每月交易不存在');s.market.monthly_trades=s.market.monthly_trades.filter((x:any)=>x.id!==a.order_id);}else {const order:Json={id:Math.max(0,...s.market.monthly_trades.map((x:any)=>x.id))+1,...a};order.prepaid_months=1;order.remaining_runs=1;s.market.monthly_trades.push(order);details={order_id:order.id};}break;
 case 'activate_relic':byKey(s.relics,a.relic_key,'遗珍').active=true;break;
 case 'set_district_zone':{const d=p().districts.find((d:any)=>d.id===a.district_id);if(!d)throw new Error('区划实例不存在');d.zones??={};d.zones[a.slot]=a.zone_key;break;}
 case 'cancel_construction':{let matched=false;for(const planet of s.planets){const q=planet.queue.find((x:any)=>x.id===a.item_id);if(q){planet.queue=planet.queue.filter((x:any)=>x.id!==a.item_id);matched=true;}}const op=s.operationLog.find((x:any)=>x.order_id===a.item_id&&!x.completed&&!x.cancelled);if(op){op.cancelled=true;matched=true;}if(!matched)throw new Error('建设订单不存在');break;}
 case 'build_district':case 'upgrade_building':case 'clear_blocker':days=30;break;
 case 'demolish_district':{const i=p().districts.findIndex((d:any)=>d.key===a.district_key);p().districts.splice(i,1);const resource=({district_generator:'energy',district_mining:'minerals',district_farming:'food'} as Json)[a.district_key];if(resource)s.resources[resource].net-=10;break;}
 case 'enact_planetary_decision':p().enacted_decisions??=[];p().enacted_decisions.push(a.decision_key);break;
 case 'start_terraforming':p().terraforming={target:a.target_class??p().terraform_options.find((o:any)=>o.link_index===a.link_index)?.target_class};days=120;break;
 case 'cancel_terraforming':if(!p().terraforming)throw new Error('没有地貌改造订单');p().terraforming=null;for(const o of s.operationLog)if(o.tool==='stellaris_start_terraforming'&&o.args.planet_id===a.planet_id&&!o.completed)o.cancelled=true;break;
 case 'ascend_colony':p().ascension_tier++;break;
 case 'set_job_priority':byKey(p().jobs,a.job_key,'岗位').priority=!byKey(p().jobs,a.job_key,'岗位').priority;break;
 case 'set_job_workforce_limit':if(a.limit< -1)throw new Error('劳动力上限无效');byKey(p().jobs,a.job_key,'岗位').limit=a.limit;break;
 case 'set_planet_army_settings':Object.assign(p().army_settings,Object.fromEntries(Object.entries(a).filter(([k])=>k!=='planet_id')));break;
 case 'embark_all_armies':p().embarked_armies=p().armies;p().armies=[];break;
 case 'disband_planet_army':find(p().armies,a.army_id,'陆军');p().armies=p().armies.filter((x:any)=>x.id!==a.army_id);break;
 case 'save_game':{const file=a.name??s.date;const old=s.saves.find((x:any)=>x.file===file);if(old&&!a.overwrite)throw new Error('存档已存在');s.saves=s.saves.filter((x:any)=>x.file!==file);s.saves.push({campaign:'mock',file,date:s.date,world:structuredClone({...s,saves:[]})});break;}
 case 'load_game':{const save=s.saves.find((x:any)=>(!a.file||x.file===String(a.file).replace(/\.sav$/,''))&&(!a.campaign||x.campaign===a.campaign));if(!save)throw new Error('存档不存在');const saves=s.saves;Object.assign(s,structuredClone(save.world));s.saves=saves;s.timeline_id=uid('mock-timeline');break;}
 case 'exit_to_main_menu':s.in_game=false;s.paused=true;break;
 case 'save_empire_design':{const base=s.empireDesigns.find((x:any)=>x.key===(a.base??a.key));if(a.key==='mock_empire')throw new Error('预设帝国不可覆盖');const old=s.empireDesigns.find((x:any)=>x.key===a.key);if(old&&!a.overwrite&&!a.base)throw new Error('帝国设计已存在');const design={...base,key:a.key,...a.changes,...(a.text?{text:a.text}:{})};if(!a.validate_only){s.empireDesigns=s.empireDesigns.filter((x:any)=>x.key!==a.key);s.empireDesigns.push(design);}break;}
 case 'delete_empire_design':if(a.key==='mock_empire')throw new Error('预设帝国不可删除');byKey(s.empireDesigns,a.key,'帝国设计');s.empireDesigns=s.empireDesigns.filter((x:any)=>x.key!==a.key);break;
 case 'set_galaxy_settings':Object.assign(s.galaxySettings,a.settings);break;
 case 'new_game':{const empire=typeof a.empire==='string'?byKey(s.empireDesigns,a.empire,'帝国设计'):s.empireDesigns[0];s.empire_name=empire.name;s.session_id=uid('mock-session');s.timeline_id=uid('mock-timeline');s.day=0;s.date='2200.01.01';s.in_game=true;s.paused=true;s.new_game_settings={...s.galaxySettings,...a.galaxy};break;}
 case 'run_until':{let daysToRun=a.days;if(a.until_date){const d=String(a.until_date).split('.').map(Number);daysToRun=(d[0]-2200)*360+(d[1]-1)*30+d[2]-1-s.day;}if(!Number.isInteger(daysToRun)||daysToRun<1||daysToRun>36000)throw new Error('推进天数无效');s.run_requested_days=daysToRun;break;}
 default:throw new Error(`模拟写入处理器缺失：${name}`);
 }
 // Monthly orders reserve the first month's cost in EXEC, but are charged by the simulation each month.
 for(const [k,v]of Object.entries(cost))if(Number(v)>0)s.resources[k].stockpile-=Number(v);
 const battle=['move_fleet','follow_fleet','fleet_mia','land_armies','orbit_planet'].includes(n);const operation={battle,id:uid('operation'),order_id:days?++s.nextOrderId:undefined,tool:name,args:structuredClone(a),cost,started_day:s.day,remaining_days:days,completed:days===0,cancelled:false,details};s.operationLog.push(operation);
 if(days){for(const x of s.fleets.filter((x:any)=>x.id===a.fleet_id||a.fleet_ids?.includes(x.id))){x.orders??=[];x.orders.push({id:operation.id,tool:name,args:a,remaining_days:days});}}
 return {accepted:true,operation_id:operation.id,cost,completed:operation.completed,...details};
}

export function advanceExtended(s:Json,days:number){
 extendWorld(s);
 for(const o of s.operationLog){if(o.completed||o.cancelled||o.battle)continue;if(o.external){const a=o.args;if(o.tool==='stellaris_select_research'){const area=typeof a.area==='number'?['physics','society','engineering'][a.area]:a.area;o.completed=!!s.research[area]?.completed?.includes(a.tech_key);}else{o.completed=s.completedOrders.some((q:any)=>q.id===o.order_id);}continue;}o.remaining_days-=days;if(o.remaining_days>0)continue;const a=o.args,n=bare(o.tool);const p=()=>find(s.planets,a.planet_id,'星球');const f=()=>find(s.fleets,a.fleet_id,'舰队');
 switch(n){
 case 'move_fleet':f().system_id=a.system_id;break;
 case 'survey':find(s.systems,a.system_id??1,'星系').surveyed=true;break;
 case 'research_anomalies':find(s.systems,a.system_id,'星系').anomaly=false;break;
 case 'excavate_site':find(s.sites,a.site_id,'遗迹').excavated=true;break;
 case 'build_outpost':find(s.systems,a.system_id,'星系').owner=0;break;
 case 'build_megastructure':s.megastructures.push({id:Math.max(...s.megastructures.map((x:any)=>x.id))+1,name:a.type,level:1,cost:{alloys:200}});break;
 case 'upgrade_megastructure':find(s.megastructures,a.megastructure_id,'巨构').level++;break;
 case 'colonize':{const target=find(s.colonizable,a.planet_id,'殖民目标');target.colonized=true;s.planets.push({id:target.id,name:target.name,queue:[],buildings:[],buildableBuildings:structuredClone(s.planets[0].buildableBuildings)});break;}
 case 'build_district':p().districts.push({id:Math.max(-1,...p().districts.map((x:any)=>x.id))+1,key:a.district_key,zones:{}});{const resource=({district_generator:'energy',district_mining:'minerals',district_farming:'food'} as Json)[a.district_key];if(resource)s.resources[resource].net+=10;}break;
 case 'upgrade_building':{const i=p().buildings.findIndex((b:any,i:number)=>(b.id??i)===a.building_id);if(i>=0)p().buildings[i]={id:a.building_id,key:a.upgrade_to_key??`${typeof p().buildings[i]==='string'?p().buildings[i]:p().buildings[i].key}_upgraded`};break;}
 case 'clear_blocker':p().blockers=p().blockers.filter((x:any)=>x.id!==a.deposit_id&&x.key!==a.deposit_key);break;
 case 'start_terraforming':p().class=p().terraforming?.target;p().terraforming=null;break;
 case 'upgrade_fleet':f().power+=100;f().upgraded=true;break;
 case 'build_ship':{const target=s.fleets.find((x:any)=>!x.type||x.type==='military');target.power+=100*(a.count??1);target.ships??=[];target.ships.push({design_id:a.design_id,count:a.count??1});break;}
 case 'recruit_planet_army':p().armies.push({id:Math.max(0,...p().armies.map((x:any)=>x.id))+1,key:a.army_key});break;
 }
 o.completed=true;for(const fleet of s.fleets)if(fleet.orders)fleet.orders=fleet.orders.filter((x:any)=>x.id!==o.id);
 }
 advanceBattlefield(s,days);
 // Execute monthly trade orders only for elapsed full game months; insufficient stock waits without debt.
 const months=Math.floor(s.day/30)-Math.floor((s.day-days)/30);
 for(let month=0;month<months;month++)for(const o of s.market.monthly_trades){if(o.remaining_runs<=0){o.status='awaiting_authorization';continue;}if(o.prepaid_months){o.prepaid_months--;o.remaining_runs--;if(o.action==='sell')s.resources.energy.stockpile+=o.amount*s.market.prices[o.resource]*0.7;else s.resources[o.resource].stockpile+=o.amount;continue;}const price=s.market.prices[o.resource];if(!price||o.price_limit>0&&(o.action==='sell'?price<o.price_limit:price>o.price_limit))continue;const from=o.action==='sell'?o.resource:'energy',quantity=o.action==='sell'?o.amount:o.amount*price;if((s.resources[from]?.stockpile??0)<quantity){o.status='blocked';continue;}s.resources[from].stockpile-=quantity;const to=o.action==='sell'?'energy':o.resource;s.resources[to].stockpile+=o.action==='sell'?o.amount*price*0.7:o.amount;o.remaining_runs--;o.status='executed';}
 extendWorld(s);
}
