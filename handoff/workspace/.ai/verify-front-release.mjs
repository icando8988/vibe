const origin = 'https://vibe-ten-nu.vercel.app';
for (const path of ['/', '/admin/distribution', '/admin/distribution/contents', '/api/distribution/extension/whoami']) {
  const res = await fetch(origin + path, {redirect:'manual', signal:AbortSignal.timeout(20000)});
  const body = await res.text();
  console.log(JSON.stringify({path,status:res.status,cacheControl:res.headers.get('cache-control'),
    denied:body.includes('관리자 확인이 필요합니다'),cors:res.headers.get('access-control-allow-origin'),
    title:body.match(/<title>([^<]*)<\/title>/)?.[1]??null}));
}
