/**
 * 확장(네이버 블로그 입력기)에 넘길 작업 본문 만들기 — 순수 함수(테스트 대상).
 * 원본 키트의 utils/extensionTask.ts·extensionContent.ts 역할을 우리 데이터 구조로 대체한다(원본 코드 복사 아님).
 *
 * - 제목: 당장은 **승인된 원문 버전의 title**을 쓴다(초안 리비전에 title 열 없음 — 신규 열 추가하지 않음, Master 결정).
 * - 본문: 승인된 blog 리비전 body. 빈 줄로 문단을 나눠 확장의 text 블록으로 보낸다. 이미지 블록은 M4 전이라 없다.
 * - 승인 확인: 리비전 승인과 원문 버전 승인이 모두 유효해야 만든다. 판정 자체는 DB(create_job·서버 API)가 다시 한다.
 * - 확장은 이 내용을 발행 직전까지만 입력한다. 입력 결과는 게시 증거가 아니다.
 */

export type ApprovedBlogSource = {
  jobId: string;
  runId: string;
  jobMode: string;
  jobStatus: string;
  channel: string;
  contentVersion: { title: string; approved: boolean };
  revision: { body: string; approved: boolean; channel: string };
};

export type ExtensionTextBlock = { type: "text"; text: string };
export type ExtensionTask = { id: string; runId: string; title: string; blocks: ExtensionTextBlock[]; tags: string[] };

export type BlogTaskProblem =
  | "not_blog"
  | "not_manual"
  | "not_manual_ready"
  | "revision_not_approved"
  | "content_not_approved"
  | "empty_title"
  | "empty_body";

export function buildBlogExtensionTask(src: ApprovedBlogSource): { ok: true; task: ExtensionTask } | { ok: false; problem: BlogTaskProblem } {
  if (src.channel !== "blog" || src.revision.channel !== "blog") return { ok: false, problem: "not_blog" };
  if (src.jobMode !== "manual") return { ok: false, problem: "not_manual" };
  if (src.jobStatus !== "manual_ready") return { ok: false, problem: "not_manual_ready" };
  if (!src.revision.approved) return { ok: false, problem: "revision_not_approved" };
  if (!src.contentVersion.approved) return { ok: false, problem: "content_not_approved" };
  const title = src.contentVersion.title;
  if (title.trim().length === 0) return { ok: false, problem: "empty_title" };
  const paragraphs = src.revision.body
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .map((p) => p.replace(/^\n+|\n+$/g, ""))
    .filter((p) => p.trim().length > 0);
  if (paragraphs.length === 0) return { ok: false, problem: "empty_body" };
  return {
    ok: true,
    task: { id: src.jobId, runId: src.runId, title, blocks: paragraphs.map((text) => ({ type: "text", text })), tags: [] },
  };
}
