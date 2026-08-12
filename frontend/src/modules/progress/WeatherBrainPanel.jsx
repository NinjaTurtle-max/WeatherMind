import { useQuery } from '@tanstack/react-query';
import AbilityRadar, { RADAR_MIN_CONCEPTS } from './AbilityRadar';
import Mascot from '../../components/Mascot';
import { conceptCharacter } from '../../components/conceptCharacter';
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
 * 개념마다 **담당 캐릭터**를 막대 앞에 세운다(2026-08-10 사용자 지시). 배정표는
 * `conceptCharacter.js`가 소유한다 — 여기서 고르지 않는다. 그림 넷이 합류하면서
 * 산불 기상·홍수 대응이 폴백(구름)을 벗어나, 이 목록에서 같은 얼굴이 반복되던
 * 것이 풀렸다. 캐릭터는 장식이라 `Mascot`이 aria-hidden으로 그린다 — 개념 이름은
 * 바로 옆 텍스트가 읽어 준다.
 *
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
      // 구분선은 **바깥 격자가 준다**(좁으면 위 테두리, 넓으면 왼쪽 테두리) —
      // 여기서 border-t를 박으면 2열일 때 오른쪽 칸 머리에 줄이 하나 더 생긴다.
      <div>
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
                    <span className="flex min-w-0 items-center gap-1.5">
                      <Mascot
                        name={conceptCharacter(m.concept_tag)}
                        className="h-[22px] w-[22px] flex-none"
                      />
                      <span className="min-w-0 truncate font-semibold text-slate-700">
                        {CONCEPT_KO[m.concept_tag] ?? m.concept_tag}
                      </span>
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
    tag: a.concept_tag,
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
      {/* 폭 전체 한 판이 되면서(2026-08-10 사용자 지시) 카드 안이 2열로 갈린다 —
          **왼쪽 θ(지금 실력) · 오른쪽 숙련도(익혔을 확률)**. 두 축을 세로로
          이어 붙이던 시절에는 막대가 14+14줄이라 카드 하나가 화면 두 개 높이였다.
          lg 미만에서는 1열로 쌓이고, 그때만 숙련도 위에 구분선이 생긴다.

          설명도 **열마다 따로** 붙는다(2026-08-11 사용자 지시). 종전에는 카드
          맨 위에 전폭 한 문단이 있었는데, 그것은 θ만 설명하는 글이라 오른쪽
          숙련도에는 자기 소개(h3 + 부제)가 있고 왼쪽에는 없는 짝짝이가 됐다.
          두 열의 머리를 같은 꼴(h3 + 부제)로 맞추면 무엇과 무엇이 나란한
          것인지가 읽힌다. */}
      <div className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2 lg:items-start lg:gap-6">
      <div>
      <h3 className="text-sm font-bold text-slate-800">{t('weatherBrain.ability.title')}</h3>
      <p className="mb-3 mt-0.5 text-xs leading-relaxed text-slate-500">
        {t('weatherBrain.introSeg1')}
        <span className="font-semibold text-sky-700">{t('weatherBrain.introStrong')}</span>
        {t('weatherBrain.introSeg2')}
      </p>
      {/* 레이더 + 막대 (2026-08-09) — 홈이 사라지면서 레이더가 이리로 왔다.
          막대는 개념을 **하나씩** 읽게 하고 레이더는 **치우침**을 한 번에 보여준다.
          둘은 같은 데이터의 다른 질문이라 겹치는 게 아니다.
          개념 3종 미만이면 AbilityRadar가 스스로 null이라 자리째 빠진다 —
          다각형이 안 그려지는데 빈 칸을 남기면 "고장"으로 읽힌다.

          2026-08-11(사용자 지시): 나란히(레이더 | 막대)에서 **위아래**로 바꾸고
          레이더를 키웠다(150 → 224px). 옆에 두면 레이더가 열 폭의 3분의 1을
          먹어 막대가 짧아지는데, 정작 레이더는 작아서 치우침이 안 읽혔다.
          위로 올리면 레이더는 열 폭만큼 커지고 막대도 폭을 다 쓴다.
          간격(mt-3·gap-2.5)은 오른쪽 숙련도 목록과 같은 값이다 — 두 열의 줄이
          같은 리듬으로 내려가야 한 카드로 읽힌다. */}
      {/* ⚠️ 개념 3종 미만이면 **감싼 div까지 같이 빠져야 한다**(2026-08-11 코드
          리뷰). AbilityRadar는 스스로 null이지만 wrapper가 남으면 mt-3만큼의
          빈 줄이 막대 위에 생겨, "자리째 빠진다"던 위 설명이 거짓이 된다.
          임계는 AbilityRadar가 소유한다(RADAR_MIN_CONCEPTS) — 여기서 다시 정하지
          않고 **같은 상수를 읽는다**. 숫자를 베끼면 그쪽이 바뀔 때 빈 줄이
          조용히 되살아난다. */}
      {rows.length >= RADAR_MIN_CONCEPTS && (
        <div className="mt-3 flex justify-center">
          <AbilityRadar
            abilities={(Array.isArray(data) ? data : []).map((a) => ({
              concept_tag: a.concept_tag,
              theta: a.theta,
              level_label: a.level_label,
            }))}
            className="h-[224px] w-[224px]"
          />
        </div>
      )}
      <ul className="mt-3 flex min-w-0 flex-col gap-2.5">
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
              <span className="flex min-w-0 items-center gap-1.5">
                <Mascot
                  name={conceptCharacter(row.tag)}
                  className="h-[22px] w-[22px] flex-none"
                />
                <span className="min-w-0 truncate font-semibold text-slate-700">{row.name}</span>
              </span>
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
      </div>

      <div className="border-t border-slate-100 pt-4 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
        <MasterySection />
      </div>
      </div>
    </Card>
  );
}
