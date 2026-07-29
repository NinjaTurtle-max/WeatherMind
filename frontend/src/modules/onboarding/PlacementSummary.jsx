import {
  CONCEPT_KO,
  LEVEL_KO,
  LEVEL_CHIP,
  COLOR_MEASURED,
  thetaToScore,
  levelFromTheta,
} from '../../lib/abilityDisplay';

/**
 * PlacementSummary (R7-01 S3) — 배치고사 완료 후 개념별 진단 결과(θ) 화면.
 * POST /session/{id}/complete 응답의 abilities:
 *   [{concept_tag, theta, theta_se, num_responses, level_label}] (/progress/abilities와 동일 형식)
 * 를 WeatherBrainPanel과 같은 표현 문법(thetaToScore 정규화 막대 + 레벨 칩)으로 보여준다.
 * level_label은 서버값을 우선 쓰고, 부재 시에만 levelFromTheta로 파생(폴백).
 * 약한 개념 우선 정렬 — /progress/abilities(WeatherBrainPanel) 정렬과 같은 방향(서버 비의존).
 */
export default function PlacementSummary({ summary, onDone }) {
  const abilities = [...(summary?.abilities ?? [])].sort((a, b) => (a.theta ?? 0) - (b.theta ?? 0));

  return (
    <div className="mt-10 rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-slate-200">
      <p className="text-4xl">🧭</p>
      <h2 className="mt-3 text-xl font-extrabold text-slate-900">진단 완료!</h2>
      <p className="mt-1 text-sm text-slate-500">
        {typeof summary?.correct_count === 'number' && typeof summary?.total === 'number'
          ? `${summary.total}문항 중 ${summary.correct_count}문항을 맞혔어요. `
          : null}
        이제 WeatherBrain이 내 수준에 맞는 문제를 준비해요.
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
            막대가 짧을수록 앞으로 더 자주 만나게 될 개념이에요. 진단 결과는 프로필의
            WeatherBrain 능력 분석에서 계속 갱신돼요.
          </p>
        </div>
      ) : (
        <p className="mt-6 text-sm text-slate-500">
          진단 결과가 아직 준비되지 않았어요. 학습을 진행하면 능력 분석이 채워져요.
        </p>
      )}

      <button
        type="button"
        onClick={onDone}
        className="mt-6 w-full rounded-xl bg-slate-900 py-3 text-sm font-bold text-white transition hover:bg-slate-700"
      >
        학습 시작하기 →
      </button>
    </div>
  );
}
