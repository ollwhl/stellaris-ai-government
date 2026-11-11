import {setGlobalProxyFromEnv} from 'node:http';
// Node 24 applies the inherited proxy and CA configuration to both fetch and
// http(s), including the unmodified Teacher importer. NO_PROXY keeps local MCP
// and application requests local. Do not hard-code proxy endpoints or secrets.
setGlobalProxyFromEnv();
