# GOV 政府决策模块

入口 `createGovernment(context, administration, intel)`；不直接调用游戏，也不写授权或预算账本。

## 运行
- `submitGoal(text)` 持久化玩家消息与目标修订，立即返回 traceId；背景启动规划。
- 完整轮次为总统方向 → 经济与军事并行提交 → 发展参谋综合 → 总统最终裁决。
- 科研、军事和经济阻塞可只唤醒相关部门及发展参谋/总统；暂停的角色不会被调用或补写记录。
- `tick()` 处理 EXEC feedback、授权变化、时间线与战略到期；不等待模型，行政可独立推进。
- 反馈、战略与项目均持久化；同一目标下相同阻塞只主动调整一次，等待事实变化后再唤醒，避免模型重试循环。

## 调试证据
每轮 `Decision` 记录 snapshot 深拷贝、输入授权版本、实际参与角色、实际会议消息和最终报告。
`roleViews[role].calls[]` 保留该角色每次调用（包括总统 direction/final）的实际输入、输出、阶段、时刻与报告引用。actual input 包括全局报告、领域视图、前序部门报告、知识引用与反馈。没有调用的角色没有报告；模型失败不伪造成功记录，真实模型失败不降级 mock。

消息为角色公开报告/需求/裁决，rationale 为简短依据，均不请求或保存内部思维链。

## 发布条件
目标修订、授权版本、session/timeline、mock/real 环境和研究候选身份保持有效才可发布。进度值变化不自动废弃规划。最终提交在 store.transaction 中复核。过期结果持久化为 stale，合并一次最新规划。

GOV 只给出预算意图和业务项目。advice/停止/对应权限未开启时，项目状态 proposed；EXEC 仍须在每次真实提交前独立检查权限、可用资源与对象状态。

项目 scope：
- research: area / preferences / targetCapability / allowSwitch(false)
- construction: buildingPreference(research|energy|minerals) / planetIds / desiredCount
- defense: fleetIds / posture(defend) / visibleTargetsOnly

mock 根据不同目标、资源和反馈生成不同路线；不包含固定工具调用脚本。真实模型返回经 Zod 校验，结构不合法则该轮失败且不发布项目。

## 正常退出
`shutdown()` 关闭新轮次入口、清除排队定时器、退订事件并等待在途规划收尾。退出后不再启动新角色或发布项目；在途结果标记 stale 并保留记录。应用必须 await GOV shutdown 后再关闭 INTEL、模型服务与持久化 Store。

## 局部重评与项目重绑
科研等局部重评不会补写未参与部门的会议记录。发布新战略时，同一事务将未重评部门的活动项目重绑到当前战略，保留原目标、scope、预算及状态，递增项目 revision，让旧的待提交动作失效；已提交订单仍由 EXEC 观察。重绑前项目保存在 `project_revisions`，重绑事实保存在 `project_rebases` 并发布 `government.project.rebased` 事件。EXEC 依新战略重检权限、预算和约束。
新玩家目标完成规划后，旧目标下未被替换的活动项目全部取消，包括当轮暂停而未参与的部门。发布前旧项目保持有效。
