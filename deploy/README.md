# VPS screen 试用

按用户要求直接开放 HTTP 公网 8001，不使用反代、证书或 SSH 转发。地址：http://163.44.114.51:8001 。HTTP 不加密传输。

启动：`bash deploy/start-screen.sh`。查看：`screen -r stellaris-government`，按 Ctrl+A 再 D 脱离；进入后 Ctrl+C 正常停止，再执行启动脚本重启。screen 不提供开机自启。

启动参数：HOST=0.0.0.0 PORT=8001 PUBLIC_PREVIEW=1 PUBLIC_PREVIEW_HTTP=1。PUBLIC_PREVIEW 强制所有请求配对，启动窗口显示随机24字符配对码；PUBLIC_PREVIEW_HTTP 是用户明确要求的 HTTP 部署选项，仅移除 Cookie 的 Secure 属性，保留 HttpOnly、SameSite 和会话验证。默认公开模式仍使用 Secure Cookie。

使用项目独立 Node 24.22.2、mock 游戏、服务端真实 DeepSeek 配置和随库四篇真实 Wiki。配置与密钥位于 runtime/application.sqlite，不进入 Git。网页测试由用户操作；真实模型业务效果尚未验证。应用默认仅建议模式，模型调用会产生提供商费用。

8000 上既有 SQLite Web 保持原样。升级前停止应用并保留 runtime，构建后重新启动。不要将数据库、密钥或环境变量复制进日志或 Git。
