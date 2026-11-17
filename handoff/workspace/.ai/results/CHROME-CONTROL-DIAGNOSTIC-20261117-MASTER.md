# Chrome 제어 실패 진단 — 2026-11-17

주인님 요청: Chrome을 작업용으로 사용, 다시 열기, 반복 차단 원인 확인. 원래 사이트 통합/배포 작업은 유지한다.

## 확인된 서로 다른 두 실패

1. `orca computer list-apps --json`과 안내된 진단 `capabilities --json`이 모두 `accessibility_error`로 실패했다. PowerShell 원인은 `ScriptContainedMaliciousContent`다.
2. 기존 Chrome 실행 파일로 사이트/팀 인증 페이지를 새 창에 여는 `Start-Process` 명령은 실행 도구의 자동 승인 검토에서 `blocked by policy`로 거절됐다. Chrome 프로세스 시작 성공을 주장하지 않는다. 해당 정책의 세부 판정 이유는 제공되지 않았다.

## Windows 측 실제 증거

읽기 전용 `Get-MpThreatDetection` 및 최근 Defender Operational 이벤트1116/1117 대조:

- 대상: `C:/Users/Administrator/AppData/Local/Programs/orca/resources/computer-use-windows/runtime.ps1`
- 탐지명: `HackTool:PowerShell/EmpireGetScreenshot.C`
- ThreatID: `2147743659`, 탐지원 AMSI, 심각도 높음.
- 조치: 격리, ActionSuccess=true, 이벤트 Error Code 0x00000000.
- 보안 인텔리전스: 1.463.338.0, 엔진 1.1.26100.4.

탐지의 정확성/오탐 여부와 에이전트의 별도 실행 거절 원인은 이 기록만으로 확정하지 않는다. 차단을 재현하려고 명령을 반복하거나 Defender 비활성화/제외 추가/격리 복원/정책 변경/보안 우회를 하지 않았다. 주인님이 Chrome을 직접 열었다고 알려 주셨다. 브라우저 화면 접근·관리자 세션·사이트 실측 성공은 별도 미확인이다.

권장 전달 자료는 위 파일 경로·탐지명·보안 버전 및 Orca 제어 오류다. 보안 설정 변경보다 Orca 지원/배포판 업데이트·탐지 검토를 먼저 확인한다. 실제 인증값·브라우저 프로필·토큰은 기록하지 않는다.
