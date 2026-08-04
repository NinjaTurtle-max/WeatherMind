import { Link } from 'react-router-dom';
import { DailyGoalMeter } from '../progress/DailyGoal';
import { useT } from '../../i18n';

/**
 * SessionSummary (R2-01 S7) — 세션 완료 요약 화면.
 * POST /session/{id}/complete 응답 {xp_total, correct_count, total, streak_count} 표시.
 *
 * R10-01 §3.4 (S4 — R10-D): 완료 화면에 "오늘 목표 N/M"을 표기한다
 * (N=/progress/me의 today_answered_count, M=daily_goal_items — 미설정이면 미렌더).
 */
export default function SessionSummary({ summary }) {
  const t = useT();
  if (!summary) return null;
  const { xp_total, correct_count, total, streak_count } = summary;
  const allCorrect = correct_count === total;

  return (
    <div className="mt-10 rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-slate-200">
      <p className="text-4xl">{allCorrect ? '🌈' : '⛅'}</p>
      <h2 className="mt-3 text-xl font-extrabold text-slate-900">{t('session.summary.title')}</h2>
      <p className="mt-1 text-sm text-slate-500">
        {allCorrect ? t('session.summary.allCorrect') : t('session.summary.someWrong')}
      </p>

      <div className="mt-6 grid grid-cols-3 gap-2">
        <div className="rounded-xl bg-emerald-50 p-3">
          <p className="text-lg font-extrabold text-emerald-600">
            {correct_count}
            <span className="text-sm font-medium text-emerald-500">/{total}</span>
          </p>
          <p className="mt-0.5 text-xs font-medium text-slate-500">{t('session.summary.correct')}</p>
        </div>
        <div className="rounded-xl bg-sky-50 p-3">
          <p className="text-lg font-extrabold text-sky-600">+{xp_total}</p>
          <p className="mt-0.5 text-xs font-medium text-slate-500">{t('session.summary.xp')}</p>
        </div>
        <div className="rounded-xl bg-orange-50 p-3">
          <p className="text-lg font-extrabold text-orange-500">🔥 {streak_count}</p>
          <p className="mt-0.5 text-xs font-medium text-slate-500">{t('session.summary.streak')}</p>
        </div>
      </div>

      {/* 오늘 목표 진행 (R10-01 §3.4) — 목표 미설정이면 렌더되지 않는다 */}
      <DailyGoalMeter className="mt-4" />

      {/* R10-01 §3.5 마감 4: 고정 "5문항" 카피를 실제 배합(complete 응답 total)과
          동기화한다. 배합은 Settings.SESSION_RECIPE로 env 조정될 수 있어 상수로
          적으면 어긋난다(관찰 보고서 §1-4: 표기 5 vs 실제 9). total이 없으면 수를 뺀다. */}
      <p className="mt-6 text-sm text-slate-500">
        {total > 0 ? t('session.summary.tomorrow', { total }) : t('session.summary.tomorrowNoCount')}
      </p>
      <Link
        to="/board"
        className="mt-4 inline-block rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-slate-700"
      >
        {t('session.summary.boardCta')}
      </Link>
    </div>
  );
}
