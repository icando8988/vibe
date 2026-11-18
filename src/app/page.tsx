import { ProjectHome } from "../components/project-home";
import { PUBLIC_CHANNEL_ORDER, type PublicChannelFeed, type PublicChannelUnavailable } from "../components/public-channel-feed";
import { getPublicChannelFeeds } from "@/server/public-feed";

/**
 * 홈(Server Component) — FE-HOME-PUBLIC-FEED-085.
 * - getPublicChannelFeeds()는 server-only 모듈이라 이 서버 컴포넌트에서만 호출한다. service_role 키·DB 클라이언트는 서버에 남고,
 *   ProjectHome·PublicChannelFeedGrid(둘 다 클라이언트 컴포넌트 아님)에는 공개 DTO(PublicChannelFeed)만 넘어가 HTML로 렌더된다.
 * - status가 ok가 아니면(not_configured·schema_missing·error·예외) 세 채널을 "불러오지 못함"으로 표시한다. 정상 0건과 구분한다.
 * - ok여도 availability가 unsupported인 채널은 "연동 준비 중"으로 표시한다(FE-086).
 * - 공개 자격 판정(published·승인·public_ok·증거·허용 호스트)은 Backend가 한다. 여기서는 결과를 그대로 전달하고 fixture를 넣지 않는다.
 */
// 게시 확인 시각·승인 철회를 요청 시점에 반영하고, 빌드 시점에 서버 키로 조회하지 않도록 동적 렌더.
export const dynamic = "force-dynamic";

async function loadChannelFeeds(): Promise<readonly PublicChannelFeed[]> {
  let reason: PublicChannelUnavailable;
  try {
    const result = await getPublicChannelFeeds();
    if (result.status === "ok") {
      // 서버가 미지원(unsupported)으로 표시한 채널은 정상 0건과 구분해 "연동 준비 중"으로 넘긴다(FE-086). availability가 posts보다 우선.
      const { feeds, availability } = result.data;
      return feeds.map((f) => (availability[f.channel] === "unsupported" ? { ...f, posts: [], unavailable: "unsupported" as const } : f));
    }
    reason = result.status === "not_configured" ? "not_configured" : "error";
  } catch {
    reason = "error";
  }
  return PUBLIC_CHANNEL_ORDER.map((channel) => ({ channel, posts: [], unavailable: reason }));
}

// ProjectHome이 자체 main#main-content와 h1을 포함한다. 추가 main으로 감싸지 않는다.
export default async function HomePage() {
  return <ProjectHome channelFeeds={await loadChannelFeeds()} />;
}
