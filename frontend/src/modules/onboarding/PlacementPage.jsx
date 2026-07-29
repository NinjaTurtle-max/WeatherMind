import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { placementApi, sessionApi } from '../../api';
import SessionRunner from '../session/SessionRunner';
import PlacementSummary from './PlacementSummary';
import PlacementFinalizing from './PlacementFinalizing';

/**
 * PlacementPage (R7-01 S3 · R7-02 S1) — 온보딩 배치고사(실력 진단) 전체 화면.
 * 가입 직후 진입하며 Layout(헤더·탭바) 밖에서 렌더된다 — 진단에 집중하는 풀스크린.
 * 세션 플레이는 공용 SessionRunner를 재사용한다(로딩/에러/완료 상태머신 포함).
 *
 * R7-02 S1 — 일괄 채점 UX(bulkMode):
 * - 문항 제출은 서버 왕복 없이 로컬 수집 → 즉시 다음 문항(문항 간 대기 0).
 * - 마지막 문항 후 "내 난이도를 찾는 중…" 전환 화면 뒤에서
 *   POST /onboarding/placement/submit-all → POST /session/{id}/complete 순차 호출.
 * - 완료 요약(PlacementSummary)에 submit-all results 기반 정답 수를 보강한다.
 *
 * 페이지 고유 처리 두 가지:
 * - 409 PLACEMENT_ALREADY_DONE: 이미 진단을 마친 사용자 — 홈으로 조용히 리다이렉트.
 * - "건너뛰기": 시작 전·진행 중 언제든 홈으로 이탈 가능(진단은 강제가 아님).
 *   미완료 이탈 시 로컬 답안은 버려지고, 재진입하면 당일 세션이 멱등 재사용된다.
 */
export default function PlacementPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const goHome = useCallback(() => navigate('/', { replace: true }), [navigate]);

  const loadSession = useCallback(async () => {
    try {
      return await placementApi.startPlacement();
    } catch (err) {
      if (err?.code === 'PLACEMENT_ALREADY_DONE') {
        // 이미 완료 — 에러 화면 없이 홈으로. 언마운트될 때까지 로딩 상태를 유지하도록
        // 결코 이행되지 않는 프로미스를 돌려준다(에러 플래시·불필요한 재시도 방지).
        goHome();
        return new Promise(() => {});
      }
      throw err; // 그 외 에러는 SessionRunner의 공용 에러 화면(재시도 버튼)으로
    }
  }, [goHome]);

  // R7-02 S1: 전 문항 응답 후 일괄 채점(멱등) → 완료(θ 배정). 전환 화면이
  // 최소 1.6초는 보이도록 API 왕복과 병행해 홀드한다(플래시 방지, 결정적 지연).
  const finalizeBulk = useCallback(async ({ sessionId, answers }) => {
    const minHold = new Promise((resolve) => setTimeout(resolve, 1600));
    const bulk = await placementApi.submitPlacementAll(answers);
    const summary = await sessionApi.completeSession(sessionId);
    await minHold;
    const results = bulk?.results ?? [];
    return {
      ...summary,
      // 요약의 "n문항 중 m개 정답"은 complete 응답을 우선, 부재 시 results로 파생
      correct_count: summary?.correct_count ?? results.filter((r) => r.is_correct).length,
      total: summary?.total ?? bulk?.progress?.total ?? results.length,
    };
  }, []);

  return (
    <div className="mx-auto min-h-screen max-w-xl px-4 pb-10 pt-4">
      <div className="flex items-center justify-between">
        <span className="text-base font-extrabold tracking-tight text-sky-900">⛅ WeatherMind</span>
        <button
          type="button"
          onClick={goHome}
          className="rounded-lg px-2 py-1 text-sm font-medium text-slate-400 transition hover:text-slate-600"
        >
          건너뛰기 →
        </button>
      </div>

      <SessionRunner
        queryKey={['placement', 'session']}
        loadSession={loadSession}
        staleTime={0}
        title="실력 진단 — 내 수준 찾기"
        subheader={
          <p className="mb-2 inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-bold text-indigo-700">
            🧭 딱 6문항이면 충분해요 — 틀려도 괜찮아요, 진단일 뿐!
          </p>
        }
        bulkMode
        finalizeBulk={finalizeBulk}
        finalizingScreen={<PlacementFinalizing />}
        onSessionComplete={() => {
          // placement_done·초기 θ 반영 (홈 헤더 /progress/me, 프로필 능력 분석)
          queryClient.invalidateQueries({ queryKey: ['progress', 'me'] });
          queryClient.invalidateQueries({ queryKey: ['progress', 'abilities'] });
        }}
        renderSummary={(summary) => <PlacementSummary summary={summary} onDone={goHome} />}
      />
    </div>
  );
}
