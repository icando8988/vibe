const fs=require('node:fs'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {renderReaderReview}=require('../../marketing/render-reader-review.cjs');
const root='docs/marketing/';
const load=name=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(fs.readFileSync(root+name)));
const v1=load('first-content-pack.json'),v2=load('reader-content-pack.json');
const hash=name=>crypto.createHash('sha256').update(fs.readFileSync(root+name)).digest('hex');
const hashes=Object.fromEntries(['first-content-pack.json','first-content-pack.md','render-content-review.cjs','content-review.html'].map(f=>[f,hash(f)]));
const md=fs.readFileSync(root+'reader-content-pack.md','utf8');
const expected=[];let holds=0;
for(let n=0;n<3;n++){
 const topic=v2.topics[n];assert.equal(topic.variants.length,3);
 for(const [kind,item]of [['original',topic.original],...topic.variants.map(i=>[i.channel,i])]){
  assert.equal(item.status,'draft');for(const key of ['publicApproval','runtimeImportAllowed','externallyPosted'])assert.equal(item[key],false);
  assert.equal(item.suggestedCTA.path,'/about');assert.ok(md.includes(item.title));assert.ok(md.includes(item.body));
  assert.equal(item.editorialHold,n===1||kind==='instagram');if(item.editorialHold){holds++;assert.ok(item.editorialHoldReasons.length);}
  assert.doesNotMatch(item.body,/기획서|제안합니다|초안입니다|창작하지|확인이 필요|차례로|알려 드|km|기네스|최고령|협찬|https?:\/\/|@[a-zA-Z]|#[가-힣A-Za-z]/);
  if(n===1)assert.ok(!item.sourceRefs.some(s=>s.endsWith('E48')));
  const old=kind==='original'?v1.topics[n].original:v1.topics[n].variants.find(i=>i.channel===kind);
  expected.push({title:old.title,body:old.body},{title:item.title,body:item.body});
 }
}
assert.equal(holds,6);assert.equal(v2.pendingQuestions.length,6);assert.equal(v2.repositoryNameUseApproval.grantsPostPublicationApproval,false);
const html=fs.readFileSync(root+'reader-review.html','utf8');assert.equal(html,renderReaderReview(v1,v2));
const malicious=structuredClone(v2);malicious.topics[0].original.body='</script><img src=x onerror="window.injected=true">';
const escaped=renderReaderReview(v1,malicious);assert.ok(escaped.includes('&lt;/script&gt;'));assert.ok(!escaped.includes('<img src=x'));assert.equal((escaped.match(/<\/script>/g)||[]).length,1);
new(require('node:vm').Script)(html.split('<script>')[1].split('</script>')[0]);
const page='da2f93e0-2c2c-4bda-b2d1-07f1a0471e9a';
function call(args){const raw=execFileSync('powershell.exe',['-NoProfile','-Command',`orca ${args} --page ${page} --json`],{encoding:'utf8'});const r=JSON.parse(raw);assert.equal(r.ok,true,raw);return r.result;}
function evaluate(js){return JSON.parse(call(`eval --expression '${js.replaceAll("'","''")}'`).result);}
const actual=evaluate(`JSON.stringify([...document.querySelectorAll('article')].map(a=>({title:a.querySelector('h3').textContent,body:a.querySelector('.copy-body').textContent})))`);assert.deepEqual(actual,expected);
assert.equal(evaluate(`JSON.stringify(document.querySelectorAll('.hold').length)`),6);
const checks=[];
for(const width of [320,390,1440]){
 call(`viewport --width ${width} --height 900 ${width<400?'--mobile':''}`);
 for(let topic=0;topic<3;topic++){
  call(`select --element '@e25' --value ${topic}`);
  for(const kind of ['original','blog','threads','instagram']){
   call(`select --element '@e26' --value ${kind}`);
   const row=evaluate(`JSON.stringify({width:innerWidth,scroll:document.documentElement.scrollWidth,topic:document.querySelector('section:not([hidden])').dataset.topic,kind:document.querySelector('section:not([hidden]) .pair:not([hidden])').dataset.kind,versions:[...document.querySelectorAll('section:not([hidden]) .pair:not([hidden]) article')].map(a=>a.dataset.version),hold:document.querySelectorAll('section:not([hidden]) .pair:not([hidden]) .hold').length,overflow:[...document.querySelectorAll('main *')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&(r.right>innerWidth+1||r.left< -1)}).map(e=>e.tagName)})`);
   assert.equal(row.topic,String(topic));assert.equal(row.kind,kind);assert.deepEqual(row.versions,['v1','v2']);assert.equal(row.hold,topic===1||kind==='instagram'?1:0);assert.ok(row.scroll<=row.width);assert.deepEqual(row.overflow,[]);checks.push(row);
  }
 }
}
for(const [name,value]of Object.entries(hashes))assert.equal(hash(name),value);
fs.writeFileSync('docs/qa/MKT-010/browser-results.json',JSON.stringify({v1Hashes:hashes,exactTextPairs:12,unapprovedV2Items:12,heldV2Items:6,checks},null,2));
console.log('PASS: 12 v1/v2 exact pairs, 12 unapproved v2, 6 holds, 36 topic/item/width cases, editorial copy/source checks, script escaping, original hashes preserved.');
