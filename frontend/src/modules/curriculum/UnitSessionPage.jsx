import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { curriculumApi } from '../../api';
import SessionRunner from '../session/SessionRunner';

/**
 * UnitSessionPage (R5-01 §3.2·S4) — 커리큘럼 유닛 세션 플레이어.
 * POST /curriculum/units/{id}/session으로 세션을 발급받아 공용 SessionRunner로 플레이한다.
 * 완료 시 ['curriculum']를 무효화해 다음 유닛이 즉시 열리도록 하고(체류 유도),
 * 요약 화면에서 왕관 획득·다음 유닛 진행 CTA를 보여준다.
 */
export default function UnitSessionPage() {
  const { unitId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  return (
    <div className="pt-2">
      <Link to="/" className="mb-2 inline-block text-sm font-medium text-slate-500 hover:text-slate-700">
        ← 학습 경로로
      </Link>
      <SessionRunner
        queryKey={['curriculum', 'unit', unitId, 'session']}
        loadSession={() => curriculumApi.startUnitSession(unitId)}
        staleTime={0}
        title="유닛 학습"
        subheader={
          <p className="mb-2 inline-flex items-center gap-1 rounded-full bg-sky-100 px-2.5 py-0.5 text-xs font-bold text-sky-700">
            📚 커리큘럼 유닛
          </p>
        }
        onSessionComplete={() => {
          // 완료 → 다음 유닛 즉시 노출(§3.2) + 구름 잔량 반영
          queryClient.invalidateQueries({ queryKey: ['curriculum'] });
          queryClient.invalidateQueries({ queryKey: ['progress', 'energy'] });
        }}
        renderSummary={(summary) => (
          <UnitSummary summary={summary} onNext={() => navigate('/')} />
        )}
      />
    </div>
  );
}

function UnitSummary({ summary, onNext }) {
  const ur = summary?.unit_result ?? {};
  const cleared = ur.cleared;
  const earnedCrown = ur.all_correct && cleared;

  return (
    <div className="mt-10 rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-slate-200">
      <p className="text-4xl">{earnedCrown ? '👑' : ur.all_correct ? '🌈' : '⛅'}</p>
      <h2 className="mt-3 text-xl font-extrabold text-slate-900">
        {earnedCrown ? '유닛 클리어!' : ur.all_correct ? '유닛 완료!' : '유닛을 마쳤어요'}
      </h2>
      <p className="mt-1 text-sm text-slate-500">
        {ur.all_correct
          ? '모든 문항을 맞혔어요. 다음 유닛이 열렸어요!'
          : '틀린 문항이 있어요. 다시 도전하면 왕관을 받을 수 있어요.'}
      </p>

      <div className="mt-6 grid grid-cols-3 gap-2">
        <div className="rounded-xl bg-amber-50 p-3">
          <p className="text-lg font-extrabold text-amber-500">👑 {ur.crowns ?? 0}</p>
          <p className="mt-0.5 text-xs font-medium text-slate-500">왕관</p>
        </div>
        <div className="rounded-xl bg-emerald-50 p-3">
          <p className="text-lg font-extrabold text-emerald-600">
            {summary?.correct_count ?? 0}
            <span className="text-sm font-medium text-emerald-500">/{summary?.total ?? 0}</span>
          </p>
          <p className="mt-0.5 text-xs font-medium text-slate-500">정답 수</p>
        </div>
        <div className="rounded-xl bg-sky-50 p-3">
          <p className="text-lg font-extrabold text-sky-600">+{(summary?.xp_total ?? 0) + (ur.unit_xp ?? 0)}</p>
          <p className="mt-0.5 text-xs font-medium text-slate-500">획득 XP</p>
        </div>
      </div>

      {ur.unit_xp > 0 && (
        <p className="mt-3 text-xs font-bold text-amber-600">✨ 유닛 최초 클리어 보너스 +{ur.unit_xp} XP</p>
      )}

      <button
        type="button"
        onClick={onNext}
        className="mt-6 w-full rounded-xl bg-slate-900 py-3 text-sm font-bold text-white transition hover:bg-slate-700"
      >
        {ur.all_correct ? '다음 유닛으로 →' : '학습 경로로 돌아가기'}
      </button>
    </div>
  );
}
