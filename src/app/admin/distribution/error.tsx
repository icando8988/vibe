"use client";

import Link from "next/link";

/**
 * 화면 오류. 조회 실패를 게시 실패로 바꾸지 않고, 안전한 참조 코드(digest)만 보인다.
 * 오류 원문·스택·비밀값은 표시하지 않는다.
 */
export default function DistributionError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main id="main-content" tabIndex={-1} className="ds-main">
      <div className="ds-container ds-section">
        <h1>화면을 표시하지 못했습니다</h1>
        <div className="ds-notice ds-notice--error" role="alert">
          <strong className="ds-notice-title">콘텐츠 배포 화면 오류</strong>
          <p>화면을 만드는 중 문제가 생겼습니다. 저장·승인·게시 결과와는 관계없는 표시 오류입니다.</p>
          {error.digest ? (
            <p>
              참조 코드: <code>{error.digest}</code>
            </p>
          ) : null}
        </div>
        <div className="ds-actions">
          <button type="button" className="ds-button ds-button--primary" onClick={() => reset()}>
            다시 불러오기
          </button>
          <Link className="ds-button ds-button--secondary" href="/admin">
            관리로 돌아가기
          </Link>
        </div>
      </div>
    </main>
  );
}
