import { readFileSync } from 'node:fs';
import type { ToolDefinition, Json } from '../../contracts/index.js';
const obj=(properties:Json={},required:string[]=[]):Json=>({type:'object',properties,required,additionalProperties:false});
const int={type:'integer'}, str={type:'string'};
const definitions:[string,string,Json,'read'|'write',string][]=[
 ['stellaris_get_status','获取帝国全局状态',obj(),'read','state'],
 ['stellaris_get_research_state','查询三个领域当前研究及合法候选',obj(),'read','research'],
 ['stellaris_select_research','从当前候选选择研究',{...obj({area:{anyOf:[{type:'integer',minimum:0,maximum:2},{enum:['physics','society','engineering']}]},tech_key:str},['area','tech_key'])},'write','research'],
 ['stellaris_get_outliner','查询帝国对象列表',obj(),'read','state'],
 ['stellaris_get_planet_details','查询星球详情',obj({planet_id:int},['planet_id']),'read','construction'],
 ['stellaris_get_buildable_buildings','查询当前可建建筑和实际成本',obj({planet_id:int,building_key:str,zone_id:int},['planet_id']),'read','construction'],
 ['stellaris_build_building','将建筑加入建设队列',obj({planet_id:int,building_key:str,district_type:str,slot_index:int},['planet_id','building_key']),'write','construction'],
 ['stellaris_get_fleets','查询舰队及增援缺口',obj({fleet_id:int,include_civilian:{type:'boolean'}}),'read','military'],
 ['stellaris_reinforce_fleet','增援指定舰队',obj({fleet_id:int},['fleet_id']),'write','military'],
 ['stellaris_set_paused','暂停或继续游戏',obj({paused:{type:'boolean'}},['paused']),'write','time'],
 ['stellaris_set_speed','设置游戏速度',obj({speed:{type:'integer',minimum:0,maximum:4}},['speed']),'write','time'],
 ['stellaris_get_active_events','查询当前事件',obj(),'read','state'],
 ['stellaris_get_notifications','查询通知',obj(),'read','state'],
 ['stellaris_get_alerts','查询预警',obj(),'read','state'],
];
const supportedTools:ToolDefinition[]=definitions.map(([name,description,inputSchema,effect,domain])=>({name,description,inputSchema,effect,domain,supported:true}));
const extracted=JSON.parse(readFileSync(new URL('../../contracts/game-tools.json',import.meta.url),'utf8')) as {tools:ToolDefinition[]};
export const mockTools:ToolDefinition[]=extracted.tools.map(t=>{const supported=supportedTools.find(s=>s.name===t.name);return {...t,effect:supported?.effect??'unknown',domain:supported?.domain??'unclassified',supported:!!supported};});
// Explicit effects for supported business paths. Unknown names are never inferred read-only.
export function classify(name:string):Pick<ToolDefinition,'effect'|'domain'|'supported'>{const t=mockTools.find(t=>t.name===name);return t?{effect:t.effect,domain:t.domain,supported:t.supported}:{effect:'unknown',domain:'unclassified',supported:false};}
