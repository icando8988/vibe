import Link from "next/link";
import { ConsoleShell } from "@/components/distribution-console/console-shell";
import { denyUnlessDistributionAdmin } from "@/components/distribution-console/guard";
import { ReadStateNotice } from "@/components/distribution-console/write-notice-view";
import { isWriteConfigured, loadContentList, loadJobs } from "@/server/distribution/content-page";
import { jobStatusText, type JobDto } from "@/server/distribution/jobs-dto";
import styles from "./overview.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "SNS 관리" };

const routes = {
  newContent: "/admin/distribution/contents/new",
  library: "/admin/distribution/contents",
  jobs: "/admin/distribution/jobs",
  connections: "/admin/distribution/connections",
};

const channels = [
  { id: "threads", name: "Threads", href: `${routes.connections}/threads`, mode: "텍스트 모의 실행", detail: "계정을 연결하고 승인된 문안을 모의 실행합니다." },
  { id: "instagram", name: "Instagram", href: `${routes.connections}/instagram`, mode: "초안·미디어 준비", detail: "캡션, 이미지와 권리 상태를 검토합니다." },
  { id: "blog", name: "네이버 블로그", href: `${routes.connections}/blog-extension`, mode: "확장 입력·수동 발행", detail: "승인한 글을 확장으로 보내고 실제 게시 URL을 기록합니다." },
];

const dateTime = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "short", timeStyle: "short" });

function needsAttention(job: JobDto): boolean {
  return job.hasIssues || job.reconciliationRequired || job.holdReason !== null || ["failed", "unknown", "awaiting_evidence"].includes(job.status);
}

export default async function DistributionOverviewPage() {
  const denied = await denyUnlessDistributionAdmin();
  if (denied) return denied;

  const [contents, jobs] = await Promise.all([loadContentList(), loadJobs()]);
  const canWrite = isWriteConfigured() && contents.status === "ok";
  const contentRows = contents.status === "ok" ? contents.data : [];
  const jobRows = jobs.status === "ok" ? jobs.data : [];
  const titles = new Map(contentRows.map((content) => [content.id, content.title]));
  const recentJobs = [...jobRows].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 5);
  const metrics = [
    { label: "원고", count: contents.status === "ok" ? contentRows.length : null, detail: "최근 원고 최대 50건 기준", href: routes.library },
    { label: "예약 작업", count: jobs.status === "ok" ? jobRows.filter((job) => job.status === "scheduled" && job.mode === "live").length : null, detail: "실제 게시 예약", href: routes.jobs },
    { label: "게시 확인", count: jobs.status === "ok" ? jobRows.filter((job) => job.status === "published").length : null, detail: "게시 결과가 확인된 작업", href: routes.jobs },
    { label: "조치 필요", count: jobs.status === "ok" ? jobRows.filter(needsAttention).length : null, detail: "실패·결과 불명·증거 대기 포함", href: routes.jobs },
  ];

  return (
    <ConsoleShell
      section="overview"
      isRoot
      title="SNS 관리"
      description="글을 준비하고 Threads, Instagram, 네이버 블로그의 게시 작업을 관리합니다."
      actions={<Link className="ds-button ds-button--secondary" href={routes.connections}>계정 연결</Link>}
      gateNotice={<p className={styles.state}>예약 자동 게시는 준비 중입니다. 네이버 블로그는 확장 입력 후 직접 발행할 수 있습니다.</p>}
    >
      <section aria-labelledby="sns-summary">
        <div className={styles.sectionHead}>
          <h2 id="sns-summary">운영 현황</h2>
          <span>최근 게시 작업 최대 100건 기준</span>
        </div>
        <div className={styles.metrics}>
          {metrics.map((metric) => (
            <article key={metric.label} className={`dc-card ${styles.metric}`}>
              <Link href={metric.href}>{metric.label}</Link>
              <strong>{metric.count === null ? "조회 불가" : `${metric.count}건`}</strong>
              <small>{metric.detail}</small>
            </article>
          ))}
        </div>
      </section>

      <section aria-labelledby="sns-start" className="dc-block">
        <div className={styles.sectionHead}><h2 id="sns-start">콘텐츠 시작</h2></div>
        <div className={styles.cards}>
          <article className="dc-card">
            <h3>원고 직접 작성</h3>
            <p>제목과 본문을 입력하고 채널별 초안을 만듭니다.</p>
            {canWrite ? <Link className="ds-button ds-button--primary" href={routes.newContent}>새 원고 작성</Link> : <p className="ds-muted">원고 저장 연결을 확인해 주세요.</p>}
          </article>
          <article className="dc-card">
            <h3>글감 수집</h3>
            <p>출처가 있는 글감 후보를 모아 원고로 가져오는 기능입니다.</p>
            <span className="dc-tag">준비 중</span>
          </article>
          <article className="dc-card">
            <h3>주제로 바로 만들기</h3>
            <p>주제만 입력해 제목과 기본 원고를 제안받는 기능입니다.</p>
            <span className="dc-tag">준비 중</span>
          </article>
        </div>
      </section>

      <section aria-labelledby="sns-channels" className="dc-block">
        <div className={styles.sectionHead}>
          <h2 id="sns-channels">채널별 게시</h2>
          <Link href={routes.connections}>전체 연결 상태</Link>
        </div>
        <div className={styles.cards}>
          {channels.map((channel) => (
            <article key={channel.id} className="dc-card">
              <h3>{channel.name}</h3>
              <span className="dc-tag">{channel.mode}</span>
              <p>{channel.detail}</p>
              <Link href={channel.href}>{channel.name} 연결 관리</Link>
            </article>
          ))}
        </div>
      </section>

      <div className={`dc-block ${styles.activity}`}>
        <section aria-labelledby="sns-contents" className="dc-card">
          <div className={styles.sectionHead}>
            <h2 id="sns-contents">최근 원고</h2><Link href={routes.library}>보관함 열기</Link>
          </div>
          {contents.status !== "ok" ? <ReadStateNotice status={contents.status} what="원고 목록" /> : !contentRows.length ? (
            <p className="ds-muted">저장한 원고가 없습니다.</p>
          ) : (
            <ul className={styles.rows}>
              {contentRows.slice(0, 5).map((content) => (
                <li key={content.id}><Link href={`${routes.library}/${content.id}`}>{content.title ?? "제목 없음"}</Link></li>
              ))}
            </ul>
          )}
        </section>
        <section aria-labelledby="sns-jobs" className="dc-card">
          <div className={styles.sectionHead}>
            <h2 id="sns-jobs">최근 게시 작업</h2><Link href={routes.jobs}>작업 목록 열기</Link>
          </div>
          {jobs.status !== "ok" ? <ReadStateNotice status={jobs.status} what="게시 작업" /> : !recentJobs.length ? (
            <p className="ds-muted">등록된 게시 작업이 없습니다.</p>
          ) : (
            <ul className={styles.rows}>
              {recentJobs.map((job) => {
                const channelName = channels.find((channel) => channel.id === job.channel)?.name ?? "채널 미확인";
                const updatedAt = new Date(job.updatedAt);

                return (
                  <li key={job.id}>
                    <Link href={`${routes.jobs}/${job.id}`}>{titles.get(job.contentId) || `${channelName} 작업`}</Link>
                    <span>{channelName} · {jobStatusText(job)}</span>
                    {Number.isFinite(updatedAt.getTime()) ? <time dateTime={job.updatedAt}>{dateTime.format(updatedAt)} KST</time> : null}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </ConsoleShell>
  );
}
