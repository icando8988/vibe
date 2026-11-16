import Link from "next/link";
import { PageMain } from "./_components/page-main";

export default function NotFound() {
  return (
    <PageMain title="페이지를 찾을 수 없습니다">
      <p>주소가 바뀌었거나 아직 공개되지 않은 페이지입니다.</p>
      <div className="ds-actions">
        <Link className="ds-button ds-button--secondary" href="/">
          홈으로
        </Link>
        <Link className="ds-text-link" href="/stories">
          이야기 목록 <span aria-hidden="true">→</span>
        </Link>
      </div>
    </PageMain>
  );
}
