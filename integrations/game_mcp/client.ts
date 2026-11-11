import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { classify } from './catalog.js';
import type { Context, Json, ToolDefinition } from '../../contracts/index.js';
export class RealGameClient {
 private client?:Client; private transport?:StdioClientTransport;private fingerprint='';private connecting?:Promise<Client>;
 constructor(private ctx:Context){}
 async connect():Promise<Client>{
  const cfg=this.ctx.config.gameMcp;const fp=JSON.stringify(cfg);
  if(this.client&&this.fingerprint===fp)return this.client;
  if(this.connecting)return this.connecting;
  this.connecting=(async()=>{await this.close();if(!cfg.command)throw new Error('尚未配置游戏 MCP 启动命令');this.transport=new StdioClientTransport({command:cfg.command,args:cfg.args,env:{...process.env,...cfg.env} as Record<string,string>,stderr:'pipe'});const c=new Client({name:'stellaris-government',version:'0.1.0'});await c.connect(this.transport);this.client=c;this.fingerprint=fp;return c;})();
  try{return await this.connecting;}finally{this.connecting=undefined;}
 }
 async tools():Promise<ToolDefinition[]>{const c=await this.connect();const out:ToolDefinition[]=[];let cursor:string|undefined;do{const page=await c.listTools(cursor?{cursor}:{});out.push(...page.tools.map(t=>({name:t.name,description:t.description??'',inputSchema:t.inputSchema,...classify(t.name)})));cursor=page.nextCursor;}while(cursor);return out;}
 async call(name:string,args:Json):Promise<any>{const c=await this.connect();const result=await c.callTool({name,arguments:args},undefined,{timeout:30_000});if(result.isError)throw Object.assign(new Error('MCP 返回错误'),{result,knownFailure:true});const content=(result.content??[]) as any[];const block=content.find(x=>x.type==='text');if(block){try{return {data:JSON.parse(block.text),raw:result};}catch{}}return {data:result,raw:result};}
 async close(){try{await this.client?.close();}catch{}this.client=undefined;try{await this.transport?.close();}catch{}this.transport=undefined;}
}
