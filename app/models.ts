import {setTimeout as delay} from 'node:timers/promises';
import type {Context, ModelService, ModelMessage, ModelConfig, Role} from '../contracts/index.ts';
import {now,uid} from '../contracts/index.ts';
class ModelCancelled extends Error {constructor(){super('AI 总开关已关闭或服务退出，本轮模型任务已取消');this.name='ModelCancelled';}}
class Capacity {
 private active=0;
 private queue:Array<{limit:number;start:()=>void}>=[];
 private drain(){while(this.queue.length&&this.active<this.queue[0].limit)this.queue.shift()!.start();}
 async run<T>(limit:number,fn:()=>Promise<T>,signal:AbortSignal):Promise<T>{
  signal.throwIfAborted();
  await new Promise<void>((resolve,reject)=>{
   const entry={limit,start:()=>{signal.removeEventListener('abort',abort);this.active++;resolve();}};
   const abort=()=>{const index=this.queue.indexOf(entry);if(index>=0)this.queue.splice(index,1);reject(signal.reason);this.drain();};
   signal.addEventListener('abort',abort,{once:true});
   if(signal.aborted)abort();else if(this.active<limit)entry.start();else this.queue.push(entry);
  });
  try{signal.throwIfAborted();return await fn();}finally{this.active--;this.drain();}
 }
}
export function createModels(ctx:Omit<Context,'models'>):ModelService {
 const pools=new Map<string,Capacity>();const active=new Set<AbortController>();let generation=0,closed=false;
 const enabled=()=>!closed&&ctx.store.get<any>('control','permissions')?.aiEnabled!==false;
 const cancel=()=>{generation++;for(const controller of active)controller.abort(new ModelCancelled());};
 const unsubscribe=ctx.bus.subscribe(event=>{if(event.type==='permissions.changed'&&event.data?.aiEnabled===false)cancel();});
 function check(epoch:number){if(!enabled()||epoch!==generation)throw new ModelCancelled();}
 function config(role:Role){const id=ctx.config.roleModels[role]??ctx.config.models[0].id;const m=ctx.config.models.find(x=>x.id===id);if(!m)throw new Error(`未找到模型配置 ${id}`);return {...m};}
 function pool(m:ModelConfig,role:Role){const key=m.id+(role==='administration'?':admin':':planning');if(!pools.has(key))pools.set(key,new Capacity());return pools.get(key)!;}
 async function tracked<T>(role:Role,m:ModelConfig,traceId:string|undefined,messages:number,fn:(signal:AbortSignal)=>Promise<T>):Promise<T>{
  const epoch=generation;check(epoch);const controller=new AbortController();active.add(controller);
  const id=uid('model'),started=Date.now();const run:any={id,role,configId:m.id,model:m.mock?'mock':m.model,...(m.mock?{source:'mock'}:{}),at:now(),status:'queued',traceId,inputMessages:messages};
  const persist=(event:string)=>ctx.store.transaction(()=>{ctx.store.set('modelRuns',id,run);ctx.bus.emit(event,run,traceId);});
  try{
   persist('model.queued');
   return await pool(m,role).run(role==='administration'?1:m.concurrency,async()=>{
    check(epoch);Object.assign(run,{status:'running'});persist('model.started');
    const result=await fn(controller.signal);check(epoch);
    Object.assign(run,{status:'completed',durationMs:Date.now()-started,usage:(result as any)?.usage??null});persist('model.completed');return result;
   },controller.signal);
  }catch(error){
   const cancelled=controller.signal.aborted||error instanceof ModelCancelled;const reason=cancelled?new ModelCancelled():error;
   Object.assign(run,{status:cancelled?'cancelled':'failed',durationMs:Date.now()-started,error:reason instanceof Error?reason.message:'模型请求失败'});persist(cancelled?'model.cancelled':'model.failed');throw reason;
  }finally{active.delete(controller);}
 }
 async function request(role:Role,messages:ModelMessage[],tools:any[]|undefined,traceId:string|undefined,json:boolean){
  const m=config(role);if(m.mock)throw new Error('Mock 模型仅通过明确的结构化 fallback 使用');
  return tracked(role,m,traceId,messages.length,async signal=>{
   const endpoint=m.baseUrl.replace(/\/+$/,'');
   const response=await fetch(endpoint.endsWith('/chat/completions')?endpoint:`${endpoint}/chat/completions`,{method:'POST',headers:{'Content-Type':'application/json',...(m.apiKey?{Authorization:`Bearer ${m.apiKey}`}:{})},body:JSON.stringify({model:m.model,messages,stream:false,max_tokens:m.maxTokens,...(json?{response_format:{type:'json_object'}}:{}),...(tools?.length?{tools,tool_choice:'auto'}:{})}),signal:AbortSignal.any([signal,AbortSignal.timeout(m.timeoutMs)])});
   if(!response.ok){await response.body?.cancel();throw new Error(`模型 HTTP ${response.status}，请检查 URL、模型和密钥配置`);}
   const result:any=await response.json();const message=result.choices?.[0]?.message;if(!message)throw new Error('模型未返回有效消息');
   return {content:message.content??null,toolCalls:message.tool_calls??[],usage:result.usage??null};
  });
 }
 return {
  shutdown(){closed=true;unsubscribe();cancel();},
  complete:(role,messages,tools,traceId)=>request(role,messages,tools,traceId,false),
  async json<T>(role:Role,system:string,input:unknown,fallback:()=>T,traceId?:string){
   const m=config(role);
   if(m.mock)return tracked(role,m,traceId,2,async signal=>{if(ctx.config.planningDelayMs&&role!=='administration')await delay(ctx.config.planningDelayMs,undefined,{signal});signal.throwIfAborted();return fallback();});
   const reply=await request(role,[{role:'system',content:system+'\nReturn one valid JSON object only. Do not include private chain of thought; provide concise public reasons.'},{role:'user',content:JSON.stringify(input)}],undefined,traceId,true);
   if(!reply.content)throw new Error('模型没有输出结构化结果');const text=reply.content.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'');try{return JSON.parse(text) as T;}catch{throw new Error('模型输出不是有效 JSON，本轮结果未采纳');}
  }
 };
}
