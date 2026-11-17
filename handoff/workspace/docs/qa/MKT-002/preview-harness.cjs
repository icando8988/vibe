// Local-only review harness; no app routes or dependencies are changed.
// Run from D:/Vibe: node docs/qa/MKT-002/preview-harness.cjs
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { createRequire } = require('node:module');
const appRequire = createRequire(path.resolve('web/package.json'));
const ts = appRequire('typescript');
const modules = [];
const ids = new Map();
function bundle(file) {
  if (ids.has(file)) return ids.get(file);
  const id = modules.length;
  ids.set(file,id); modules.push('');
  let source=fs.readFileSync(file,'utf8');
  if (/\.tsx?$/.test(file)) source=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020}}).outputText;
  source=source.replaceAll('process.env.NODE_ENV',JSON.stringify('production'));
  source=source.replace(/require\(['"]([^'"]+)['"]\)/g,(_,name)=>{
    let resolved;
    if(name.startsWith('.')) {
      const base=path.resolve(path.dirname(file),name);
      resolved=[base,base+'.tsx',base+'.ts',base+'.js',path.join(base,'index.js')].find(p=>fs.existsSync(p)&&fs.statSync(p).isFile());
    } else resolved=appRequire.resolve(name);
    if(!resolved) throw Error('Cannot resolve '+name);
    return `require(${bundle(resolved)})`;
  });
  modules[id]=`function(module,exports,require){${source}\n}`;
  return id;
}
const preview=bundle(path.resolve('web/src/components/content-distribution-preview.tsx'));
const react=bundle(appRequire.resolve('react'));
const client=bundle(appRequire.resolve('react-dom/client'));
const js=`const modules=[${modules.join(',')}];const cache={};function require(id){if(cache[id])return cache[id].exports;const m=cache[id]={exports:{}};modules[id](m,m.exports,require);return m.exports;}require(${client}).createRoot(document.getElementById('root')).render(require(${react}).createElement(require(${preview}).ContentDistributionPreview));`;
const css=fs.readFileSync('web/src/styles/design.css','utf8');
const server=http.createServer((request,response)=>{
  response.setHeader('Cache-Control','no-store');
  if(request.url==='/preview.js'){response.setHeader('Content-Type','application/javascript');response.end(js);return;}
  response.setHeader('Content-Type','text/html; charset=utf-8');
  response.end(`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MKT-002 로컬 시안 검증</title><style>${css}</style><main><h1 class="ds-container">로컬 검증 전용 · 관리자 연결 전</h1><div id="root"></div></main><script src="/preview.js"></script></html>`);
});
server.listen(3313,'127.0.0.1',()=>console.log('MKT-002 harness http://127.0.0.1:3313 (memory-only bundle, local sample)'));
