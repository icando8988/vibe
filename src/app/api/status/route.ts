/**
 * GET /api/status — 연동 준비 상태(불리언만). 비밀값·URL·키는 응답하지 않는다.
 */
import { NextResponse } from "next/server";
import { getIntegrationStatus } from "@/lib/env";

export const dynamic = "force-dynamic";

export function GET() {
  const s = getIntegrationStatus();
  return NextResponse.json(
    {
      stage: "DEV-004",
      supabaseConfigured: s.supabaseConfigured,
      authConnected: s.authConnected,
      transactionsEnabled: s.transactionsEnabled,
    },
    { headers: { "Cache-Control": "private, no-store, max-age=0" } },
  );
}
