"use client";

/**
 * 글감 수집 1단계 화면(TOPIC-COLLECT-131 계약 · FE task_e3081d32118a).
 * - 등록: 관리자가 직접 쓴 메모·출처 링크만. 링크는 문자열로 보내고, 화면도 서버도 그 주소에 접속하지 않는다.
 * - 목록: 분류·수집 시각·출처를 보이고, 고르기·제외·되살리기는 rowVersion을 그대로 expectedVersion으로 보낸다.
 * - 전환: "고른" 후보만 공통 원고 전환 폼을 연다(제목·메모 미리 채움 → 사람이 다듬고 확인란 선택 → convertTopicCandidateAction).
 *   승인·채널 초안·게시는 만들지 않는다. 원고 소유자는 전환한 관리자, 출처는 후보에 남는다(계약 그대로).
 * - 손실 없는 재시도: 실패·결과 불명이면 입력값을 그대로 두고, 자동 재전송하지 않는다. 결과 불명은 성공으로 표시하지 않고 재조회를 안내한다.
 *   (등록은 DB 중복 판정, 전환은 같은 원고 귀결이라 다시 보내도 중복 생성되지 않는다.)
 * - 링크는 검증된 https만 새 탭(rel="noopener noreferrer")으로 보인다. 그 밖은 글자로만 보인다.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useMemo, useRef, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { convertTopicCandidateAction, createTopicCandidateAction, setTopicCandidateStatusAction } from "@/app/admin/distribution/topic-actions";
import { TOPIC_STATUS_LABEL } from "./topic-labels";
import type { TopicCandidateDto, TopicConvertOutcome, TopicCreateOutcome, TopicStatus, TopicStatusOutcome } from "@/server/distribution/topics/types";

// ---- 순수 도우미(시험 대상) ----

const CONTENT_BASE = "/admin/distribution/contents";

const DENY: Record<string, string> = {
  auth_not_configured: "관리자 인증이 아직 연결되지 않았습니다.",
  unauthenticated: "로그인한 관리자만 이용할 수 있습니다. 다시 로그인해 주세요.",
  forbidden: "관리자 권한이 필요합니다.",
  not_approved: "승인된 관리자만 이용할 수 있습니다. 계정 승인 상태를 확인해 주세요.",
};
const FIELD: Record<string, string> = {
  title: "제목",
  memo: "메모",
  sourceUrl: "출처 링크",
  sourceName: "출처 이름",
  category: "분류",
  sourceDate: "출처 날짜",
  body: "본문",
  targetPath: "연결할 사이트 경로",
  confirmConvert: "전환 확인",
  candidateId: "후보",
  expectedVersion: "후보 버전",
  status: "상태",
};
const RULE: Record<string, string> = {
  required: "필수",
  max_length: "너무 김",
  control_chars: "쓸 수 없는 문자",
  https_url: "https 주소만",
  date: "올바른 날짜(YYYY-MM-DD, 미래 불가)",
  format: "형식 오류",
};

const has = (m: Record<string, string>, k: string) => Object.hasOwn(m, k);
const pick = (m: Record<string, string>, k: string, fb: string) => (has(m, k) ? (m[k] as string) : fb);

/** 화면에 링크로 보일 수 있는 주소만 돌려준다: https, 사용자정보 없음, 공백 없음, 2048자 이하. 그 밖은 null(글자로만 표시). */
export function safeHttpsHref(raw: string | null | undefined): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 2048 || /\s/.test(raw)) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password || !u.hostname) return null;
  return u.href;
}

const KST = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "medium", timeStyle: "short" });
export function kstTime(iso: string | null | undefined): string {
  if (!iso) return "시각 없음";
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? `${KST.format(d)} KST` : "시각 확인 불가";
}

/** 상태별로 사람이 누를 수 있는 상태 변경(계약: new↔selected, →dismissed, dismissed→new). converted는 없음. */
export function statusMoves(status: TopicStatus): Array<{ to: "new" | "selected" | "dismissed"; label: string }> {
  switch (status) {
    case "new":
      return [{ to: "selected", label: "고르기" }, { to: "dismissed", label: "제외" }];
    case "selected":
      return [{ to: "new", label: "고르기 취소" }, { to: "dismissed", label: "제외" }];
    case "dismissed":
      return [{ to: "new", label: "되살리기" }];
    default:
      return [];
  }
}

type Tone = "success" | "warning" | "error";
export type Notice = {
  tone: Tone;
  title: string;
  body?: string;
  contentId?: string;
  /** 안내가 가리키는 후보(링크 여부는 렌더 시점의 실제 목록으로 판정 — candidateLocator) */
  candidate?: { id: string; status: TopicStatus };
  refresh?: boolean;
};
type Failure = Exclude<TopicCreateOutcome | TopicStatusOutcome | TopicConvertOutcome, { status: "ok" }> | { status: "request_failed" };

function invalidText(errors: ReadonlyArray<{ field: string; rule: string }>): string {
  return errors.map((e) => `${pick(FIELD, e.field, "입력")}(${pick(RULE, e.rule, "확인 필요")})`).join(", ") || "입력값을 확인해 주세요.";
}

/** 쓰기 실패 공통 안내. what: 화면 문맥("등록"·"상태 변경"·"전환"). 결과 불명은 성공으로 표시하지 않고 재조회를 안내한다. */
export function failureNotice(o: Failure, what: "등록" | "상태 변경" | "전환"): Notice {
  const retrySafe =
    what === "전환" ? "다시 보내도 같은 원고로 연결되어 원고가 두 번 만들어지지 않습니다." : what === "등록" ? "다시 보내도 같은 글감은 중복 등록되지 않습니다." : "";
  switch (o.status) {
    case "denied":
      return { tone: "error", title: `${what}할 수 없습니다`, body: pick(DENY, o.reason, "접근 권한을 확인해 주세요.") };
    case "invalid":
      return { tone: "error", title: "입력을 확인해 주세요", body: `확인할 항목: ${invalidText(o.errors)}. 입력한 내용은 그대로 남아 있습니다.` };
    case "not_ready":
      return { tone: "warning", title: "저장 준비 전입니다", body: "서버 저장 연결이 설정되지 않아 저장하지 않았습니다. 입력한 내용은 그대로 남아 있습니다." };
    case "bad_response":
      return {
        tone: "error",
        title: "서버 응답을 확인하지 못했습니다",
        body: `처리됐는지 알 수 없습니다. 목록을 새로 불러와 확인해 주세요. ${retrySafe}`.trim(),
        refresh: true,
      };
    case "request_failed":
      return {
        tone: "error",
        title: "요청 결과를 확인하지 못했습니다",
        body: `연결이 끊겼거나 응답을 받지 못했습니다. 성공으로 보지 말고 목록${what === "전환" ? "·원고 보관함" : ""}을 새로 불러와 확인해 주세요. ${retrySafe}`.trim(),
        refresh: true,
      };
    case "db_error": {
      const { token, code } = o.error;
      if (token === "VERSION_CONFLICT" || code === "conflict_version")
        return { tone: "warning", title: "그 사이 후보가 바뀌었습니다", body: "다른 화면에서 먼저 바뀌었습니다. 목록을 새로 불러온 뒤 다시 시도해 주세요.", refresh: true };
      if (token === "ALREADY_CONVERTED")
        return { tone: "warning", title: "이미 원고로 전환된 후보입니다", body: "전환된 후보는 상태를 바꿀 수 없습니다. 목록을 새로 불러와 원고 링크를 확인해 주세요.", refresh: true };
      if (token === "DUPLICATE" || code === "duplicate")
        return { tone: "warning", title: "같은 글감이 이미 있습니다", body: "제외한 사이 같은 글감이 다시 등록돼 되살릴 수 없습니다. 목록에서 기존 후보를 이용해 주세요.", refresh: true };
      if (token === "INVALID_TRANSITION" || code === "invalid_transition")
        return {
          tone: "warning",
          title: what === "전환" ? "이 후보는 전환할 수 없습니다" : "이미 그 상태입니다",
          body: what === "전환" ? "제외한 후보는 전환할 수 없습니다. 되살린 뒤 다시 골라 주세요." : "목록을 새로 불러와 현재 상태를 확인해 주세요.",
          refresh: true,
        };
      if (code === "forbidden") return { tone: "error", title: `${what}할 수 없습니다`, body: "관리자 권한이 확인되지 않았습니다." };
      if (code === "not_found") return { tone: "error", title: "후보를 찾지 못했습니다", body: "없거나 볼 권한이 없는 후보입니다. 목록을 새로 불러와 주세요.", refresh: true };
      if (code === "unavailable")
        return {
          tone: "error",
          title: "처리 결과를 확인하지 못했습니다",
          body: `응답을 받지 못했습니다. 성공으로 보지 말고 목록${what === "전환" ? "·원고 보관함" : ""}을 새로 불러와 확인해 주세요. 자동으로 다시 보내지 않습니다. ${retrySafe}`.trim(),
          refresh: true,
        };
      return { tone: "error", title: `${what}하지 못했습니다`, body: "저장소 오류입니다. 잠시 뒤 다시 시도해 주세요. 입력한 내용은 그대로 남아 있습니다." };
    }
  }
}

export function createNotice(o: TopicCreateOutcome | { status: "request_failed" }): Notice {
  if (o.status !== "ok") return failureNotice(o, "등록");
  if (o.data.created) return { tone: "success", title: "글감 후보를 등록했습니다", body: "새 후보로 저장했습니다.", candidate: { id: o.data.candidateId, status: "new" } };
  return {
    tone: "warning",
    title: "같은 글감이 이미 있습니다",
    body: `새로 만들지 않았습니다. 기존 후보 상태: ${TOPIC_STATUS_LABEL[o.data.duplicateStatus] ?? "확인 필요"}. 입력한 내용은 그대로 남아 있습니다.`,
    candidate: { id: o.data.duplicateOf, status: o.data.duplicateStatus },
  };
}

/**
 * 전환 결과 안내. ok일 때만 원고 링크(contentId)를 단다 — 실패·결과 불명은 원고 링크·이동 없음.
 * filter: 지금 보고 있는 상태 필터. 전환된 후보는 converted가 되어 다른 필터 목록에서 빠지므로 그 사실도 알린다.
 */
export function convertNotice(o: TopicConvertOutcome | { status: "request_failed" }, filter: TopicStatus | null = null, candidateTitle?: string): Notice {
  if (o.status !== "ok") return failureNotice(o, "전환");
  const who = candidateTitle ? `"${candidateTitle}" 후보` : "이 후보";
  const moved = filter !== null && filter !== "converted" ? ` 전환된 후보는 지금 필터 목록에서 빠지며, "${TOPIC_STATUS_LABEL.converted}" 목록에서 다시 볼 수 있습니다.` : "";
  return o.data.alreadyConverted
    ? { tone: "success", title: "이미 전환된 후보입니다", body: `${who}는 이미 원고가 있어 새 원고를 만들지 않았습니다. 기존 원고에서 이어서 작업하세요.${moved}`, contentId: o.data.contentId }
    : { tone: "success", title: "공통 원고로 전환했습니다", body: `${who}로 원고 버전 1이 생겼습니다. 원고 화면에서 채널 초안과 승인을 진행하세요. 아직 승인·게시되지 않았습니다.${moved}`, contentId: o.data.contentId };
}

const TOPICS_BASE = "/admin/distribution/topics";
export type CandidateLocator =
  | { kind: "anchor"; href: string; label: string }
  | { kind: "filter"; href: string; label: string; text: string }
  | { kind: "text"; text: string };

/**
 * 안내 속 후보로 가는 길(QA R3). 실제로 렌더된 목록(visibleIds)에 있을 때만 앵커를 준다.
 * 없으면: 다른 상태 필터를 보고 있거나 전체 보기면 그 후보 상태의 필터 링크(실제 이동), 이미 그 상태 필터면 이동 링크 없이 사유만.
 * visibleIds가 null(목록 조회 불가)이면 링크 없이 사유만.
 */
export function candidateLocator(candidate: { id: string; status: TopicStatus }, visibleIds: ReadonlySet<string> | null, filter: TopicStatus | null): CandidateLocator {
  if (visibleIds === null) return { kind: "text", text: "목록을 불러오지 못해 이 후보로 바로 이동할 수 없습니다." };
  if (visibleIds.has(candidate.id)) return { kind: "anchor", href: `#topic-${candidate.id}`, label: "목록에서 후보 보기" };
  const label = TOPIC_STATUS_LABEL[candidate.status] ?? "해당 상태";
  if (filter !== candidate.status) {
    return {
      kind: "filter",
      href: `${TOPICS_BASE}?status=${encodeURIComponent(candidate.status)}`,
      label: `"${label}" 목록 열기`,
      text: `이 후보는 지금 보이는 목록에 없습니다. "${label}" 목록에서 찾을 수 있습니다(목록은 최근 수집 100건까지만 보입니다).`,
    };
  }
  return { kind: "text", text: `이 후보는 "${label}" 목록의 최근 수집 100건에 들지 않아 화면에 보이지 않습니다. 바로 이동할 수 없습니다.` };
}

// ---- 목록 공용 상태(필터·보이는 후보·전환 결과) ----

type WorkspaceCtx = {
  visibleIds: ReadonlySet<string> | null;
  filter: TopicStatus | null;
  convertResult: Notice | null;
  setConvertResult: (n: Notice | null) => void;
};
const TopicWorkspaceContext = createContext<WorkspaceCtx | null>(null);

/**
 * 글감 화면 공용 상태. 페이지가 렌더한 실제 목록 id·필터를 내려 주고, 전환 성공 안내를 항목 밖에 보관한다(QA R2):
 * 필터 목록에서 후보가 빠져 항목이 사라져도 원고 링크가 남는다. router.refresh로는 초기화되지 않는다.
 */
export function TopicWorkspace({ visibleIds, filter, children }: { visibleIds: readonly string[] | null; filter: TopicStatus | null; children: ReactNode }) {
  const [convertResult, setConvertResult] = useState<Notice | null>(null);
  const ids = useMemo(() => (visibleIds ? new Set(visibleIds) : null), [visibleIds]);
  const value = useMemo(() => ({ visibleIds: ids, filter, convertResult, setConvertResult }), [ids, filter, convertResult]);
  return <TopicWorkspaceContext.Provider value={value}>{children}</TopicWorkspaceContext.Provider>;
}

/** 전환 성공 안내 자리(목록 위). 항목이 목록에서 빠져도 유지된다. */
export function TopicConvertResult() {
  const ctx = useContext(TopicWorkspaceContext);
  const ref = useRef<HTMLDivElement>(null);
  const result = ctx?.convertResult ?? null;
  useEffect(() => {
    if (result) ref.current?.focus();
  }, [result]);
  return (
    <div ref={ref} tabIndex={-1} aria-live="polite">
      {result && ctx ? (
        <>
          <NoticeView notice={result} onRefresh={() => undefined} />
          <p>
            <button type="button" className="ds-button ds-button--secondary" onClick={() => ctx.setConvertResult(null)}>안내 닫기</button>
          </p>
        </>
      ) : null}
    </div>
  );
}

// ---- 표시 ----

const TONE_CLASS: Record<Tone, string> = { success: "ds-notice", warning: "ds-notice ds-notice--warning", error: "ds-notice ds-notice--error" };

function NoticeView({ notice, onRefresh }: { notice: Notice; onRefresh: () => void }) {
  const ctx = useContext(TopicWorkspaceContext);
  const loc = notice.candidate ? candidateLocator(notice.candidate, ctx ? ctx.visibleIds : null, ctx ? ctx.filter : null) : null;
  return (
    <div role={notice.tone === "error" ? "alert" : "status"} className={TONE_CLASS[notice.tone]}>
      <p><strong>{notice.title}</strong></p>
      {notice.body ? <p>{notice.body}</p> : null}
      {notice.contentId ? (
        <p>
          <Link className="ds-text-link" href={`${CONTENT_BASE}/${notice.contentId}`}>원고 열기</Link>
        </p>
      ) : null}
      {loc?.kind === "anchor" ? (
        <p>
          <a className="ds-text-link" href={loc.href}>{loc.label}</a>
        </p>
      ) : loc?.kind === "filter" ? (
        <p>
          {loc.text} <Link className="ds-text-link" href={loc.href}>{loc.label}</Link>
        </p>
      ) : loc?.kind === "text" ? (
        <p className="ds-muted">{loc.text}</p>
      ) : null}
      {notice.refresh ? (
        <p>
          <button type="button" className="ds-button ds-button--secondary" onClick={onRefresh}>목록 새로 불러오기</button>
        </p>
      ) : null}
    </div>
  );
}

const EMPTY_FORM = { title: "", memo: "", sourceUrl: "", sourceName: "", category: "", sourceDate: "" };

/** 등록 폼. 성공(새로 등록)일 때만 비우고, 중복·실패·결과 불명이면 입력을 그대로 둔다. */
export function TopicCreateForm({ disabledReason }: { disabledReason: string | null }) {
  const router = useRouter();
  const [values, setValues] = useState(EMPTY_FORM);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [pending, start] = useTransition();
  const noticeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (notice) noticeRef.current?.focus();
  }, [notice]);

  const set = (k: keyof typeof EMPTY_FORM) => (e: { target: { value: string } }) => setValues((v) => ({ ...v, [k]: e.target.value }));
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (pending || disabledReason) return;
    const fd = new FormData(e.currentTarget);
    start(async () => {
      let out: TopicCreateOutcome | { status: "request_failed" };
      try {
        out = await createTopicCandidateAction(fd);
      } catch {
        out = { status: "request_failed" };
      }
      setNotice(createNotice(out));
      if (out.status === "ok" && out.data.created) {
        setValues(EMPTY_FORM);
        router.refresh();
      }
    });
  };

  return (
    <section aria-labelledby="topic-new" className="dc-panel">
      <h2 id="topic-new">글감 등록</h2>
      <p className="ds-muted">메모나 출처 링크를 직접 적어 후보로 모읍니다. 링크는 주소만 저장하고 열어 보지 않습니다. 같은 링크·같은 내용은 중복 등록되지 않습니다.</p>
      <div ref={noticeRef} tabIndex={-1} aria-live="polite">
        {notice ? <NoticeView notice={notice} onRefresh={() => router.refresh()} /> : null}
      </div>
      <form onSubmit={onSubmit} className="ds-editor-fields" aria-busy={pending || undefined}>
        <fieldset disabled={disabledReason !== null || pending}>
          <label htmlFor="tc-title">제목(필수, 200자 이하)</label>
          <input id="tc-title" name="title" type="text" required maxLength={400} value={values.title} onChange={set("title")} />
          <label htmlFor="tc-memo">메모(5000자 이하)</label>
          <textarea id="tc-memo" name="memo" rows={5} value={values.memo} onChange={set("memo")} />
          <label htmlFor="tc-url">출처 링크(선택, https만)</label>
          <input id="tc-url" name="sourceUrl" type="url" inputMode="url" maxLength={2048} placeholder="https://" value={values.sourceUrl} onChange={set("sourceUrl")} />
          <label htmlFor="tc-source">출처 이름(선택)</label>
          <input id="tc-source" name="sourceName" type="text" maxLength={100} value={values.sourceName} onChange={set("sourceName")} />
          <label htmlFor="tc-category">분류(선택)</label>
          <input id="tc-category" name="category" type="text" maxLength={50} value={values.category} onChange={set("category")} />
          <label htmlFor="tc-date">출처 날짜(선택)</label>
          <input id="tc-date" name="sourceDate" type="date" value={values.sourceDate} onChange={set("sourceDate")} />
          <div className="ds-actions">
            <button type="submit" className="ds-button ds-button--primary">{pending ? "등록하는 중…" : "후보로 등록"}</button>
          </div>
        </fieldset>
        {disabledReason ? <p className="ds-muted dc-reason">{disabledReason}</p> : null}
        {pending ? <p role="status" className="ds-muted dc-reason">처리 중입니다. 다시 누르지 마세요.</p> : null}
      </form>
    </section>
  );
}

/** 후보 한 건: 정보 표시 + 상태 변경 + (고른 후보만) 공통 원고 전환 폼. */
export function TopicCandidateItem({ candidate: c, disabledReason }: { candidate: TopicCandidateDto; disabledReason: string | null }) {
  const router = useRouter();
  const ws = useContext(TopicWorkspaceContext);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [pending, start] = useTransition();
  const [title, setTitle] = useState(c.title);
  const [body, setBody] = useState(c.memo);
  const href = safeHttpsHref(c.sourceUrl);
  const locked = disabledReason !== null || pending;

  const runStatus = (to: "new" | "selected" | "dismissed") => {
    if (locked) return;
    const fd = new FormData();
    fd.set("candidateId", c.id);
    fd.set("expectedVersion", String(c.rowVersion));
    fd.set("status", to);
    start(async () => {
      let out: TopicStatusOutcome | { status: "request_failed" };
      try {
        out = await setTopicCandidateStatusAction(fd);
      } catch {
        out = { status: "request_failed" };
      }
      if (out.status === "ok") {
        setNotice(null);
        router.refresh();
      } else setNotice(failureNotice(out, "상태 변경"));
    });
  };

  const onConvert = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (locked) return;
    const fd = new FormData(e.currentTarget);
    fd.set("candidateId", c.id);
    fd.set("expectedVersion", String(c.rowVersion));
    start(async () => {
      let out: TopicConvertOutcome | { status: "request_failed" };
      try {
        out = await convertTopicCandidateAction(fd);
      } catch {
        out = { status: "request_failed" };
      }
      if (out.status === "ok" && ws) {
        // 성공 안내는 항목 밖(목록 공용 자리)에 둔다 — 필터에서 후보가 빠져 이 항목이 사라져도 원고 링크가 남는다.
        setNotice(null);
        ws.setConvertResult(convertNotice(out, ws.filter, c.title));
      } else {
        setNotice(convertNotice(out, ws?.filter ?? null, c.title));
      }
      if (out.status === "ok") router.refresh();
    });
  };

  return (
    <li id={`topic-${c.id}`} className="dc-card" aria-busy={pending || undefined}>
      <div className="dc-panel-head">
        <h3>{c.title}</h3>
        <span className="dc-tag">{TOPIC_STATUS_LABEL[c.status] ?? "상태 확인 필요"}</span>
      </div>
      <dl className="dc-facts">
        <dt>분류</dt>
        <dd>{c.category ?? "분류 없음"}</dd>
        <dt>수집 시각</dt>
        <dd><time dateTime={c.collectedAt}>{kstTime(c.collectedAt)}</time></dd>
        {c.sourceName || c.sourceDate ? (
          <>
            <dt>출처</dt>
            <dd>{[c.sourceName, c.sourceDate ? `${c.sourceDate} 기준` : null].filter(Boolean).join(" · ")}</dd>
          </>
        ) : null}
        {c.sourceUrl ? (
          <>
            <dt>출처 링크</dt>
            <dd style={{ overflowWrap: "anywhere" }}>
              {href ? (
                <a className="ds-text-link" href={href} target="_blank" rel="noopener noreferrer">{href}<span className="ds-muted"> (새 탭)</span></a>
              ) : (
                <span>{c.sourceUrl} <span className="ds-muted">(형식을 확인할 수 없어 링크로 열지 않습니다)</span></span>
              )}
            </dd>
          </>
        ) : null}
      </dl>
      {c.memo ? <p style={{ whiteSpace: "pre-wrap" }}>{c.memo}</p> : <p className="ds-muted">메모 없음</p>}

      {notice ? <NoticeView notice={notice} onRefresh={() => router.refresh()} /> : null}

      {c.status === "converted" ? (
        <p>
          {c.convertedContentId ? (
            <Link className="ds-button ds-button--secondary" href={`${CONTENT_BASE}/${c.convertedContentId}`}>전환된 원고 열기</Link>
          ) : (
            <span className="ds-muted">전환된 원고 정보를 확인할 수 없습니다.</span>
          )}
          {c.convertedAt ? <span className="ds-muted"> · 전환 {kstTime(c.convertedAt)}</span> : null}
        </p>
      ) : (
        <div className="ds-actions">
          {statusMoves(c.status).map((m) => (
            <button key={m.to} type="button" className={m.to === "dismissed" ? "ds-button ds-button--secondary" : "ds-button ds-button--primary"} disabled={locked} onClick={() => runStatus(m.to)}>
              {m.label}
            </button>
          ))}
        </div>
      )}

      {c.status === "selected" ? (
        <details>
          <summary>공통 원고로 전환</summary>
          <form onSubmit={onConvert} className="ds-editor-fields">
            <fieldset disabled={locked}>
              <p className="ds-muted">제목과 메모를 원고 제목·본문으로 미리 채웠습니다. 다듬은 뒤 전환하세요. 전환하면 원고 버전 1만 생기고 승인·채널 초안·게시는 하지 않습니다. 출처는 이 후보에 남습니다.</p>
              <label htmlFor={`cv-title-${c.id}`}>원고 제목(1~200자)</label>
              <input id={`cv-title-${c.id}`} name="title" type="text" required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
              <label htmlFor={`cv-body-${c.id}`}>원고 본문</label>
              <textarea id={`cv-body-${c.id}`} name="body" rows={8} required value={body} onChange={(e) => setBody(e.target.value)} />
              <label htmlFor={`cv-path-${c.id}`}>연결할 사이트 경로(선택, 예: /about)</label>
              <input id={`cv-path-${c.id}`} name="targetPath" type="text" maxLength={512} />
              <label>
                <input type="checkbox" name="confirmConvert" value="on" required /> 이 후보로 공통 원고를 만듭니다(승인·게시 아님)
              </label>
              <div className="ds-actions">
                <button type="submit" className="ds-button ds-button--primary">{pending ? "전환하는 중…" : "원고로 전환"}</button>
              </div>
            </fieldset>
          </form>
        </details>
      ) : null}
    </li>
  );
}
