# distribution 로컬 DB 검증 (AUTOPOST-LOCAL-DB-VERIFY-002 · AUTOPOST-M2-VERIFY-003)

일회성 인메모리 PGlite(PostgreSQL 18.6 WASM)에 **Supabase 최소 대역**을 깔고, `web/supabase/migrations/*.sql`을 순서대로 모두 적용한 뒤 시나리오를 실행한다.
**실제 Supabase 검증이 아니다.** 키·env·원격 DB·네트워크는 쓰지 않는다. 연결은 하나뿐이라 다중 연결 동시성은 검증하지 않는다.

## 실행

PGlite는 `web/`에 설치하지 않는다. OS 임시 디렉터리에 별도 프로젝트를 만들어 설치한다.

```powershell
$d = Join-Path $env:TEMP 'autopost-local-db-verify-002'
New-Item -ItemType Directory -Force $d | Out-Null
Set-Content -Encoding ascii (Join-Path $d package.json) '{"name":"autopost-local-db-verify-002","private":true,"type":"module"}'
npm install --prefix $d --no-audit --no-fund --save-exact @electric-sql/pglite@0.5.16
node web/scripts/distribution-local-verify/run.mjs    --pglite-project $d --json (Join-Path $d result.json)     # M1+050000 회귀
node web/scripts/distribution-local-verify/m2-run.mjs --pglite-project $d --json (Join-Path $d m2-result.json)  # M2 전이(약 50초, 리스 실시간 대기 포함)
```

종료 코드: `0` 기대 동작 전부 일치 · `1` 불일치 · `2` migration 적용 실패 · `3` PGlite 없음(NOT RUN).
m2-run의 `DEFECT-REPRODUCED` 항목은 SQL 결함을 재현한 것이다. 통과 집계와 따로 보고하며 종료 코드에는 반영하지 않는다.

## 파일

- `supabase-local-standin.sql`: Supabase 대역. 대역이 흉내 내는 범위는 머리 주석에 있다. migration은 비superuser `supa_owner`로 적용한다.
- `lib.mjs`: 공용 헬퍼(PGlite 로드, 대역과 migration 적용, 트랜잭션별 역할 전환, 판정). `token-run.mjs` 등 다른 러너도 이 모듈을 쓰므로 export 시그니처를 바꾸지 않는다.
- `run.mjs`: M0~050000 회귀. 앞 6개 migration 순서를 확인하고, 이후 추가된 migration도 함께 적용한다.
- `m2-run.mjs`: M2 수동 게시, 증거, 대사, 리스, retry, 취소, 권한 철회 전이 검증. live 경로를 실행하려고 **이 일회성 DB 안에서만** `distribution_live_gate`를 `select true`로 바꾼다. 원래 게이트가 닫혀 있다는 것은 대조군으로 먼저 확인한다.
- `token-run.mjs`: 다른 작업(AUTOPOST-BLOG-TOKEN-005) 소유. 이 README의 작업 범위가 아니다.
