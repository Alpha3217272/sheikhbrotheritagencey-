import test from 'node:test';
import assert from 'node:assert/strict';
import {proxy,serve,BACKEND} from '../netlify/edge-functions/agency-gateway.js';
const origin='https://agency-example.netlify.app';
const req=(path='/',init={})=>new Request(origin+path,init);

test('pages retain their design and use the new origin in SEO metadata',async()=>{
 let sent;
 const result=await proxy(req('/website-development?x=1'),async r=>{sent=r;return new Response('<h1>Your business.</h1><link rel="canonical" href="'+BACKEND+'/website-development">',{headers:{'content-type':'text/html','content-security-policy':"default-src 'self'",etag:'old'}})});
 assert.equal(sent.url,BACKEND+'/website-development?x=1');
 assert.match(await result.text(),new RegExp(origin.replaceAll('.','\\.')));
 assert.match(result.headers.get('content-security-policy'),/default-src 'self'/);
 assert.equal(result.headers.get('etag'),null);
});
test('a validated form keeps its body and cookie while translating the origin',async()=>{
 const data=JSON.stringify({service:'Website Development',message:'A project enquiry'});
 const result=await proxy(req('/api/enquiries',{method:'POST',headers:{origin,'content-type':'application/json',cookie:'__Host-sb_portal=test','sec-fetch-site':'same-origin'},body:data}),async r=>{
  assert.equal(r.method,'POST');assert.equal(r.headers.get('origin'),BACKEND);
  assert.equal(r.headers.get('cookie'),'__Host-sb_portal=test');assert.equal(await r.text(),data);
  return Response.json({ok:true});
 });
 assert.equal(result.status,200);assert.match(result.headers.get('cache-control'),/no-store/);
});
test('cross-site, missing-origin and null-origin writes never reach the backend',async()=>{
 for(const init of [{origin:'https://other.test'},{},{origin:'null'},{origin,'sec-fetch-site':'cross-site'}]){
  let calls=0;const response=await proxy(req('/api/portal-auth',{method:'POST',headers:init,body:'{}'}),async()=>{calls++;return new Response()});
  assert.equal(response.status,403);assert.equal(calls,0);
 }
});
test('visitor-supplied identity, forwarding and authorization headers are removed',async()=>{
 const r=await proxy(req('/',{headers:{'oai-authenticated-user-email':'forged@test.invalid','cf-connecting-ip':'1.2.3.4','x-forwarded-host':'evil.test',authorization:'forged'}}),async r=>{
  for(const h of ['oai-authenticated-user-email','cf-connecting-ip','x-forwarded-host','authorization'])assert.equal(r.headers.get(h),null);
  return new Response('ok');
 });assert.equal(r.status,200);
});
test('gateway destination is fixed even with a URL-like path or target parameter',async()=>{
 await proxy(req('//other.test/path?target=https://other.test'),async r=>{assert.equal(new URL(r.url).origin,BACKEND);return new Response('ok')});
});
test('portal cookies retain security attributes and cannot be CDN cached',async()=>{
 const h=new Headers();h.append('set-cookie','__Host-sb_portal=test; Path=/; Secure; HttpOnly; SameSite=Strict');h.append('set-cookie','other=value; Path=/; Secure');
 const r=await proxy(req('/api/portal-auth',{method:'POST',headers:{origin},body:'{}'}),async()=>new Response('{}',{headers:h}));
 assert.equal(r.headers.getSetCookie().length,2);assert.match(r.headers.get('set-cookie'),/HttpOnly/);
 assert.equal(r.headers.get('netlify-cdn-cache-control'),'no-store');
});
test('redirects remain on the deployed origin and are not fetched automatically',async()=>{
 const r=await proxy(req('/studio'),async r=>{assert.equal(r.redirect,'manual');return new Response(null,{status:307,headers:{location:BACKEND+'/admin'}})});
 assert.equal(r.status,307);assert.equal(r.headers.get('location'),origin+'/admin');
 const external=await proxy(req('/external'),async()=>new Response(null,{status:302,headers:{location:'https://external.test/'}}));
 assert.equal(external.headers.get('location'),'https://external.test/');
});
test('sitemap and robots refer to the Netlify domain',async()=>{
 for(const [path,type] of [['/sitemap.xml','application/xml'],['/robots.txt','text/plain']]){
  const r=await proxy(req(path),async()=>new Response(BACKEND+'/website-development',{headers:{'content-type':type}}));
  assert.equal(await r.text(),origin+'/website-development');
 }
});
test('video ranges, statuses and bytes survive unchanged',async()=>{
 const bytes=new Uint8Array([0,1,4,255]);
 const r=await proxy(req('/video.mp4',{headers:{range:'bytes=0-3'}}),async r=>{assert.equal(r.headers.get('range'),'bytes=0-3');return new Response(bytes,{status:206,headers:{'content-type':'video/mp4','content-range':'bytes 0-3/100','content-length':'4'}})});
 assert.equal(r.status,206);assert.equal(r.headers.get('content-range'),'bytes 0-3/100');assert.deepEqual(new Uint8Array(await r.arrayBuffer()),bytes);
});
test('the notification worker keeps its scope and update headers',async()=>{
 const r=await proxy(req('/agency-notifications.js'),async()=>new Response('self.addEventListener("push",()=>{})',{headers:{'content-type':'text/javascript'}}));
 assert.equal(r.headers.get('service-worker-allowed'),'/');assert.equal(r.headers.get('cache-control'),'no-cache');
});
test('source maps and deployment source files are not served',async()=>{
 for(const p of ['/.env','/netlify.toml','/package.json','/scripts/build.mjs','/netlify/edge-functions/agency-gateway.js','/app.js.map','/app.js%2emap']){
  const r=await proxy(req(p),async()=>{throw new Error('must not fetch')});assert.equal(r.status,404);
 }
});
test('backend failures return a clear error instead of a fake success',async()=>{
 const r=await proxy(req('/'),async()=>{throw new Error('network')});assert.equal(r.status,502);assert.match(await r.text(),/could not be reached/);
});
test('HEAD and 304 return no response body',async()=>{
 const r=await proxy(req('/',{method:'HEAD'}),async()=>new Response(null,{headers:{'content-type':'text/html'}}));assert.equal(await r.text(),'');
 const cached=await proxy(req('/file.js'),async()=>new Response(null,{status:304}));assert.equal(cached.status,304);assert.equal(await cached.text(),'');
});

test('frontend pages and assets are served from Netlify without contacting the backend',async()=>{
 for(const [path,type] of [['/','text/html'],['/_next/static/main.js','text/javascript'],['/_next/static/main.css','text/css'],['/video.mp4','video/mp4']]){
  let local=0,remote=0;
  const r=await serve(req(path),{next:async()=>{local++;return new Response(type==='text/html'?'<h1>Local frontend</h1>':'local bytes',{headers:{'content-type':type}})}},async()=>{remote++;throw new Error('Backend offline')});
  assert.equal(r.status,200);assert.equal(local,1);assert.equal(remote,0);assert.ok((await r.text()).toLowerCase().includes('local'));
 }
});
test('API routes still use the backend while static admin shell remains private',async()=>{
 let local=0,remote=0;
 const api=await serve(req('/api/site'),{next:async()=>{local++;return new Response()}},async()=>{remote++;return Response.json({site:{}})});
 assert.equal(api.status,200);assert.equal(local,0);assert.equal(remote,1);
 const admin=await serve(req('/admin'),{next:async()=>new Response('<p>Loading portal</p>',{headers:{'content-type':'text/html'}})},async()=>{throw new Error('No remote frontend')});
 assert.match(admin.headers.get('cache-control'),/no-store/);assert.match(admin.headers.get('x-robots-tag'),/noindex/);
});
test('frontend routes never forward unexpected form writes',async()=>{
 const r=await serve(req('/website-development',{method:'POST',headers:{origin},body:'{}'}),{next:async()=>{throw new Error('Unexpected')}});assert.equal(r.status,405);
});

test('backend PDF sandbox policy is preserved',async()=>{
 const r=await proxy(req('/api/quotations/test/pdf'),async()=>new Response('pdf',{headers:{'content-type':'application/pdf','content-security-policy':"default-src 'none'; sandbox"}}));
 assert.equal(r.headers.get('content-security-policy'),"default-src 'none'; sandbox");
});

test('all four service routes recover from static routing 404s',async()=>{
 for(const route of ['website-development','ai-creation','ai-automation','social-media-management']){
  for(const suffix of ['', '/']){
   let calls=0;
   const r=await serve(req('/'+route+suffix),{next:async()=>new Response('missing',{status:404})},async upstream=>{calls++;assert.equal(new URL(upstream.url).pathname,'/'+route+suffix);return new Response('<h1>Service page</h1>',{headers:{'content-type':'text/html'}})});
   assert.equal(r.status,200);assert.equal(calls,1);assert.match(await r.text(),/Service page/);
  }
 }
});
test('unknown routes remain 404 rather than serving an unrelated homepage',async()=>{
 const r=await serve(req('/does-not-exist'),{next:async()=>new Response('missing',{status:404})},async()=>{throw new Error('must not fetch')});assert.equal(r.status,404);
});

// Regression: the previous global origin replacement shortened Flight text
// records without updating their hex byte counts. Test the real exported pages.
const flightChunks = html => [...html.matchAll(/\.rsc\.push\(("(?:[^"\\]|\\.)*")\)/g)].map(m=>JSON.parse(m[1]));
function checkFlightFrames(chunks) {
 const data=Buffer.from(chunks.join(''));let cursor=0,textRecords=0;
 while(cursor<data.length){
  const head=/^([0-9a-f]*):/.exec(data.subarray(cursor).toString());
  if(!head)throw new Error('Invalid Flight record at '+cursor);
  const start=cursor+head[0].length;
  const length=/^T([0-9a-f]+),/.exec(data.subarray(start).toString());
  if(length){cursor=start+length[0].length+parseInt(length[1],16);textRecords++;}
  else {const end=data.indexOf(10,start);if(end<0)throw new Error('Truncated Flight record');cursor=end+1;}
  if(cursor>data.length)throw new Error('Truncated Flight text');
 }
 return textRecords;
}
test('real homepage, all service pages and admin retain exact React bootstrap bytes',async()=>{
 const {readFileSync}=await import('node:fs');
 for(const page of ['index.html','website-development/index.html','ai-creation/index.html','ai-automation/index.html','social-media-management/index.html','admin/index.html']){
  const source=readFileSync(new URL('../public/'+page,import.meta.url),'utf8');
  const before=flightChunks(source);
  assert.ok(before.length>0,page+' has a React payload');
  checkFlightFrames(before);
  for(const domain of [origin,'https://a.co','https://a-much-longer-custom-domain.example.com']){
   const result=await serve(new Request(domain+'/'+page),{next:async()=>new Response(source,{headers:{'content-type':'text/html'}})});
   const after=flightChunks(await result.text());
   assert.deepEqual(after,before,page+' must preserve each payload chunk exactly');
   assert.equal(checkFlightFrames(after),checkFlightFrames(before));
   assert.equal(result.headers.get('netlify-cdn-cache-control'),'no-store');
  }
 }
});
test('regression fixture demonstrates why global domain replacement corrupts Flight',async()=>{
 const {readFileSync}=await import('node:fs');
 const source=readFileSync(new URL('../public/social-media-management/index.html',import.meta.url),'utf8');
 assert.throws(()=>checkFlightFrames(flightChunks(source.replaceAll(BACKEND,origin))),/Flight/);
});
test('client navigation and prefetch receive unmodified Flight data, never static HTML',async()=>{
 for(const route of ['/','/website-development','/ai-creation/','/ai-automation','/social-media-management/','/admin']){
  for(const variant of [{suffix:'?_rsc=prefetch',headers:{}},{suffix:'',headers:{rsc:'1'}},{suffix:'',headers:{accept:'text/x-component'}}]){
   const payload='0:'+JSON.stringify({url:BACKEND+'/path',text:'پاکستان'})+'\n';
   const response=await serve(req(route+variant.suffix,{headers:variant.headers}),{next:async()=>{throw new Error('Must not serve HTML')}},async request=>{
    assert.equal(new URL(request.url).search,variant.suffix);
    for(const [key,value] of Object.entries(variant.headers))assert.equal(request.headers.get(key),value);
    return new Response(payload,{headers:{'content-type':'text/x-component',vary:'RSC, Accept'}});
   });
   assert.equal(await response.text(),payload);
   assert.equal(response.headers.get('content-type'),'text/x-component');
   assert.equal(response.headers.get('netlify-cdn-cache-control'),'no-store');
  }
 }
});
