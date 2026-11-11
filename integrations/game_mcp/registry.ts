import type {Json,Permissions,Project,Role} from '../../contracts/index.js';
export const domainNames:Record<string,string>={state:'事件与帝国情报',research:'科研',construction:'生产建设',military:'舰队与军事',exploration:'探索与扩张',government:'政务与议程',traditions:'传统与发展',leaders:'领袖',species:'物种与权利',market:'市场交易',relics:'遗珍与发现',time:'游戏时间',session:'存档与新局'};
const groups:Record<string,{read:string;write:string}>={
 state:{read:'get_status get_active_events get_notifications get_alerts get_contacts get_outliner get_sectors get_armies',write:'resolve_event open_notification open_alert'},
 research:{read:'get_research_state',write:'select_research cancel_research'},
 exploration:{read:'get_galaxy_overview get_galaxy_map get_system find_systems find_path get_situation_log get_megastructure get_buildable_megastructures',write:'collect_data research_anomalies excavate_site use_bypass explore_bypass build_outpost upgrade_megastructure build_megastructure colonize survey set_situation_approach claim_system'},
 military:{read:'get_fleets get_military_fleets get_civilian_fleets get_ship_designs get_ship_design_catalog get_component_details get_buildable_ships get_planet_armies',write:'move_fleet cancel_fleet_orders follow_fleet set_fleet_stance fleet_mia land_armies orbit_planet reinforce_fleet set_fleet_template_quota create_ship_design update_ship_design upgrade_fleet delete_ship_design build_ship set_planet_army_settings embark_all_armies disband_planet_army recruit_planet_army'},
 government:{read:'get_government get_civics',write:'launch_council_agenda set_council_agenda change_civics'},
 traditions:{read:'get_traditions get_edicts',write:'adopt_tradition toggle_edict'},
 leaders:{read:'get_leaders',write:'select_leader_trait hire_leader dismiss_leader assign_leader'},
 species:{read:'get_species get_species_modification_info',write:'set_species_rights create_species_template modify_species_template delete_species_template apply_species_template'},
 market:{read:'get_market',write:'market_trade set_monthly_trade'},
 relics:{read:'get_discoveries',write:'activate_relic'},
 construction:{read:'get_planet_details get_available_district_zones get_buildable_districts get_buildable_buildings get_clearable_blockers get_planetary_decisions get_terraforming_options get_planetary_features get_planet_jobs',write:'set_district_zone cancel_construction build_district demolish_district build_building upgrade_building clear_blocker enact_planetary_decision start_terraforming cancel_terraforming ascend_colony set_job_priority set_job_workforce_limit'},
 time:{read:'',write:'set_paused set_speed run_until'},
 session:{read:'list_saves list_empire_designs get_empire_design get_empire_design_text get_new_game_options',write:'load_game save_game exit_to_main_menu save_empire_design delete_empire_design set_galaxy_settings new_game'},
};
export const capabilities:Record<string,{domain:string;effect:'read'|'write'}>={};
for(const [domain,g] of Object.entries(groups))for(const effect of ['read','write'] as const)for(const name of g[effect].split(' ').filter(Boolean))capabilities['stellaris_'+name]={domain,effect};
export const domainOwner=(domain:string):Role=>['construction','market'].includes(domain)?'economy':['military'].includes(domain)?'military':['research','traditions','exploration','species','relics'].includes(domain)?'development':'president';
export function domainEnabled(p:Permissions,domain:string):boolean {
 if(domain==='research')return p.research;
 if(domain==='construction')return p.construction;
 if(domain==='military')return p.military;
 if(domain==='time')return p.pause||p.resume||p.speed;
 return p.domains?.[domain]??false;
}
export const projectDomain=(p:Pick<Project,'kind'|'scope'>)=>p.kind==='research'?'research':p.kind==='construction'?'construction':p.kind==='defense'||p.kind==='fleet'?'military':String(p.scope.domain??'');
export function queryTools(domain:string):string[]{return Object.entries(capabilities).filter(([,c])=>c.domain===domain&&c.effect==='read').map(([n])=>n);}
export const extendedDomains=Object.keys(groups).filter(d=>!['research','construction','military','time'].includes(d));
export function allowedGenericTool(project:Project,name:string):boolean {const c=capabilities[name];return !!c&&c.domain===project.scope.domain&&Array.isArray(project.scope.allowedTools)&&project.scope.allowedTools.includes(name);}
export function objectRefs(args:Json):string[]{const result:string[]=[];for(const [key,prefix] of [['planet_id','planet'],['fleet_id','fleet'],['target_fleet_id','fleet'],['to_system_id','system'],['leader_id','leader'],['species_id','species'],['system_id','system']] as const)if(args[key]!==undefined)result.push(`${prefix}:${args[key]}`);for(const id of args.fleet_ids??[])result.push(`fleet:${id}`);if(args.area!==undefined)result.push(`research:${typeof args.area==='number'?['physics','society','engineering'][args.area]:args.area}`);if(args.assignment_type===1&&args.target_id!==undefined)result.push(`planet:${args.target_id}`);if(args.assignment_type===2&&args.target_id!==undefined)result.push(`fleet:${args.target_id}`);return result;}
