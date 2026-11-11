import type { AppConfig, Json, Role, Store, ModelConfig } from '../contracts/index.ts';
import { roleNames,defaultWakeSchedules,defaultBattlefieldConfig } from '../contracts/index.ts';
import { resolve } from 'node:path';
import { z } from 'zod';
const modelSchema=z.object({id:z.string().min(1),label:z.string(),baseUrl:z.string().url(),model:z.string().min(1),apiKey:z.string(),timeoutMs:z.number().int().min(1000).max(600000),maxTokens:z.number().int().min(128).max(131072),concurrency:z.number().int().min(1).max(16),mock:z.boolean()});
const mcpSchema=z.object({command:z.string(),args:z.array(z.string()),env:z.record(z.string())});
const roles=['president','economy','military','development','administration'] as const;
const wakeSchema=z.discriminatedUnion('mode',[z.object({mode:z.literal('real'),interval:z.number().finite().min(1).max(31536000)}),z.object({mode:z.literal('game'),interval:z.number().int().min(1).max(36000)})]);
const wakeSchedulesSchema=z.object({president:wakeSchema,economy:wakeSchema,military:wakeSchema,development:wakeSchema,administration:wakeSchema});
const battlefieldSchema=z.object({scanIntervalMs:z.number().int().min(1000).max(300000),mapRefreshMs:z.number().int().min(5000).max(3600000),maxSystems:z.number().int().min(1).max(48),jumps:z.number().int().min(1).max(12),staleAfterMs:z.number().int().min(5000).max(3600000),powerLossThreshold:z.number().min(0.05).max(0.95),dangerRatio:z.number().min(0.5).max(10)});
const configSchema=z.object({battlefield:battlefieldSchema,wakeSchedules:wakeSchedulesSchema,roleNames:z.object({president:z.string().trim().min(1).max(30),economy:z.string().trim().min(1).max(30),military:z.string().trim().min(1).max(30),development:z.string().trim().min(1).max(30),administration:z.string().trim().min(1).max(30)}),host:z.string().min(1),port:z.number().int().min(1).max(65535),gameMode:z.enum(['mock','real']),models:z.array(modelSchema).min(1),roleModels:z.record(z.string()),gameMcp:mcpSchema,knowledgeMcp:mcpSchema,autoTickMs:z.number().int().min(250).max(60000),planningDelayMs:z.number().int().min(0).max(60000),pairingRequired:z.boolean()});
export function loadConfig(store:Store):AppConfig {
 const defaultModel:ModelConfig={id:'default',label:'开发模型（Mock）',baseUrl:'https://api.deepseek.com/v1',model:'deepseek-chat',apiKey:'',timeoutMs:120000,maxTokens:4096,concurrency:3,mock:true};
 const defaults:AppConfig={battlefield:defaultBattlefieldConfig(),wakeSchedules:defaultWakeSchedules(),roleNames:{...roleNames},host:process.env.HOST??'0.0.0.0',port:Number(process.env.PORT??4317),gameMode:'mock',models:[defaultModel],roleModels:Object.fromEntries(roles.map(r=>[r,'default'])),gameMcp:{command:'node',args:[resolve('vendor/stellaris-mcp/stellaris_mcp_server/dist/index.js')],env:{}},knowledgeMcp:{command:'node',args:[resolve('vendor/mcp-stellaris/server.js')],env:{STELLARIS_KB_DIR:resolve('runtime/knowledge')}},autoTickMs:2000,planningDelayMs:0,pairingRequired:true};
 const saved=store.get<AppConfig>('system','config');const config=saved?{...defaults,...saved,battlefield:{...defaultBattlefieldConfig(),...saved.battlefield},wakeSchedules:{...defaultWakeSchedules(),...saved.wakeSchedules}}:defaults;
 if(process.env.PORT)config.port=Number(process.env.PORT);if(process.env.HOST)config.host=process.env.HOST;
 return configSchema.parse(config) as AppConfig;
}
export function publicConfig(config:AppConfig):Json {
 const copy=structuredClone(config) as any;
 copy.models=copy.models.map((m:ModelConfig)=>{const {apiKey,...safe}=m;return {...safe,hasApiKey:!!apiKey};});
 // Command environment may contain credentials. Expose names, never their values.
 for(const field of ['gameMcp','knowledgeMcp']){copy[field].envKeys=Object.keys(copy[field].env);copy[field].env={};}
 return copy;
}
export function patchConfig(config:AppConfig,patch:Json,store:Store){
 const candidate={...structuredClone(config),...patch,battlefield:{...defaultBattlefieldConfig(),...config.battlefield,...patch.battlefield},wakeSchedules:{...defaultWakeSchedules(),...config.wakeSchedules,...patch.wakeSchedules},roleNames:{...roleNames,...config.roleNames,...patch.roleNames}};
 if(patch.models){candidate.models=patch.models.map((m:any)=>{const old=config.models.find(x=>x.id===m.id);const {hasApiKey,...rest}=m;return {...old,...rest,apiKey:m.apiKey===undefined?old?.apiKey??'':m.apiKey};});}
 for(const key of ['gameMcp','knowledgeMcp'] as const){if(patch[key])candidate[key]={...config[key],...patch[key],env:{...config[key].env,...patch[key].env}};}
 const parsed=configSchema.parse(candidate) as AppConfig;
 if(new Set(parsed.models.map(m=>m.id)).size!==parsed.models.length)throw new Error('模型配置 ID 不可重复');
 for(const [role,id] of Object.entries(parsed.roleModels)){if(!roles.includes(role as Role)||!parsed.models.some(m=>m.id===id))throw new Error('角色模型映射无效');}
 Object.assign(config,parsed);store.set('system','config',config);return publicConfig(config);
}
