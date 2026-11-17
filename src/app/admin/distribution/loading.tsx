/** 불러오는 동안: 건수·연결 상태를 0이나 성공으로 임시 표시하지 않는다. 메뉴·데이터 구조도 노출하지 않는다. */
export default function DistributionLoading() {
  return (
    <main id="main-content" tabIndex={-1} className="ds-main" aria-busy="true">
      <div className="ds-container ds-section">
        <p role="status">화면을 불러오는 중입니다.</p>
      </div>
    </main>
  );
}
