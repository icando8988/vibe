// Run from D:/Vibe: node docs/qa/DEV-002B/check-browser.cjs <width>
// Requires this task's Orca page and local server on 3312.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const page = '643560bd-4cf8-4d75-a2c5-5462c512a1c1';
const width = Number(process.argv[2] || 390);
// Use PowerShell to preserve JS quoting through Windows CLI argument parsing.
function call(command) {
  const out = execFileSync('powershell.exe', ['-NoProfile', '-Command', command], { encoding: 'utf8' });
  const parsed = JSON.parse(out);
  if (!parsed.ok) throw Error(out);
  return parsed.result;
}
const expression = `JSON.stringify({url:location.pathname,width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,main:document.querySelectorAll('main').length,h1:document.querySelectorAll('h1').length,mainTarget:document.querySelectorAll('#main-content').length,contactTarget:document.querySelectorAll('#contact').length,bodyFont:getComputedStyle(document.body).fontSize,title:document.querySelector('h1')?.textContent,notice:[...document.querySelectorAll('.ds-notice')].map(e=>e.textContent),overflow:[...document.querySelectorAll('main *,header *,footer *')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&(r.right>innerWidth+1||r.left< -1)}).slice(0,10).map(e=>e.tagName+'.'+e.className),smallTargets:[...document.querySelectorAll('a')].filter(e=>e.getBoundingClientRect().height<44).map(e=>({text:e.textContent,height:e.getBoundingClientRect().height}))})`;
const rows = [];
for (const route of ['/', '/books', '/about', '/how-it-works', '/login', '/me', '/admin', '/missing-page-dev-002b']) {
  call(`orca goto --page ${page} --url http://127.0.0.1:3312${route} --json`);
  call(`orca viewport --page ${page} --width ${width} --height 900 ${width <=390 ? '--mobile' : ''} --json`);
  const data = call(`orca eval --page ${page} --expression '${expression.replaceAll("'", "''")}' --json`);
  const row = JSON.parse(data.result);
  if (row.url !== route) throw Error('Browser page changed during check: ' + route + ' -> ' + row.url);
  rows.push(row);
}
fs.writeFileSync(`docs/qa/DEV-002B/routes-${width}.json`, JSON.stringify(rows, null, 2));
console.log(JSON.stringify(rows.map(({url,width,scrollWidth,main,h1,overflow,smallTargets})=>({url,width,scrollWidth,main,h1,overflow,smallTargets})),null,2));
