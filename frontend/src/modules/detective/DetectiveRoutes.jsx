import { Route, Routes } from 'react-router-dom';
import CaseListPage from './CaseListPage';
import CasePlayPage from './CasePlayPage';

/**
 * 기후 탐정 라우트 묶음 (R13, 대장 CO-N-2).
 *
 * App.jsx는 `<Route path="/detective/*" element={<DetectiveRoutes />} />` **한 줄**만
 * 받는다 — 이 모듈이 하위 경로를 스스로 소유해서, 케이스가 늘어도 App.jsx를
 * 다시 건드리지 않는다(공유 파일 동시 편집 최소화).
 *   /detective            사건 목록
 *   /detective/:caseId    사건 플레이
 */
export default function DetectiveRoutes() {
  return (
    <Routes>
      <Route index element={<CaseListPage />} />
      <Route path=":caseId" element={<CasePlayPage />} />
    </Routes>
  );
}
