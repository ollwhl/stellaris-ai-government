import type { Request,Response,NextFunction } from 'express';
import { randomInt,randomBytes,createHash,timingSafeEqual } from 'node:crypto';
import type { Context } from '../contracts/index.ts';
export function createAuth(ctx:Context){
 const code=String(randomInt(100000,1000000));
 const failures=new Map<string,{count:number;since:number}>();
 const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
 const isLocal=(req:Request)=>['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress??'');
 function authenticated(req:Request){if(isLocal(req))return true;const token=req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith('stg_session='))?.slice(12);if(!token)return false;const session=ctx.store.get<{expires:number}>('sessions',hash(token));return !!session&&session.expires>Date.now();}
 function sameOrigin(req:Request,res:Response,next:NextFunction){if(['GET','HEAD','OPTIONS'].includes(req.method))return next();const origin=req.headers.origin;if(origin){try{if(new URL(origin).host!==req.headers.host)return res.status(403).json({error:'请求来源不匹配'});}catch{return res.status(403).json({error:'请求来源无效'});}}next();}
 function requireSession(req:Request,res:Response,next:NextFunction){if(!ctx.config.pairingRequired||authenticated(req))return next();return res.status(401).json({error:'请先输入本地服务显示的配对码',requiresPairing:true});}
 function pair(req:Request,res:Response){const ip=req.socket.remoteAddress??'';let attempts=failures.get(ip);if(!attempts||Date.now()-attempts.since>60000){attempts={count:0,since:Date.now()};failures.set(ip,attempts);}if(attempts.count>=6)return res.status(429).json({error:'尝试过多，请一分钟后重试'});const supplied=String(req.body.code??'');if(supplied.length!==code.length||!timingSafeEqual(Buffer.from(supplied),Buffer.from(code))){attempts.count++;return res.status(403).json({error:'配对码不正确'});}failures.delete(ip);const token=randomBytes(32).toString('hex');ctx.store.set('sessions',hash(token),{expires:Date.now()+30*86400000});res.cookie('stg_session',token,{httpOnly:true,sameSite:'strict',maxAge:30*86400000,path:'/'});return res.json({authenticated:true});}
 return {code,sameOrigin,requireSession,pair,authenticated};
}
