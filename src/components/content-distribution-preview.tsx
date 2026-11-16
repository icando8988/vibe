'use client';

import { useId, useRef, useState } from 'react';
import { DryRunAdapter, unverifiedCapabilities } from '../lib/distribution/adapters';
import { applyResult, createJob, startDispatch } from '../lib/distribution/jobs';
import type { DistributionErrorCode } from '../lib/distribution/result';
import type { AdapterCapabilities, Channel, ChannelDraft, ContentItem, PublishJob } from '../lib/distribution/types';
import { StatusNotice } from './status-notice';

const channels = [
  { id: 'blog', label: '블로그', hint: '제목과 본문을 나누는 구성 예시입니다. 블로그 서비스와 지원 형식은 미확인입니다.' },
  { id: 'threads', label: 'Threads', hint: '한 문장의 도입 뒤 본문을 배치한 예시입니다. 글자 수·연속 게시 지원은 미확인입니다.' },
  { id: 'instagram', label: 'Instagram', hint: '캡션 구성 예시입니다. 이미지 없이 게시할 수 있다는 뜻이 아니며 미디어·계정 조건은 미확인입니다.' },
] as const;
const sample = {
  title: '[샘플] 도전을 준비하며 나누고 싶은 이야기',
  body: '자전거 세계일주 도전의 이유와 출발 전 준비 과정을 이야기로 나누려 합니다. 이 글은 화면 검토를 위한 샘플이며, 실제 여행 실적이나 발행된 게시물이 아닙니다.',
};
const states = {
  needs_review: { label: '검토 시안', title: '내용과 공개 권리를 확인하는 단계', text: '사실 확인, 미디어 사용권, 개인정보 포함 여부를 검토할 화면 예시입니다. 검토를 요청하거나 승인한 상태가 아닙니다.' },
  scheduled: { label: '예약 시안', title: '예약 기능은 연결되지 않았습니다', text: '예약 시각과 시간대는 실행기 확인 후 입력하도록 연결할 예정입니다. 현재 예약된 작업이나 실행 일정은 없습니다.' },
  failed: { label: '실패 시안', title: '실패 안내 예시 · 실제 게시 시도 없음', text: '실제 오류 코드와 재시도 가능 여부는 프로그램 분석 뒤 연결합니다. 결과가 불명확할 때는 중복 게시 전에 외부 결과를 확인해야 합니다.' },
  disconnected: { label: '미연결 시안', title: '프로그램·채널 계정이 연결되지 않았습니다', text: '자동포스팅 프로그램을 제공받아 지원 기능과 인증 방식을 확인해야 합니다. 지금은 게시·저장·예약·발송을 실행하지 않습니다.' },
  unknown: { label: '결과 불명 설명 예시', title: '상태 설명 예시 · 실제 사건이 아닙니다', text: '결과가 불명확하면 외부 게시 결과를 대사하기 전에는 다시 게시하지 않습니다.' },
  partial: { label: '부분 성공 설명 예시', title: '상태 설명 예시 · 실제 사건이 아닙니다', text: '채널별 성공·실패·결과 불명을 분리해 확인해야 합니다. 이 화면에서는 실제 채널로 게시하지 않습니다.' },
} as const;
type PreviewState = keyof typeof states;
const capabilityLabels: ReadonlyArray<[Exclude<keyof AdapterCapabilities, 'channel' | 'connected' | 'limits'>, string]> = [
  ['publishText', '텍스트'], ['publishImage', '이미지'], ['publishVideo', '동영상'], ['publishLink', '링크'],
  ['schedule', '예약'], ['edit', '수정'], ['delete', '삭제'], ['lookupByIdempotencyKey', '결과 대사'], ['metrics', '통계'],
];

const errorGuidance: Record<DistributionErrorCode, string> = {
  INVALID_INPUT: '입력 내용을 확인할 수 없습니다. 제목과 본문을 확인한 뒤 샘플 검토를 다시 눌러 주세요.',
  NOT_APPROVED: '샘플 검토 확인이 필요합니다. 현재 원문과 채널을 살펴보고 샘플 검토 확인을 눌러 주세요.',
  STALE_DRAFT: '검토한 뒤 원문이 바뀌었습니다. 바뀐 내용을 살펴보고 샘플 검토를 다시 확인해 주세요.',
  DUPLICATE: '같은 원문 버전·채널의 모의 실행 요청이 이미 있습니다. 표시된 결과를 확인해 주세요. 내용을 수정했다면 샘플 검토부터 다시 진행해 주세요.',
  INVALID_TRANSITION: '현재 요청을 다시 실행할 수 없습니다. 표시된 결과와 원문을 확인해 주세요.',
  NOT_DUE: '지금 실행할 수 없는 요청입니다. 이 화면은 즉시 모의 실행만 지원하므로 원문을 확인하고 샘플 검토부터 다시 진행해 주세요.',
  RETRY_NOT_ALLOWED: '이 요청은 다시 실행할 수 없습니다. 반복해서 누르지 말고 현재 결과와 입력 내용을 확인해 주세요.',
  RECONCILE_REQUIRED: '결과 확인이 먼저 필요한 요청입니다. 외부 결과 확인 기능은 연결되지 않았으므로 다시 실행하지 마세요.',
  NOT_CONNECTED: '선택한 채널은 연결되지 않았습니다. 이 화면에서는 샘플 검토와 모의 실행만 이용할 수 있습니다.',
  CAPABILITY_UNVERIFIED: '채널의 지원 기능을 아직 확인하지 못했습니다. 아래의 미확인 기능 안내를 확인해 주세요.',
  MODE_MISMATCH: '실행 방식이 맞지 않아 진행하지 않았습니다. 이 화면의 모의 실행만 이용해 주세요.',
  NO_EVIDENCE: '결과를 확인할 근거가 부족합니다. 완료로 판단하거나 반복 실행하지 말고 현재 안내를 확인해 주세요.',
  STALE_RESULT: '현재 요청과 맞지 않는 결과라 반영하지 않았습니다. 현재 원문과 표시된 모의 실행 결과를 확인해 주세요.',
};

function getErrorGuidance(code: string): string {
  return Object.hasOwn(errorGuidance, code)
    ? errorGuidance[code as DistributionErrorCode]
    : '모의 실행을 마치지 못했습니다. 현재 입력과 샘플 검토 상태를 확인해 주세요. 외부 게시·저장·예약은 수행하지 않습니다.';
}

/** Standalone local mock for a future protected admin route; never mounts on the public home. */
export function ContentDistributionPreview() {
  const id = useId();
  const [content, setContent] = useState<ContentItem>({ id: 'local-preview', version: 1, title: sample.title, body: sample.body, targetPath: null, mediaRefs: [], updatedAt: '2026-11-16T00:00:00Z' });
  const { title, body } = content;
  const [channel, setChannel] = useState<Channel>('blog');
  const [previewState, setPreviewState] = useState<PreviewState>('disconnected');
  const [message, setMessage] = useState('');
  const [reviewed, setReviewed] = useState<ChannelDraft | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [resultJob, setResultJob] = useState<PublishJob | null>(null);
  const jobs = useRef<PublishJob[]>([]);
  const running = useRef(false);
  const generation = useRef(0);
  const selected = channels.find((item) => item.id === channel)!;
  const state = states[previewState];
  const preview = channel === 'blog' ? body : channel === 'threads' ? `${title}\n\n${body}` : `${body}\n\n${title}`;
  const capabilities = unverifiedCapabilities(channel);
  const reviewValid = reviewed?.contentVersion === content.version && reviewed.channel === channel;

  function invalidateReview() {
    generation.current += 1;
    setReviewed(null);
    setResultJob(null);
    setError('');
    setMessage('원문 또는 채널이 바뀌어 이전 샘플 검토 확인이 무효입니다. 다시 확인해 주세요.');
  }

  function editContent(next: Pick<ContentItem, 'title' | 'body'>) {
    invalidateReview();
    setContent((previous) => ({ ...previous, ...next, version: previous.version + 1, updatedAt: new Date().toISOString() }));
  }

  function confirmReview() {
    setError('');
    if (!title.trim() || !body.trim()) {
      setReviewed(null);
      setError('제목과 본문을 모두 입력해 주세요. 공백만 있는 원문은 검토할 수 없습니다.');
      return;
    }
    setReviewed({ contentId: content.id, contentVersion: content.version, channel, text: preview, mediaRefs: [], link: null, reviewStatus: 'approved' });
    setMessage(`원문 v${content.version} · ${selected.label} 샘플 검토를 확인했습니다. 운영 승인으로 저장되지 않습니다.`);
  }

  async function runDryRun() {
    if (running.current) return;
    setError('');
    if (!reviewValid || !reviewed) {
      setError('현재 원문과 채널의 샘플 검토를 먼저 확인해 주세요.');
      return;
    }
    if (!body.trim()) { setError('본문을 입력하고 다시 검토해 주세요.'); return; }
    const now = new Date().toISOString();
    const created = createJob({ id: `local-job-${jobs.current.length + 1}`, content, draft: reviewed, mode: 'dry_run', scheduledAt: null, now, existing: jobs.current });
    if (!created.ok) { setError(getErrorGuidance(created.error.code)); return; }
    const started = startDispatch(created.value, now);
    if (!started.ok) { setError(getErrorGuidance(started.error.code)); return; }
    jobs.current.push(started.value);
    const currentGeneration = generation.current;
    running.current = true;
    setBusy(true);
    try {
      const outcome = await new DryRunAdapter(channel).publish(started.value, reviewed);
      const applied = applyResult(started.value, outcome, { attempt: started.value.attempts });
      if (applied.ok) jobs.current = jobs.current.map((job) => job.id === applied.value.id ? applied.value : job);
      if (generation.current !== currentGeneration) return;
      if (!applied.ok) { setError(getErrorGuidance(applied.error.code)); return; }
      setResultJob(applied.value);
      setMessage('모의 실행 결과를 확인했습니다. 외부 게시·저장·예약은 없습니다.');
    } catch {
      if (generation.current === currentGeneration) setError(getErrorGuidance('UNRECOGNIZED'));
    } finally { running.current = false; setBusy(false); }
  }

  return (
    <section className="ds-distribution ds-container ds-section" aria-labelledby={`${id}-heading`}>
      <p className="ds-eyebrow">운영 화면 시안 · 로컬 샘플</p>
      <h2 id={`${id}-heading`}>콘텐츠 배포 미리보기</h2>
      <StatusNotice tone="warning" title="미연결 · 실제로 게시하거나 저장하지 않습니다">
        <p>샘플 내용을 바꾸고 채널별 구성을 살펴볼 수 있습니다. 수정 내용은 이 화면의 메모리에만 있으며, 새로고침하거나 화면을 떠나면 사라집니다. 개인정보나 비밀값을 입력하지 마세요.</p>
      </StatusNotice>
      <div className="ds-editor-grid">
        <div className="ds-editor-fields">
          <h3>콘텐츠 원문</h3>
          <label htmlFor={`${id}-title`}>콘텐츠 제목</label>
          <input id={`${id}-title`} value={title} onChange={(event) => editContent({ title: event.target.value, body })} aria-describedby={`${id}-input-help ${id}-error`} aria-invalid={Boolean(error) && !title.trim()} />
          <label htmlFor={`${id}-body`}>콘텐츠 본문</label>
          <textarea id={`${id}-body`} rows={8} value={body} onChange={(event) => editContent({ title, body: event.target.value })} aria-describedby={`${id}-input-help ${id}-error`} aria-invalid={Boolean(error) && !body.trim()} />
          <p id={`${id}-input-help`} className="ds-muted">텍스트 구성만 미리 봅니다. 플랫폼별 글자 수·미디어·API 지원 조건은 아직 확인되지 않았습니다.</p>
          <fieldset className="ds-channel-options">
            <legend>미리 볼 채널</legend>
            {channels.map((item) => <label key={item.id}><input type="radio" name={`${id}-channel`} value={item.id} checked={channel === item.id} onChange={() => { invalidateReview(); setChannel(item.id); }} />{item.label}</label>)}
          </fieldset>
          <p className="ds-review-summary">원문 v{content.version} · {reviewValid ? '현재 버전 샘플 검토 확인됨' : '샘플 검토 필요'}</p>
          <button type="button" className="ds-button ds-button--secondary" disabled={busy} onClick={confirmReview}>샘플 검토 확인</button>
          <button type="button" className="ds-button ds-button--primary" disabled={busy} onClick={runDryRun}>{busy ? '모의 실행 중' : '모의 실행'}</button>
          <p>검토 후 실행할 수 있습니다. 같은 원문 버전·채널의 재실행은 중복으로 차단합니다.</p>
          <p id={`${id}-error`} role="alert" className="ds-input-error">{error}</p>
          <button type="button" className="ds-button ds-button--secondary" onClick={() => { editContent(sample); setMessage('원문 입력을 처음 샘플로 되돌렸습니다. 다시 샘플 검토가 필요합니다. 저장하거나 게시하지 않았습니다.'); }}>원문을 샘플로 되돌리기</button>
          <p role="status" className="ds-muted">{message}</p>
        </div>
        <div className="ds-channel-preview">
          <p className="ds-tag">샘플 · {selected.label}</p>
          <h3>채널별 텍스트 구성</h3>
          <p className="ds-muted">{selected.hint}</p>
          <article className="ds-draft-paper" aria-label={`${selected.label} 샘플 텍스트 미리보기`}>
            {channel === 'blog' ? <h4>{title.trim() ? title : '제목을 입력하면 여기에 표시합니다.'}</h4> : null}
            <p className="ds-preview-text">{preview.trim() ? preview : '원문을 입력하면 여기에 표시합니다.'}</p>
          </article>
          <div className="ds-execution-result" aria-live="polite" aria-atomic="true">
            {resultJob ? <StatusNotice tone={resultJob.status === 'dry_run_succeeded' ? 'info' : 'warning'} title={resultJob.status === 'dry_run_succeeded' ? '모의 실행 완료 · 외부 게시 없음' : '모의 실행을 마치지 못했습니다'}><p>원문 v{resultJob.contentVersion} · {selected.label}</p><p>{resultJob.status === 'dry_run_succeeded' ? '미리보기와 입력 내용을 확인해 주세요. 같은 원문 버전·채널은 다시 실행할 필요가 없습니다.' : getErrorGuidance(resultJob.lastError?.code ?? 'UNRECOGNIZED')}</p><p>외부 게시 식별자 없음 · 실제 예약 없음 · 저장 없음</p></StatusNotice> : <p>아직 현재 원문·채널의 모의 실행 결과가 없습니다.</p>}
          </div>
          <details className="ds-state-examples">
            <summary>상태 설명 예시 · 실제 사건 아님</summary>
            <label htmlFor={`${id}-state`}>살펴볼 설명 예시</label>
            <select id={`${id}-state`} value={previewState} onChange={(event) => setPreviewState(event.target.value as PreviewState)}>
              {Object.entries(states).map(([value, item]) => <option key={value} value={value}>{item.label}</option>)}
            </select>
          <div className="ds-preview-status">
            <StatusNotice tone={previewState === 'failed' ? 'error' : 'info'} title={`${state.label} · ${state.title}`}><p>{state.text}</p></StatusNotice>
          </div>
          </details>
          <h3>채널 기능 · 미연결</h3>
          <p>실제 플랫폼의 지원 여부는 미확인입니다. 모의 실행 성공이 기능 지원을 뜻하지 않습니다.</p>
          <dl className="ds-capabilities">{capabilityLabels.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{capabilities[key] === 'unverified' ? '미확인' : capabilities[key]}</dd></div>)}<div><dt>글자·미디어 제한</dt><dd>미확인</dd></div></dl>
          <p className="ds-muted">게시·방문·성과 집계 없음. 외부 게시물 URL과 확인 근거를 받기 전에는 게시 성공을 표시하지 않습니다.</p>
        </div>
      </div>
    </section>
  );
}
