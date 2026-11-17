/**
 * service_role RPC 클라이언트 연결(server-only). 키가 없으면 null → 호출부는 준비 전.
 */
import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import type { RpcClient } from "../write-runner";

export function getServiceRpcClient(): RpcClient | null {
  const client = createSupabaseServiceClient();
  if (!client) return null;
  return { rpc: (fn, params) => client.rpc(fn, params) as unknown as PromiseLike<{ data: unknown; error: unknown }> };
}
