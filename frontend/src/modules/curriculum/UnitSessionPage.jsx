import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { curriculumApi } from '../../api';
import SessionRunner from '../session/SessionRunner';
import { DailyGoalMeter } from '../progress/DailyGoal';
import { useT } from '../../i18n';

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
  const t = useT();

  return (
    <div className="pt-2">
      <Link to="/" className="mb-2 inline-block text-sm font-medium text-slate-500 hover:text-slate-700">
        {t('unitSession.back')}
      </Link>
      <SessionRunner
        queryKey={['curriculum', 'unit', unitId, 'session']}
        loadSession={() => curriculumApi.startUnitSession(unitId)}
        staleTime={0}
        title={t('unitSession.title')}
        subheader={
          <p className="mb-2 inline-flex items-center gap-1 rounded-full bg-sky-100 px-2.5 py-0.5 text-xs font-bold text-sky-700">
            {t('unitSession.chip')}
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

/**
 * UnitSummary — complete 응답의 unit_result(R8-01 §3.1 계약 5필드
 * {all_correct, crowns, crown_target, cleared, unit_xp})를 렌더한다.
 * crown_target 반영: 왕관은 n/target로 표시하고, 만점이어도 target 미달이면
 * "클리어"가 아니라 남은 왕관 안내를 보여준다(crown_target≥2 유닛 대비).
 */
function UnitSummary({ summary, onNext }) {
  const t = useT();
  const ur = summary?.unit_result ?? {};
  const cleared = ur.cleared;
  const earnedCrown = ur.all_correct && cleared;
  const crownTarget = ur.crown_target ?? 1;

  return (
    <div className="mt-10 rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-slate-200">
      <p className="text-4xl">{earnedCrown ? '👑' : ur.all_correct ? '🌈' : '⛅'}</p>
      <h2 className="mt-3 text-xl font-extrabold text-slate-900">
        {earnedCrown ? t('unitSession.cleared') : ur.all_correct ? t('unitSession.crowned') : t('unitSession.done')}
      </h2>
      <p className="mt-1 text-sm text-slate-500">
        {ur.all_correct
          ? cleared
            ? t('unitSession.allCleared')
            : t('unitSession.allMore', { target: crownTarget })
          : t('unitSession.hasWrong')}
      </p>

      <div className="mt-6 grid grid-cols-3 gap-2">
        <div className="rounded-xl bg-amber-50 p-3">
          <p className="text-lg font-extrabold text-amber-500">
            👑 {ur.crowns ?? 0}
            <span className="text-sm font-medium text-amber-400">/{crownTarget}</span>
          </p>
          <p className="mt-0.5 text-xs font-medium text-slate-500">{t('unitSession.crowns')}</p>
        </div>
        <div className="rounded-xl bg-emerald-50 p-3">
          <p className="text-lg font-extrabold text-emerald-600">
            {summary?.correct_count ?? 0}
            <span className="text-sm font-medium text-emerald-500">/{summary?.total ?? 0}</span>
          </p>
          <p className="mt-0.5 text-xs font-medium text-slate-500">{t('session.summary.correct')}</p>
        </div>
        <div className="rounded-xl bg-sky-50 p-3">
          <p className="text-lg font-extrabold text-sky-600">+{(summary?.xp_total ?? 0) + (ur.unit_xp ?? 0)}</p>
          <p className="mt-0.5 text-xs font-medium text-slate-500">{t('session.summary.xp')}</p>
        </div>
      </div>

      {ur.unit_xp > 0 && (
        <p className="mt-3 text-xs font-bold text-amber-600">{t('unitSession.bonus', { xp: ur.unit_xp })}</p>
      )}

      {/* 오늘 목표 N/M (R10-01 §3.4 — 웨이브 1 잔여: 데일리 SessionSummary와 같은 방식).
          목표 미설정이면 렌더되지 않는다. */}
      <DailyGoalMeter className="mt-4" />

      <button
        type="button"
        onClick={onNext}
        className="mt-6 w-full rounded-xl bg-slate-900 py-3 text-sm font-bold text-white transition hover:bg-slate-700"
      >
        {cleared ? t('unitSession.next') : t('unitSession.backToPath')}
      </button>
    </div>
  );
}
