const fs=require('node:fs'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const page='85becb11-eadd-46fd-8471-211c6c9334d9';
const originalFiles=['reader-content-pack.json','reader-content-pack.md','reader-review.html','render-reader-review.cjs'];
const hash=f=>crypto.createHash('sha256').update(fs.readFileSync('docs/marketing/'+f)).digest('hex');
const hashes=Object.fromEntries(originalFiles.map(f=>[f,hash(f)]));
const rawCodes=['INVALID_INPUT','NOT_APPROVED','STALE_DRAFT','DUPLICATE','INVALID_TRANSITION','NOT_DUE','RETRY_NOT_ALLOWED','RECONCILE_REQUIRED','NOT_CONNECTED','CAPABILITY_UNVERIFIED','MODE_MISMATCH','NO_EVIDENCE','STALE_RESULT','UNEXPECTED_PRIVATE_CODE'];
const rows=[];
function call(args){const out=execFileSync('powershell.exe',['-NoProfile','-Command',`orca ${args} --page ${page} --json`],{encoding:'utf8'});const r=JSON.parse(out);assert.equal(r.ok,true,out);return r.result;}
function evaluate(js){return JSON.parse(call(`eval --expression '${js.replaceAll("'","''")}'`).result);}
const click=ref=>call(`click --element '${ref}'`);
const fill=(ref,value)=>call(`fill --element '${ref}' --value '${value}'`);
function capture(label,expected){const row=evaluate(`JSON.stringify({error:document.querySelector('[role=alert]').textContent,review:document.querySelector('.ds-review-summary').textContent,result:document.querySelector('.ds-execution-result').textContent,message:document.querySelector('[role=status]').textContent,text:document.body.innerText,attempts:window.qaAttempts})`);assert.ok(JSON.stringify(row).includes(expected),label);if(label.startsWith('fixture '))assert.ok(row.error.trim().length>0);for(const code of [...rawCodes,'dry_run_succeeded','DO_NOT_SHOW_SECRET'])assert.ok(!row.text.includes(code),label+' leaked '+code);delete row.text;rows.push({label,...row});}
click('@e9');capture('unreviewed','먼저 확인');
fill('@e7',' ');click('@e8');capture('blank-body','제목과 본문을 모두');
fill('@e7','로컬 검증용 본문입니다. 실제 게시하지 않습니다.');click('@e8');capture('review','샘플 검토 확인됨');
fill('@e7','검토 후 수정한 로컬 본문입니다.');capture('edit invalidation','무효');
click('@e9');capture('edited unreviewed blocked','먼저 확인');
click('@e8');click('@e9');capture('completed','모의 실행 완료 · 외부 게시 없음');
assert.deepEqual(rows.at(-1).attempts,[1]);
click('@e9');capture('natural duplicate','모의 실행 요청이 이미 있습니다');
for(const code of rawCodes){evaluate(`JSON.stringify((window.qaForceCreateError('${code}'),true))`);click('@e9');capture('fixture '+code,code==='UNEXPECTED_PRIVATE_CODE'?'모의 실행을 마치지 못했습니다':'');}
evaluate(`JSON.stringify((window.qaForceCreateError(null),true))`);
click('@e10');click('@e8');click('@e9');capture('reset then normal completion','모의 실행 완료 · 외부 게시 없음');
const widths=[];
for(const width of [320,390,1440]){call(`viewport --width ${width} --height 900 ${width<400?'--mobile':''}`);const row=evaluate(`JSON.stringify({width:innerWidth,scroll:document.documentElement.scrollWidth,overflow:[...document.querySelectorAll('main *')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&(r.right>innerWidth+1||r.left< -1)}).map(e=>e.tagName)})`);assert.ok(row.scroll<=row.width);assert.deepEqual(row.overflow,[]);widths.push(row);}
for(const [file,value]of Object.entries(hashes))assert.equal(hash(file),value);
fs.writeFileSync('docs/qa/UI-MKT-001/browser-results.json',JSON.stringify({rows,widths,contentV2Hashes:hashes},null,2));
console.log('PASS: 8 normal-flow checks, 14 synthetic error-code views with no raw/private text, attempt=1 captured, 3 widths and content v2 hashes preserved.');
