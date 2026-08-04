import {
  CONCEPT_KO,
  LEVEL_KO,
  LEVEL_CHIP,
  COLOR_MEASURED,
  thetaToScore,
  levelFromTheta,
} from '../../lib/abilityDisplay';
import { DailyGoalPicker } from '../progress/DailyGoal';
import { useT } from '../../i18n';

/**
 * PlacementSummary (R7-01 S3) — 배치고사 완료 후 개념별 진단 결과(θ) 화면.
 * POST /session/{id}/complete 응답의 abilities:
 *   [{concept_tag, theta, theta_se, num_responses, level_label}] (/progress/abilities와 동일 형식)
 * 를 WeatherBrainPanel과 같은 표현 문법(thetaToScore 정규화 막대 + 레벨 칩)으로 보여준다.
 * level_label은 서버값을 우선 쓰고, 부재 시에만 levelFromTheta로 파생(폴백).
 * 약한 개념 우선 정렬 — /progress/abilities(WeatherBrainPanel) 정렬과 같은 방향(서버 비의존).
 *
 * R10-01 §3.4·D4 (S4 — R10-D): 진단 직후 **일일 목표 선택 1스텝**을 여기에 둔다.
 * "지금 무엇을 할지"가 가장 분명한 순간에 하루 분량을 스스로 정하게 하는 커밋
 * 장치다(관찰 보고서 R10-D). 선택은 PUT /progress/daily-goal로 즉시 저장되고,
 * 이후 세션 완료 화면·프로필의 "오늘 목표 N/M" 표기의 분모가 된다.
 * 강제하지 않는다 — 고르지 않아도 "학습 시작하기"로 넘어갈 수 있다(미설정 유지).
 */
export default function PlacementSummary({ summary, onDone }) {
  const t = useT();
  const abilities = [...(summary?.abilities ?? [])].sort((a, b) => (a.theta ?? 0) - (b.theta ?? 0));

  return (
    <div className="mt-10 rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-slate-200">
      <p className="text-4xl">🧭</p>
      <h2 className="mt-3 text-xl font-extrabold text-slate-900">{t('placement.doneTitle')}</h2>
      <p className="mt-1 text-sm text-slate-500">
        {typeof summary?.correct_count === 'number' && typeof summary?.total === 'number'
          ? t('placement.scored', { total: summary.total, correct: summary.correct_count })
          : null}
        {t('placement.doneBody')}
      </p>

      {abilities.length > 0 ? (
        <div className="mt-6 flex flex-col gap-3 text-left">
          {abilities.map((a) => {
            const level = a.level_label ?? levelFromTheta(a.theta); // 서버값 우선, 부재 시 폴백
            return (
              <div key={a.concept_tag}>
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-xs font-semibold text-slate-700">
                    {CONCEPT_KO[a.concept_tag] ?? a.concept_tag}
                  </span>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${
                      LEVEL_CHIP[level] ?? 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {LEVEL_KO[level] ?? level}
                  </span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full transition-none"
                    style={{ width: `${thetaToScore(a.theta)}%`, backgroundColor: COLOR_MEASURED }}
                  />
                </div>
              </div>
            );
          })}
          <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
            {t('placement.barsNote')}
          </p>
        </div>
      ) : (
        <p className="mt-6 text-sm text-slate-500">
          {t('placement.emptyAbilities')}
        </p>
      )}

      {/* 일일 목표 커밋 1스텝 (§3.4·D4) */}
      <DailyGoalPicker className="mt-6" />

      <button
        type="button"
        onClick={onDone}
        className="mt-6 w-full rounded-xl bg-slate-900 py-3 text-sm font-bold text-white transition hover:bg-slate-700"
      >
        {t('placement.start')}
      </button>
    </div>
  );
}
