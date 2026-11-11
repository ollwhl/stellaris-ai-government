import type {Context, ModelService, ModelMessage, ModelConfig, Role} from '../contracts/index.ts';
import { now,uid } from '../contracts/index.ts';
class Capacity {
 private active=0;private queue:(()=>void)[]=[];
 async run<T>(limit:number,fn:()=>Promise<T>):Promise<T>{if(this.active>=limit)await new Promise<void>(r=>this.queue.push(r));else this.active++;try{return await fn();}finally{const next=this.queue.shift();if(next)next();else this.active--;}}
}
export function createModels(ctx:Omit<Context,'models'>):ModelService {
 const pools=new Map<string,Capacity>();
 function config(role:Role){const id=ctx.config.roleModels[role]??ctx.config.models[0].id;const m=ctx.config.models.find(x=>x.id===id);if(!m)throw new Error(`未找到模型配置 ${id}`);return {...m};}
 function pool(m:ModelConfig,role:Role){const key=m.id+(role==='administration'?':admin':':planning');if(!pools.has(key))pools.set(key,new Capacity());return pools.get(key)!;}
 async function request(role:Role,messages:ModelMessage[],tools:any[]|undefined,traceId:string|undefined,json:boolean){
  const m=config(role);if(m.mock)throw new Error('Mock 模型仅通过明确的结构化 fallback 使用');
  return pool(m,role).run(role==='administration'?1:m.concurrency,async()=>{
   const id=uid('model');const started=Date.now();
   const run:any={id,role,configId:m.id,model:m.model,at:now(),status:'running',traceId,inputMessages:messages.length};ctx.store.set('modelRuns',id,run);ctx.bus.emit('model.started',run,traceId);
   try{
    const endpoint=m.baseUrl.replace(/\/+$/,'');
    const response=await fetch(endpoint.endsWith('/chat/completions')?endpoint:`${endpoint}/chat/completions`,{method:'POST',headers:{'Content-Type':'application/json',...(m.apiKey?{Authorization:`Bearer ${m.apiKey}`}:{})},body:JSON.stringify({model:m.model,messages,stream:false,max_tokens:m.maxTokens,...(json?{response_format:{type:'json_object'}}:{}),...(tools?.length?{tools,tool_choice:'auto'}:{})}),signal:AbortSignal.timeout(m.timeoutMs)});
    if(!response.ok){await response.body?.cancel();throw new Error(`模型 HTTP ${response.status}，请检查 URL、模型和密钥配置`);}
    const result:any=await response.json();const msg=result.choices?.[0]?.message;if(!msg)throw new Error('模型未返回有效消息');
    Object.assign(run,{status:'completed',durationMs:Date.now()-started,usage:result.usage??null});ctx.store.set('modelRuns',id,run);ctx.bus.emit('model.completed',run,traceId);
    return {content:msg.content??null,toolCalls:msg.tool_calls??[]};
   }catch(e){Object.assign(run,{status:'failed',durationMs:Date.now()-started,error:e instanceof Error?e.message:'模型请求失败'});ctx.store.set('modelRuns',id,run);ctx.bus.emit('model.failed',run,traceId);throw e;}
  });
 }
 return {
  complete:(role,messages,tools,traceId)=>request(role,messages,tools,traceId,false),
  async json<T>(role:Role,system:string,input:unknown,fallback:()=>T,traceId?:string){
   const m=config(role);
   if(m.mock){const id=uid('model');const started=Date.now();if(ctx.config.planningDelayMs&&role!=='administration')await new Promise(r=>setTimeout(r,ctx.config.planningDelayMs));const value=fallback();const run={id,role,configId:m.id,model:'mock',source:'mock',at:now(),status:'completed',durationMs:Date.now()-started,usage:null,traceId};ctx.store.set('modelRuns',id,run);ctx.bus.emit('model.completed',run,traceId);return value;}
   const reply=await request(role,[{role:'system',content:system+'\nReturn one valid JSON object only. Do not include private chain of thought; provide concise public reasons.'},{role:'user',content:JSON.stringify(input)}],undefined,traceId,true);
   if(!reply.content)throw new Error('模型没有输出结构化结果');const text=reply.content.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'');try{return JSON.parse(text) as T;}catch{throw new Error('模型输出不是有效 JSON，本轮结果未采纳');}
  }
 };
}
