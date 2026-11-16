import Link from 'next/link';
import { StatusNotice } from './status-notice';

const preparationSteps = [
  { number: '01', title: '도전을 시작하는 이유', description: '자전거 세계일주를 계획하는 목적과 이야기를 준비합니다. 실제 완료한 여정이나 인증 기록을 뜻하지 않습니다.' },
  { number: '02', title: '출발 전 준비와 여정 계획', description: '어떤 준비를 하고 무엇을 기록할지 소개할 예정입니다. 확인된 자료와 공개 동의를 갖춘 뒤 안내합니다.' },
  { number: '03', title: '기록을 책으로 나누는 이유', description: '길 위에서 남길 기록과 출판의 방향을 이야기할 예정입니다. 책 정보와 출간 일정은 아직 준비 중입니다.' },
];

export function ProjectHome() {
  return (
    <main id="main-content" tabIndex={-1} className="ds-main">
      <section className="ds-hero" aria-labelledby="home-title">
        <div className="ds-container ds-hero-grid">
          <div>
            <p className="ds-eyebrow">자전거 세계일주 · 출판 프로젝트</p>
            <h1 id="home-title">떠나기 전부터,<br />이야기는 시작됩니다.</h1>
            <p className="ds-lead">원민철의 자전거 세계일주 도전 계획. 도전을 준비하는 이유와 여정의 이야기를 차근차근 나누기 위한 공간입니다.</p>
            <div className="ds-actions">
              <Link className="ds-button ds-button--primary" href="/about">도전 이야기 읽기 <span aria-hidden="true">→</span></Link>
              <a className="ds-button ds-button--secondary" href="#stories">준비 중인 이야기 살펴보기</a>
            </div>
            <p className="ds-hero-note">지금은 소개 자료와 콘텐츠를 준비 중입니다. 공개된 기사·구독·신청 기능은 없습니다.</p>
          </div>
          <aside className="ds-journey-note" aria-label="프로젝트 준비 안내">
            <span className="ds-tag">도전 계획</span>
            <p className="ds-note-heading">준비부터 기록까지,<br />차근차근 나눌 이야기.</p>
            <div className="ds-route-art" aria-hidden="true"><span /><i /><span /><i /><span /></div>
            <p>도전의 이유 → 출발 준비 → 기록 계획</p>
            <p className="ds-muted">이 그림은 준비 방향을 표현합니다.<br />실제 이동 경로나 달성 기록이 아닙니다.</p>
          </aside>
        </div>
      </section>

      <section id="stories" tabIndex={-1} className="ds-section ds-container" aria-labelledby="stories-title">
        <div className="ds-section-heading">
          <div><p className="ds-eyebrow">이야기 둘러보기</p><h2 id="stories-title">공개할 첫 이야기를 준비합니다.</h2></div>
          <Link className="ds-text-link" href="/stories">이야기 목록 보기 <span aria-hidden="true">→</span></Link>
        </div>
        <StatusNotice title="아직 공개된 글과 연결된 채널이 없습니다">
          <p>소개 자료와 콘텐츠의 사실 확인을 마친 뒤 안내하겠습니다. 블로그·Threads·Instagram의 공식 채널 주소와 게시 일정도 확인 후 제공합니다.</p>
        </StatusNotice>
      </section>

      <section className="ds-section ds-process-section" aria-labelledby="process-title">
        <div className="ds-container">
          <p className="ds-eyebrow">준비 중인 콘텐츠 주제</p>
          <h2 id="process-title">이런 이야기를 나누려 합니다.</h2>
          <p className="ds-section-intro">아래는 콘텐츠 기획 주제입니다. 이미 발행된 기사나 실제 준비 실적으로 표시하지 않습니다.</p>
          <ol className="ds-steps">
            {preparationSteps.map((step) => <li key={step.number}><span className="ds-step-number" aria-hidden="true">{step.number}</span><h3>{step.title}</h3><p>{step.description}</p></li>)}
          </ol>
          <Link className="ds-text-link" href="/about">현재 도전 소개 보기 <span aria-hidden="true">→</span></Link>
        </div>
      </section>

      <section className="ds-section ds-container ds-closing" aria-labelledby="home-books-title">
        <div><p className="ds-eyebrow">이야기에서 책으로</p><h2 id="home-books-title">책으로 만나는 여정도 준비합니다.</h2><p>책의 내용과 출간 조건은 확정 후 안내합니다. 현재 판매와 참여 신청은 받지 않습니다.</p></div>
        <div className="ds-actions"><Link className="ds-text-link" href="/books">책 준비 상태 보기 <span aria-hidden="true">→</span></Link><a className="ds-text-link" href="#contact">문의와 정책 확인 <span aria-hidden="true">↓</span></a></div>
      </section>
    </main>
  );
}
