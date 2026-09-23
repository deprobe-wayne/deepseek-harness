/** Compare configured and /v1 API paths; emit response metadata only, never credentials. */
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const require = createRequire(root+'apps/cli/package.json');
const yaml = require('js-yaml');
const settings = yaml.load(await readFile(root+'../.dsh-home/settings.yaml','utf8'));
const credentials = yaml.load(await readFile(root+'../.dsh-home/.credentials.yaml','utf8'));
const selected = settings['agent-default-model'];
const profile = settings['llm-pi-ai'].providers[selected.provider];
const key = process.env[profile.apiKeyEnv] || credentials.refs?.[profile.apiKeyEnv];
if (typeof key !== 'string' || !key) throw new Error('Configured credential reference did not resolve');
const base = profile.baseURL.replace(/\/$/,'');
const candidates = [...new Set([base, base.endsWith('/v1') ? base.slice(0,-3) : base+'/v1'])];
const results = await Promise.all(candidates.flatMap(url => [false,true].map(async stream => {
 const target = url+'/chat/completions', start = Date.now();
 try {
  const response = await fetch(target, { method:'POST', redirect:'manual', signal:AbortSignal.timeout(45000), headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'}, body:JSON.stringify({model:selected.model,messages:[{role:'user',content:'Reply with exactly OK.'}],max_tokens:64,stream,thinking:{type:'disabled'}}) });
  const text = await response.text();
  const types = [], finishes = []; let contentChars = 0, done = false, json = 0, unparsed = 0, error;
  const chunks = stream ? text.split(/\r?\n/).filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trim()) : [text];
  for(const chunk of chunks) {
   if(chunk==='[DONE]'){done=true;continue;}
   try {const data=JSON.parse(chunk); json++; if(data.object)types.push(data.object); if(data.error)error={code:data.error.code,type:data.error.type,message:String(data.error.message).replaceAll(key,'[redacted]').slice(0,350)};
    for(const c of data.choices||[]){if(c.finish_reason)finishes.push(c.finish_reason);contentChars+=(c.delta?.content||c.message?.content||'').length;}
   }catch{unparsed++;}
  }
  return {target,stream,status:response.status,contentType:response.headers.get('content-type'),bytes:Buffer.byteLength(text),html:/<!doctype html|<html/i.test(text),htmlTitle:text.match(/<title>([^<]*)<\/title>/i)?.[1],dataEvents:stream?chunks.length:undefined,json,unparsed,done,finishes:[...new Set(finishes)],types:[...new Set(types)],contentChars,error,elapsedMs:Date.now()-start};
 }catch(e){return{target,stream,error:{name:e.name,message:e.message},elapsedMs:Date.now()-start};}
})));
const result={provider:selected.provider,model:selected.model,configuredBase:base,results};
await writeFile(root+'product/zhuanleme/evidence/api-route-diagnostic.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
