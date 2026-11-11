import {resolve} from 'node:path';
import {SqliteStore} from '../app/store.ts';
import {loadConfig} from '../app/config.ts';
import {restoreKnowledgeSeed} from '../app/knowledge-seed.ts';
const store=new SqliteStore(resolve('runtime/application.sqlite'));
try {console.log(JSON.stringify(restoreKnowledgeSeed(store,loadConfig(store)),null,2));}
finally {store.close();}
