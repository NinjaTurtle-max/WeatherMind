import { Route, Routes } from 'react-router-dom';
import CaseListPage from './CaseListPage';
import CasePlayPage from './CasePlayPage';

/**
 * 과거 예보 라우트 묶음 (MT-30).
 *
 * App.jsx는 `<Route path="/hindcast/*" element={<HindcastRoutes />} />` **한 줄**만
 * 받는다 — 이 모듈이 하위 경로를 스스로 소유해서, 회차가 늘어도 App.jsx를 다시
 * 건드리지 않는다(DetectiveRoutes가 세운 선례. 공유 파일 동시 편집 최소화).
 *   /hindcast            회차 목록
 *   /hindcast/:caseId    회차 플레이
 */
export default function HindcastRoutes() {
  return (
    <Routes>
      <Route index element={<CaseListPage />} />
      <Route path=":caseId" element={<CasePlayPage />} />
    </Routes>
  );
}
