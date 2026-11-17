const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const page = '643560bd-4cf8-4d75-a2c5-5462c512a1c1';
const rows = [];
function call(command) {
  const raw = execFileSync('powershell.exe', ['-NoProfile', '-Command', command], {encoding:'utf8'});
  const response=JSON.parse(raw);
  if (!response.ok) throw Error(raw);
  return response.result;
}
function evaluate(expression) {
  return JSON.parse(call(`orca eval --page ${page} --expression '${expression.replaceAll("'", "''")}' --json`).result);
}
function state(label) {
  rows.push({label,...evaluate(`JSON.stringify({url:location.href,focus:document.activeElement.tagName+'#'+document.activeElement.id,focusText:document.activeElement.textContent?.trim().slice(0,80),hasFocus:document.hasFocus(),outline:getComputedStyle(document.activeElement).outline,scrollY})`)});
}
function key(key) { call(`orca keypress --page ${page} --key ${key} --json`); }
call(`orca goto --page ${page} --url http://127.0.0.1:3312/ --json`);
call(`orca viewport --page ${page} --width 390 --height 844 --mobile --json`);
// Put DOM sequential navigation at the document start, then use real key commands.
evaluate(`JSON.stringify((document.activeElement.blur(),window.scrollTo(0,0),true))`);
key('Tab'); state('Tab to skip link');
key('Enter'); state('Enter skip -> main');
key('Shift+Tab'); state('Shift+Tab -> final header link');
key('Tab'); state('Tab -> first main action');
key('Enter'); state('Enter books CTA -> /books');
// Exercise the native contact anchor by keyboard after selecting the actual link.
evaluate(`JSON.stringify(([...document.querySelectorAll('a')].find(e=>e.hash==='#contact').focus(),true))`);
key('Enter'); state('Enter contact anchor -> contact');
// CSS enlargement is supplemental, not a browser zoom certification.
const zoom=[];
for (const route of ['/', '/books', '/about', '/how-it-works', '/login', '/me', '/admin', '/missing-page-dev-002b']) {
  call(`orca goto --page ${page} --url http://127.0.0.1:3312${route} --json`);
  call(`orca viewport --page ${page} --width 768 --height 900 --json`);
  zoom.push(evaluate(`JSON.stringify((document.documentElement.style.zoom='2',{route:location.pathname,zoom:getComputedStyle(document.documentElement).zoom,width:innerWidth,scroll:document.documentElement.scrollWidth,main:document.querySelectorAll('main').length,h1:document.querySelectorAll('h1').length}))`));
}
fs.writeFileSync('docs/qa/DEV-002B/interaction.json',JSON.stringify({keyboard:rows,cssZoomSupplement:zoom},null,2));
console.log(JSON.stringify({keyboard:rows,cssZoomSupplement:zoom},null,2));
