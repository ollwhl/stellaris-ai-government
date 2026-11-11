# 集成决定
- 用户已授权按五角色并行开发，旧项目不再复用。
- Windows 本地单体应用，Node.js 24 LTS + TypeScript + React + SQLite。云端开发，默认全部mock。
- 游戏桥接作为既有依赖，复验不构成开发门槛。真实连接入口按stdio，mock支持相同工具schema。
- 游戏依赖锁定 0af3b09d63fc124209c30a03ee1010f2f481bbcd；Teacher daf3067081cfaa67c6ee4bafc24b576ec03bcdad。离线注册抽取123工具schema，未调用任何游戏handler。README工具数量不作目录真值。
- 模型配置默认显式mock；改成OpenAI兼容服务后不静默降级。URL、模型、密钥、超时、长度、并发及各角色映射均可调。
- 所有写入经EXEC。WEB权限即时更新，暂停与继续及调速分开。未知副作用工具只允许明确调试授权。
- 会议信息为实际角色消息、结构化报告和公开依据；不记录隐藏思维链。每轮固定snapshot，各角色保存实际输入、公开输出及错误。调试开关控制展示，不停止记录。
- 业务状态本地SQLite持久化。Wiki正文与导入状态本地存储，空库和sample显式标注。
- 先完成实现再集中mock端到端测试。未进行实机、联机和真实DeepSeek服务测试。

## 扩展工具与可配置称呼（2026-11-11）

COORD 统一扩展根 contracts/index.ts：AppConfig.roleNames 为稳定角色 ID 的显示名称映射；Permissions.domains 为新增领域授权。既有字段与默认职责保持兼容。工具领域由 integrations/game_mcp/registry.ts 显式登记；通用项目使用现有 generic kind 和受校验 scope，不增加运行角色或绕过 EXEC。具体行为和真实模式边界见 docs/AUTOMATION.md。

COORD 增加可选 Permissions.aiEnabled（旧记录读取默认 true）及 ModelService.shutdown。AI 总开关按权限持久化；政府、行政、模型层分别守卫，模型取消使用 AbortController 与代次，不改写原有单项授权。新部署时本机总开关置为关闭，用户明确打开后恢复。

## 各角色双时钟调度（2026-11-11）

COORD 在根 contracts/index.ts 增加 WakeSchedule（mode=real/game，interval 分别为现实秒／游戏天）及可选 AppConfig.wakeSchedules。新战略增加可选游戏日期有效期，旧契约默认兼容。后台唤醒按角色合并，玩家命令和权限变更立即响应；行政新决策与只读观察分别调度，持久计时在 modules/control/wake-clock.ts。

## 事件自治（2026-11-11）

COORD 增加 GameIncident/IncidentDecision/IncidentInput、可选 AdminService.attentionTick/incidents、GovService.adjudicateIncident 及 CallRecord/call options.eventId。EXEC 单写事件队列及执行资格，GOV 单写最高角色实际裁决报告，不由 EXEC 伪造总统发言或写政府项目。独立事件循环绕过普通周期但保留总开关、角色暂停及原授权；事件支出仍走 Ledger 和同一 MCP 写入入口。

### 战场与舰队执行契约
- 根 contracts 扩展 BattlefieldState/FleetMission/FleetCommand、fleet 项目、独立进攻/紧急撤退授权，以及 EXEC/GOV 服务入口。COORD 在本轮统一实施公共契约和模块衔接。
- INTEL 读取/归一化与事件检测；GOV 只发布任务意图；EXEC 维护舰队占用、阶段决策、预算和命令；Web 不直接写游戏。玩家任务不因周期军事会议而被覆盖。
- 不能从外舰可见性推断敌对，不能从失联推断击败。未知成本不可视为免费；未知写结果不重发，完整保留观察与恢复证据。
- 玩家继续负责网页与业务测试，云端不跑浏览器自动测试，不以桥接验收为上线前置。
