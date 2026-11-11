# 契约 v0
唯一公共类型入口 index.ts。时间 ISO，ID 字符串，对象 ID 0 是有效 ID。状态模型未知字段显式 missing。snapshot 为决策时深拷贝，roleViews 为实际输入。所有调用经 AdminService.call。预算与权限单写入者 EXEC，项目/战略 GOV，状态/知识 INTEL。事件均有 seq 供 SSE 重连。生产模型配置与日志不向浏览器回显 apiKey。
构造函数：createAdministration(ctx: Context, getIntel:()=>IntelService): AdminService；createIntel(ctx:Context, admin:AdminService): IntelService；createGovernment(ctx:Context, admin:AdminService, intel:IntelService): GovService；createWebRouter(services:Services): express.Router。
循环调度由 COORD 调用 intel.refresh / gov.tick / admin.tick，各模块提供内部防重入。GOV.submitGoal 立即返回，后台规划，不能等待整场会议才返回。数据空间 projects / strategies / decisions / chat / tasks / calls / reservations / feedback / snapshots / knowledge，由相应 owner 写入。注意新战略发布不应废弃已接受的游戏调用跟踪。mock 模型为显式 fallback，真实模型失败不得静默降级 mock。
