import type { JobDto } from "@/server/distribution/jobs-dto";
import { jobStatusText } from "@/server/distribution/jobs-dto";

/** 작업 요약(서버 컴포넌트). 값은 조회 결과 그대로이며 텍스트로만 렌더한다. */
export function JobFacts({ job }: { job: JobDto }) {
  return (
    <dl className="dc-facts">
      <dt>상태</dt>
      <dd>
        {jobStatusText(job)}
        {job.status === "unrecognized" ? ` (${job.rawStatus})` : ""}
      </dd>
      <dt>채널·방식</dt>
      <dd>
        {job.channel} · {job.mode}
      </dd>
      <dt>원문 버전</dt>
      <dd>v{job.contentVersionNo}</dd>
      <dt>작업 버전</dt>
      <dd>{job.version}</dd>
      {job.reconciliationRequired ? (
        <>
          <dt>검토</dt>
          <dd>늦은·충돌 증거 검토 필요</dd>
        </>
      ) : null}
      {job.externalUrl ? (
        <>
          <dt>게시 주소</dt>
          <dd>{job.externalUrl}</dd>
        </>
      ) : null}
      {job.lastErrorCode ? (
        <>
          <dt>마지막 오류 코드</dt>
          <dd>{job.lastErrorCode}</dd>
        </>
      ) : null}
    </dl>
  );
}

export const kst = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "medium", timeStyle: "short" }).format(new Date(iso)) + " KST" : "—";
