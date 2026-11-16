import type { Metadata } from "next";
import { BooksView } from "../../components/books-view";

export const metadata: Metadata = { title: "책과 참여" };

// BooksView가 자체 main#main-content와 h1, 자료 미확보 빈 상태를 포함한다.
// DEV-003 이후 승인·게시된 책/캠페인 공개 조회를 연결할 때 BooksView에 데이터 props를 추가하도록 UI 담당과 조정한다.
export default function BooksPage() {
  return <BooksView />;
}
