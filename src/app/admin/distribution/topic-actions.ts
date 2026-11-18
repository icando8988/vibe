"use server";

/**
 * 글감 후보 서버 액션(고정 계약). TOPIC-COLLECT-131.
 *   createTopicCandidateAction(formData): Promise<TopicCreateOutcome>       — title · memo? · sourceUrl? · sourceName? · category? · sourceDate?
 *   setTopicCandidateStatusAction(formData): Promise<TopicStatusOutcome>    — candidateId · expectedVersion · status(new|selected|dismissed)
 *   convertTopicCandidateAction(formData): Promise<TopicConvertOutcome>     — candidateId · expectedVersion · title · body · targetPath? · confirmConvert=on
 *   listTopicCandidatesAction(status?): Promise<TopicListOutcome>           — 최신 수집 순 최대 100건
 * 매 액션: 검증된 세션 actor + D1 → 입력 검증 → service RPC 1회(DB가 D1·중복·버전 재검사). redirect 없음 — 결과를 그대로 돌려준다.
 * 출처 링크는 저장만 한다(서버가 그 주소로 요청하지 않음). 변환은 원문 1버전 생성까지 — 승인·초안·작업·게시 없음.
 */
import { revalidatePath } from "next/cache";
import { topicWriteDeps, getTopicCandidates } from "@/server/distribution/topics/runtime";
import { convertTopicCandidate, createTopicCandidate, setTopicCandidateStatus } from "@/server/distribution/topics/service";
import { TOPIC_STATUSES, type TopicConvertOutcome, type TopicCreateOutcome, type TopicListOutcome, type TopicStatus, type TopicStatusOutcome } from "@/server/distribution/topics/types";

const TOPICS_PATH = "/admin/distribution/topics";
const CONTENTS_PATH = "/admin/distribution/contents";

export async function createTopicCandidateAction(formData: FormData): Promise<TopicCreateOutcome> {
  const out = await createTopicCandidate(topicWriteDeps, formData);
  if (out.status === "ok" && out.data.created) revalidatePath(TOPICS_PATH);
  return out;
}

export async function setTopicCandidateStatusAction(formData: FormData): Promise<TopicStatusOutcome> {
  const out = await setTopicCandidateStatus(topicWriteDeps, formData);
  if (out.status === "ok") revalidatePath(TOPICS_PATH);
  return out;
}

export async function convertTopicCandidateAction(formData: FormData): Promise<TopicConvertOutcome> {
  const out = await convertTopicCandidate(topicWriteDeps, formData);
  if (out.status === "ok") {
    revalidatePath(TOPICS_PATH);
    revalidatePath(CONTENTS_PATH);
  }
  return out;
}

export async function listTopicCandidatesAction(status?: string): Promise<TopicListOutcome> {
  const s = typeof status === "string" && (TOPIC_STATUSES as readonly string[]).includes(status) ? (status as TopicStatus) : undefined;
  return getTopicCandidates(s ? { status: s } : {});
}
