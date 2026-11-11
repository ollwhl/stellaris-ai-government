# 群星 AI 政府：VPS Codex 交接

交接日期：2026-11-11（Asia/Tokyo）。本文描述仓库实际状态，不代表原开发计划的全部里程碑已完成。

## 1. 先做什么

用户现在要在自己的 VPS 上接手开发和试用。先部署**mock 游戏 + 真实 OpenAI 兼容模型 + 已灌入的 Wiki 知识**，让用户通过浏览器下令、看会议和报告、调整权限、观察行政操作。

不要把连接实机、逐条验收游戏桥接或对照游戏画面作为前置条件。先让现有应用可以访问、配置和试用。真实游戏在用户后续明确安排时接入。

仓库：https://github.com/ollwhl/stellaris-ai-government （用户要求保持私有），工作分支 `main`。

建议依次阅读：`AGENTS.md` → 本文 → `README.md` → `contracts/index.ts` → `integration/VALIDATION.md`。开发规格的模块归属见 `integration/TASKS.md`，接口决定见 `integration/DECISIONS.md`。原始开发计划在 `docs/DEVELOPMENT_PLAN.md`，仅作规格参考；本交接第2节记录的后续用户要求优先，不要按旧计划重新从零派工或启动实机验收。

## 2. 用户已确认的要求

- 正式产品最终在 Windows 游戏电脑上全本地运行；这次 VPS 用于远程试用和接续开发。
- 不复用旧失败项目的平台或业务代码，不需要索要旧项目资料。
- 模型使用 OpenAI 兼容协议，实际准备接 DeepSeek；URL、模型、API Key、超时、长度、并发及角色分配均可改，不能写死。
- 游戏通过现有 Yidhar MCP 操作；不做 OCR，不依赖原版 AI 的内部行为。
- 首轮 mock 必须从玩家下令走到行政部门生成真实 schema 格式的 MCP 调用，不能只做固定科研演示。
- 政府规划和行政执行独立调度，长规划不能堵住行政；停止/撤权必须使旧待提交动作失效。
- 聊天界面内随时调整模式、领域、对象、预算、暂停/继续/调速权限，支持一次性项目批准。
- 调试模式要看每轮总统/各部门实际交流、最终报告、当时看到的全局报告，以及各角色实际输入。只记录公开消息与决策摘要，不保存隐藏思维链，不事后编造会议。
- 知识库正文也随私有 GitHub 仓库保存，换机器无需重新抓取首批内容。
- 各阶段实现完再集中测试，不把测试桥接本身变成长期主任务。必要构建/类型检查可随开发进行。

## 3. 已实现的内容

| 模块 | 实现与入口 |
|---|---|
| 应用 | `app/server.ts`：Express、生命周期、独立循环、模块装配、开发/生产界面 |
| 数据 | `app/store.ts`：Node SQLite、事务、持久化事件序号；默认 `runtime/application.sqlite` |
| 模型 | `app/models.ts`：OpenAI兼容 chat/completions、JSON输出、工具协议接口、角色容量、用量记录；mock显式fallback，真实API失败不伪装成功 |
| 政府 | `modules/government/index.ts`：总统方向→经济/军事并发→发展参谋→总统裁决；事件重评、战略/项目修订、反馈及过期处理 |
| 行政 | `modules/administration/index.ts`：候选查询、结构化动作选择、受控调用、等待、观察、异常恢复 |
| 控制 | `modules/control/ledger.ts`：授权、原子预算预留、战略底线、一次性项目批准 |
| 游戏 MCP | `integrations/game_mcp/`：stdio客户端、动态发现、离线schema、mock状态机 |
| 情报 | `modules/state/index.ts`：共享快照、来源、时间线、部门视图和变化 |
| 知识 | `modules/knowledge/index.ts`、`integrations/knowledge_mcp/`：Teacher查询、本地BM25、导入队列/重试/断点、版本/来源/哈希 |
| 知识快照 | `data/knowledge-seed/`、`app/knowledge-seed.ts`：首次空库自动恢复，已有库不覆盖 |
| Web | `modules/webui/`：中文React界面、聊天权限、会议档案、工具调试、任务预算、模型配置、知识检索和手机布局 |

开发负责人曾按 COORD/GOV/EXEC/INTEL/WEB 并行交付；这些是开发分工，不是产品运行角色。VPS上的Codex可以继续按边界修改，不需要保留原对话中的agent会话。

## 4. 实际完成范围与限制

- 自主执行的主要路径是科研选择/完成观察、建设入队/完成、舰队增援。mock包含14条有状态业务工具。
- 从固定依赖提交离线抽取到123条真实工具schema；不是计划书中预估的“三百多个”。实际连接后工具数量以 tools/list 为准。
- 未模拟的工具不会假装调用成功；当前未分类工具需要明确调试授权，不能直接作为自主路径执行。
- 规划与行政模型目前主要用 `models.json` 产出受校验的结构化报告/动作，再由程序提交。客户端有工具调用协议接口，但不是已经实现了覆盖全部工具的任意多轮 agent 系统。
- 首版验证基于显式mock模型和本机HTTP桩；**尚未接入实际DeepSeek，用户未配置模型API Key**。真实模型的提示词、schema兼容性、延迟、费用和长时间运行还需试用观察。
- 尚未连接实际Windows游戏、运行游戏DLL、做联机双客户端测试或验证所有游戏版本。不能宣称M5联机和M6全领域接管已完成。
- 模型调用次数/用量/耗时已有记录；“每游戏月费用”等实际成本结论尚无数据。

## 5. 知识库：已经灌了什么

`data/knowledge-seed/` 含真实内容，不是 smoke test 样例：

| 正文 | 来源 | 页面版本标签 |
|---|---|---|
| Technology | https://stellaris.paradoxwikis.com/Technology | 4.5 |
| Resources | https://stellaris.paradoxwikis.com/Resources | 4.5 |
| Buildings | https://stellaris.paradoxwikis.com/Buildings | 4.5 |
| Districts | https://stellaris.paradoxwikis.com/Districts | 4.5 |

导入了6个标题，其中Research→Technology、Economy→Resources，因此是**4篇独立正文，不是全Wiki机制库**。覆盖更多军事、传统等内容仍需后续扩充。

- `pages/*.json`：原始wikitext、清理后的正文、链接、标题等。
- `index.json/meta.json/queue.json`：可直接读取的Teacher知识库索引和状态。
- `metadata.json`：仅knowledge/knowledge_meta/knowledge_import三类记录，用于恢复引用版本和来源。
- `manifest.json`：页面来源、抓取时间、适用版本及每文件SHA-256。raw接口取不到修订号，显式null并保留原因，不编造修订号。

普通首次启动若知识目录没有页面，会先校验文件哈希，再恢复至配置目录（默认`runtime/knowledge`）。已有页面则跳过，不覆盖用户后续导入。`:memory:`测试不自动灌库。

也可在应用停止时手动执行：

```sh
npm run knowledge:restore
```

在“模型与知识”检索 `research technology` 应返回 `source=wiki`、适用版本4.5。没有真实结果时mock才可能给source=sample；不要混淆。

扩充资料可在UI启动导入，或：

```sh
npx tsx scripts/import-knowledge.ts Technology Research Resources Economy Buildings Districts
```

普通程序处理字节，不需要LLM。失败HTML不会入库。外部程序更新后重启应用刷新已持有的索引。`runtime/`不进Git，快照目录才是此次携带的数据。

## 6. VPS现状：尚未登录或部署

用户提供的目标主机为 `163.44.114.51`，SSH用户 `ollwhl991118`，确认SSH端口 `22`。凭据不要写进代码、文档、终端历史或GitHub提交；本文不包含密码。

云端曾尝试SSH和SFTP：

1. 原样ssh先因云端本地`/etc/ssh/ssh_config.d/20-systemd-ssh-proxy.conf`权限报错。
2. `-F /dev/null`排除本地配置后，到目标22端口返回`Connection refused`。
3. SFTP相同，均未进入密码验证。不能据此认为用户的端口或密码错误；此云端没有一般互联网TCP路由，部署未成功。
4. GitHub源码推送正常，但当前连接没有GitHub Actions Secrets管理权限；不通过明文workflow或代码存密码来绕过。

**没有对目标VPS做安装、进程终止或配置修改。**

用户说8000/8001/8002对外开放。云端HTTP探测看到8000已有SQLite Web，因此不要覆盖、关闭或改写8000上的服务。后续网页端口优先**8001**，8002备用；外部8001/8002当时返回503，不能当作Linux端口空闲的证明，接手后先用`ss -ltnp`确认监听和转发映射。不要盲目开放或重配其他既有服务。

云端容器里运行过4317本机mock服务，后来在4319启动了受保护预览；这些进程和地址不是目标VPS上的部署。不要给用户云端localhost链接。

## 7. 接手部署的建议顺序

### 7.1 先检查VPS

确认系统、CPU架构、Node版本、磁盘、8001监听情况、反向代理/端口映射，以及现有服务。先核实用户给出的8001是主机监听端口还是云平台映射入口。

### 7.2 取得代码并构建

使用用户已授权的GitHub方式访问私有仓库，不把PAT写入clone URL、脚本或日志。示意：

```sh
git clone https://github.com/ollwhl/stellaris-ai-government.git
cd stellaris-ai-government
node --version
npm ci
npm run build
npm run knowledge:restore
```

使用当前Node.js 24 LTS（推荐最新24.x），SQLite为Node内置，不需要安装外部数据库。`app/network.ts`调用Node24的环境代理支持，复用HTTP_PROXY/HTTPS_PROXY/NO_PROXY；没有代理的普通VPS无需复制云端代理地址。

### 7.3 公开试用必须启用预览认证

**不要把默认本机模式直接经反向代理发布。**默认本机回环请求可免配对；公网反代也可能来自回环地址。已增加专用公开预览模式：

```sh
PUBLIC_PREVIEW=1 HOST=127.0.0.1 PORT=4319 npm start
```

外层HTTPS入口可使用用户允许的8001端口，反向代理到`127.0.0.1:4319`。如何安装代理、配置证书和进程守护，由VPS真实环境决定，不假定已有Nginx/Caddy/systemd或sudo。

- 公开模式强制认证，即使来自回环代理或配置里关闭pairingRequired也不免登录。
- 启动窗口输出24字符随机配对码；首次浏览器配对后使用HttpOnly、Secure、SameSite=Strict Cookie。
- **需要HTTPS**，不能为了让HTTP直连工作而取消Secure或关闭认证。若没有域名/证书，先与用户确定可用方式，别宣称已有可信HTTPS。
- 反代保留原始Host（含端口，例如Nginx使用`$http_host`），否则写请求的Origin检查会拒绝。
- SSE `/api/events`需要流式转发、关闭缓冲并允许较长连接。
- 用systemd或其他合适方式守护进程，保留runtime数据目录，停止/升级时正常退出。

认证探测应满足：未配对`/api/session`为authenticated=false，`/api/bootstrap`返回401；配对后才能查看配置和发令。

### 7.4 配置真实模型，游戏仍用mock

用户会自行提供模型API Key，优先让其在HTTPS页面“模型与知识”填写，不要求贴在聊天中。

- Base URL默认示例 `https://api.deepseek.com/v1`，可改；也支持完整`/chat/completions`端点。
- 模型名可改；关闭该端点的mock开关，并检查总统/经济/军事/发展参谋/行政的映射。
- 先保留 `gameMode=mock`。不要因为模型改真就同时切实际游戏。
- 首次默认仅建议；用户在聊天权限入口按需开启部分接管或一次性批准。
- 配置、密钥在本地SQLite；服务端公开配置仅返回hasApiKey。字段省略表示保留旧密钥，空字符串表示清除。

### 7.5 让用户试用

测试目标：“优先科研，维持经济底线，保留边境防御能力”。查看总统方向、部门意见、发展路线、最终裁决和实际输入，授权后观察科研选择/建设、等待与mock时间推进。更换目标以观察是否真实调整方案，不仅检查页面能否打开。

## 8. 代码与数据契约中的关键点

- 所有游戏写入经 `AdminService.call`，Web调试也不能直接绕过。
- 战略按 `id:revision` 保存，EXEC按strategy.id筛选最新修订；不要重新写成直接get(strategyId)。
- GOV单写战略/项目；EXEC单写预算/授权/任务/调用/反馈；INTEL单写对局状态/知识。
- 科研选择被回读确认只表示调用observed，任务仍waiting；实际科技完成后才发completed。
- 命令accepted、后置observed、业务完成是不同状态。未知写结果先观察，不盲重试；资源预留保留。
- 权限revision、项目revision、会话与时间线防过期；旧模型结果不能覆盖新授权。
- 局部重评可能递增未参与部门项目revision并写 `project_rebases`。EXEC只沿完整rebase链承接已提交任务，防重绑后重复扣款；真正修改目标的revision不能随意承接。
- 反馈含projectRevision，GOV不让旧任务反馈覆盖新修订。
- 停止AI只停止新提交，已进入游戏的订单仍如实观察，不能用修改任务板宣称撤销。
- 会议 `Decision.snapshot` 不可变，`roleViews`保存实际输入；总统direction/final两次调用分开展示。新状态不应替换历史快照。
- 角色暂停、人工接管和一次性项目批准已接入，不能改成只在UI显示的假开关。

## 9. 验证证据

最近集中结果：

- `npm run build`通过（严格TS检查+Vite生产构建）。
- `npm test` **12/12通过**，涵盖SQLite、OpenAI协议/并发、政府到行政、权限/预算、未知结果重启、一次性批准、导入HTML拒绝、rebase、防代理免登录、知识包离线恢复/校验/不覆盖。
- 桌面1440×1000与手机390×844浏览器流程曾通过、无页面异常、无横向溢出。截图在`integration/screenshots/`。本次知识快照变动没有重跑全部浏览器流程，未改前端。
- 真实Wiki抓取/入库/检索已成功；真实DeepSeek、目标VPS部署、Windows游戏和联机尚未测试。

必要命令：

```sh
npm run build
npm test
npm run test:browser
```

浏览器检查需要Chromium；Linux脚本默认`/usr/bin/chromium`，可用`CHROMIUM_PATH`指定。只在改变相关代码或有具体问题时重复检查，不恢复为无休止桥接验收。

## 10. 不要带过去的东西

不要复制云端整份`runtime/application.sqlite`，它还可能包含配置、会话与历史状态。此次快照已只抽取知识三类数据。不要上传.env、密钥、SSH口令、运行日志、node_modules或机器专属绝对路径配置。云端已下载的隧道二进制不是应用依赖，也无需复制。

上游依赖版本和许可在`VENDOR.md`及vendor各LICENSE：游戏MCP `0af3b09d63fc124209c30a03ee1010f2f481bbcd`；Teacher `daf3067081cfaa67c6ee4bafc24b576ec03bcdad`。上游原生桥接未修改。

## 11. 给VPS Codex的接手提示词

> 请先阅读本仓库AGENTS.md、HANDOFF.md和README.md，接手现有实现，不重建架构。先检查这台VPS及现有服务；8000已有SQLite Web，勿覆盖，网页试用优先8001。使用Node24构建，核对随库四篇真实Wiki的自动恢复与检索。在HTTPS反代后启用PUBLIC_PREVIEW=1和强制配对，提供能访问的试用地址及配对方式。让用户在配置页填写OpenAI兼容模型参数，游戏先保持mock，验证玩家下令到会议、报告、行政操作的闭环。不要以实机接入或桥接逐条复验为开发门槛；不要在聊天、代码或日志中写入SSH口令/模型密钥。明确报告已运行行为、证据、具体阻塞和下一步。

## 12. VPS 续建补充

本轮已在目标主机用 screen 部署应用，公网入口按用户明确要求直接 HTTP 8001（无反代、无证书），启用 PUBLIC_PREVIEW=1 和 PUBLIC_PREVIEW_HTTP=1 保留强制配对；8000 SQLite Web 保持原样。不要重新切回 systemd、SSH转发或证书流程。用户负责网页与业务验收，不在 VPS 运行浏览器自动测试。

工具框架已扩展至随库123条 schema 的分类和 mock 处理器，并新增通用行政项目；不能把静态覆盖等同于123条真实游戏验收。中文全局报告、扩展领域权限、中文预算输入及可保存的政体角色名称已实现。详情见 docs/AUTOMATION.md。服务脚本在 deploy/，本地运行数据和升级前一致性备份在 runtime/（私有、不入Git）。

## 13. 持续舰队任务与战场态势

已新增「战场态势」页、程序采集/变化事件、军事 fleet 项目、行政持续任务与舰队占用/命令恢复机制。实现见 modules/state/battlefield.ts、modules/administration/fleet-missions.ts、modules/control/fleet-{policy,leases}.ts、modules/webui/battlefield.tsx；模拟器见 integrations/game_mcp/battlefield-mock.ts。使用说明和边界见 docs/AUTOMATION.md 末节。玩家指定任务由 GOV 建立，不绕过 EXEC、总开关、军事权限与预算；进攻和紧急跃迁独立授权，默认关闭。保持现有玩家总开关，不为部署自动开启。

本轮仅执行类型检查、生产构建和部署 HTTP 检查，未运行浏览器自动测试或业务验收、未连接游戏、未修改 vendor。用户自行在网页验收。历史章节中的代理、证书和旧测试结论不适用于本轮部署；继续 screen、0.0.0.0:8001、直接 HTTP，保留8000既有服务。

部署补记：最新版本已通过构建并在 screen 的 stellaris-government 中运行，直接公网8001返回200，未配对业务接口401。部署时玩家已将AI开启并设为全局接管，已原样保留（不要按更早记录强制改为关闭）。另修复历史调用按任务查询错选索引的性能问题，及SSE重连全量读取旧事件的问题。
