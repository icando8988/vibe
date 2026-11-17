# UI-PLAN-20261117-01 디자인·UI 순차 개발

2026-11-17 / Codex design · CX-DESIGN-01 / 총괄 CX-MASTER-01.
사용자 지시: 개발 계획을 Master에게 보고하고 순서대로 작업 진행.

## 순서와 범위

1. 최신 구현·설계 대조: 읽기 전용 점검. 과거 미작성 보고를 현행 상태로 교체.
2. 콘솔 사용성: 기존 메뉴·간격·모바일·상태·조작 영역 재사용 및 필요한 최소 수정.
3. 원문·채널 초안·검토: 최신 서버 계약을 읽고 입력 보존·충돌·검토 흐름의 UI를 확인. app/server 수정은 Master 조정.
4. 배포 준비·결과: 모의/수동/실제 구분, 증거·대사와 재실행 제한을 기존 계약에 맞춰 확인.
5. 공개 사이트: 홈·소개·목록·상세 흐름 점검. 미승인 원고나 가짜 자산 추가 금지.
6. 영향에 맞는 코드·브라우저 검증과 결함/미검증 보고. 단계별 통합은 Master 담당.

완료 조건: 단계별 변경 파일·실행 검증·미실행·후속을 기록하며 전체 계획의 구현 완료와 구별한다.
공용 .ai/루트Git/계정/DB/실게시/배포 변경 없음. 추가 위임 없음.

## 전달과 현황

Orca orchestration 스킬로 Master run_eaedc8d53618에 계획 전달: msg_825dd7514d68.
후속 최소 수정 범위 공유: msg_25dec6708bef. 전송 성공이며 수신자의 검토/수락을 주장하지 않는다.

현재 콘솔 경로·A안 셸·상태 컴포넌트·공용 CSS·서버 액션 연결이 이미 있다. 과거 라우트/CSS 부재 보고는 현행에 적용하지 않는다. globals.css가 콘솔 스타일을 소유하므로 중복 CSS를 추가하지 않는다.
원문 입력 보존·중복 제출 차단·결과 불명 시 재조회가 action-form.tsx에 이미 있어 재구현 대상에서 제외한다.

## 이번 최소 수정

ChannelCards의 제목 링크와 DistributionDenied의 로그인 링크에 기존 ds-text-link 클래스를 적용한다. 각각 반복 링크·거부 후 이동 행동이므로 최소44px 높이 규칙을 계승한다. 정적 소스에서 높이 규칙 누락을 확인한 것이며 현재 브라우저 실측 결함이라고 주장하지 않는다.
수정 범위는 states.tsx 및 console-shell.tsx의 링크 클래스만. 권한·경로·서버 행위는 변경하지 않는다.

## 실행 결과와 다음 순서

- 1단계 최신 구현 점검 완료. 2단계 최소 링크 개선은 ready_review. 전체6단계 완료는 아님.
- 두 수정 파일 대상 eslint exit0, npm.cmd run typecheck exit0. 기존 min-height:44px CSS 선택자 매칭을 확인했다. 브라우저/승인 관리자 실세션의 실제 크기·키보드·접근성은 이번에 미실행이며 개선 효과를 실측 통과로 표현하지 않는다.
- 설치된 Next Link 가이드와 React best practices를 적용했다. 기존 Link와 권한 분기 유지, 클라이언트 상태·의존성·새 CSS 없음. 영향이 작은 기존 클래스 적용이어서 구현을 복제하는 테스트를 추가하지 않았다.
- 3단계 읽기 전용 점검: 원문 생성·채널 승인/철회·stale 안내, 공통 ActionForm의 입력 보존/중복 제출 방지가 이미 구현돼 있다. 빈 골격으로 가정해 재구현하지 않는다.
- 4단계 읽기 전용 점검: prepare 화면은 Blog/Threads 모의 작업 생성과 실제 실행기 미연결 상태를 구분한다. 현재 화면의 동작 가능 여부는 서버 준비 상태에 따라 달라진다. 문서의 과거 ‘저장 전부 미연결’ 설명을 현재 기능 전체에 일반화하지 않는다.
- 다음 우선: Master가 진행 중인 코드 점유/최신 서버 연결 범위를 공유하면 콘솔 실제 렌더·입력 오류/충돌·모바일 탐색을 그 범위로 검증하고 필요한 UI를 순차 수정한다. 권한을 우회하거나 승인된 원고처럼 게시하지 않는다.

수정 파일: console-shell.tsx, states.tsx, 이 고유 결과 문서. 공용 globals/app/lib/콘텐츠v2는 변경하지 않았다.

## Master 점유 확정 후 최종 반환

msg_e669ebbac74d 수신: Master가 CX-DESIGN-01/Codex Design의 현재 코드 범위를 두 링크로 등록하고 Front에 회피 전달을 확인했다. 이번 코드 수정 상태는 ready_review다. 후속 범위 확대는 파일·심벌을 수정 전에 공유한다.

정확한 변경(diff):

```diff
# web/src/components/distribution-console/console-shell.tsx / DistributionDenied
-<Link href="/login">회원 이용 안내로 이동</Link>
+<Link className="ds-text-link" href="/login">회원 이용 안내로 이동</Link>
# web/src/components/distribution-console/states.tsx / ChannelCards
-<Link href={hrefFor(channel)}>{info.label}</Link>
+<Link className="ds-text-link" href={hrefFor(channel)}>{info.label}</Link>
```

위 diff는 변경한 두 JSX 구문의 전후 비교이며 Git diff 산출물은 아니다. 다른 작업자의 변경을 포함하거나 되돌리지 않았다. 기존 lint/typecheck 통과 후 새 코드는 변경하지 않았으며 동일 검사를 불필요하게 재실행하지 않았다. 남은 문제: 실제 관리자 화면에서 조작 높이·줄바꿈·키보드 실측 및 Master 통합 확인. 전체 계획 구현·브라우저 통과·배포 완료로 보고하지 않는다.
