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
