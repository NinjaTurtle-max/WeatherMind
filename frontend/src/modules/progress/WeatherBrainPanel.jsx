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
 */

export default function WeatherBrainPanel() {
  const t = useT();
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['progress', 'abilities'],
    queryFn: progressApi.fetchAbilities,
    staleTime: 30_000,
  });

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
    </Card>
  );
}
