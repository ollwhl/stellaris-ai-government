# 外部依赖版本

| 仓库 | 提交 | 用途 |
|---|---|---|
| https://github.com/Yidhar/stellaris-mcp | 0af3b09d63fc124209c30a03ee1010f2f481bbcd | 游戏MCP服务端源码、工具schema、Windows桥接参考 |
| https://github.com/IbrahimSabriOrene/mcp-stellaris | daf3067081cfaa67c6ee4bafc24b576ec03bcdad | Teacher MCP、本地知识检索与导入库 |

源码置于vendor/并保留上游许可证及说明，未修改桥接实现。contracts/game-tools.json由scripts/extract-catalog.ts仅执行注册过程生成，未调用游戏handler。本提交抽取123个工具；运行时实际MCP目录仍为准。

npm依赖锁定在package-lock.json。Node 24自带SQLite，应用没有Python运行时依赖。vendor中的Python脚本属于上游游戏桥接辅助工具。
