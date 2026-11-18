import Link from 'next/link';
import { formatKoreanDate } from '@/lib/content/metadata';

/**
 * DESIGN-CHANNELS-HOME-082: 방문자용 공개 채널 피드(표현 전용).
 *
 * 입력 계약 — 서버가 "실제 외부 게시가 확인된 항목"만 골라 이 모양으로 넘긴다.
 * - 이 타입에는 상태(status) 필드가 없다. 초안·검수 대기·예약·모의 실행(dry_run_succeeded)·
 *   게시 결과 불명(unknown)·증거 대기(awaiting_evidence) 항목은 서버 경계에서 제외하고 보내지 않는다.
 * - 관리자 정보(작업 ID, 계정 ID, 오류, 검토자, 토큰 등)는 넣지 않는다.
 * - 아래 표현 단계 방어선은 형식이 깨진 항목을 숨길 뿐, 상태 판정을 대신하지 않는다.
 */
export type PublicChannelId = 'blog' | 'threads' | 'instagram';

export interface PublicChannelPost {
  /** 채널 안에서 유일한 공개 식별자(React key). 내부 작업 ID를 쓰지 않는다. */
  id: string;
  channel: PublicChannelId;
  /** 없으면 제목 줄을 숨기고 링크 이름은 채널·게시일로 만든다. */
  title?: string | null;
  /** 일반 텍스트 요약. 없으면 숨긴다. HTML을 해석하지 않는다. */
  summary?: string | null;
  /** 외부 게시 확인 시각(ISO-8601 UTC). 필수. */
  publishedAt: string;
  /** 원문 주소. 블로그는 내부 경로(`/stories/slug`) 또는 https 외부 permalink(예: blog.naver.com), Threads·Instagram은 https 외부 permalink. 필수. */
  url: string;
}

export interface PublicChannelFeed {
  channel: PublicChannelId;
  /** 확인된 공식 채널 프로필 주소(https). 확인 전에는 null — 링크를 만들지 않는다. */
  profileUrl?: string | null;
  /** 최신순. 홈에서는 앞에서부터 최대 3개만 보인다. */
  posts: readonly PublicChannelPost[];
  /**
   * 조회 불가 표시(FE-HOME-PUBLIC-FEED-085, FE-086). 값이 있으면 posts와 무관하게 "게시물 없음"이 아닌 별도 안내를 보인다.
   * - not_configured: 서버 연결 설정 전 / error: 읽기 실패·스키마 없음·형식 이상
   * - unsupported: 이 채널의 공개 게시물 연동이 아직 없음(서버 availability = unsupported)
   * 없거나 null이면 정상 조회 결과다(0건 포함).
   */
  unavailable?: PublicChannelUnavailable | null;
}

export type PublicChannelUnavailable = 'not_configured' | 'error' | 'unsupported';

/**
 * 카드 날짜의 의미(FE-086). 서버 계약의 publishedAt은 "외부 게시 확인 시각"이다.
 * 블로그는 운영자가 수동 증거로 기록한 확인(관측) 시각이라 실제 게시일과 다를 수 있다.
 * Threads·Instagram은 아직 연동 전이며, 실제 게시 시각 계약이 생기기 전까지 같은 "게시 확인" 의미로 표기한다.
 */
const DATE_LABEL: Record<PublicChannelId, string> = { blog: '게시 확인', threads: '게시 확인', instagram: '게시 확인' };

const UNAVAILABLE_TEXT: Record<PublicChannelUnavailable, { title: string; body: string }> = {
  unsupported: {
    title: '이 채널 글은 아직 홈에 모아 보여드리지 않습니다',
    body: '이 채널의 공개 게시물을 홈에 불러오는 기능을 준비하고 있습니다. 준비가 끝나면 게시가 확인된 글만 이곳에 표시합니다.',
  },
  not_configured: {
    title: '게시물 연결을 준비하고 있습니다',
    body: '채널 게시물을 불러오는 연결이 아직 준비되지 않았습니다. 게시물이 없다는 뜻은 아닙니다.',
  },
  error: {
    title: '지금은 게시물을 불러오지 못했습니다',
    // H08(FE-090): schema_missing도 이 문구로 오므로 근거 없는 재시도 권유("잠시 후 다시")는 넣지 않는다.
    body: '게시물이 없다는 뜻은 아닙니다.',
  },
};

const CHANNEL_META: Record<PublicChannelId, { name: string; eyebrow: string; description: string; empty: string; mark: string }> = {
  blog: {
    name: '블로그',
    eyebrow: '긴 글',
    description: '도전의 이유와 준비 과정을 긴 글로 기록합니다.',
    empty: '사실 확인과 공개 승인을 마친 글이 아직 없습니다. 첫 글이 공개되면 이곳에 바로 보입니다.',
    mark: 'B',
  },
  threads: {
    name: 'Threads',
    eyebrow: '짧은 소식',
    description: '준비 중의 짧은 소식을 나눕니다.',
    empty: '실제로 게시가 확인된 Threads 글이 아직 없습니다. 공식 계정과 첫 글이 확인되면 이곳에 보입니다.',
    mark: '@',
  },
  instagram: {
    name: 'Instagram',
    eyebrow: '사진 기록',
    description: '길 위의 장면을 사진으로 남깁니다.',
    empty: '실제로 게시가 확인된 Instagram 게시물이 아직 없습니다. 공식 계정과 첫 게시물이 확인되면 이곳에 보입니다.',
    mark: '◎',
  },
};

export const PUBLIC_CHANNEL_ORDER: readonly PublicChannelId[] = ['blog', 'threads', 'instagram'];
const HOME_LIMIT = 3;

function isSafeUrl(channel: PublicChannelId, url: string): boolean {
  if (channel === 'blog' && url.startsWith('/') && !url.startsWith('//')) return true;
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

/** 표현 단계 방어선: 필수 필드가 없거나 주소가 안전하지 않거나 게시일이 미래인 항목은 숨긴다. */
export function visiblePosts(feed: PublicChannelFeed, now: Date = new Date()): PublicChannelPost[] {
  return feed.posts
    .filter((p) => p.channel === feed.channel)
    .filter((p) => typeof p.url === 'string' && isSafeUrl(feed.channel, p.url))
    .filter((p) => {
      const t = Date.parse(p.publishedAt);
      return !Number.isNaN(t) && t <= now.getTime();
    })
    .slice(0, HOME_LIMIT);
}

function safeProfileUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

/** 사이트 안 이야기 경로(/stories/…)인 블로그 게시물인지. 외부 permalink와 구분한다(FE-085, FE-090 H01). */
function isInternalStory(post: PublicChannelPost): boolean {
  return post.channel === 'blog' && post.url.startsWith('/') && !post.url.startsWith('//');
}

function PostCard({ post }: { post: PublicChannelPost }) {
  const meta = CHANNEL_META[post.channel];
  const title = post.title?.trim() || null;
  const summary = post.summary?.trim() || null;
  const date = formatKoreanDate(post.publishedAt);
  // 블로그도 외부 https permalink면 새 창 링크로 그린다. 사이트 안 경로(/stories/…)만 Next Link(FE-085).
  const internal = isInternalStory(post);
  const external = !internal;
  // H06(FE-090): 제목이 있으면 article 이름을 h4에 연결해 같은 제목을 aria-label로 한 번 더 두지 않는다.
  const titleId = `post-${post.channel}-${post.id}-title`;
  const linkLabel = internal ? '글 읽기' : post.channel === 'blog' ? '블로그 원문 보기' : `${meta.name}에서 원문 보기`;
  // 제목이 없을 때의 이름도 날짜가 게시일로 읽히지 않게 "게시 확인"을 붙인다(FE-086).
  const subject = title ?? `${meta.name} 게시물(${date} ${DATE_LABEL[post.channel]})`;

  return (
    <li className="ds-post-card">
      <article {...(title ? { 'aria-labelledby': titleId } : { 'aria-label': subject })}>
        {/* H05(FE-090): 공백은 aria-hidden 구분자 밖에 두고, 어순은 "날짜 게시 확인"으로 맞춘다. */}
        <p className="ds-post-meta">
          <span>{meta.name}</span>
          {date ? <>{' '}<span aria-hidden="true">·</span>{' '}<time dateTime={post.publishedAt}>{date}</time>{' '}{DATE_LABEL[post.channel]}</> : null}
        </p>
        {title ? <h4 id={titleId}>{title}</h4> : null}
        {summary ? <p className="ds-post-summary">{summary}</p> : null}
        {external ? (
          <a className="ds-text-link" href={post.url} target="_blank" rel="noopener noreferrer">
            {linkLabel}
            <span className="ds-visually-hidden">: {subject} (새 창에서 열림)</span>
            <span aria-hidden="true">↗</span>
          </a>
        ) : (
          <Link className="ds-text-link" href={post.url}>
            {linkLabel}
            <span className="ds-visually-hidden">: {subject}</span>
            <span aria-hidden="true">→</span>
          </Link>
        )}
      </article>
    </li>
  );
}

function ChannelSection({ feed, now }: { feed: PublicChannelFeed; now: Date }) {
  const meta = CHANNEL_META[feed.channel];
  const unavailable = feed.unavailable ? UNAVAILABLE_TEXT[feed.unavailable] : null;
  const posts = unavailable ? [] : visiblePosts(feed, now);
  const headingId = `channel-${feed.channel}-title`;
  const profileUrl = safeProfileUrl(feed.profileUrl);
  const showStoriesLink = feed.channel === 'blog' && posts.some(isInternalStory);

  return (
    <section className={`ds-channel ds-channel--${feed.channel}`} aria-labelledby={headingId}>
      <header className="ds-channel-head">
        <span className="ds-channel-mark" aria-hidden="true">{meta.mark}</span>
        <div>
          <p className="ds-channel-eyebrow">{meta.eyebrow}</p>
          <h3 id={headingId}>{meta.name}</h3>
          <p className="ds-muted">{meta.description}</p>
        </div>
      </header>

      {unavailable ? (
        // H04(FE-090): 서버 초기 렌더의 고정 안내라 live region(role="status")을 두지 않는다.
        <div className="ds-channel-empty">
          <p className="ds-channel-empty-title">{unavailable.title}</p>
          <p>{unavailable.body}</p>
        </div>
      ) : posts.length > 0 ? (
        <ul className="ds-post-list">
          {posts.map((post) => <PostCard key={post.id} post={post} />)}
        </ul>
      ) : (
        <div className="ds-channel-empty">
          <p className="ds-channel-empty-title">아직 공개된 게시물이 없습니다</p>
          <p>{meta.empty}</p>
        </div>
      )}

      <div className="ds-channel-foot">
        {/* H01(FE-090): /stories는 외부 블로그 게시물과 다른 저장소다. 사이트 안 이야기 카드가 보일 때만 목록으로 안내한다. */}
        {showStoriesLink ? (
          <Link className="ds-text-link" href="/stories">이야기 목록 보기 <span aria-hidden="true">→</span></Link>
        ) : profileUrl ? (
          <a className="ds-text-link" href={profileUrl} target="_blank" rel="noopener noreferrer">
            {feed.channel === 'blog' ? '공식 블로그' : `${meta.name} 공식 계정`}<span className="ds-visually-hidden"> (새 창에서 열림)</span> <span aria-hidden="true">↗</span>
          </a>
        ) : (
          <p className="ds-muted ds-channel-pending">{feed.channel === 'blog' ? '공식 블로그 주소는 확인 후 안내합니다.' : '공식 계정 주소는 확인 후 안내합니다.'}</p>
        )}
      </div>
    </section>
  );
}

/** 세 채널을 항상 같은 순서로 보여준다. 넘어오지 않은 채널은 빈 상태로 채운다. */
export function PublicChannelFeedGrid({ feeds = [], now = new Date() }: { feeds?: readonly PublicChannelFeed[]; now?: Date }) {
  const byChannel = new Map(feeds.map((f) => [f.channel, f]));
  return (
    <div className="ds-channel-grid">
      {PUBLIC_CHANNEL_ORDER.map((channel) => (
        <ChannelSection key={channel} feed={byChannel.get(channel) ?? { channel, posts: [] }} now={now} />
      ))}
    </div>
  );
}
