import { ProjectHome } from "../components/project-home";

// ProjectHome이 자체 main#main-content와 h1을 포함한다. 추가 main으로 감싸지 않는다.
export default function HomePage() {
  return <ProjectHome />;
}
