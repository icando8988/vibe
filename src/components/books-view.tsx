import Link from 'next/link';
import { StatusNotice } from './status-notice';

export function BooksView() {
  return (
    <main id="main-content" tabIndex={-1} className="ds-main">
      <div className="ds-container ds-section">
        <nav aria-label="현재 위치" className="ds-breadcrumb"><Link href="/">홈</Link><span aria-hidden="true">/</span><span aria-current="page">책과 참여</span></nav>
        <p className="ds-eyebrow">이야기를 담을 책</p>
        <h1>책과 참여</h1>
        <p className="ds-lead">책의 내용과 참여 조건을 충분히 살펴본 뒤 함께할 수 있도록 준비합니다.</p>
        <section className="ds-empty-state" aria-labelledby="books-empty-title">
          <span className="ds-empty-symbol" aria-hidden="true">↗</span>
          <p className="ds-tag">책 정보 미확보 · 모집 전</p>
          <h2 id="books-empty-title">아직 공개된 책이 없습니다.</h2>
          <p>표지와 목차, 책 형식, 가격, 출간 일정이 확정되지 않았습니다.<br className="ds-desktop-break" /> 확인된 자료가 준비되면 이곳에서 안내합니다.</p>
          <Link className="ds-button ds-button--secondary" href="/about">먼저 도전 이야기 읽기</Link>
        </section>
        <StatusNotice tone="warning" title="신청·입금·외부 펀딩은 아직 연결되지 않았습니다">
          <p>현재 구매 신청이나 회원 가입을 접수하지 않습니다. 실제 판매 조건과 취소·환불 정책은 참여 기능을 열기 전에 안내합니다.</p>
        </StatusNotice>
        <div className="ds-actions ds-books-followup"><Link className="ds-text-link" href="/how-it-works">참여 전 확인할 내용 <span aria-hidden="true">→</span></Link><a className="ds-text-link" href="#contact">문의와 정책 준비 상태 <span aria-hidden="true">↓</span></a></div>
      </div>
    </main>
  );
}
