import {existsSync,mkdirSync,readdirSync,readFileSync,writeFileSync,renameSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {AppConfig,Store} from '../contracts/index.ts';

export function restoreKnowledgeSeed(store:Store,config:AppConfig,options:{seedDir?:string;targetDir?:string}={}) {
 const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
 const seed=options.seedDir??resolve(root,'data/knowledge-seed');
 const target=options.targetDir??resolve(config.knowledgeMcp.env.STELLARIS_KB_DIR??resolve(root,'runtime/knowledge'));
 const pageDir=resolve(target,'pages');
 const existing=existsSync(pageDir)?readdirSync(pageDir).filter(p=>p.endsWith('.json')):[];
 if(existing.length)return {restored:false,reason:'existing-pages',pageCount:existing.length,target};
 if(!existsSync(resolve(seed,'manifest.json')))return {restored:false,reason:'no-bundled-data',pageCount:0,target};
 const manifest=JSON.parse(readFileSync(resolve(seed,'manifest.json'),'utf8'));
 if(manifest.formatVersion!==1||!Array.isArray(manifest.files))throw new Error('内置知识包格式不支持');
 const payloads:Array<{path:string;bytes:Buffer}>=[];
 for(const entry of manifest.files){
  if(typeof entry.path!=='string'||!['meta.json','queue.json','index.json','metadata.json'].includes(entry.path)&&!/^pages\/[A-Za-z0-9_.-]+\.json$/.test(entry.path))throw new Error('内置知识包路径无效');
  const source=resolve(seed,entry.path);if(!source.startsWith(resolve(seed)+sep))throw new Error('内置知识包路径超出目录');
  const bytes=readFileSync(source);if(createHash('sha256').update(bytes).digest('hex')!==entry.sha256)throw new Error(`内置知识包校验失败：${entry.path}`);
  payloads.push({path:entry.path,bytes});
 }
 const pageCount=payloads.filter(p=>p.path.startsWith('pages/')).length;
 if(pageCount!==manifest.pageCount)throw new Error('内置知识包页面数量不匹配');
 const metadata=JSON.parse(payloads.find(p=>p.path==='metadata.json')!.bytes.toString('utf8'));
 const allowed=new Set(['knowledge_meta','knowledge_import','knowledge']);
 if(metadata.formatVersion!==1||!Array.isArray(metadata.tables)||metadata.tables.some((r:any)=>!allowed.has(r.space)||typeof r.id!=='string'))throw new Error('知识包包含不允许的业务数据');
 // Verify the complete bundle before creating files. Existing page collections
 // are never overwritten by this bootstrap step.
 const ordered=payloads.filter(p=>p.path!=='metadata.json').sort((a,b)=>Number(a.path.startsWith('pages/'))-Number(b.path.startsWith('pages/')));
 mkdirSync(target,{recursive:true});
 for(const item of ordered){const dest=resolve(target,item.path);mkdirSync(dirname(dest),{recursive:true});const temp=dest+'.seed-tmp';writeFileSync(temp,item.bytes);renameSync(temp,dest);}
 store.transaction(()=>{for(const row of metadata.tables)store.set(row.space,row.id,row.value);});
 store.set('system','knowledgeSeed',{pageCount,restoredAt:new Date().toISOString(),teacherCommit:manifest.teacherCommit});
 return {restored:true,reason:'restored',pageCount,target};
}
