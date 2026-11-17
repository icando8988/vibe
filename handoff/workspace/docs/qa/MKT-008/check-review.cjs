const fs=require('node:fs');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {renderReview}=require('../../marketing/render-content-review.cjs');
const page='a3fe18d9-5d3b-42a5-a3b9-ac44636d25ae';
const jsonPath='docs/marketing/first-content-pack.json';
const mdPath='docs/marketing/first-content-pack.md';
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const sourceHashes={json:hash(jsonPath),markdown:hash(mdPath)};
const source=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(fs.readFileSync(jsonPath)));
const expected=source.topics.flatMap(t=>[t.original,...t.variants].map(i=>({title:i.title,body:i.body})));
function call(args){const raw=execFileSync('powershell.exe',['-NoProfile','-Command',`orca ${args} --page ${page} --json`],{encoding:'utf8'});const r=JSON.parse(raw);assert.equal(r.ok,true,raw);return r.result;}
function evaluate(js){return JSON.parse(call(`eval --expression '${js.replaceAll("'","''")}'`).result);}
const rendered=fs.readFileSync('docs/marketing/content-review.html','utf8');
assert.equal(rendered,renderReview(source));
assert.equal((rendered.match(/<script>/g)||[]).length,1);
assert.equal((rendered.match(/<\/script>/g)||[]).length,1);
const actual=evaluate(`JSON.stringify([...document.querySelectorAll('.draft-panel')].map(a=>({title:a.querySelector('h3').textContent,body:a.querySelector('.draft-body').textContent})))`);
assert.deepEqual(actual,expected);
assert.equal(evaluate(`JSON.stringify([...document.querySelectorAll('.badge')].filter(e=>e.textContent.includes('false')).length)`),12);
assert.equal(evaluate(`JSON.stringify([...document.querySelectorAll('button')].every(b=>b.className==='copy-button'))`),true);
const malicious=structuredClone(source);
const payload='</script><img src=x onerror="window.injected=true"><script>window.injected=true</script> & "\u2028\u2029';
malicious.topics[0].original.title=payload;
malicious.topics[0].original.body=payload;
malicious.sourceCaution=payload;
const safe=renderReview(malicious);
assert.equal((safe.match(/<script>/g)||[]).length,1);
assert.equal((safe.match(/<\/script>/g)||[]).length,1);
assert.ok(!safe.includes('<img src=x'));
assert.ok(safe.includes('&lt;/script&gt;'));
fs.writeFileSync('docs/qa/MKT-008/escape-review.html',safe,'utf8');
const widths=[];
for(const width of [320,390,1440]){
 call(`viewport --width ${width} --height 900 ${width<400?'--mobile':''}`);
 for(let topic=0;topic<3;topic++){
  call(`select --element '@e3' --value ${topic}`);
  for(const [channel,ref]of [['blog','@e5'],['threads','@e6'],['instagram','@e7']]){
   call(`check --element '${ref}'`);
   const row=evaluate(`JSON.stringify({width:innerWidth,scroll:document.documentElement.scrollWidth,topic:document.querySelector('.topic-panel:not([hidden])').dataset.topic,visible:[...document.querySelectorAll('.topic-panel:not([hidden]) .draft-panel:not([hidden])')].map(a=>a.dataset.kind),status:document.getElementById('selection-status').textContent,overflow:[...document.querySelectorAll('main *')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&(r.right>innerWidth+1||r.left< -1)}).map(e=>e.tagName+'.'+e.className)})`);
   assert.equal(row.topic,String(topic));assert.deepEqual(row.visible,['original',channel]);assert.ok(row.scroll<=row.width);assert.deepEqual(row.overflow,[]);widths.push(row);
  }
 }
}
assert.equal(hash(jsonPath),sourceHashes.json);assert.equal(hash(mdPath),sourceHashes.markdown);
fs.writeFileSync('docs/qa/MKT-008/browser-results.json',JSON.stringify({sourceHashes,exactItems:12,unapprovedBadges:12,escapeChecks:'pass',widths},null,2));
console.log('PASS: deterministic output, 12 exact title/body pairs, 12 unapproved badges, escape safety, 27 topic-channel-width combinations, unchanged source hashes.');
