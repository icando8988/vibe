/**
 * 서버 설정 준비 상태. 값 자체는 반환하지 않고 '연결 가능 여부'만 알린다.
 * DEV-001 단계에서는 Supabase에 실제로 연결하지 않는다.
 */

export interface IntegrationStatus {
  /** Supabase 공개 설정(URL·publishable key) 존재 여부 */
  supabaseConfigured: boolean;
  /** 인증 연결 여부. DEV-004 전까지 항상 false */
  authConnected: boolean;
  /** 실거래 쓰기 허용 여부. DEC-002/003 확정 + DEV-005 완료 전까지 코드로 false 고정 */
  transactionsEnabled: false;
}

function present(name: string): boolean {
  const v = process.env[name];
  return typeof v === "string" && v.trim().length > 0;
}

export function getIntegrationStatus(): IntegrationStatus {
  return {
    supabaseConfigured: present("NEXT_PUBLIC_SUPABASE_URL") && present("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
    // 설정 값이 있어도 클라이언트 코드가 아직 없으므로 연결로 보지 않는다.
    authConnected: false,
    transactionsEnabled: false,
  };
}

/**
 * 실거래 스위치. 환경변수로 켤 수 없게 상수로 둔다.
 * 켜려면 DEC-002/003 결정 기록과 DEV-005 검증을 근거로 코드 변경·리뷰를 거친다.
 */
export const TRANSACTIONS_ENABLED = false as const;
