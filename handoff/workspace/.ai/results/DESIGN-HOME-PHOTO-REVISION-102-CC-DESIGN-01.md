# DESIGN-HOME-PHOTO-REVISION-102 — 홈 실사 사진 반영

담당 Claude Design CC-DESIGN-01 (`term_831c9215-98e9-4d07-9ba1-298fc40b30c5`). Task `task_f9a30d2e180b` / Dispatch `ctx_9d7932f7c983`, coordinator Codex(master). 2026-11-18 KST. 상태 ready_review.

**근거**: 주인님 직접 지시("이걸로 메인페이지 수정 배포해")와 비공개 시안(https://claude.ai/artifact/MkcVPYkS4RdJ3txwF1nXME). commit, push, merge, deploy는 하지 않았다. 통합과 배포는 Master 소관이다.

## 1. 착수 전 확인
- HEAD는 `1a69145 feat(home): add approved public channel feed and globe hero`다. Master가 097까지 커밋했다.
- 시작 해시는 097 결과의 '변경 후' 값과 같았다. 그래서 다른 활성 작업이 이 파일들을 점유하지 않았다고 판단했다.
  - project-home.tsx 0FF97D79…1D4D
  - design.css 02DBE159…D709
- `public/` 폴더는 없었으므로 새로 만들었다.

## 2. 변경 파일과 diff 요약

| 파일 | 변경 |
|---|---|
| `public/images/home/` (신규 6개) | 사진 3장 × WebP·JPG. 크기 조정과 재압축 |
| `src/components/project-home.tsx` (+50/−12) | 아래 내용 참조 |
| `src/styles/design.css` (+48/−0) | 파일 끝에 `.ds-hero--photo`, `.ds-hero-photo-*`, `.ds-photo-band*`, `.ds-photo-prep*`, 700px 분기, forced-colors 규칙 추가. 097 `.ds-hero--globe` 규칙은 지우지 않았다(현재 미사용) |

**project-home.tsx 변경 내용**
1. `HomeHeroGlobe` import를 제거했다.
2. `PHOTO_CREDITS` 상수와 `PhotoCredit` 표시 컴포넌트를 추가했다. 저작자는 Commons 파일 페이지로, 라이선스는 CC 증서로 링크하고, 두 링크 모두 새 창·`noopener noreferrer`·숨김 안내문을 붙였다. "크기 조정" 변경 표기도 붙였다.
3. 히어로를 `ds-hero--globe`에서 `ds-hero--photo`로 바꿨다.
   - 배경 `<picture>`(webp + jpg 대체)에 `alt=""`, `fetchPriority="high"`를 줬다.
   - 남색 그라데이션 덮개를 깔았다. 데스크톱은 왼쪽에서, 700px 이하는 아래에서 덮는다.
   - **제목 "지구 한 바퀴, 페달로 잇습니다.", 사실 2항목(40,075km 적도 기준 지구 둘레(약), 출발일 미정), CTA(`#channels`, `/about`), 안내문은 그대로 유지했다.**
   - 하단에 공개 문구와 출처를 넣었다: "분위기 연출용 사진이며 이 프로젝트의 실제 여정이나 인물이 아닙니다 · 사진 Dennis Kleine · CC BY-SA 2.0 · 크기 조정".
4. 채널 섹션과 주제 섹션 사이에 풍경 띠 `figure.ds-photo-band`를 넣었다.
   - 이미지는 `alt=""`(장식)이고, 캡션이 풍경을 설명한다.
   - 캡션 내용: "길 위에서 만날 풍경을 상상하며 준비합니다." 그리고 "분위기 연출용 사진(카자흐스탄의 가을)이며 실제 여정이 아닙니다 · 출처"
   - 지연 로드한다.
5. 주제 섹션의 `ol` 앞에 준비 사진 `figure.ds-photo-prep`를 넣었다.
   - 대체 텍스트: "숲속 풀밭에 세운 빨간 1인용 텐트와 그 옆에 세워 둔 자전거"
   - 공개 문구와 출처를 함께 넣었고, 지연 로드한다.

**바꾸지 않은 것**: 채널 피드 섹션 마크업·동작, `src/app/page.tsx`, 서버, 다른 파일. `home-hero-globe.tsx`는 이제 참조되지 않는다(`grep` 결과 자기 파일 외 0건). 지시의 기본값대로 **삭제하지 않고 그대로 두었다**. 삭제 여부는 Master가 판단한다.

## 3. 이미지 출처·라이선스 근거
Wikimedia Commons API `imageinfo/extmetadata`로 2026-11-18에 다시 확인했다.

| 사용 위치 | Commons 파일 | 저작자 | 라이선스 | 원본 sha1(Commons) |
|---|---|---|---|---|
| 히어로 | File:Cycling_tourist_with_racks_and_panniers_riding_on_a_gravel_road.jpg (Flickr theartificer/25681277574 경유) | Dennis Kleine | CC BY-SA 2.0 | 6fa5bf26e59a80afa0c4796034f48d5a2d175135 |
| 풍경 띠 | File:Kazakhstan_in_autumn_(9720298344)_(cropped).jpg | likeablerodent | CC BY-SA 2.0 | 4a32a94f3c9b25a1986745245639217337ffd4e2 |
| 준비 사진 | File:Giant_Roam_2_hybrid_bicycle_beside_a_lightweight_tent_during_cycle_touring_in_the_Australian_bush.jpg | JaredMcKenzie | CC0 | 9a13378923e46564681bc321c4a478dfbdb7f183 |

- **CC BY-SA 2.0 의무**: 저작자·라이선스 링크·변경 표기를 화면에 넣었다. 이 이미지 파일(크기 조정본)을 따로 배포하면 같은 라이선스가 적용된다. 사이트 코드나 페이지 전체에 BY-SA가 전파되지는 않는다(사진을 페이지에 함께 싣는 것은 수집물(collection) 형태다).
- **오해 방지**: 세 사진 모두 "분위기 연출용, 실제 여정·인물 아님"을 화면에 표시했다. 히어로 사진은 얼굴이 보이지 않는 뒷모습이다. 얼굴이 보이는 후보 사진(국경 표지판 사진)은 쓰지 않았다.
- Unsplash 후보는 자동 내려받기가 차단돼 쓰지 않았다.

## 4. 검사 (실제 실행)

| 명령 | 결과 |
|---|---|
| `npx tsc --noEmit -p .` | exit 0 |
| `npx eslint src/components/project-home.tsx` | exit 0 |
| postcss parse design.css | 성공 |
| `npx vitest run` 전체 | 46 files passed / 12 skipped, 1082 passed / 91 skipped |
| 임시 렌더 검사(저장소 밖, 실행 후 삭제) | 1/1 통과 |
| 줄바꿈 | project-home.tsx CRLF, design.css 추가분 CRLF |

임시 렌더 검사에서 확인한 항목:
- 제목·사실 2항목·`#channels`/`/about` 링크
- 이미지 6개 경로
- 공개 문구 3곳, 저작자 3명, CC BY-SA 표기 2곳
- `#channels` 섹션 유지, canvas 없음, h1 1개, 외부 링크 `noopener noreferrer`

**미실시**:
- `npm run build`(Master 게이트), 브라우저 렌더
- 사진 자르기 위치·글자 대비 실측(360/768/1440px)
- 이미지 실제 로드(Next 정적 제공 경로 `/images/home/*`)
- 키보드 초점 가시성, 화면 낭독기, forced-colors 에뮬레이션, 운영 배포

대비는 덮개 불투명도 기준의 추정치이며 실측이 아니다.

## 5. SHA-256

| 파일 | 변경 전 | 변경 후 |
|---|---|---|
| src/components/project-home.tsx | 0FF97D7965FB014569DDA03BF6432974E28DB7B6C612241BDB175DC6AA041D4D | EB175691C090E0560B244126D9505BB4769BB134F67C2030E4B08C7CCAFD1FAD |
| src/styles/design.css | 02DBE1594D4F63FB275EF4A11C7C69490BB1E490BE1FF6564DFEBEA82B1BD709 | 6ADD98FAF67336F16958AC712E1439FFA93ADC683FD1A20FBBCF0E880170DBF4 |
| public/images/home/home-hero-gravel-road.jpg | (신규) | EF4A290182A9FA442FE0BD777D421090494F2BADAAA0D03CB0007912715A21D4 |
| public/images/home/home-hero-gravel-road.webp | (신규) | 39DCA8E672AD00C42A894530C522CBA6329F100D9C29FE397FE82FC2B92A3B1F |
| public/images/home/home-band-kazakhstan.jpg | (신규) | 8961BD62553FBAA8C8C51C57579559A14A4F7F2A2CC90C177C3E67418FE8F240 |
| public/images/home/home-band-kazakhstan.webp | (신규) | 9E6953DC2275F3A43848DDD070C03F37788D4C6CDA32D251BB992B707AB62C92 |
| public/images/home/home-prep-tent.jpg | (신규) | 410EFB47DD4C10933175A13D8D31EF9099AD6CBE8A58AA0CACB0F84319571CD |
| public/images/home/home-prep-tent.webp | (신규) | 3AEE89AB7747D23775C23771C4A412DF0E9D7405DEFDF37B14EB736068982D15 |
| src/components/home-hero-globe.tsx (미변경, 미참조) | F06CF14432AF6010D534A4A74C096E036FC8FB2D3141F30B16FB1F50DA151A84 | 같음 |

크기:

| 사진 | 픽셀 | JPG | WebP |
|---|---|---|---|
| 히어로 | 1080×1080 | 109KB | 102KB |
| 풍경 띠 | 1920×275 | 65KB | 59KB |
| 텐트 | 1200×900 | 236KB | 240KB |

텐트는 WebP 이득이 거의 없다. 필요하면 폭을 1000px로 줄이는 것을 권한다.

## 6. 다음 담당
- **Master**: 독립 검토(라이선스 표기 포함), `npm run build`, 피드 회귀 확인, `home-hero-globe.tsx`와 097 미사용 CSS 정리 여부 결정, 승인된 배포 절차 진행
- **QA**: 배포 전후 폭별 사진 자르기·대비·초점·이미지 로드 실측
