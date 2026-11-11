import './network.ts';
import express from 'express';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync,readFileSync } from 'node:fs';
import { SqliteStore,EventBus } from './store.ts';
import { loadConfig,patchConfig,publicConfig } from './config.ts';
import { createModels } from './models.ts';
import { createAuth } from './auth.ts';
import { restoreKnowledgeSeed } from './knowledge-seed.ts';
import type {Context, IntelService, Services} from '../contracts/index.ts';
import { createAdministration } from '../modules/administration/index.ts';
import { createIntel } from '../modules/state/index.ts';
import { createGovernment } from '../modules/government/index.ts';
import { createWebRouter } from '../modules/webui/router.ts';

export async function startApp(options:{port?:number;host?:string;dbPath?:string;serveUi?:boolean;autoTick?:boolean;externalAccess?:boolean;seedKnowledge?:boolean}={}) {
 const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
 const store=new SqliteStore(options.dbPath??resolve(root,'runtime/application.sqlite'));
 const bus=new EventBus(store);const config=loadConfig(store);
 if(options.port!==undefined)config.port=options.port;if(options.host)config.host=options.host;
 if(options.seedKnowledge!==false&&options.dbPath!==':memory:')restoreKnowledgeSeed(store,config);
 const base={store,bus,config};const context:Context={...base,models:createModels(base)};
 let intel:IntelService;const admin=createAdministration(context,()=>intel);intel=createIntel(context,admin);const gov=createGovernment(context,admin,intel);
 const services:Services={context,admin,intel,gov,publicConfig:()=>publicConfig(config),updateConfig:async patch=>{
   const oldMode=config.gameMode;const oldMcp=JSON.stringify(config.gameMcp);
   const result=patchConfig(config,patch,store);
   if(oldMode!==config.gameMode||oldMcp!==JSON.stringify(config.gameMcp)){admin.updatePermissions({stopped:true});bus.emit('config.connectionChanged',{message:'连接配置已改变，AI 新提交已停止。请刷新状态，确认环境后再启用。'});}
   bus.emit('config.updated',{config:result});return result;
 }};
 const app=express();app.disable('x-powered-by');app.use(express.json({limit:'2mb'}));
 app.use((_req,res,next)=>{res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');next();});
 const auth=createAuth(context,{externalAccess:options.externalAccess});app.use('/api',auth.sameOrigin);
 app.get('/api/session',(req,res)=>res.json({authenticated:auth.authenticated(req)||!auth.requiresPairing(),requiresPairing:auth.requiresPairing()}));
 app.post('/api/pair',auth.pair);app.use('/api',auth.requireSession,createWebRouter(services));
 app.use('/api',(_req,res)=>res.status(404).json({error:'接口不存在'}));
 app.use((err:any,_req:any,res:any,_next:any)=>res.status(err.status??400).json({error:err.message??'请求处理失败'}));
 let vite:any;
 if(options.serveUi!==false){
  if(existsSync(resolve(root,'dist/index.html'))){app.use(express.static(resolve(root,'dist')));app.get('/{*path}',(_req,res)=>res.sendFile(resolve(root,'dist/index.html')));}
  else {const {createServer}=await import('vite');vite=await createServer({root,server:{middlewareMode:true},appType:'custom'});app.use(vite.middlewares);app.use(async(req,res,next)=>{try{const html=await vite.transformIndexHtml(req.originalUrl,readFileSync(resolve(root,'index.html'),'utf8'));res.type('html').send(html);}catch(e){next(e);}});}
 }
 const server=await new Promise<ReturnType<typeof app.listen>>(done=>{const s=app.listen(config.port,config.host,()=>done(s));});
 const tickErrors=new Map<string,string>();
 async function guard(name:string,fn:()=>Promise<any>){try{await fn();tickErrors.delete(name);}catch(e){const error=e instanceof Error?e.message:String(e);if(tickErrors.get(name)!==error){bus.emit('runtime.error',{module:name,error});tickErrors.set(name,error);console.error(`[${name}] ${error}`);}}}
 await guard('state',()=>intel.refresh());
 let timer:ReturnType<typeof setInterval>|undefined;
 if(options.autoTick!==false)timer=setInterval(()=>{void guard('state',()=>intel.refresh());void guard('government',()=>gov.tick());void guard('administration',()=>admin.tick());},config.autoTickMs);
 const address=server.address();const port=typeof address==='object'&&address?address.port:config.port;
 console.log(`群星 AI 政府：http://localhost:${port} · 游戏 ${config.gameMode} · 手机配对码 ${auth.code}`);
 let closed=false;
 return {app,server,services,port,pairingCode:auth.code,async close(){if(closed)return;closed=true;if(timer)clearInterval(timer);admin.updatePermissions({stopped:true});await new Promise<void>(r=>{server.close(()=>r());server.closeAllConnections();});await gov.shutdown();await admin.shutdown();await intel.shutdown();await vite?.close();store.close();}};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const runtime=await startApp();for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>{void runtime.close().then(()=>process.exit(0));});
}
