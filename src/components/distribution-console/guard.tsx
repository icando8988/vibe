import type { ReactElement } from "react";
import { getDistributionAccess } from "./access";
import { DistributionDenied } from "./console-shell";

/**
 * 모든 콘솔 page의 첫 줄에서 호출한다(직접 URL 접근 포함 D1 차단).
 * layout은 하위 이동 때 다시 렌더되지 않을 수 있으므로 판정은 page마다 한다.
 * 거부면 거부 화면을, 허용이면 null을 돌려준다.
 */
export async function denyUnlessDistributionAdmin(): Promise<ReactElement | null> {
  const access = await getDistributionAccess();
  return access.allowed ? null : <DistributionDenied reason={access.reason} />;
}
