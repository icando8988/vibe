import Link from 'next/link';
export function SiteFooter() {
  return (
    <footer className="ds-footer">
      <div className="ds-container ds-footer-grid">
        <div>
          <p className="ds-footer-title">세계일주 · 출판 프로젝트</p>
          <p>도전의 이야기와 책으로 만나는 여정.</p>
          <p className="ds-muted">비공개 검토용 화면 · 공식 이름과 공개 자료 준비 중</p>
        </div>
        <div id="contact" className="ds-contact" tabIndex={-1}>
          <h2>문의와 정책</h2>
          <p>공식 문의 연락처는 준비 중입니다. 현재 이 화면에서는 문의를 접수하지 않습니다.</p>
          <p>이용약관·개인정보 처리방침·취소 및 환불 정책은 확정 후 안내합니다. 현재 회원 가입과 거래는 제공하지 않습니다.</p>
          <Link href="/how-it-works">참여 전 확인할 내용 보기 <span aria-hidden="true">↗</span></Link>
        </div>
      </div>
    </footer>
  );
}
