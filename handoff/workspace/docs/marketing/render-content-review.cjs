// Built-in Node renderer. Run: node docs/marketing/render-content-review.cjs
// Source JSON/Markdown are read-only; output is a standalone editorial review page.
const fs = require('node:fs');
const path = require('node:path');
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const list = (items) => `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
const channelNames = { blog: '블로그', threads: 'Threads', instagram: 'Instagram' };

function renderReview(pack) {
  if (pack.status !== 'draft' || pack.publicApproval !== false || pack.externallyPosted !== false || pack.topics.length !== 3) throw Error('Expected three unapproved draft topics.');
  for (const topic of pack.topics) {
    if (topic.publicApproval !== false || topic.externallyPosted !== false || topic.status !== 'draft' || topic.variants.length !== 3 || new Set(topic.variants.map((item) => item.channel)).size !== 3 || topic.variants.some((item) => !Object.hasOwn(channelNames, item.channel))) throw Error('Invalid topic.');
    for (const item of [topic.original, ...topic.variants]) if (item.status !== 'draft' || item.publicApproval !== false || item.externallyPosted !== false) throw Error('Approved or posted items are not allowed.');
  }
  function article(item, topic, topicIndex, kind) {
    const suffix = `${topicIndex}-${kind}`;
    const relevantClaims = topic.claims.filter((claim) => item.claimIds.includes(claim.id));
    return `<article class="draft-panel" data-kind="${kind}"${kind !== 'original' && kind !== 'blog' ? ' hidden' : ''} aria-labelledby="title-${suffix}">
      <p class="panel-label">${kind === 'original' ? '원문 초안' : `${channelNames[kind]} 변형`}</p>
      <p class="badge">draft · 공개승인 false · 외부 미게시</p>
      <h3 id="title-${suffix}">${escapeHtml(item.title)}</h3>
      <div class="draft-body" tabindex="0" aria-label="${kind === 'original' ? '원문' : channelNames[kind]} 본문 · 읽기 전용">${escapeHtml(item.body)}</div>
      <button type="button" class="copy-button">${kind === 'original' ? '원문' : channelNames[kind]} 본문 복사</button>
      <details><summary>출처·확인사항 보기</summary>
        <h4>원문 출처 셀</h4>${list(item.sourceRefs)}
        <h4>주장별 근거와 제한</h4>${relevantClaims.map((claim) => `<div class="claim"><p><strong>${escapeHtml(claim.id)} · ${escapeHtml(claim.classification)}</strong></p><p>${escapeHtml(claim.claim)}</p>${list(claim.sourceRefs)}${claim.planRefs ? list(claim.planRefs) : ''}<p>${escapeHtml(claim.qualification)}</p></div>`).join('')}
        <h4>공개 전 확인 필요</h4>${list(item.confirmBeforePublication)}
        <h4>제안 CTA · 미승인</h4><p>${escapeHtml(item.suggestedCTA.label)} → <code>${escapeHtml(item.suggestedCTA.path)}</code></p><p>${escapeHtml(item.suggestedCTA.note)}</p>
        <h4>이미지 원본·권리</h4><p>${escapeHtml(item.image.originalNeeded)}</p><p>원본 미수령 · 사용권 ${escapeHtml(item.image.rightsStatus)} · 공개 동의 ${escapeHtml(item.image.consentStatus)} · 이미지 필수 여부 ${escapeHtml(item.image.platformImageRequirement)}</p>
        <h4>채널 기능</h4><p>프로그램 미수령 · 미연결. 서비스·계정 유형 ${escapeHtml(item.channelFeatures.serviceAndAccountType)}, 글자 수 ${escapeHtml(item.channelFeatures.textLimit)}, 미디어 ${escapeHtml(item.channelFeatures.mediaSupport)}, API·예약 ${escapeHtml(item.channelFeatures.apiAndScheduling)}.</p>
      </details>
    </article>`;
  }
  const sections = pack.topics.map((topic, index) => `<section class="topic-panel" data-topic="${index}"${index ? ' hidden' : ''} aria-labelledby="topic-${index}"><h2 id="topic-${index}">${index + 1}. ${escapeHtml(topic.topic)}</h2><div class="comparison">${article(topic.original, topic, index, 'original')}<div class="channel-column">${topic.variants.map((variant) => article(variant, topic, index, variant.channel)).join('')}</div></div></section>`).join('');
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; img-src 'none'; font-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
<meta name="robots" content="noindex,nofollow"><title>첫 콘텐츠 초안 비교 · 로컬 검토 전용</title>
<style>
:root{font-size:18px;color:#172b4d;background:#fff;font-family:system-ui,-apple-system,'Segoe UI','Malgun Gothic',sans-serif;line-height:1.7}*{box-sizing:border-box}[hidden]{display:none!important}body{margin:0}main,header{width:min(1280px,calc(100% - 2rem));margin-inline:auto}header{padding-block:2rem 1rem}h1,h2,h3,h4{line-height:1.35;overflow-wrap:anywhere}h1{font-size:clamp(1.8rem,4vw,2.8rem);margin:0 0 1rem}h2{font-size:1.6rem}h3{font-size:1.35rem}h4{font-size:1rem;margin-block:1rem .4rem}p{margin:0 0 1rem}button,input,select{font:inherit}button,select,summary{min-height:48px}button{border:2px solid #1e40af;border-radius:8px;background:#fff;color:#1e40af;padding:.6rem 1rem;cursor:pointer;font-weight:700}button:hover{background:#eff6ff}:focus-visible{outline:3px solid #1e40af;outline-offset:4px}select{width:100%;max-width:100%;padding:.6rem;border:1px solid #526178;border-radius:8px;background:#fff;color:#172b4d}.notice{padding:1.2rem;border-left:5px solid #9a3412;background:#fff7ed;border-radius:10px}.notice p:last-child{margin:0}.muted{color:#526178}.controls{padding:1.4rem;background:#eff6ff;border:1px solid #cbd5e1;border-radius:14px;display:grid;grid-template-columns:1fr 1fr;gap:1.5rem;margin-block:1rem 1.5rem}.topic-control label,legend{font-weight:700}.topic-control label{display:block;margin-bottom:.6rem}fieldset{border:0;padding:0;margin:0;min-width:0}.radios{display:flex;flex-wrap:wrap;gap:.5rem 1rem}.radios label{display:flex;align-items:center;gap:.5rem;min-height:48px;cursor:pointer}.radios input{width:22px;height:22px;accent-color:#2563eb}.comparison{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1.4rem;align-items:start}.draft-panel{min-width:0;border:1px solid #cbd5e1;border-radius:14px;padding:1.5rem;background:#fff}.panel-label{color:#1e40af;font-weight:750}.badge{display:inline-block;background:#fff7ed;color:#9a3412;padding:.35rem .7rem;border-radius:6px;font-size:.9rem;font-weight:700}.draft-body{white-space:pre-wrap;overflow-wrap:anywhere;user-select:text;margin-block:1.2rem;padding:.2rem}.copy-button{margin-bottom:1rem}details{border-top:1px solid #cbd5e1;padding-top:1rem;margin-top:.6rem;overflow-wrap:anywhere}summary{cursor:pointer;font-weight:700;padding-block:.4rem}.claim{padding:.8rem 0;border-bottom:1px solid #cbd5e1}ul{padding-left:1.3rem}.footer{padding-block:2rem;color:#526178}.copy-status{min-height:2rem;font-weight:650;overflow-wrap:anywhere}.manual-selection{background:#eff6ff;border:2px solid #1e40af}.skip{position:fixed;top:1rem;left:1rem;transform:translateY(-200%);z-index:10;background:#fff;padding:.5rem;color:#1e40af}.skip:focus{transform:none}code{overflow-wrap:anywhere}.noscript{background:#fff7ed;padding:1rem}@media(max-width:760px){.comparison,.controls{grid-template-columns:1fr}.draft-panel{padding:1rem}.controls{padding:1rem}.topic-panel h2{font-size:1.35rem}}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}@media print{.controls,.copy-button,.copy-status,.skip{display:none}.topic-panel[hidden],.draft-panel[hidden]{display:block!important}.topic-panel{break-before:page}.comparison{display:block}.draft-panel{margin-bottom:1rem}}
</style></head><body>
<a class="skip" href="#review-main">본문 바로가기</a>
<header><p class="panel-label">MKT-008 · 단일 로컬 검토 문서</p><h1>첫 콘텐츠, 원문과 채널별 초안 비교</h1>
<div class="notice"><p><strong>검토 초안·외부 미게시 · 모든 항목 공개승인 false</strong></p><p>공식 브랜드 미확정. 이 문서는 편집 비교용이며 실제 관리자 화면이나 게시 도구가 아닙니다. 공개·승인·예약·게시 기능이 없습니다.</p></div>
<p class="muted">원문 3개와 채널 변형 9개를 비교합니다. 원본 파일을 수정하거나 정보를 저장하지 않습니다. 프로그램·채널 기능과 이미지 권리는 미확인입니다.</p></header>
<main id="review-main" tabindex="-1"><div class="controls">
<div class="topic-control"><label for="topic-select">비교할 주제</label><select id="topic-select">${pack.topics.map((topic, index) => `<option value="${index}">${index + 1}. ${escapeHtml(topic.topic)}</option>`).join('')}</select></div>
<fieldset><legend>원문과 비교할 채널</legend><div class="radios">${Object.entries(channelNames).map(([key, label], index) => `<label><input type="radio" name="channel" value="${key}"${index ? '' : ' checked'}>${label}</label>`).join('')}</div></fieldset></div>
<p id="selection-status" class="muted" role="status" aria-atomic="true">1. ${escapeHtml(pack.topics[0].topic)} · 블로그 변형을 비교합니다.</p>
<p id="copy-status" class="copy-status" role="status" aria-atomic="true"></p>
<noscript><p class="noscript">자바스크립트가 꺼져 있어 첫 주제와 블로그 초안만 표시합니다. 전체 내용은 원본 Markdown/JSON에서 읽을 수 있습니다.</p></noscript>
${sections}<div class="footer"><details><summary>전체 출처와 검토 제한</summary><p>${escapeHtml(pack.sourceWorkbook)}</p><p>${escapeHtml(pack.sourceSheet)} · ${escapeHtml(pack.sourceExtraction)}</p><p>${escapeHtml(pack.sourceCaution)}</p><p>실제 경험·인용·공식 인증·성과를 새로 만들지 않았습니다. 공개 전에 사실 확인·당사자 동의·이미지 권리·채널 규격을 별도로 확인해야 합니다.</p></details><p>텍스트 비교와 복사만 제공합니다. 외부 요청·브라우저 저장·분석 태그 없음.</p></div></main>
<script>
(() => {
  const topicSelect = document.getElementById('topic-select');
  const status = document.getElementById('selection-status');
  const copyStatus = document.getElementById('copy-status');
  let selectionVersion = 0;
  function updateSelection() {
    selectionVersion += 1;
    const channel = document.querySelector('input[name=channel]:checked').value;
    for (const section of document.querySelectorAll('.topic-panel')) {
      section.hidden = section.dataset.topic !== topicSelect.value;
      for (const article of section.querySelectorAll('[data-kind]')) article.hidden = article.dataset.kind !== 'original' && article.dataset.kind !== channel;
    }
    for (const body of document.querySelectorAll('.manual-selection')) body.classList.remove('manual-selection');
    copyStatus.textContent = '';
    const label = document.querySelector('input[name=channel]:checked').parentElement.textContent.trim();
    status.textContent = topicSelect.options[topicSelect.selectedIndex].text + ' · ' + label + ' 변형을 비교합니다.';
  }
  topicSelect.addEventListener('change', updateSelection);
  for (const radio of document.querySelectorAll('input[name=channel]')) radio.addEventListener('change', updateSelection);
  for (const button of document.querySelectorAll('.copy-button')) button.addEventListener('click', async () => {
    const body = button.closest('article').querySelector('.draft-body');
    const currentSelection = selectionVersion;
    const label = button.closest('article').querySelector('.panel-label').textContent;
    try {
      if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(body.textContent);
      if (currentSelection === selectionVersion) copyStatus.textContent = label + ' 본문을 복사했습니다. 공개 승인이나 게시를 수행하지 않았습니다.';
    } catch {
      if (currentSelection !== selectionVersion) return;
      body.classList.add('manual-selection');
      body.focus();
      const range = document.createRange(); range.selectNodeContents(body);
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
      copyStatus.textContent = '자동 복사를 사용할 수 없습니다. 선택된 ' + label + ' 본문에서 Ctrl+C 또는 기기의 복사 메뉴를 사용해 주세요.';
    }
  });
})();
</script></body></html>`;
}

if (require.main === module) {
  const bytes = fs.readFileSync(path.join(__dirname, 'first-content-pack.json'));
  const pack = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  const markdown = fs.readFileSync(path.join(__dirname, 'first-content-pack.md'), 'utf8');
  for (const topic of pack.topics) for (const item of [topic.original, ...topic.variants]) if (!markdown.includes(item.title) || !markdown.includes(item.body)) throw Error('Source Markdown/JSON mismatch.');
  const output = path.join(__dirname, 'content-review.html');
  fs.writeFileSync(output, renderReview(pack), 'utf8');
  console.log('Rendered 3 topics / 12 unapproved items: ' + output);
}
module.exports = { renderReview, escapeHtml };
