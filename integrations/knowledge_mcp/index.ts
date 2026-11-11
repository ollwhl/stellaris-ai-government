import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { Context, Json } from '../../contracts/index.js';

export function unwrapMcp(value:any):any {
  // EXEC preserves both parsed data and the original MCP result.
  if (value && typeof value==='object' && 'data' in value && 'raw' in value) return value.data;
  if (value?.isError) throw new Error(value?.content?.map((x:any)=>x.text||'').join('\n') || 'MCP 查询失败');
  if (value?.structuredContent) return value.structuredContent;
  if (Array.isArray(value?.content)) {
    const text=value.content.filter((x:any)=>x.type==='text').map((x:any)=>x.text).join('\n');
    try { return JSON.parse(text); } catch { return {text}; }
  }
  return value;
}

/** Query-only connection: ingestion is owned by the ordinary-program importer. */
export function createKnowledgeConnection(ctx:Context) {
  let client:Client|undefined;
  let fingerprint='';
  let connecting:Promise<Client>|undefined;
  let tools:any[]=[];
  async function close() { const old=client; client=undefined; connecting=undefined; tools=[]; if(old) await old.close().catch(()=>{}); }
  async function connect():Promise<Client> {
    const config=ctx.config.knowledgeMcp;
    if (!config.command) throw new Error('未配置知识 MCP；可先使用本地知识库或导入资料');
    const next=JSON.stringify(config);
    if(client && next===fingerprint) return client;
    if(connecting && next===fingerprint) return connecting;
    await close(); fingerprint=next;
    connecting=(async()=>{
      const candidate=new Client({name:'stellaris-government-knowledge',version:'0.1.0'},{capabilities:{}});
      const env:Record<string,string>={};
      for(const [k,v] of Object.entries(process.env)) if(v!==undefined) env[k]=v;
      Object.assign(env,config.env);
      const transport=new StdioClientTransport({command:config.command,args:config.args,env,stderr:'pipe'});
      // Do not forward subprocess stderr: it may contain local paths or secrets.
      transport.stderr?.on('data',()=>{});
      try {
        await candidate.connect(transport,{timeout:15_000});
        const listed=await candidate.listTools(); tools=listed.tools; client=candidate;
        return candidate;
      } catch(error) { await candidate.close().catch(()=>{}); throw error; }
      finally { connecting=undefined; }
    })();
    return connecting;
  }
  return {
    configured:()=>Boolean(ctx.config.knowledgeMcp.command),
    async query(name:string,args:Json) {
      if(!['stellaris_search','stellaris_get_page','stellaris_get_section','stellaris_glossary','stellaris_explain'].includes(name)) throw new Error('运行时仅允许知识查询工具');
      const c=await connect();
      if(!tools.some(t=>t.name===name)) throw new Error(`知识 MCP 不提供 ${name}`);
      return unwrapMcp(await c.callTool({name,arguments:args},undefined,{timeout:20_000}));
    },
    close
  };
}
