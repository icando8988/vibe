// MKT-006 원시 HTTP 점검 (JS 실행 없음). 사용: node check-raw-html.mjs http://localhost:3316
// <script> 내용(RSC 페이로드)을 제거한 뒤 서버가 보낸 HTML 마크업만 센다.
const base = process.argv[2] ?? "http://localhost:3000";
const paths = [
  "/",
  "/stories",
  "/stories/missing-one",
  "/stories/Bad_Slug",
  "/stories/%3Cscript%3E",
  "/nope",
  "/me",
  "/admin",
  "/login",
];

const strip = (html) => html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
const count = (s, re) => (s.match(re) ?? []).length;

const rows = [];
for (const p of paths) {
  const res = await fetch(base + p, { redirect: "manual" });
  const raw = await res.text();
  const html = strip(raw);
  const h1 = html.match(/<h1[^>]*>([^<]*)</)?.[1] ?? "";
  rows.push({
    path: p,
    status: res.status,
    cache: res.headers.get("cache-control") ?? "",
    xRobots: res.headers.get("x-robots-tag") ?? "",
    errorShell: raw.includes('id="__next_error__"'),
    mainInHtml: count(html, /<main\b/g),
    h1InHtml: h1,
    linksInMain: count(html.match(/<main[\s\S]*<\/main>/)?.[0] ?? "", /<a\b/g),
    contactInHtml: html.includes('id="contact"'),
    robotsMeta: html.match(/<meta name="robots" content="([^"]*)"/)?.[1] ?? "",
    canonical: html.includes('rel="canonical"'),
  });
}
console.log(JSON.stringify(rows, null, 2));
