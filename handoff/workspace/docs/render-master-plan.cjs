const fs = require('node:fs');
const path = require('node:path');
const base = fs.readFileSync(path.join(__dirname,'INTEGRATED_DEVELOPMENT_PLAN.md'),'utf8').replace(/^\uFEFF/,'');
const addendum = fs.readFileSync(path.join(__dirname,'MASTER_REVIEW_ADDENDUM.md'),'utf8');
const split = addendum.indexOf('## 19.');
const foundation = base.slice(base.indexOf('## 1.'),base.indexOf('## 19.'));
const combined = '# 세계일주·출판 플랫폼 총괄 개발 계획\n\n'+addendum.slice(0,split)+'\n'+foundation+'\n'+addendum.slice(split);
fs.writeFileSync(path.join(__dirname,'MASTER_DEVELOPMENT_PLAN.md'),combined,'utf8');
let renderer = fs.readFileSync(path.join(__dirname,'render-plan.cjs'),'utf8');
renderer = renderer.replaceAll('INTEGRATED_DEVELOPMENT_PLAN','MASTER_DEVELOPMENT_PLAN')
 .replaceAll('v0.9 · 검토안','v1.0 · 총괄 검토안')
 .replace('도전의 이야기를,<br>함께하는 프로젝트로.','도전에서 출판까지,<br>실행 기준을 세우다.')
 .replace('기획서 분석부터 기능, 화면, 데이터, 개발 순서와 검수까지.','기존 계획 정밀 검토 · 거래 계약 · 단계별 개발 · 운영 인수')
 .replace('독립 검토 결과는 별도 반영합니다.','UI 독립 검토 8건과 Master 보강 계약을 반영했습니다. Claude 기술 독립 검토 결과는 미확인입니다.')
 .replace('원본 5개 시트 분석','5시트 근거 · 10개 핵심 보강')
 .replaceAll('통합 개발 플랜','총괄 개발 계획');
new Function('require','__dirname',renderer)(require,__dirname);
