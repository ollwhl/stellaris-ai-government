import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Store, Bus, AppEvent } from '../contracts/index.ts';
import { uid, now } from '../contracts/index.ts';

export class SqliteStore implements Store {
  private db:DatabaseSync;
  private depth=0;
  constructor(path:string){
    if(path!==':memory:') mkdirSync(dirname(path),{recursive:true});
    this.db=new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS records (space TEXT NOT NULL,id TEXT NOT NULL,value TEXT NOT NULL,updated TEXT NOT NULL,PRIMARY KEY(space,id));');
    this.db.exec("CREATE INDEX IF NOT EXISTS records_space_updated ON records(space,updated,id); CREATE INDEX IF NOT EXISTS records_calls_task ON records(json_extract(value,'$.taskId')) WHERE space='calls'; CREATE INDEX IF NOT EXISTS records_calls_incident ON records(json_extract(value,'$.eventId')) WHERE space='calls'; CREATE INDEX IF NOT EXISTS records_calls_fleet_command ON records(json_extract(value,'$.fleetCommandId')) WHERE space='calls'; CREATE INDEX IF NOT EXISTS records_fleet_task ON records(json_extract(value,'$.taskId')) WHERE space='fleet_commands'; CREATE INDEX IF NOT EXISTS records_calls_trace ON records(json_extract(value,'$.traceId')) WHERE space='calls';");
  }
  get<T>(space:string,id:string):T|undefined { const row=this.db.prepare('SELECT value FROM records WHERE space=? AND id=?').get(space,id) as {value:string}|undefined;return row?JSON.parse(row.value):undefined; }
  list<T>(space:string,options:{limit?:number;reverse?:boolean}={}):T[] {const reverse=options.reverse?' DESC':'';const limit=options.limit===undefined?'':' LIMIT '+Math.max(0,Math.floor(options.limit));return (this.db.prepare(`SELECT value FROM records WHERE space=? ORDER BY updated${reverse},id${reverse}${limit}`).all(space) as {value:string}[]).map(x=>JSON.parse(x.value));}
  find<T>(space:string,fields:Record<string,any>):T[]{const entries=Object.entries(fields);for(const [key]of entries)if(!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(key))throw new Error('无效查询字段');const where=entries.map(([key])=>`json_extract(value,'$.${key}')=?`).join(' AND ');
    // A bound space plus ORDER BY made SQLite prefer the chronological index and scan every old call.
    // These are fixed internal literals, so the partial expression index can be selected unambiguously.
    const known:Record<string,Record<string,string>>={calls:{taskId:'records_calls_task',eventId:'records_calls_incident',traceId:'records_calls_trace',fleetCommandId:'records_calls_fleet_command'},fleet_commands:{taskId:'records_fleet_task'}};
    const key=entries.find(([field])=>known[space]?.[field])?.[0],index=key?known[space][key]:undefined;
    const query=index?`SELECT value FROM records INDEXED BY ${index} WHERE space='${space}'${where?' AND '+where:''} ORDER BY updated,id`:`SELECT value FROM records WHERE space=?${where?' AND '+where:''} ORDER BY updated,id`;
    return (this.db.prepare(query).all(...(index?[]:[space]),...entries.map(([,value])=>value)) as {value:string}[]).map(row=>JSON.parse(row.value));}
  eventsAfter(seq:number):AppEvent[]{return (this.db.prepare("SELECT value FROM records WHERE space='events' AND id>? ORDER BY id").all(String(Math.max(0,Math.floor(seq))).padStart(14,'0')) as {value:string}[]).map(row=>JSON.parse(row.value));}


  set<T>(space:string,id:string,value:T){this.db.prepare('INSERT INTO records(space,id,value,updated) VALUES(?,?,?,?) ON CONFLICT(space,id) DO UPDATE SET value=excluded.value,updated=excluded.updated').run(space,id,JSON.stringify(value),now());}
  delete(space:string,id:string){this.db.prepare('DELETE FROM records WHERE space=? AND id=?').run(space,id);}
  transaction<T>(fn:()=>T):T {if(this.depth)return fn();this.db.exec('BEGIN IMMEDIATE');this.depth++;try{const value=fn();this.db.exec('COMMIT');return value;}catch(e){this.db.exec('ROLLBACK');throw e;}finally{this.depth--;}}
  close(){this.db.close();}
}
export class EventBus implements Bus {
  private listeners=new Set<(e:AppEvent)=>void>();
  private seq:number;
  constructor(private store:Store){this.seq=store.get<number>('system','eventSeq')??0;}
  emit(type:string,data:any,traceId?:string):AppEvent {
    const e:AppEvent={id:uid('event'),seq:++this.seq,type,at:now(),data,traceId};
    this.store.transaction(()=>{this.store.set('events',String(e.seq).padStart(14,'0'),e);this.store.set('system','eventSeq',this.seq);if(e.seq>10000)this.store.delete('events',String(e.seq-10000).padStart(14,'0'));});
    for(const listener of this.listeners){try{listener(e);}catch{ /* event consumer cannot break commit */ }}return e;
  }
  subscribe(fn:(e:AppEvent)=>void){this.listeners.add(fn);return()=>{this.listeners.delete(fn);};}
  since(seq:number){return this.store.eventsAfter?this.store.eventsAfter(seq):this.store.list<AppEvent>('events').filter(e=>e.seq>seq);}
}
