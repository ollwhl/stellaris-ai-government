# Stellaris Teacher MCP

Personal MCP server by Ibrahim Sabri Örene for offline-first game knowledge retrieval. Zero runtime dependencies; Node.js 18+; stdio transport.

## Capabilities

BM25-ranked knowledge search, page and section access, glossary lookup, UI-label mapping, learning paths, ingestion queues and optional timestamped video retrieval. `stellaris_explain` combines useful context for a teaching assistant.

```sh
node server.js
node test/smoke.js
```

Register `node /absolute/path/to/mcp-stellaris/server.js` with your MCP client. Set `STELLARIS_KB_DIR` to the desired writable knowledge directory. Without it, storage defaults to a sibling `.kb` directory.

## Build your own knowledge base

The public repository includes authored term mappings and source code, not a downloaded wiki or video corpus. An empty KB is expected on first run. Use `stellaris_queue_add`, `stellaris_queue_next` and `stellaris_kb_add_page` to ingest material you are permitted to use. Live HTTP access can be blocked by the wiki's browser challenge; the tool reports that limitation.

The original smoke test runs against a throwaway KB with synthetic examples. It does not use your personal corpus.

Stellaris and its wiki are third-party works. This repository is an independent tool and does not redistribute their article bodies or full video transcripts. Retrieved material retains its source rights and attribution. The project package declares MIT; see LICENSE.
