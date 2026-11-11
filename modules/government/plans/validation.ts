import { z } from 'zod';
import type { Json, Role } from '../../../contracts/index.ts';

export const proposalSchema = z.object({
  kind: z.enum(['research', 'construction', 'defense', 'generic']),
  title: z.string().min(1).max(180),
  goal: z.string().min(1).max(2000),
  scope: z.record(z.any()).default({}),
  budget: z.record(z.number().finite().nonnegative()).default({}),
  priority: z.number().int().min(1).max(100).default(50),
  completion: z.string().min(1).max(1000),
  termination: z.string().min(1).max(1000),
});
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
  proposals: [{ kind: 'research|construction|defense|generic', title: '项目名', goal: '目标', scope: {}, budget: {}, priority: 70, completion: '可观察完成条件', termination: '终止条件' }],
};
