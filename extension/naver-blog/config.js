"use strict";

// 콘텐츠 배포 콘솔용 네이버 블로그 입력기 — 연결 설정 (AUTOPOST-SOURCE-PORT-001).
// 원본: Blog_Posting_Kit_v1.07/ai-auto-blog/extension (BUYLIFE 배포판, NOTICE 참조).
//
// 원본은 빌드 때 운영 주소(원본 서버 도메인)를 박아 넣었다. 이 이식본은 어떤 서버 주소도 기본값으로 갖지 않는다.
//   - SITE_ORIGIN: 이 확장을 연결할 "내 사이트" 주소(https://… , 경로 없이). 비어 있으면 모든 서버 요청을 막는다.
//   - API_READY: 사이트 쪽 확장 API(/api/distribution/extension/*)가 구현·배포되면 true로 바꾼다.
//     지금은 서버 API가 없으므로 false — 요청을 보내지 않고 "연결 준비 전" 오류를 낸다.
// 설정 방법은 SETUP.md 참조. manifest.json의 host_permissions·content_scripts에도 같은 주소를 넣어야 한다.
self.NAVER_BLOG_EXT_CONFIG = Object.freeze({
  SITE_ORIGIN: "",
  API_READY: false,
  API: Object.freeze({
    whoami: "/api/distribution/extension/whoami",
    task: "/api/distribution/extension/task",
    heartbeat: (jobId) => `/api/distribution/extension/jobs/${encodeURIComponent(jobId)}/heartbeat`,
    inputResult: (jobId) => `/api/distribution/extension/jobs/${encodeURIComponent(jobId)}/input-result`,
    connectPage: "/admin/distribution/connections",
  }),
});

// 설정 확인. 문제가 있으면 사람이 읽을 수 있는 이유를 돌려준다(요청은 보내지 않는다).
self.NaverBlogExtConfig = (() => {
  const cfg = self.NAVER_BLOG_EXT_CONFIG;

  function originProblem(value) {
    if (!value) return "사이트 주소(config.js의 SITE_ORIGIN)가 설정되지 않았습니다.";
    let url;
    try { url = new URL(value); } catch { return "사이트 주소 형식이 올바르지 않습니다."; }
    if (url.origin !== value) return "사이트 주소는 경로·끝 슬래시 없이 origin만 적어야 합니다.";
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return "사이트 주소는 https만 허용합니다(로컬 개발 주소 localhost·127.0.0.1만 http 허용).";
    return "";
  }

  /** 서버 요청 직전 호출. 준비 전이면 Error를 던진다. */
  function requireSite() {
    const problem = originProblem(cfg.SITE_ORIGIN);
    if (problem) throw new Error(`연결 준비 전: ${problem}`);
    if (!cfg.API_READY) throw new Error("연결 준비 전: 사이트의 확장 API가 아직 구현되지 않았습니다(config.js API_READY=false).");
    return cfg.SITE_ORIGIN;
  }

  /** 메시지·페이지 출처가 설정된 사이트인지(설정이 없으면 항상 false). */
  function isSiteUrl(value) {
    if (originProblem(cfg.SITE_ORIGIN)) return false;
    try { return new URL(String(value || "")).origin === cfg.SITE_ORIGIN; } catch { return false; }
  }

  return Object.freeze({ requireSite, isSiteUrl, originProblem, api: cfg.API });
})();
