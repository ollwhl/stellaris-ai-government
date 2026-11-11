# 开发任务与归属

用户确认：全本地部署；OpenAI兼容接口可改URL/模型/密钥；聊天内随时调整时间权限；第一轮mock完整闭环，不将桥接复验或实机画面作为开工门槛；不复用旧项目。

| Owner | 文件 | 交付 |
|---|---|---|
| COORD | app、contracts、integration、scripts、启动文件 | 单体应用、模型协议、SQLite、事件、配对、装配与集中验证 |
| GOV | modules/government | 总统/经济/军事/发展参谋、战略项目生命周期、独立规划、会议报告与实际输入 |
| EXEC | modules/administration、modules/control、integrations/game_mcp | 动态工具、mock、行政决策、受控写入、预算权限、观察恢复 |
| INTEL | modules/state、modules/knowledge、integrations/knowledge_mcp | 事实视图、来源时间线、知识检索与无LLM导入 |
| WEB | modules/webui、index.html、vite.config.ts | 聊天控制、会议调试、工具调试、任务与状态、模型知识配置、手机布局 |

所有owner共用contracts/index.ts。公共字段先通知主协调，不依赖未承诺字段。GOV/EXEC的运行角色与开发人员区分。所有游戏写入由EXEC统一入口；状态INTEL、项目GOV、授权与预算EXEC分别单写。

## 共同场景
玩家：优先科研、维持经济底线、保留边境防御。
总统制定方向→经济/军事提出需求→发展参谋统一排序→总统裁决→发布项目→行政读取实际候选并调用MCP→观察/等待/反馈。慢规划期间行政继续，撤权和目标变更使旧结果失效。mock选择不同目标与资源生成不同方案。

## 调试模式新增要求
每轮保存总统与部门实际发言、最终报告、资料引用、当时全局报告快照和各角色完整实际输入。不是事后补写会议，不记录隐藏思维链。开关控制展示，历史持续保存。报告与项目、行政任务、工具调用按trace关联导出。

## 集中验证规则
完成实现再集中mock端到端、异常恢复和浏览器验证；必要类型与构建检查可随开发进行。真实游戏/真实DeepSeek/双客户端联机留到最后接入，不把未验证路径作为其他模块的阻塞条件。
