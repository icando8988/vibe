/**
 * 채널별 방식·준비도 표시용 사실 모음. 값은 현재 코드와 배정 명세에서만 가져온다.
 * - 채널별 허용 모드: lib/distribution/types CHANNEL_MODES (M2 제약과 동일)
 * - 기능 준비도: lib/distribution/adapters unverifiedCapabilities (전부 unverified)
 * - live gate: DB 함수 distribution_live_gate()는 false로 정의됨, migration은 DB 미적용
 * 연결·계정·작업·통계 수치는 만들지 않는다. 실제 데이터 연결은 후속 작업이다.
 */
import { unverifiedCapabilities } from "@/lib/distribution/adapters";
import {
  CHANNELS,
  CHANNEL_MODES,
  PUBLISH_MODES,
  type AdapterCapabilities,
  type CapabilityState,
  type Channel,
  type PublishMode,
} from "@/lib/distribution/types";

/** distribution_live_gate()가 false이고 live 어댑터는 UnconnectedAdapter다. UI에서 열지 않는다. */
export const LIVE_GATE_OPEN = false;

/** 운영 저장소(M1/M2) 조회 경로가 없다. 연결 전에는 모든 목록·상세가 '미연결' 상태다. */
export const DATA_SOURCE_CONNECTED = false;

export { CHANNELS };

export function isChannel(value: string): value is Channel {
  return (CHANNELS as readonly string[]).includes(value);
}

export type ChannelInfo = {
  label: string;
  /** 방식 요약 배지 */
  methodTag: string;
  /** 채널 초안 구성 우선순위 */
  focus: string;
  summary: string;
  /** 현재 막혀 있는 이유 */
  blocked: string;
};

export const CHANNEL_INFO: { readonly [C in Channel]: ChannelInfo } = {
  blog: {
    label: "Blog",
    methodTag: "수동 / 모의",
    focus: "제목과 본문을 나눠 준비합니다.",
    summary: "승인본을 사람이 외부에서 게시하고 게시 증거를 기록하는 흐름입니다. 자동 게시(live)는 제공하지 않습니다.",
    blocked: "운영 저장·수동 증거 기록 경로가 연결되지 않았습니다.",
  },
  threads: {
    label: "Threads",
    methodTag: "API·연결 미검증",
    focus: "텍스트 초안부터 준비합니다.",
    summary: "공식 API 경로를 계획 중입니다. 계정 연결과 기능 검증 전에는 실제 게시·예약을 할 수 없습니다.",
    blocked: "계정 연결·기능 검증·실행기가 없고 live gate가 닫혀 있습니다.",
  },
  instagram: {
    label: "Instagram",
    methodTag: "단일 이미지 우선 · 미검증",
    focus: "캡션과 단일 이미지·권리를 함께 검토합니다. 캐러셀·동영상은 후속입니다.",
    summary: "이미지 없이 캡션만으로는 게시 준비가 되지 않습니다. 연결·미디어·API 모두 구현 전입니다.",
    blocked: "계정 연결·미디어 저장/권리·API 구현이 없고 live gate가 닫혀 있습니다.",
  },
};

export const MODE_LABEL: { readonly [M in PublishMode]: string } = {
  live: "실제 게시(API)",
  dry_run: "모의 실행",
  manual: "수동 게시 + 증거",
};

export type ModeAvailability = { mode: PublishMode; label: string; allowed: boolean; state: string };

/** 채널별 모드 허용 여부와 현재 실행 가능 상태. 허용 모드도 지금 실행 가능하다는 뜻은 아니다. */
export function modeAvailability(channel: Channel): ModeAvailability[] {
  return PUBLISH_MODES.map((mode) => {
    const allowed = CHANNEL_MODES[channel].includes(mode);
    let state: string;
    if (!allowed) state = "이 채널에서 제공하지 않음";
    else if (mode === "live") state = LIVE_GATE_OPEN ? "게이트 열림" : "live gate 닫힘 · 어댑터 미연결";
    else if (mode === "dry_run") state = "도메인 정의만 있음 · 운영 실행 미연결";
    else state = "도메인 정의만 있음 · 저장·증거 기록 미연결";
    return { mode, label: MODE_LABEL[mode], allowed, state };
  });
}

export const CAPABILITY_LABEL: { readonly [S in CapabilityState]: string } = {
  supported: "지원 확인",
  unsupported: "지원하지 않음",
  unverified: "미검증",
};

export const CAPABILITY_FEATURES: ReadonlyArray<[Exclude<keyof AdapterCapabilities, "channel" | "connected" | "limits">, string]> = [
  ["publishText", "텍스트 게시"],
  ["publishImage", "이미지 게시"],
  ["publishVideo", "동영상 게시"],
  ["publishLink", "링크 포함"],
  ["schedule", "예약"],
  ["edit", "게시 후 수정"],
  ["delete", "게시 후 삭제"],
  ["lookupByIdempotencyKey", "결과 조회(대사)"],
  ["metrics", "통계"],
];

/** 현재 코드가 선언한 기능 준비도. 연결 후 서버 근거로 바뀌기 전까지 전부 unverified다. */
export function currentCapabilities(channel: Channel): AdapterCapabilities {
  return unverifiedCapabilities(channel);
}

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** URL 경로의 ID 형식 확인(표시 전 방어). 존재 여부는 조회 연결 전이라 판단하지 않는다. */
export function isWellFormedId(value: string): boolean {
  return ID_PATTERN.test(value);
}
