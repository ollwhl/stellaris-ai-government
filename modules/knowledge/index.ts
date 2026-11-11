import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { now, uid, type Context, type KnowledgeRef, type Json } from '../../contracts/index.js';
import { createKnowledgeConnection } from '../../integrations/knowledge_mcp/index.js';

interface ImportItem {title:string; status:'pending'|'running'|'success'|'failed'; attempts:number; at:string; error?:string; retryAfter?:string; url?:string; hash?:string; revision?:string|null; applicableVersion?:string|null;}
const require=createRequire(import.meta.url);
const aliases:Record<string,string>={'科研':'Technology Research','科技':'Technology Research','经济':'Economy Resources','资源':'Resources','建设':'Building Districts','建筑':'Building','军事':'Warfare Ship designer','舰队':'Fleet warfare','传统':'Traditions','飞升':'Ascension perks'};
const samples:KnowledgeRef[]=[
  {id:'sample_research',title:'Technology — mock scenario',url:'',revision:null,applicableVersion:null,fetchedAt:now(),source:'sample',text:'仅用于应用流程演示的样例资料，不是已导入 Wiki：科研选择应来自当前对局候选；科研投入与军事能力需求需要共同排序。选择成功与科技完成分别追踪。'},
  {id:'sample_economy',title:'Resources and Building — mock scenario',url:'',revision:null,applicableVersion:null,fetchedAt:now(),source:'sample',text:'仅用于 mock 场景：维护库存底线后预留建设资源，建设入队后等待完成；成本和可建候选来自状态读取。'},
  {id:'sample_fleet',title:'Fleet defense — mock scenario',url:'',revision:null,applicableVersion:null,fetchedAt:now(),source:'sample',text:'仅用于 mock 场景：在授权舰队与预算范围内规划防御增援；当前兵力、缺额与成本应来自对局。'}
];

export function createKnowledge(ctx:Context) {
  const connection=createKnowledgeConnection(ctx);
  let cache=new Map<string,{at:number,refs:KnowledgeRef[]}>();
  let running:Promise<void>|undefined; let closed=false;
  let kb:any; let teacherRoot=''; let lastError:string|null=null;
  let epoch=ctx.store.get<number>('knowledge_meta','epoch')||0;
  const runtimeDir=path.resolve(process.env.STELLARIS_DATA_DIR||'runtime');
  const kbDir=()=>path.resolve(ctx.config.knowledgeMcp.env.STELLARIS_KB_DIR||path.join(runtimeDir,'knowledge'));
  const queue=()=>ctx.store.list<ImportItem>('knowledge_import');
  for(const item of queue()) if(item.status==='running') ctx.store.set('knowledge_import',item.title,{...item,status:'pending',error:'上次进程中断，等待恢复',at:now()});
  function locateTeacher():string {
    const possible=[process.env.STELLARIS_TEACHER_DIR,...ctx.config.knowledgeMcp.args.filter(x=>x.endsWith('server.js')).map(x=>path.dirname(path.resolve(x))),path.resolve('vendor/mcp-stellaris'),path.resolve('../dependencies/mcp-stellaris')].filter(Boolean) as string[];
    const found=possible.find(x=>fs.existsSync(path.join(x,'lib','kb.js'))&&fs.existsSync(path.join(x,'lib','live.js')));
    if(!found) throw new Error('未找到 Teacher MCP 源码，请配置 STELLARIS_TEACHER_DIR 或知识 MCP server.js 路径');
    return found;
  }
  function local() {
    const next=locateTeacher();
    if(!kb||teacherRoot!==`${next}:${kbDir()}`) { const {KnowledgeBase}=require(path.join(next,'lib','kb.js')); kb=new KnowledgeBase(kbDir()); kb.load(); teacherRoot=`${next}:${kbDir()}`; }
    return kb;
  }
  function changed() {epoch++; ctx.store.set('knowledge_meta','epoch',epoch); cache.clear();}
  function normalizedQuery(q:string) {let text=q; for(const [zh,en] of Object.entries(aliases)) if(q.includes(zh)) text+=' '+en; return text;}
  function metadata(title:string) {return ctx.store.get<Json>('knowledge_meta',title)||{};}
  function ref(doc:any):KnowledgeRef {const m=metadata(doc.title); return {id:`wiki_${doc.slug||doc.title}`,title:doc.title,url:doc.url||doc.sourceUrl||`https://stellaris.paradoxwikis.com/${encodeURIComponent(doc.title.replace(/ /g,'_'))}`,revision:m.revision??null,applicableVersion:m.applicableVersion??null,fetchedAt:m.fetchedAt||doc.updated||now(),text:String(doc.snippet||doc.text||'').slice(0,9000),source:'wiki'};}
  function markMissing(query:string) {const id=createHash('sha256').update(query).digest('hex').slice(0,24); ctx.store.set('knowledge_missing',id,{id,query,at:now(),status:'pending'});}
  async function search(query:string):Promise<KnowledgeRef[]> {
    const q=String(query||'').trim().slice(0,1000); if(!q) return [];
    const key=`${ctx.config.gameMode}:${JSON.stringify(ctx.config.knowledgeMcp)}:${epoch}:${q}`;
    const cached=cache.get(key); if(cached&&Date.now()-cached.at<60_000) return structuredClone(cached.refs);
    let refs:KnowledgeRef[]=[];
    if(connection.configured()) {
      try {const data=await connection.query('stellaris_search',{query:normalizedQuery(q),limit:8}); const hits=Array.isArray(data)?data:data.hits||data.results||[]; refs=hits.map(ref);}
      catch {lastError='知识 MCP 查询失败，已尝试本地知识库；请检查连接配置'; ctx.bus.emit('knowledge.warning',{message:lastError});}
    }
    if(!refs.length) {try {refs=local().search(normalizedQuery(q),{limit:8}).map((hit:any)=>ref({...local().resolve(hit.title),...hit}));}catch(error){lastError=error instanceof Error?error.message:'本地知识库不可用';}}
    if(!refs.length) {
      markMissing(q);
      if(ctx.config.gameMode==='mock') {const l=normalizedQuery(q).toLowerCase(); refs=samples.filter(x=>l.split(/\s+/).some(word=>word.length>2&&x.title.toLowerCase().includes(word))).slice(0,3); if(!refs.length) refs=[samples[0]!];}
    }
    cache.set(key,{at:Date.now(),refs}); return structuredClone(refs);
  }
  function status() {const items=queue(); let coverage=ctx.store.list<KnowledgeRef>('knowledge').length; try {coverage=local().docs.size;}catch{} return {running:Boolean(running),total:items.length,pending:items.filter(x=>x.status==='pending').length,failed:items.filter(x=>x.status==='failed').length,success:items.filter(x=>x.status==='success').length,items,missing:ctx.store.list('knowledge_missing'),lastError,kbDir:kbDir(),epoch,coverage,sampleOnly:ctx.config.gameMode==='mock'&&coverage===0};}
  async function download(title:string,live:any):Promise<{raw:string,title:string,url:string}> {
    let current=title;
    for(let redirects=0;redirects<5;redirects++) {
      const result=await live.fetchRaw(current);
      if(!result.ok) throw new Error(result.reason||result.error||'页面下载失败');
      const raw=String(result.raw||'');
      const redirect=raw.match(/^\s*#redirect\s*\[\[([^\]|#]+)/i);
      if(redirect) {current=redirect[1]!.trim();continue;}
      if(raw.trim().length<40||/^\s*(?:<!doctype\s+html|<html|<head|<body)/i.test(raw)||/<title>.*(?:challenge|denied|error)/i.test(raw)||/_fs-ch-/.test(raw)) throw new Error('拒绝空页面或网络挑战 HTML；未入库');
      return {raw,title:current,url:live.pageUrl(current)};
    }
    throw new Error('页面重定向超过五次');
  }
  async function run() {
    let library:any; let live:any;
    try {const root=locateTeacher();library=local();live=require(path.join(root,'lib','live.js'));}
    catch(error) {lastError=error instanceof Error?error.message:'知识库初始化失败';ctx.bus.emit('knowledge.import.error',{message:lastError});return;}
    for(const previous of queue()) {
      if(closed) break;
      if(!['pending','failed'].includes(previous.status)) continue;
      let done=false;
      for(let retry=0;retry<2&&!closed&&!done;retry++) {
        const item:ImportItem={...previous,status:'running',attempts:previous.attempts+retry+1,at:now()};
        ctx.store.set('knowledge_import',item.title,item);ctx.bus.emit('knowledge.import.progress',status());
        try {
          const page=await download(item.title,live);
          if(closed) {ctx.store.set('knowledge_import',item.title,{...item,status:'pending'});break;}
          const versions=[...page.raw.matchAll(/\{\{\s*(?:s?version)\s*\|\s*([^}|]+)/ig)].map(x=>x[1]!.trim());
          const hash=createHash('sha256').update(page.raw).digest('hex');
          const doc=library.upsertPage(page.title,page.raw,{aliases:page.title===item.title?[]:[item.title]});
          const info={fetchedAt:now(),url:page.url,revision:null,revisionReason:'action=raw 不提供修订编号',applicableVersion:versions.length?[...new Set(versions)].join(', '):null,versionTemplates:versions,hash,language:'en',rawTitle:page.title};
          ctx.store.set('knowledge_meta',page.title,info);if(page.title!==item.title)ctx.store.set('knowledge_meta',item.title,info);
          ctx.store.set('knowledge',doc.slug,ref(doc));
          ctx.store.set('knowledge_import',item.title,{...item,status:'success',url:page.url,hash,revision:null,applicableVersion:info.applicableVersion,error:undefined,at:now()});
          // Every page is durable before moving on. No queue_next destructive dequeue.
          library.flush();changed();done=true;
        } catch(error) {const message=error instanceof Error?error.message:'导入失败';ctx.store.set('knowledge_import',item.title,{...item,status:'failed',error:message,at:now()});lastError=message;}
        await new Promise(resolve=>setTimeout(resolve,700));
      }
      ctx.bus.emit('knowledge.import.progress',status());
    }
    try {library.flush();await connection.close();}catch{}
    ctx.bus.emit('knowledge.updated',{epoch,status:status()});
  }
  async function importPages(titles?:string[]) {
    if(running) return status();
    if(closed) throw new Error('知识服务已关闭');
    let requested=titles;
    if(!requested?.length) {
      try {const data=JSON.parse(fs.readFileSync(path.join(locateTeacher(),'data','core_pages.json'),'utf8'));const all=Object.values(data).filter(Array.isArray).flat() as string[];const first=['Technology','Research','Resources','Economy','Building','Districts'];requested=first.filter(x=>all.includes(x));if(!requested.length)requested=all.slice(0,12);}
      catch {requested=['Technology','Resources','Economy','Building'];}
    }
    if(requested.length>200) throw new Error('每次最多安排 200 页资料');
    for(const title of requested) {if(typeof title!=='string'||!title.trim()||title.length>200)throw new Error('知识页面标题无效');const key=title.trim();const old=ctx.store.get<ImportItem>('knowledge_import',key);ctx.store.set('knowledge_import',key,{title:key,status:'pending',attempts:old?.attempts||0,at:now()});}
    running=run().finally(()=>{running=undefined;ctx.bus.emit('knowledge.import.finished',status());});
    return status();
  }
  return {search,importPages,status,async shutdown(){closed=true;await connection.close();},local};
}
