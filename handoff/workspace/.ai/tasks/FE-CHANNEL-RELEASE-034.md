# FE-CHANNEL-RELEASE-034 — 세 채널 사이트 통합 배포 준비

사용자 직접 지시: 쓰레드·인스타·블로그를 사이트에 병합한 후 배포하고 결과 제시. 기존 CC-FRONT-01 단일 담당, Master 배포 담당.

목표는 현재 이식한 세 채널을 사이트의 공통 원문→채널초안→검토→실행준비 및 연결 화면에서 일관되게 탐색할 수 있게 통합하는 것이다. 기존 구현을 버리거나 별도 앱을 만들지 않는다. 실제 Meta/네이버 게시 성공이나 계정 연결을 꾸미지 않는다.

개요/채널 메뉴/연결 화면과 Blog 수동·확장 및 Threads OAuth 진입, Instagram 단일이미지 준비·미디어/초안 동선을 점검한다. 끊긴 내부 링크나 현재 구현과 다른 안내는 필요한 만큼 수정한다. Instagram OAuth나 live worker가 없으면 그 상태를 정확히 표현하고 사용 가능한 초안/미디어/검토 화면으로 연결한다. 의미 없는 링크나 disabled 기능 활성화 금지. 홈페이지/관리 진입에서도 통합 콘솔이 찾기 쉬운지 확인한다.

허용: 관련 app UI 페이지·console 컴포넌트·필요 CSS/Front 시험. Backend/API/SQL/package/config/auth 수정 금지. 공용 안내 기존 동작과 다른 담당 변경 보존. Next guide와 React best-practices 적용. 신규 기능 확장은 배포 필수 결함이 아닌 한 하지 않는다.

완료: 세 채널의 실제 내부 경로와 구현/미구현 상태 정리, 수정/검증(영향시험·typecheck·lint), 결과/해시를 results/FE-CHANNEL-RELEASE-034-CC-FRONT-01.md에 반환. 빌드/최종 전체검사/commit/push/배포는 Master가 한다. 반환 후 코드 동결한다. 브라우저는 사용자 지시로 Chrome만 사용, 직접 브라우저를 조작할 필요는 없고 Master가 배포 후 검증한다.
