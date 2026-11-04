import {randomUUID} from 'node:crypto';
import type {Plugin} from 'vite';

/** Cheap liveness identity only: no account, database, model or filesystem reads. */
export function localServiceHealth():Plugin {
  const instanceId=randomUUID();
  return {name:'zhiyu-local-service-health',configureServer(server){
    server.middlewares.use('/api/desktop/health',(req,res)=>{
      res.setHeader('Content-Type','application/json; charset=utf-8');
      res.setHeader('Cache-Control','no-store');
      res.setHeader('X-Content-Type-Options','nosniff');
      if(req.method!=='GET'){res.statusCode=405;res.end('{}');return;}
      if((req.url||'/').split('?')[0]!=='/'){res.statusCode=404;res.end('{}');return;}
      res.end(JSON.stringify({service:'zhiyu-local',ok:true,pid:process.pid,instanceId}));
    });
  }};
}
