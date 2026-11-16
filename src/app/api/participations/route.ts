/**
 * POST /api/participations — 계약(총괄 계획 19.3)상의 신청 API 자리.
 * DEC-002/003 확정과 DEV-004/005(인증·DB 트랜잭션) 전까지 모든 쓰기를 명시적으로 거절한다.
 * 입력을 저장하거나 성공처럼 보이는 응답을 주지 않는다.
 */
import { NextResponse } from "next/server";
import { httpStatusFor } from "@/lib/domain/errors";
import { TRANSACTIONS_ENABLED } from "@/lib/env";

const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" };

export async function POST() {
  if (!TRANSACTIONS_ENABLED) {
    return NextResponse.json(
      {
        error: {
          code: "TRANSACTIONS_DISABLED",
          message: "지금은 신청을 받지 않습니다. 참여 정책과 인증이 준비되면 안내합니다.",
        },
      },
      { status: httpStatusFor("TRANSACTIONS_DISABLED"), headers: { ...NO_STORE, "Retry-After": "86400" } },
    );
  }
  // 도달 불가: TRANSACTIONS_ENABLED는 상수 false.
  return NextResponse.json(
    { error: { code: "NOT_CONFIGURED", message: "서버가 준비되지 않았습니다." } },
    { status: httpStatusFor("NOT_CONFIGURED"), headers: NO_STORE },
  );
}
