/** Enumerate registered schemas only. Never execute a game handler. */
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { writeFileSync } from 'node:fs';
import { registerTools } from '../vendor/stellaris-mcp/stellaris_mcp_server/src/tools.ts';
import { registerSessionTools } from '../vendor/stellaris-mcp/stellaris_mcp_server/src/session_tools.ts';
import { registerSetupTools } from '../vendor/stellaris-mcp/stellaris_mcp_server/src/setup_tools.ts';
import { registerAttentionTools } from '../vendor/stellaris-mcp/stellaris_mcp_server/src/attention.ts';
const catalog:any[]=[];
const server:any={tool(name:string,description:string,shape:any,_handler:any){catalog.push({name,description,inputSchema:zodToJsonSchema(z.object(shape??{}),{$refStrategy:'none'}),effect:'unknown',domain:'unclassified',supported:false});return {};}};
const client:any={request(){throw new Error('Schema extraction cannot call the game');}};
registerTools(server,client);registerSessionTools(server,client);registerSetupTools(server,client);registerAttentionTools(server,client);
writeFileSync(new URL('../contracts/game-tools.json',import.meta.url),JSON.stringify({repository:'Yidhar/stellaris-mcp',commit:'0af3b09d63fc124209c30a03ee1010f2f481bbcd',extractedAt:new Date().toISOString(),tools:catalog},null,2));
console.log(`Extracted ${catalog.length} tool schemas without executing game handlers.`);
