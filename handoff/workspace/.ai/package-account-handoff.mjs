import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const workspace='D:/Vibe';
const dest=path.join(workspace,'web/handoff/workspace');
const blockedDirs=new Set(['.git','node_modules','.next','.vercel','.orca','.auth','.pglite','coverage','test-results','playwright-report','browser-profile','user-data-dir']);
const excluded=[];const copied=[];const alerts=[];
const secretPatterns=[['github',/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/],['aws',/\bAKIA[0-9A-Z]{16}\b/],['private-key',/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],['provider-key',/\bsk-proj-[A-Za-z0-9_-]{40,}\b/],['google-key',/\bAIza[A-Za-z0-9_-]{35}\b/]];
function blocked(name){return /^~\$/.test(name)||/^\.env(?:$|\.)/i.test(name)&&name!=='.env.example'||/^API\s*KEY(?:\.(?:txt|json))?$/i.test(name)||/비번|비밀번호|password.*\.txt|credentials.*\.json|service-account.*\.json|storage-state|cookies/i.test(name)||/\.(?:pem|key|p12|pfx|keystore|log|dump|sqlite3?|db|bak)$/i.test(name)||/^설치결과/.test(name);}
function walk(src,rel){for(const entry of fs.readdirSync(src,{withFileTypes:true})){const nextRel=path.join(rel,entry.name);if(blockedDirs.has(entry.name)||blocked(entry.name)||entry.isSymbolicLink()){excluded.push(nextRel);continue;}const full=path.join(src,entry.name);if(entry.isDirectory())walk(full,nextRel);else if(entry.isFile())copy(full,nextRel);}}
function copy(src,rel){const stat=fs.statSync(src);if(stat.size>95*1024*1024)throw Error('Oversized file: '+rel);if(/\.(?:md|txt|json|js|mjs|cjs|ts|tsx|jsx|ps1|yml|yaml|toml|sh|cmd|example)$/i.test(src)){const content=fs.readFileSync(src,'utf8');for(const [kind,re]of secretPatterns)if(re.test(content))alerts.push({path:rel,kind});}const target=path.join(dest,rel);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(src,target);copied.push({path:rel.replaceAll('\\','/'),bytes:stat.size,sha256:crypto.createHash('sha256').update(fs.readFileSync(src)).digest('hex')});}
for(const dir of ['.ai','docs','Blog_Posting_Kit_v1.07','Threads_Auto_Posting_Kit_v1.02','Insta_Auto_Posting_Kit_v1.11'])walk(path.join(workspace,dir),dir);
for(const name of fs.readdirSync(workspace)){const full=path.join(workspace,name);if(fs.statSync(full).isFile()&&!blocked(name))copy(full,name);else if(fs.statSync(full).isFile())excluded.push(name);}
fs.mkdirSync(path.join(workspace,'web/handoff'),{recursive:true});
fs.writeFileSync(path.join(workspace,'web/handoff/FILE_MANIFEST.json'),JSON.stringify({copied,excluded,alerts},null,2)+'\n');
console.log(JSON.stringify({files:copied.length,bytes:copied.reduce((n,f)=>n+f.bytes,0),excluded,alerts},null,2));
if(alerts.length)process.exitCode=2;
