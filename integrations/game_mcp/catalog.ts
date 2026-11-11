import {readFileSync} from 'node:fs';
import type {ToolDefinition} from '../../contracts/index.js';
import {capabilities} from './registry.js';

const extracted=JSON.parse(readFileSync(new URL('../../contracts/game-tools.json',import.meta.url),'utf8')) as {tools:ToolDefinition[]};
export const mockTools:ToolDefinition[]=extracted.tools.map(tool=>{
 const capability=capabilities[tool.name];
 if(!capability)throw new Error(`工具分类缺失：${tool.name}`);
 return {...tool,...capability,supported:true};
});
// New tools discovered from an upstream version do not inherit write authority by name.
export function classify(name:string):Pick<ToolDefinition,'effect'|'domain'|'supported'>{
 const capability=capabilities[name];
 return capability?{...capability,supported:true}:{effect:'unknown',domain:'unclassified',supported:false};
}
