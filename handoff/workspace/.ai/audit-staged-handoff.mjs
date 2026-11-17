import {execFileSync} from 'node:child_process';
const cwd='D:/Vibe/web';
const files=execFileSync('git',['ls-files','-z'],{cwd}).toString('utf8').split('\0').filter(Boolean);
const alerts=[];
const patterns=[['github',/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/],['aws',/\bAKIA[0-9A-Z]{16}\b/],['private-key',/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],['provider-key',/\bsk-proj-[A-Za-z0-9_-]{40,}\b/],['google-key',/\bAIza[A-Za-z0-9_-]{35}\b/]];
for(const file of files){
 if(/(^|\/)(?:API KEY\.txt|.*비번.*|.*비밀번호.*|\.env(?:\.(?!example$).*)?)$/i.test(file)){alerts.push({file,kind:'forbidden-filename'});continue;}
 if(!/\.(?:md|txt|json|js|mjs|cjs|ts|tsx|jsx|ps1|yml|yaml|toml|sh|cmd|example)$/i.test(file))continue;
 const content=execFileSync('git',['show',':'+file],{cwd,maxBuffer:16*1024*1024}).toString('utf8');
 for(const [kind,re] of patterns)if(re.test(content))alerts.push({file,kind});
}
console.log(JSON.stringify({indexedFiles:files.length,alerts},null,2));
if(alerts.length)process.exitCode=2;
