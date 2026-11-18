import Link from 'next/link';
import { PublicChannelFeedGrid, type PublicChannelFeed } from './public-channel-feed';

/**
 * DESIGN-HOME-PHOTO-REVISION-102: 홈 실사 사진(분위기 연출용). Wikimedia Commons 출처·라이선스를 화면에 함께 표기한다.
 * CC BY-SA 2.0 사진은 저작자·라이선스·변경(크기 조정·압축) 표기가 필요하다. 이 프로젝트의 실제 여정·인물 사진이 아니다.
 */
const PHOTO_CREDITS = {
  hero: { author: 'Dennis Kleine', license: 'CC BY-SA 2.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/2.0/', source: 'https://commons.wikimedia.org/wiki/File:Cycling_tourist_with_racks_and_panniers_riding_on_a_gravel_road.jpg' },
  band: { author: 'likeablerodent', license: 'CC BY-SA 2.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/2.0/', source: 'https://commons.wikimedia.org/wiki/File:Kazakhstan_in_autumn_(9720298344)_(cropped).jpg' },
  prep: { author: 'JaredMcKenzie', license: 'CC0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/', source: 'https://commons.wikimedia.org/wiki/File:Giant_Roam_2_hybrid_bicycle_beside_a_lightweight_tent_during_cycle_touring_in_the_Australian_bush.jpg' },
} as const;

function PhotoCredit({ credit, changed = true }: { credit: (typeof PHOTO_CREDITS)[keyof typeof PHOTO_CREDITS]; changed?: boolean }) {
  return (
    <>
      사진 <a href={credit.source} target="_blank" rel="noopener noreferrer">{credit.author}<span className="ds-visually-hidden"> (Wikimedia Commons, 새 창에서 열림)</span></a>
      {' · '}<a href={credit.licenseUrl} target="_blank" rel="noopener noreferrer">{credit.license}<span className="ds-visually-hidden"> 라이선스 (새 창에서 열림)</span></a>
      {changed ? ' · 크기 조정' : null}
    </>
  );
}

const preparationSteps = [
  { number: '01', title: '도전을 시작하는 이유', description: '자전거 세계일주를 계획하는 목적과 이야기를 준비합니다. 실제 완료한 여정이나 인증 기록을 뜻하지 않습니다.' },
  { number: '02', title: '출발 전 준비와 여정 계획', description: '어떤 준비를 하고 무엇을 기록할지 소개할 예정입니다. 확인된 자료와 공개 동의를 갖춘 뒤 안내합니다.' },
  { number: '03', title: '기록을 책으로 나누는 이유', description: '길 위에서 남길 기록과 출판의 방향을 이야기할 예정입니다. 책 정보와 출간 일정은 아직 준비 중입니다.' },
];

/**
 * DESIGN-CHANNELS-HOME-082: 홈은 공개 채널 콘텐츠 중심으로 구성한다.
 * channelFeeds는 서버가 외부 게시 확인 항목만 담아 넘긴다(계약은 public-channel-feed.tsx).
 * 넘기지 않으면 세 채널 모두 빈 상태로 보인다 — 개발용 fixture를 기본값으로 두지 않는다.
 */
export function ProjectHome({ channelFeeds = [] }: { channelFeeds?: readonly PublicChannelFeed[] }) {
  return (
    <main id="main-content" tabIndex={-1} className="ds-main">
      {/* DESIGN-HOME-PHOTO-REVISION-102: 097 "지구 한 바퀴" 문구 유지, 배경을 실사 사진(분위기 연출용)으로 교체. 사진은 장식(alt=""), 정보는 텍스트로 전달. */}
      <section className="ds-hero ds-hero--photo" aria-labelledby="home-title">
        <picture className="ds-hero-photo-media">
          <source srcSet="/images/home/home-hero-gravel-road.webp" type="image/webp" />
          <img src="/images/home/home-hero-gravel-road.jpg" alt="" width={1080} height={1080} fetchPriority="high" decoding="async" />
        </picture>
        <div className="ds-container ds-hero-photo-grid">
          <div className="ds-hero-photo-copy">
            <p className="ds-hero-photo-kicker">자전거 세계일주 · 출발 준비 중</p>
            <h1 id="home-title"><span className="ds-hero-photo-line">지구 한 바퀴,</span> <span className="ds-hero-photo-line"><span className="ds-hero-photo-accent">페달</span>로 잇습니다.</span></h1>
            <p className="ds-lead">원민철의 자전거 세계일주 도전 계획. 자전거 한 대로 대륙과 마을을 잇는 길을 준비하고, 그 이야기를 블로그·Threads·Instagram에 남길 계획입니다.</p>
            <dl className="ds-hero-photo-facts">
              <div><dt>적도 기준 지구 둘레(약)</dt><dd>40,075km</dd></div>
              <div><dt>일정</dt><dd>출발일 미정</dd></div>
            </dl>
            <div className="ds-actions">
              <a className="ds-button ds-button--primary" href="#channels">채널별 공개 글 보기 <span aria-hidden="true">↓</span></a>
              <Link className="ds-button ds-button--secondary" href="/about">도전 이야기 읽기 <span aria-hidden="true">→</span></Link>
            </div>
            <p className="ds-hero-note">게시가 확인된 글만 아래에 모아 보여드리고, 채널별 준비 상태도 함께 안내합니다. 구독·신청 기능은 없습니다.</p>
          </div>
        </div>
        <p className="ds-hero-photo-credit">분위기 연출용 사진이며 이 프로젝트의 실제 여정이나 인물이 아닙니다 · <PhotoCredit credit={PHOTO_CREDITS.hero} /></p>
      </section>

      <section id="channels" tabIndex={-1} className="ds-section ds-container" aria-labelledby="channels-title">
        <div className="ds-section-heading">
          <div>
            <p className="ds-eyebrow">채널별 공개 글</p>
            <h2 id="channels-title">블로그·Threads·Instagram에서 이야기를 만나세요.</h2>
            <p className="ds-section-intro">게시가 확인된 글만 모아 보여드리고, 아직 준비 중인 채널은 그 상태를 칸마다 안내합니다. 게시가 확인되지 않은 글은 표시하지 않습니다.</p>
          </div>
        </div>
        <PublicChannelFeedGrid feeds={channelFeeds} />
      </section>

      <figure className="ds-photo-band">
        <picture>
          <source srcSet="/images/home/home-band-kazakhstan.webp" type="image/webp" />
          <img src="/images/home/home-band-kazakhstan.jpg" alt="" width={1920} height={275} loading="lazy" decoding="async" />
        </picture>
        <figcaption>
          <span className="ds-photo-band-title">길 위에서 만날 풍경을 상상하며 준비합니다.</span>
          <small>분위기 연출용 사진(카자흐스탄의 가을)이며 실제 여정이 아닙니다 · <PhotoCredit credit={PHOTO_CREDITS.band} /></small>
        </figcaption>
      </figure>

      <section className="ds-section ds-process-section" aria-labelledby="process-title">
        <div className="ds-container">
          <p className="ds-eyebrow">준비 중인 콘텐츠 주제</p>
          <h2 id="process-title">이런 이야기를 나누려 합니다.</h2>
          <p className="ds-section-intro">아래는 콘텐츠 기획 주제입니다. 이미 발행된 기사나 실제 준비 실적으로 표시하지 않습니다.</p>
          <figure className="ds-photo-prep">
            <picture>
              <source srcSet="/images/home/home-prep-tent.webp" type="image/webp" />
              <img src="/images/home/home-prep-tent.jpg" alt="숲속 풀밭에 세운 빨간 1인용 텐트와 그 옆에 세워 둔 자전거" width={1200} height={900} loading="lazy" decoding="async" />
            </picture>
            <figcaption>출발 전 준비를 떠올리게 하는 분위기 연출용 사진이며 실제 여정이 아닙니다 · <PhotoCredit credit={PHOTO_CREDITS.prep} /></figcaption>
          </figure>
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
