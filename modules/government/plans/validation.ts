import {fleetScopeSchema} from '../../control/fleet-policy.js';
import {capabilities} from '../../../integrations/game_mcp/registry.js';
import { z } from 'zod';
import type { Json, Role } from '../../../contracts/index.ts';

export const proposalSchema = z.object({
  kind: z.enum(['research', 'construction', 'defense', 'generic','fleet']),
  title: z.string().min(1).max(180),
  goal: z.string().min(1).max(2000),
  scope: z.record(z.any()).default({}),
  budget: z.record(z.number().finite().nonnegative()).default({}),
  priority: z.number().int().min(1).max(100).default(50),
  completion: z.string().min(1).max(1000),
  termination: z.string().min(1).max(1000),
}).superRefine((p,ctx)=>{if(p.kind==='fleet'){const result=fleetScopeSchema.safeParse(p.scope);if(!result.success)for(const issue of result.error.issues)ctx.addIssue({code:z.ZodIssueCode.custom,message:issue.message,path:['scope',...issue.path]});return;}if(p.kind!=='generic')return;const s=p.scope;if(typeof s.domain!=='string'||!Array.isArray(s.allowedTools)||!s.allowedTools.length||s.allowedTools.some((n:any)=>typeof n!=='string'||!capabilities[n]||capabilities[n].domain!==s.domain))ctx.addIssue({code:z.ZodIssueCode.custom,message:'generic scope 必须指定同一已登记领域 domain 和 allowedTools'});if(s.maxActions!==undefined&&(!Number.isInteger(s.maxActions)||s.maxActions<1||s.maxActions>12))ctx.addIssue({code:z.ZodIssueCode.custom,message:'maxActions 必须为1至12'});});
export const reportSchema = z.object({
  title: z.string().min(1).max(180),
  summary: z.string().min(1).max(5000),
  recommendations: z.array(z.string().max(2000)).max(20).default([]),
  rationale: z.string().max(3000),
  requests: z.array(z.string().max(1500)).max(15).default([]),
  priorities: z.array(z.string().max(500)).max(12).default([]),
  constraints: z.record(z.any()).default({}),
  budgets: z.record(z.number().finite().nonnegative()).default({}),
  contingencies: z.array(z.string().max(1500)).max(12).default([]),
  proposals: z.array(proposalSchema).max(10).default([]),
});
export type RoleReport = z.infer<typeof reportSchema>;
export type Proposal = z.infer<typeof proposalSchema>;
export function validateRoleReport(value: unknown, role: Role): RoleReport {
  const result = reportSchema.safeParse(value);
  if (!result.success) throw new Error(`${role} 报告结构无效：${result.error.issues.map(x => `${x.path.join('.')}: ${x.message}`).join('; ')}`);
  return result.data;
}
export const outputGuide: Json = {
  title: '报告标题', summary: '公开的结论与建议摘要，不是内部思维链', recommendations: ['具体建议'], rationale: '简短依据与实际观测',
  requests: ['需要其他部门或总统协调的事项'], priorities: ['优先级'], constraints: {}, budgets: {}, contingencies: [],
  fleetScopeExample:{mission:'defend',fleetIds:[0],targetSystemId:0,homeSystemId:0,minimumAdvantage:1.2,retreatHull:0.4,retreatLoss:0.3,allowEmergencyFtl:false,requireRepair:false},
  genericScopeExample:{domain:'market',allowedTools:['stellaris_get_market','stellaris_market_trade'],maxActions:3},
  proposals: [{ kind: 'research|construction|defense|generic|fleet', title: '项目名', goal: '目标', scope: {}, budget: {}, priority: 70, completion: '可观察完成条件', termination: '终止条件' }],
};
