import type { Metadata } from "next";
import { StatusNotice } from "../../components/status-notice";
import { PageMain } from "../_components/page-main";

export const metadata: Metadata = { title: "참여 안내" };

export default function HowItWorksPage() {
  return (
    <PageMain eyebrow="참여 전 확인" title="참여 안내">
      <StatusNotice tone="warning" title="참여 규칙이 아직 확정되지 않았습니다">
        <p>
          입금 순서·목표 기준·취소와 환불 규칙은 정해지는 대로 안내합니다. 아래는 앞으로의 공통 흐름 초안이며, 지금은 신청과 입금을
          받지 않습니다.
        </p>
      </StatusNotice>
      <h2>참여 흐름(초안)</h2>
      <ol>
        <li>회원 가입 후 운영자 승인을 기다립니다.</li>
        <li>책 상세에서 형식·가격·마감일·취소 조건을 확인하고 수량을 신청합니다.</li>
        <li>안내에 따라 입금하고, 입금했다고 알려 주시면 운영자가 확인합니다. 알려 주신 것만으로 입금 완료가 되지는 않습니다.</li>
        <li>‘내 참여’에서 입금 확인·제작·배송 또는 전자책 받기 상태를 확인합니다.</li>
      </ol>
      <h2>외부 펀딩</h2>
      <p>외부 펀딩으로 참여하면 결제와 내역 확인은 해당 서비스에서 합니다. 이 사이트는 외부 결제 성공을 기록하지 않습니다.</p>
    </PageMain>
  );
}
