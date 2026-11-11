# 群星 AI 政府

**VPS 接手请先读 [HANDOFF.md](HANDOFF.md)。**

一个在 Windows 本地运行的外部 AI 政府控制台。玩家通过电脑或手机聊天下令，总统、经济部、军事部和发展参谋规划，行政部门通过 MCP 执行。默认是 **mock 游戏 + mock 模型**，首次启动无需游戏或模型密钥；仓库已包含首批四篇真实 Wiki 知识。

## Windows 启动

安装 **Node.js 24 LTS（含 npm）**，解压后双击 `install.cmd` 安装依赖并构建，再双击 `start.cmd`。浏览器访问 http://localhost:4317 。首次启动默认为仅建议模式；在聊天右上角「权限」选择部分接管并开启需要的领域。

同一局域网手机访问 `http://电脑局域网IP:4317`，输入服务端窗口显示的六位配对码。Windows 防火墙如提示，请只允许自己使用的网络。配对码每次启动更新，已配对设备会话有效30天。关闭服务端终端即可停止应用。

开发命令：

```sh
npm ci
npm run build
npm start
```

未构建时 `npm run dev` 也能提供 Vite 开发界面。数据保存在 `runtime/`；升级请保留此目录。`HOST` / `PORT` 可改变监听配置。

## 第一条操作路径

1. 在指挥中心发送「优先科研，维持经济底线，保留边境防御能力」。
2. 在会议档案查看总统方向、各部门意见、发展路线与总统裁决。展开「决策时全局报告」和「角色实际输入」，查看那一轮使用的状态。
3. 在聊天界面打开权限，选择部分接管，开启科研、建设和军事，设置资源预算。权限调整后政府会重新评估。
4. 到状态与任务查看行政操作、等待条件、资源预留和调用结果。通过模拟推进时间观察科研与建设完成。
5. 随时停止 AI 新提交或人工接管对象。停止不会宣称游戏内已提交订单被取消。
6. 工具调试页可浏览123个从依赖源码抽取的真实工具schema；mock只模拟标为支持的业务，其他工具不会假装成功。实际MCP模式动态获取工具目录。

## 接入 DeepSeek / 其他 OpenAI 兼容服务

在「模型与知识」修改模型配置：Base URL（如 `https://api.deepseek.com/v1`）、模型（如 `deepseek-chat`）、API Key、超时、输出长度、并发。关闭该配置的 mock 开关，并把角色映射到此配置。Base URL 也可直接填写完整 `/chat/completions` 端点。密钥留空输入通常表示不更改；清除已有密钥需明确提交空字符串。

规划和行政分开调度与排队；提供商若限制总并发，可为行政配置独立模型端点。API错误会显示为失败，不会自动以mock伪装成功。服务端仅保存调用用量与状态，不向浏览器返回密钥。

## 接入实际游戏 MCP

项目已包含 `vendor/stellaris-mcp` 源码及许可证，不自动注入或启动游戏。先按该依赖自身说明在 Windows 安装其游戏插件。模型与知识页面配置游戏 MCP 的 command / args / env，指向已安装的服务端 `dist/index.js`；选择实际MCP模式。也可用 `install-game-mcp.cmd` 单独安装并编译随包的 TypeScript MCP 服务端，它不构建或安装游戏 DLL。

改变游戏连接配置会停止 AI 新提交。刷新实际状态、确认当前会话后，再自行恢复权限。真实工具目录来自 `tools/list`，通过同一调用入口运行。游戏画面核对与桥接修复没有作为此版开发前置条件。

## 知识库

Teacher MCP 源码在 `vendor/mcp-stellaris`。上游仓库不带 Wiki 正文，本私有项目已将灌好的四篇正文、索引和来源版本信息保存到 `data/knowledge-seed/`。普通首次启动发现知识库为空时，会自动校验并恢复至配置的知识目录（默认 `runtime/knowledge`），已有知识库不覆盖。也可运行 `npm run knowledge:restore` 手动恢复。数据包说明见 `data/knowledge-seed/README.md`。

首批资料涵盖 Technology、Resources、Buildings、Districts，版本标注 4.5。Research、Economy 两个入口重定向到已保存页面，所以六个标题对应四篇独立正文。样例资料仍明确标注 sample，仅在检索不到真实资料时用于 mock。更多页面可在界面继续导入，过程不消耗模型 token；网络挑战或错误 HTML 不入库。未知修订号保存为 null 和原因。

## 状态、调试与恢复

- 聊天内调整模式、领域、预算、暂停/继续/调速、部门暂停和对象人工接管。
- 每轮会议保存实际发言、最终报告、引用、当时全局快照以及各角色实际输入。调试模式只控制展示。
- 工具调用保存参数、原始响应、错误、后置观察、玩家标记，可按trace导出JSON。
- 战略、项目、任务、预算、未知调用、聊天及会议记录持久化。写操作超时先观察结果，不能盲重试。
- 已实现的自主执行重点覆盖科研选择、建设与舰队增援。其余目录工具可通过调试入口使用；并非每个游戏领域都有专用规划与完成观察器。
- 联机执行权和双客户端同步还需要后续实现与实机实验；此包不能宣称已完成联机闭环。

## 集中验证

```sh
npm run build
npm test
npm run test:browser
```

`npm test` 使用mock与本地兼容模型桩，不访问实际模型或游戏。浏览器检查需要可用Chromium（Linux环境默认 `/usr/bin/chromium`，可用 `CHROMIUM_PATH` 更改）。验证记录见 `integration/VALIDATION.md`。

本项目不承诺此次mock验证代表真实游戏效果，实际DeepSeek、Windows游戏及联机测试留到最后接入阶段。

## 临时公网试用部署

这是额外的预览模式，正式使用仍以本地应用为主。已有自己的 HTTPS 反向代理或隧道入口时，使用 `PUBLIC_PREVIEW=1 HOST=127.0.0.1 PORT=4319 npm start` 启动。此模式即使请求来自回环代理也强制配对，启动时生成24字符随机配对码，Cookie仅通过HTTPS发送。反向代理应保留原始Host，并支持SSE；不要直接把默认本机免配对模式通过代理暴露到公网。公网域名、证书和端口入口由实际部署环境提供，本项目不会假设Codex云端有公网IP。

普通模型请求与Teacher导入现在复用Node的 `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY`，不硬编码代理地址。

首批知识可用以下普通程序导入（无需模型密钥）：

```sh
npx tsx scripts/import-knowledge.ts Technology Research Resources Economy Buildings Districts
```

首批六个标题已导入并以四篇独立正文随本私有仓库分发，其他电脑/VPS首次启动会从 `data/knowledge-seed` 恢复。上面的命令用于重新抓取或扩充页面。额外程序导入后应重启应用刷新已有服务索引。
