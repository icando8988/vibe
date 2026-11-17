/**
 * 콘솔 쓰기 공통 절차 — 순수(의존성 주입) 함수(테스트 대상). 명세 §4 공통 순서:
 *   1) actor 도출(검증된 세션) — 거부면 즉시 종료, RPC 호출 0회
 *   2) 입력 검증 — 실패면 종료, RPC 호출 0회
 *   3) service 클라이언트 — 없으면(키 없음) not_ready, RPC 호출 0회
 *   4) RPC 1회 — 오류는 §5 매핑. 응답을 못 받으면 unavailable(결과 불명, 자동 재전송 없음)
 * 서버 액션은 이 함수를 감싸 redirect/notice만 한다.
 */
import type { DistributionDenyReason } from "@/components/distribution-console/access";
import type { ActorResult } from "./actor-core";
import { mapDistributionDbError, unavailableError, type MappedDbError } from "./errors";
import type { FieldError, Validated } from "./validation";

export type RpcResponse = { data: unknown; error: unknown };
export type RpcClient = { rpc: (fn: string, params: Record<string, unknown>) => PromiseLike<RpcResponse> };

export type WriteOutcome<T> =
  | { status: "ok"; data: T }
  | { status: "denied"; reason: DistributionDenyReason }
  | { status: "invalid"; errors: FieldError[] }
  | { status: "not_ready" }
  | { status: "db_error"; error: MappedDbError }
  | { status: "bad_response" };

export type WriteSpec<I, T> = {
  resolveActor: () => Promise<ActorResult>;
  validate: () => Validated<I>;
  getClient: () => RpcClient | null;
  fn: string;
  /** actorId는 1)에서 나온 값만 들어온다. 입력에 actor가 있어도 쓰이지 않는다. */
  params: (actorId: string, input: I) => Record<string, unknown>;
  /** RPC 반환값을 좁힌다. 형식이 다르면 null → bad_response. */
  parse: (data: unknown) => T | null;
};

export async function runDistributionWrite<I, T>(spec: WriteSpec<I, T>): Promise<WriteOutcome<T>> {
  const actor = await spec.resolveActor();
  if (!actor.ok) return { status: "denied", reason: actor.reason };

  const input = spec.validate();
  if (!input.ok) return { status: "invalid", errors: input.errors };

  const client = spec.getClient();
  if (!client) return { status: "not_ready" };

  let response: RpcResponse;
  try {
    response = await client.rpc(spec.fn, spec.params(actor.actorId, input.value));
  } catch {
    return { status: "db_error", error: unavailableError() };
  }
  if (response.error) return { status: "db_error", error: mapDistributionDbError(response.error) };
  const parsed = spec.parse(response.data);
  return parsed === null ? { status: "bad_response" } : { status: "ok", data: parsed };
}
