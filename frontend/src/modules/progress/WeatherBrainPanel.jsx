import { useQuery } from '@tanstack/react-query';
import { progressApi } from '../../api';
import LoadingSpinner from '../../components/LoadingSpinner';
import {
  CONCEPT_KO,
  LEVEL_KO,
  LEVEL_CHIP,
  COLOR_MEASURED,
  COLOR_PRIOR,
  thetaToScore,
} from '../../lib/abilityDisplay';
import { useT } from '../../i18n';

/**
 * WeatherBrainPanel (R6 WeatherBrain) — 개념별 능력(θ) 분석 패널.
 * GET /progress/abilities → [{concept_tag, theta, theta_se, num_responses,
 *   level_label, updated_at}] (약한 개념 우선 정렬).
 *
 * WeatherMind 자체 적응형 모델(WeatherBrain)이 개념별 이해도를 추정해 난이도를
 * 배정한다. θ(로짓 -3..3)를 0..100 표시 스케일로 정규화해 가로 막대로 보여주고,
 * num_responses===0(사전 배정, 아직 측정 아님) 개념은 옅은 막대·안내 문구로 구분한다.
 * θ 표시 헬퍼(정규화·한글 라벨·칩 색)는 lib/abilityDisplay로 추출해
 * 배치고사 결과 화면(R7-01 S3)과 공유하며, 막대도 같은 div 관용구를 쓴다
 * (PlacementSummary와 동일 — 차트 라이브러리 불사용).
 *
 * R13-01 §5-1: 같은 카드 아래에 **BKT 숙련도** 섹션을 덧붙인다.
 * GET /progress/mastery → [{concept_tag, p_mastery, p_next_correct,
 *   num_responses, cold_start, level_label, params_source}].
 * 두 축은 다른 것을 잰다 — θ 막대는 "지금 실력"(로짓, 순서 없는 집합),
 * 숙련도 막대는 "이 개념을 익혔을 확률"(0..1, 시간 순서). 색조도 나눈다
 * (θ=sky, 숙련=emerald). 숙련도는 부가 축이라 조회 실패 시 섹션만 사라지고
 * θ 패널은 그대로 뜬다.
 */

// BKT 숙련 라벨 → 칩 색. θ의 LEVEL_CHIP과 **다른 팔레트**(emerald)를 쓴다 —
// 두 축이 한 카드에 나란히 놓이므로 색이 같으면 같은 지표로 읽힌다.
const MASTERY_CHIP = {
  insufficient: 'bg-slate-100 text-slate-500',
  beginning: 'bg-amber-100 text-amber-700',
  learning: 'bg-emerald-100 text-emerald-700',
  mastered: 'bg-emerald-600 text-white',
};
const COLOR_MASTERY = '#059669'; // emerald-600 — 익혔을 확률(θ의 sky와 구분)
const COLOR_MASTERY_COLD = '#e2e8f0'; // slate-200 — 데이터 부족

const pct = (p) => Math.round(Math.min(1, Math.max(0, typeof p === 'number' ? p : 0)) * 100);

export default function WeatherBrainPanel() {
  const t = useT();
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['progress', 'abilities'],
    queryFn: progressApi.fetchAbilities,
    staleTime: 30_000,
  });
  // 숙련도(BKT)는 **부가 축**이다 — 실패해도 θ 패널은 그대로 뜬다(섹션만 빠진다).
  const mastery = useQuery({
    queryKey: ['progress', 'mastery'],
    queryFn: progressApi.fetchMastery,
    staleTime: 30_000,
    retry: false,
  });
  const masteryRows = Array.isArray(mastery.data) ? mastery.data : [];
  const MasterySection = () => {
    if (mastery.isLoading || mastery.isError) return null;
    return (
      <div className="mt-4 border-t border-slate-100 pt-3">
        <h3 className="text-sm font-bold text-slate-800">
          {t('weatherBrain.mastery.title')}
        </h3>
        <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
          {t('weatherBrain.mastery.subtitle')}
        </p>
        {masteryRows.length === 0 ? (
          <p className="mt-2 text-xs text-slate-400">{t('weatherBrain.mastery.empty')}</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2.5">
            {masteryRows.map((m) => {
              const percent = pct(m.p_mastery);
              const next = pct(m.p_next_correct);
              const cold = Boolean(m.cold_start);
              return (
                <li
                  key={`mastery-${m.concept_tag}`}
                  title={t('weatherBrain.mastery.rowTitle', {
                    percent,
                    next,
                    count: m.num_responses ?? 0,
                  })}
                >
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="min-w-0 truncate font-semibold text-slate-700">
                      {CONCEPT_KO[m.concept_tag] ?? m.concept_tag}
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      <span className="text-[11px] font-bold tabular-nums text-slate-600">
                        {percent}%
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                          MASTERY_CHIP[m.level_label] ?? MASTERY_CHIP.insufficient
                        }`}
                      >
                        {t(`weatherBrain.mastery.${m.level_label}`)}
                      </span>
                    </span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full transition-none"
                      style={{
                        width: `${percent}%`,
                        backgroundColor: cold ? COLOR_MASTERY_COLD : COLOR_MASTERY,
                      }}
                    />
                  </div>
                  <p className="mt-0.5 text-[10px] text-slate-400">
                    {t('weatherBrain.mastery.nextHint', { next })}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    );
  };

  const Card = ({ children }) => (
    <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">{children}</div>
  );
  const Header = () => (
    <div className="mb-1 flex items-center gap-2">
      <h2 className="text-base font-extrabold text-slate-900">{t('weatherBrain.title')}</h2>
    </div>
  );

  if (isLoading) {
    return (
      <Card>
        <Header />
        <LoadingSpinner label={t('weatherBrain.loading')} />
      </Card>
    );
  }

  if (isError) {
    return (
      <Card>
        <Header />
        <p className="text-center text-sm text-slate-500">
          {t('weatherBrain.loadFailed', { detail: error?.detail ?? '' })}
        </p>
        <button
          type="button"
          onClick={() => refetch()}
          className="mt-2 block w-full rounded-lg bg-slate-100 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-200"
        >
          {t('common.retry')}
        </button>
      </Card>
    );
  }

  const rows = (Array.isArray(data) ? data : []).map((a) => ({
    name: CONCEPT_KO[a.concept_tag] ?? a.concept_tag,
    score: thetaToScore(a.theta),
    theta: typeof a.theta === 'number' ? a.theta : 0,
    levelKo: LEVEL_KO[a.level_label] ?? a.level_label ?? LEVEL_KO.beginner,
    level_label: a.level_label,
    num_responses: a.num_responses ?? 0,
    isPrior: (a.num_responses ?? 0) === 0,
  }));

  if (rows.length === 0) {
    return (
      <Card>
        <Header />
        <p className="mt-1 text-sm text-slate-500">
          {t('weatherBrain.empty')}
        </p>
        <MasterySection />
      </Card>
    );
  }

  return (
    <Card>
      <Header />
      <p className="mb-3 text-xs leading-relaxed text-slate-500">
        {t('weatherBrain.introSeg1')}
        <span className="font-semibold text-sky-700">{t('weatherBrain.introStrong')}</span>
        {t('weatherBrain.introSeg2')}
      </p>

      {/* 개념별 막대(PlacementSummary와 동일 div 관용구) + 레벨 칩 + 초기 배정 안내 */}
      <ul className="flex flex-col gap-2.5">
        {rows.map((row) => (
          <li
            key={row.name}
            title={t('weatherBrain.rowTitle', {
              theta: row.theta.toFixed(2),
              basis: row.isPrior
                ? t('weatherBrain.basisPrior')
                : t('weatherBrain.basisMeasured', { count: row.num_responses }),
            })}
          >
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="min-w-0 truncate font-semibold text-slate-700">{row.name}</span>
              <span className="flex shrink-0 items-center gap-1.5">
                {row.isPrior && (
                  <span className="text-[10px] font-medium text-slate-400">
                    {t('weatherBrain.priorNote')}
                  </span>
                )}
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                    LEVEL_CHIP[row.level_label] ?? 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {row.levelKo}
                </span>
              </span>
            </div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full transition-none"
                style={{
                  width: `${row.score}%`,
                  backgroundColor: row.isPrior ? COLOR_PRIOR : COLOR_MEASURED,
                  opacity: row.isPrior ? 0.7 : 1,
                }}
              />
            </div>
          </li>
        ))}
      </ul>

      <MasterySection />
    </Card>
  );
}
