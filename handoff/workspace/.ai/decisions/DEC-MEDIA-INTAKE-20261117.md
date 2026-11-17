# 미디어 원본 intake 직접 업로드 기술 결정

2026-11-17 / Codex master / 근거 BE-MEDIA-024 계약§9.

일반 Server Action/Function body로20MB이미지를전달하는경로 대신 원본전용 private intake bucket과 서버발급 서명업로드로 브라우저직접전송을채택한다. JPEG변형용 private bucket은분리유지한다. 기존권리/ready/변형sha검사를우회하지않는다.

BE-UPLOAD-025는서버/API/SQL계약·mock/대역검증만배정. 실제bucket생성/설정/실업로드는이번결정으로실행하지않는다. 실제Storage서명의2시간수명/개별철회불가와짧은앱세션을구분하고,만료/취소뒤원본잔존·고아정리조건을기록한다.

Front는확정된metadata만먼저연결하고 upload계약완료전비활성유지. Backend는기존metadata exports를보존한다. 업로드전용토큰은인가된grant응답외UI/DB/로그에노출하지않으며게시용서명preview를허용하지않는다.
