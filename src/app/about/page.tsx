import type { Metadata } from "next";
import { StatusNotice } from "../../components/status-notice";
import { PageMain } from "../_components/page-main";

export const metadata: Metadata = { title: "도전 이야기" };

export default function AboutPage() {
  return (
    <PageMain eyebrow="도전 계획" title="도전 이야기">
      <StatusNotice title="소개 자료를 준비 중입니다">
        <p>도전자 소개·사진·이력은 공개 동의와 사실 확인을 마친 자료가 들어오면 표시합니다.</p>
      </StatusNotice>
      <h2>출발 계획</h2>
      <p>
        기획서의 출발 예정일은 <strong>2029년 3월 15일(계획)</strong>입니다. 사이트 공개일과는 별개입니다.
      </p>
      <p>
        이동 거리는 자전거·항공·선박을 나누어 관리할 예정입니다. 구간별 경로 자료가 들어오기 전에는 지도나 경로를 만들어 보여주지
        않으며, 계획 수치는 기록 인증의 근거가 아닙니다.
      </p>
    </PageMain>
  );
}
