import '../app/network.ts';
import {resolve} from 'node:path';
import {SqliteStore,EventBus} from '../app/store.ts';
import {loadConfig} from '../app/config.ts';
import {createModels} from '../app/models.ts';
import {createKnowledge} from '../modules/knowledge/index.ts';
const store=new SqliteStore(resolve('runtime/application.sqlite'));
const config=loadConfig(store),bus=new EventBus(store);
const base={store,bus,config},knowledge=createKnowledge({...base,models:createModels(base)});
const titles=process.argv.slice(2);
let last='';
const unsubscribe=bus.subscribe(()=>{const s=knowledge.status();const key=`${s.success}/${s.failed}/${s.pending}`;if(key!==last){last=key;console.log(JSON.stringify({success:s.success,failed:s.failed,pending:s.pending,total:s.total}));}});
try{
 await knowledge.importPages(titles.length?titles:undefined);
 while(knowledge.status().running)await new Promise(r=>setTimeout(r,200));
 const status=knowledge.status();
 const refs=await knowledge.search('research technology');
 console.log(JSON.stringify({coverage:status.coverage,items:status.items.map((i:any)=>({title:i.title,status:i.status,error:i.error??null,applicableVersion:i.applicableVersion,hash:i.hash})),search:refs.map(r=>({title:r.title,source:r.source,applicableVersion:r.applicableVersion}))},null,2));
 if(status.failed)process.exitCode=1;
}finally{unsubscribe();await knowledge.shutdown();store.close();}
