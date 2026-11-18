import Link from "next/link";
import { ConsoleShell } from "@/components/distribution-console/console-shell";
import { denyUnlessDistributionAdmin } from "@/components/distribution-console/guard";
import { TopicCandidateItem, TopicConvertResult, TopicCreateForm, TopicWorkspace } from "@/components/distribution-console/topic-collector";
import { TOPIC_STATUS_LABEL, topicListStateText, topicWriteLock } from "@/components/distribution-console/topic-labels";
import { isWriteConfigured } from "@/server/distribution/content-page";
import { getTopicCandidates } from "@/server/distribution/topics/runtime";
import { TOPIC_STATUSES, type TopicStatus } from "@/server/distribution/topics/types";

export const dynamic = "force-dynamic";
export const metadata = { title: "글감 수집" };

const BASE = "/admin/distribution/topics";

/**
 * 글감 수집(task_e3081d32118a, 계약 TOPIC-COLLECT-131 §3).
 * 관리자 가드 → 목록 조회(D1 포함) → 등록 폼·필터·후보 목록. 쓰기는 저장 연결과 목록 조회가 정상일 때만 연다.
 * 외부 주소 접속·AI 호출·게시 없음.
 */
export default async function TopicsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const denied = await denyUnlessDistributionAdmin();
  if (denied) return denied;
  const sp = await searchParams;
  const raw = typeof sp.status === "string" ? sp.status : "";
  const filter = (TOPIC_STATUSES as readonly string[]).includes(raw) ? (raw as TopicStatus) : null;
  const list = await getTopicCandidates(filter ? { status: filter } : {});
  const lock = topicWriteLock(list, isWriteConfigured());

  const filters: Array<{ key: TopicStatus | null; label: string }> = [{ key: null, label: "전체" }, ...TOPIC_STATUSES.map((s) => ({ key: s, label: TOPIC_STATUS_LABEL[s] }))];

  return (
    <ConsoleShell
      section="overview"
      eyebrow="콘텐츠 시작"
      title="글감 수집"
      description="메모나 출처 링크로 글감 후보를 모으고, 고른 후보를 공통 원고로 전환합니다. 전환은 원고 버전 1만 만들며 승인·게시는 하지 않습니다."
      crumbs={[{ href: "/admin/distribution", label: "SNS 관리" }, { label: "글감 수집" }]}
    >
      {/* 실제 렌더한 후보 id·필터를 공용 상태로 내려 준다(중복 안내 링크 판정, 전환 결과 유지 — QA R2·R3). */}
      <TopicWorkspace visibleIds={list.status === "ok" ? list.data.map((c) => c.id) : null} filter={filter}>
      <TopicCreateForm disabledReason={lock} />

      <section aria-labelledby="topic-list" className="dc-block">
        <h2 id="topic-list">후보 목록</h2>
        <nav aria-label="후보 상태 필터" className="dc-channel-links">
          <ul>
            {filters.map((f) => (
              <li key={f.key ?? "all"}>
                <Link href={f.key ? `${BASE}?status=${f.key}` : BASE} aria-current={f.key === filter ? "page" : undefined}>
                  {f.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <TopicConvertResult />
        {list.status !== "ok" ? (
          <p role="status" className="ds-notice ds-notice--warning">{topicListStateText(list)}</p>
        ) : list.data.length === 0 ? (
          <p className="ds-muted">{filter ? `"${TOPIC_STATUS_LABEL[filter]}" 상태의 후보가 없습니다.` : "아직 등록한 글감 후보가 없습니다."}</p>
        ) : (
          <>
            <p className="ds-muted">최근 수집 순 최대 100건 · {list.data.length}건</p>
            <ul className="dc-topic-list" style={{ listStyle: "none", padding: 0, display: "grid", gap: ".85rem" }}>
              {list.data.map((c) => (
                <TopicCandidateItem key={c.id} candidate={c} disabledReason={lock} />
              ))}
            </ul>
          </>
        )}
      </section>
      </TopicWorkspace>

      <p className="dc-block">
        <Link className="ds-text-link" href="/admin/distribution/quick">주제로 바로 만들기</Link>
        {" · "}
        <Link className="ds-text-link" href="/admin/distribution">SNS 관리로</Link>
      </p>
    </ConsoleShell>
  );
}
