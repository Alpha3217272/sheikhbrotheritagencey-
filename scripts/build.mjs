import {mkdirSync,cpSync,rmSync,readFileSync,existsSync} from 'node:fs';
rmSync('dist',{recursive:true,force:true});
mkdirSync('dist',{recursive:true});
cpSync('public','dist',{recursive:true});
console.log('Netlify frontend ready: local HTML, JavaScript, CSS, images and videos. Deploy the API Edge Function too.');

for(const page of ['index.html','website-development/index.html','ai-creation/index.html','ai-automation/index.html','social-media-management/index.html','admin/index.html']){
 const html=readFileSync('dist/'+page,'utf8');
 for(const [,asset]of html.matchAll(/(?:src|href)="([^"]+\.(?:js|css)(?:\?[^"]*)?)"/g)){
  const url=new URL(asset,'https://sheikh-brother-it-agency.furqanfarooq923.chatgpt.site');
  if(url.origin==='https://sheikh-brother-it-agency.furqanfarooq923.chatgpt.site'&&!existsSync('dist'+url.pathname))throw new Error('Missing frontend asset: '+url.pathname);
 }
}
console.log('All six HTML pages and their JavaScript/CSS references verified.');
