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
  }
  get<T>(space:string,id:string):T|undefined { const row=this.db.prepare('SELECT value FROM records WHERE space=? AND id=?').get(space,id) as {value:string}|undefined;return row?JSON.parse(row.value):undefined; }
  list<T>(space:string):T[] {return (this.db.prepare('SELECT value FROM records WHERE space=? ORDER BY updated,id').all(space) as {value:string}[]).map(x=>JSON.parse(x.value));}
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
  since(seq:number){return this.store.list<AppEvent>('events').filter(e=>e.seq>seq);}
}
