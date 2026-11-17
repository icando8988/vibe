// Run from D:/Vibe while preview-harness.cjs listens on localhost:3315.
const fs = require('node:fs');
const {execFileSync} = require('node:child_process');
const page = '94ffda3d-1a23-4582-a780-d81a3d17dd82';
const evidence=[];
function call(args) {
  const out=execFileSync('powershell.exe',['-NoProfile','-Command',`orca ${args} --page ${page} --json`],{encoding:'utf8'});
  const reply=JSON.parse(out); if(!reply.ok) throw Error(out); return reply.result;
}
function evaluate(js){return JSON.parse(call(`eval --expression '${js.replaceAll("'","''")}'`).result);}
function check(label, expected) {
  const state=evaluate(`JSON.stringify({review:document.querySelector('.ds-review-summary').textContent,error:document.querySelector('[role=alert]').textContent,result:document.querySelector('.ds-execution-result').textContent,message:document.querySelector('[role=status]').textContent})`);
  if(!JSON.stringify(state).includes(expected))throw Error(label+' '+JSON.stringify(state));
  evidence.push({label,...state});
}
const click=ref=>call(`click --element '${ref}'`);
const fill=(ref,value)=>call(`fill --element '${ref}' --value '${value}'`);
click('@e10'); check('unreviewed execution blocked','먼저 확인');
click('@e9'); check('explicit sample review','현재 버전 샘플 검토 확인됨');
fill('@e8','수정한 샘플 본문입니다. 실제 게시하지 않습니다.'); check('edit invalidates review','무효');
click('@e10'); check('edited unreviewed execution blocked','먼저 확인');
click('@e9'); click('@e10'); check('review then dry run','dry_run_succeeded');
click('@e10'); check('repeat execution rejected by shared duplicate guard','DUPLICATE');
fill('@e8',' '); click('@e9'); check('whitespace body review blocked','제목과 본문을 모두');
click('@e10'); check('blank-body execution blocked','먼저 확인');
fill('@e7',' '); click('@e9'); check('blank title and body blocked','제목과 본문을 모두');
click('@e11'); check('reset also invalidates review','다시 샘플 검토');
click('@e16'); click('@e9'); click('@e10'); check('channel-specific dry-run','dry_run_succeeded');
const widths=[];
for(const width of [320,390,768,1440]) {
  call(`viewport --width ${width} --height 900 ${width<=390?'--mobile':''}`);
  const row=evaluate(`JSON.stringify({width:innerWidth,scroll:document.documentElement.scrollWidth,overflow:[...document.querySelectorAll('main *')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&(r.right>innerWidth+1||r.left< -1)}).map(e=>e.tagName+'.'+e.className),capabilities:document.querySelector('.ds-capabilities').textContent})`);
  if(row.scroll>row.width||row.overflow.length)throw Error('overflow '+JSON.stringify(row));
  widths.push(row);
}
fs.writeFileSync('docs/qa/MKT-005/browser-results.json',JSON.stringify({evidence,widths},null,2));
console.log('PASS '+evidence.length+' interaction cases and '+widths.length+' widths');
