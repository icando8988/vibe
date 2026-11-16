/**
 * 채널 어댑터. 자동포스팅 프로그램과 공식 플랫폼 자료를 확인하기 전이라 실제 공급자 어댑터는 없다.
 * - UnconnectedAdapter: 모든 실행을 NOT_CONNECTED로 거절(외부 호출 없음)
 * - DryRunAdapter: dry_run 작업만 미리보기를 돌려준다. 절대 published를 만들지 않는다.
 * capability는 전부 'unverified'(임의로 supported 금지).
 */
import type { AdapterCapabilities, Channel, ChannelDraft, PublishJob, PublishResult } from "./types";
import { CHANNELS } from "./types";

export interface PublishAdapter {
  readonly channel: Channel;
  readonly capabilities: AdapterCapabilities;
  publish(job: PublishJob, draft: ChannelDraft): Promise<PublishResult>;
}

export function unverifiedCapabilities(channel: Channel): AdapterCapabilities {
  return {
    channel,
    connected: false,
    publishText: "unverified",
    publishImage: "unverified",
    publishVideo: "unverified",
    publishLink: "unverified",
    schedule: "unverified",
    edit: "unverified",
    delete: "unverified",
    lookupByIdempotencyKey: "unverified",
    metrics: "unverified",
    limits: { maxTextLength: null, maxMedia: null },
  };
}

export class UnconnectedAdapter implements PublishAdapter {
  readonly capabilities: AdapterCapabilities;
  constructor(readonly channel: Channel) {
    this.capabilities = unverifiedCapabilities(channel);
  }
  async publish(): Promise<PublishResult> {
    return {
      kind: "rejected",
      error: { code: "NOT_CONNECTED", message: `${this.channel} 채널은 아직 연결되지 않았습니다.`, retryable: false },
    };
  }
}

export class DryRunAdapter implements PublishAdapter {
  readonly capabilities: AdapterCapabilities;
  constructor(readonly channel: Channel) {
    this.capabilities = unverifiedCapabilities(channel);
  }
  async publish(job: PublishJob, draft: ChannelDraft): Promise<PublishResult> {
    if (job.mode !== "dry_run") {
      return {
        kind: "rejected",
        error: { code: "MODE_MISMATCH", message: "모의 어댑터는 실제 게시를 하지 않습니다.", retryable: false },
      };
    }
    if (draft.channel !== this.channel || job.channel !== this.channel) {
      return {
        kind: "rejected",
        error: { code: "INVALID_INPUT", message: "채널이 일치하지 않습니다.", retryable: false },
      };
    }
    return {
      kind: "dry_run_ok",
      preview: { channel: this.channel, text: draft.text, mediaCount: draft.mediaRefs.length, link: draft.link },
    };
  }
}

/** 기본 레지스트리: live는 전부 미연결, dry_run은 모의 어댑터 */
export function getAdapter(channel: Channel, mode: PublishJob["mode"]): PublishAdapter {
  return mode === "dry_run" ? new DryRunAdapter(channel) : new UnconnectedAdapter(channel);
}

/** 기능 사용 전 확인: supported가 아니면 실행하지 않는다. */
export function requireCapability(
  caps: AdapterCapabilities,
  feature: Exclude<keyof AdapterCapabilities, "channel" | "connected" | "limits">,
): { ok: true } | { ok: false; reason: "not_connected" | "unsupported" | "unverified" } {
  if (!caps.connected) return { ok: false, reason: "not_connected" };
  const state = caps[feature];
  if (state === "supported") return { ok: true };
  return { ok: false, reason: state };
}

export const ALL_CHANNELS = CHANNELS;
