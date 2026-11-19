import {createServer,type IncomingMessage,type ServerResponse} from 'node:http';
import {resolve,join} from 'node:path';
import {existsSync} from 'node:fs';
import {startProdServer} from 'vinext/server/prod-server';
import type {ViteDevServer} from 'vite';
import {zhiyuRuntimePlugins} from './runtime';
import {isTrustedHost} from '../npc/beta-identity';

type Next=(error?:unknown)=>void;
type Middleware=(req:IncomingMessage,res:ServerResponse,next:Next)=>unknown;
type Layer={prefix:string;handler:Middleware};

/** Minimal Connect-compatible routing for the existing, authenticated APIs.
 * This production process does not create a Vite development server. */
export function createMiddlewareChain(){
  const layers:Layer[]=[];
  const use=(prefix:string|Middleware,handler?:Middleware)=>{layers.push(typeof prefix==='function'?{prefix:'',handler:prefix}:{prefix,handler:handler!});};
  const handle=(req:IncomingMessage,res:ServerResponse,done:Next)=>{
    let index=0;
    const next:Next=error=>{
      if(error)return done(error);
      const layer=layers[index++];if(!layer)return done();
      const pathname=(req.url||'/').split('?')[0];
      if(layer.prefix&&pathname!==layer.prefix&&!pathname.startsWith(layer.prefix+'/'))return next();
      const original=req.url;
      if(layer.prefix)req.url=(req.url||'/').slice(layer.prefix.length)||'/';
      if(req.url?.startsWith('?'))req.url='/'+req.url;
      let advanced=false;
      const advance:Next=reason=>{if(advanced)return;advanced=true;req.url=original;next(reason);};
      try{const result=layer.handler(req,res,advance);if(result&&typeof (result as Promise<unknown>).catch==='function')void (result as Promise<unknown>).catch(advance);}
      catch(reason){advance(reason);}
    };
    next();
  };
  return {use,handle};
}

async function main(){
  const envFile=process.env.ZHIYU_ENV_FILE;
  if(envFile)process.loadEnvFile(resolve(envFile));
  const appRoot=resolve(process.env.ZHIYU_DATA_ROOT||process.cwd());
  const buildRoot=resolve(process.env.ZHIYU_BUILD_ROOT||join(process.cwd(),'dist'));
  process.env.ZHIYU_BETA_MODE='1';
  if(!existsSync(join(buildRoot,'server/index.js')))throw Error('缺少生产构建，请先运行 npm run beta:build');
  const host=process.env.HOST||'127.0.0.1',port=Number(process.env.PORT||3100);
  if(!Number.isInteger(port)||port<0||port>65535)throw Error('PORT 必须是有效端口');
  if(!process.env.ZHIYU_PUBLIC_ORIGIN&&!['127.0.0.1','localhost','::1'].includes(host))throw Error('对外启动前请设置 HTTPS 的 ZHIYU_PUBLIC_ORIGIN');
  // Reuse Vinext's complete production asset/RSC handler, including its request
  // context. Its temporary bootstrap listener is loopback-only and is closed.
  const frontend=await startProdServer({outDir:buildRoot,host:'127.0.0.1',port:0,silent:true});
  const renderers=frontend.server.listeners('request');
  await new Promise<void>((done,reject)=>frontend.server.close(error=>error?reject(error):done()));
  const chain=createMiddlewareChain();
  const server=createServer((req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','same-origin');
    if(!isTrustedHost(req)){res.writeHead(403);res.end('请求主机未授权');return;}
    const path=(req.url||'/').split('?')[0];
    if(path==='/healthz'){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end('{"ok":true}');return;}
    if(path==='/'){res.writeHead(302,{Location:'/mobile','Cache-Control':'no-store'});res.end();return;}
    if(path.startsWith('/api/')&&/(?:-|\/)health(?:\/|$)/.test(path)){res.writeHead(404);res.end();return;}
    if(/^\/(?:@|\.env|\.git|\.npc-runtime|output(?:\/|$)|server(?:\/|$)|scripts(?:\/|$)|api\/desktop(?:\/|$)|studio(?:\/|$)|speech-settings(?:\/|$)|topbar(?:\/|$)|npc\/[^/]+\/test(?:\/|$))/.test(path)){
      res.writeHead(404);res.end();return;
    }
    chain.handle(req,res,error=>{
      if(res.writableEnded)return;
      if(error){console.error('[beta] 请求处理失败');res.writeHead(500);res.end('服务暂时不可用');return;}
      if(path.startsWith('/api/')){res.writeHead(404);res.end();return;}
      for(const renderer of renderers)renderer.call(frontend.server,req,res);
    });
  });
  // Each independent runtime plugin registers one owned close hook.
  server.setMaxListeners(40);
  server.requestTimeout=120000;server.headersTimeout=15000;server.keepAliveTimeout=65000;
  const facade={config:{root:appRoot,server:{port:port||3100}},httpServer:server,middlewares:chain} as unknown as ViteDevServer;
  const after:Array<()=>unknown>=[];
  for(const plugin of zhiyuRuntimePlugins()){
    const hook=plugin.configureServer;if(!hook)continue;
    const fn=typeof hook==='function'?hook:hook.handler;
    const result=await fn.call({} as never,facade);if(typeof result==='function')after.push(result);
  }
  for(const hook of after)await hook();
  await new Promise<void>((done,reject)=>{server.once('error',reject);server.listen(port,host,done);});
  const address=server.address();
  console.log(`[beta] 智域生产服务已就绪：http://${host}:${typeof address==='object'&&address?address.port:port}；入口 /mobile，后台 /admin`);
  let stopping=false;
  const stop=()=>{if(stopping)return;stopping=true;server.close(()=>process.exit(0));server.closeIdleConnections();setTimeout(()=>process.exit(1),10000).unref();};
  process.once('SIGTERM',stop);process.once('SIGINT',stop);
}

if(process.env.ZHIYU_BETA_NO_START!=='1')void main().catch(()=>{console.error('[beta] 启动失败，请检查构建、端口、数据目录和配置。');process.exitCode=1;});
