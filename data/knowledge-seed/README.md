# 已灌入的首批机制知识

这是用户要求随私有 GitHub 仓库保存的知识快照，包含真实正文与可直接使用的 BM25 索引，不是 smoke test 样例。

| 页面 | 原始来源 | 页面标注版本 |
|---|---|---|
| Technology | https://stellaris.paradoxwikis.com/Technology | 4.5 |
| Resources | https://stellaris.paradoxwikis.com/Resources | 4.5 |
| Buildings | https://stellaris.paradoxwikis.com/Buildings | 4.5 |
| Districts | https://stellaris.paradoxwikis.com/Districts | 4.5 |

Research 重定向至 Technology；Economy 重定向至 Resources。6 个导入标题对应 4 篇独立正文。

- `pages/`：页面的原始 wikitext、转换后的文本、标题与链接等。
- `index.json`、`meta.json`、`queue.json`：Teacher 知识库索引与状态。
- `metadata.json`：仅包含 knowledge、knowledge_meta、knowledge_import 三类数据，不包含应用配置、登录会话、聊天、模型密钥或运行日志。
- `manifest.json`：原始来源 URL、抓取时间、适用版本、正文哈希和全部数据文件的 SHA-256。

应用普通首次启动时，若知识目录没有页面，会校验这个快照并恢复正文、索引和来源信息。已有页面时跳过，避免覆盖自己后来导入的内容。也可以在应用停止时运行：

```sh
npm run knowledge:restore
npm start
```

运行数据仍保存在忽略的 `runtime/`，本目录是可复制到新电脑/VPS的初始快照。后续增量导入不会自动修改此快照。

页面版权与许可归原始来源，本快照保留来源链接和原文，不以应用代码许可证替代原站许可。页面版本标签不是针对某一具体游戏构建的实测结论；修订号无法由 raw 接口取得时，保留 null 与原因。
