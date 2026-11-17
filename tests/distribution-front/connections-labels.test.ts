/**
 * FE-CONNECTIONS-REGRESSION-073 — 연결 화면 공용 라벨(reauth-labels)과 ResultFocus 서버 렌더 모양.
 * 서버 렌더는 래퍼 마크업만 확인한다. 실제 초점 이동(useEffect·focus)은 DOM·브라우저가 필요해 이 시험으로 검증되지 않는다.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { connectionStatusLabel, reauthReasonLabel } from "@/app/admin/distribution/connections/reauth-labels";
import { ResultFocus } from "@/app/admin/distribution/connections/result-focus";

describe("connectionStatusLabel", () => {
  it("알려진 상태는 한글 라벨", () => {
    expect(connectionStatusLabel("connected")).toBe("연결됨");
    expect(connectionStatusLabel("reauth_required")).toBe("재인증 필요");
    expect(connectionStatusLabel("revoked")).toBe("연결 해제됨");
  });

  it("모르는 상태는 원문 대신 '상태 확인 필요'(프로토타입 키 포함)", () => {
    for (const s of ["", "pending", "CONNECTED", "toString", "constructor", "__proto__"]) {
      expect(connectionStatusLabel(s), s).toBe("상태 확인 필요");
    }
  });
});

describe("reauthReasonLabel", () => {
  it("알려진 사유는 채널과 무관한 같은 라벨", () => {
    const known: Record<string, string> = { decrypt_failed: "저장 토큰을 읽지 못함", expired: "토큰 만료", key_rotated: "암호화 키 교체", manual: "관리자 표시" };
    for (const [code, label] of Object.entries(known)) {
      expect(reauthReasonLabel(code, "threads")).toBe(label);
      expect(reauthReasonLabel(code, "instagram")).toBe(label);
    }
  });

  it("provider_auth는 채널 이름을 붙인다", () => {
    expect(reauthReasonLabel("provider_auth", "threads")).toBe("Threads 인증 거절");
    expect(reauthReasonLabel("provider_auth", "instagram")).toBe("Instagram 인증 거절");
  });

  it("사유 없음은 null, 모르는 코드는 원문 대신 '재인증 사유 확인 필요'", () => {
    expect(reauthReasonLabel(null, "threads")).toBeNull();
    expect(reauthReasonLabel(undefined, "instagram")).toBeNull();
    expect(reauthReasonLabel("", "threads")).toBeNull();
    for (const c of ["revoked", "EXPIRED", "toString", "__proto__", "x<script>"]) {
      expect(reauthReasonLabel(c, "threads"), c).toBe("재인증 사유 확인 필요");
    }
  });
});

describe("ResultFocus 서버 렌더(초점 효과는 미검증)", () => {
  it("children을 display:contents 래퍼 하나로 감싸고 내용·속성은 바꾸지 않는다", () => {
    const child = createElement("p", { role: "status" }, "안내");
    expect(renderToStaticMarkup(createElement(ResultFocus, null, child))).toBe('<div style="display:contents"><p role="status">안내</p></div>');
  });

  it("클라이언트 모듈이며 서버 모듈을 import하지 않는다, 라벨 모듈은 클라이언트 지시어가 없다", () => {
    const dir = join(process.cwd(), "src", "app", "admin", "distribution", "connections");
    const rf = readFileSync(join(dir, "result-focus.tsx"), "utf8");
    expect(rf.trimStart().startsWith('"use client"')).toBe(true);
    expect(rf).not.toMatch(/from "@\/server|server-only|from "next\//);
    const rl = readFileSync(join(dir, "reauth-labels.ts"), "utf8");
    expect(rl).not.toMatch(/^\s*["']use client["']/m);
    expect(rl).not.toMatch(/from "@\/server|server-only/);
  });
});
