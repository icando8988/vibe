import Link from 'next/link';
const navigation = [
  { href: '/about', label: '도전 이야기' },
  { href: '/stories', label: '이야기 목록' },
  { href: '/how-it-works', label: '참여 안내' },
  { href: '/books', label: '책 준비 안내' },
];

export function SiteHeader() {
  return (
    <>
      <a className="ds-skip-link" href="#main-content">본문 바로가기</a>
      <header className="ds-header">
        <div className="ds-container ds-header-inner">
          <Link className="ds-brand" href="/" aria-label="세계일주 · 출판 프로젝트 홈">
            <span className="ds-brand-symbol" aria-hidden="true">↗</span>
            <span>세계일주 · 출판<span className="ds-brand-caption">프로젝트 · 임시 이름</span></span>
          </Link>
          <nav aria-label="주요 메뉴" className="ds-nav">
            {navigation.map(({ href, label }) => <Link key={href} href={href}>{label}</Link>)}
            <Link className="ds-account-link" href="/login">로그인/가입</Link>
          </nav>
        </div>
      </header>
    </>
  );
}
