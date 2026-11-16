import Link from "next/link";
import { PageMain } from "../_components/page-main";

// 없는·비공개·형식 오류 slug. 비공개 글의 존재 여부를 구별해 알려주지 않는다.
export default function StoryNotFound() {
  return (
    <PageMain eyebrow="이야기" title="이야기를 찾을 수 없습니다">
      <p>주소가 바뀌었거나 아직 공개되지 않은 이야기입니다.</p>
      <div className="ds-actions">
        <Link className="ds-button ds-button--secondary" href="/stories">
          이야기 목록으로
        </Link>
        <Link className="ds-text-link" href="/">
          홈으로 <span aria-hidden="true">→</span>
        </Link>
      </div>
    </PageMain>
  );
}
