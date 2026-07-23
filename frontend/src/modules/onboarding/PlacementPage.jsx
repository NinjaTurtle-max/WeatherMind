import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { placementApi } from '../../api';
import SessionRunner from '../session/SessionRunner';
import PlacementSummary from './PlacementSummary';

/**
 * PlacementPage (R7-01 S3) — 온보딩 배치고사(실력 진단) 전체 화면.
 * 가입 직후 진입하며 Layout(헤더·탭바) 밖에서 렌더된다 — 진단에 집중하는 풀스크린.
 * 세션 플레이는 공용 SessionRunner를 재사용한다(로딩/에러/피드백/완료 상태머신 포함).
 *
 * 페이지 고유 처리 두 가지만 얹는다:
 * - 409 PLACEMENT_ALREADY_DONE: 이미 진단을 마친 사용자 — 홈으로 조용히 리다이렉트.
 * - "건너뛰기": 시작 전·진행 중 언제든 홈으로 이탈 가능(진단은 강제가 아님).
 *   미완료 이탈 시 서버 세션은 미완료로 남고, 재진입하면 당일 세션이 멱등 재사용된다.
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
