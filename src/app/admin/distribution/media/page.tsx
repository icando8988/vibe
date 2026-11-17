import { ConsoleShell } from "@/components/distribution-console/console-shell";
import { denyUnlessDistributionAdmin } from "@/components/distribution-console/guard";
import { Dependencies, DisabledAction, NotConnected } from "@/components/distribution-console/states";

export const dynamic = "force-dynamic";
export const metadata = { title: "미디어·권리" };

/** W6 미디어·권리. 업로드·변환·삭제는 준비 전이며 외부 이미지 URL 입력란도 두지 않는다. */
export default async function MediaPage() {
  const denied = await denyUnlessDistributionAdmin();
  if (denied) return denied;

  return (
    <ConsoleShell section="media" title="미디어·권리" crumbs={[{ label: "미디어·권리" }]}>
      <p>게시에 쓰는 이미지는 형식·규격, 출처·사용권, 등장인물 동의, 공개 범위를 확인한 뒤에만 고를 수 있습니다. 처리 중 · 처리 실패 · 권리 미확인은 서로 다른 상태로 표시합니다.</p>
      <DisabledAction id="md-upload" label="이미지 올리기" reason="이미지 저장·권리 확인 기능을 준비 중입니다." />
      <NotConnected what="미디어 자산" />
      <p className="ds-muted">참조하는 작업이나 보존 여부를 확인하기 전에는 자산을 삭제하지 않습니다.</p>
      <Dependencies
        items={[
          "M4 미디어 자산·권리 테이블과 업로드 서버 경로",
          "JPEG 등 형식 검증·변환, 공개 URL 수명 관리",
          "참조 작업 보호(삭제 차단)",
        ]}
      />
    </ConsoleShell>
  );
}
