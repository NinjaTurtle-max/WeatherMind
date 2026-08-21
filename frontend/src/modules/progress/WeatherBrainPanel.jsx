import { useQuery } from '@tanstack/react-query';
import AbilityRadar, {
  AbilityRadarPlaceholder,
  RADAR_MIN_CONCEPTS,
  RADAR_TONES,
  unitToRatio,
} from './AbilityRadar';
import Mascot from '../../components/Mascot';
import { conceptCharacter } from '../../components/conceptCharacter';
import { progressApi } from '../../api';
import LoadingSpinner from '../../components/LoadingSpinner';
import {
  CONCEPT_KO,
  LEVEL_CHIP,
  knowledgeLevelLabel,
  COLOR_MEASURED,
  COLOR_PRIOR,
  thetaToScore,
} from '../../lib/abilityDisplay';
import { useT } from '../../i18n';

/**
 * WeatherBrainPanel (R6 WeatherBrain) — 개념별 능력(θ) 분석 패널.
 * GET /progress/abilities → [{concept_tag, theta, theta_se, num_responses,
 *   level_label, knowledge_level(+_max), updated_at}] (약한 개념 우선 정렬).
 *   ⚠️ `knowledge_level`을 이 목록에 **꼭 적어 둔다** — 2026-08-19에 칩·레이더가
 *   그 필드를 소비하기 시작했는데 이 줄은 소비 전 목록 그대로였다. 낡은 필드
 *   목록은 다음 사람이 "안 내려오는 값"으로 읽고 폴백을 지우게 만든다(§0).
 *
 * WeatherMind 자체 적응형 모델(WeatherBrain)이 개념별 이해도를 추정해 난이도를
 * 배정한다. θ(로짓 -3..3)를 0..100 표시 스케일로 정규화해 가로 막대로 보여주고,
 * num_responses===0(사전 배정, 아직 측정 아님) 개념은 옅은 막대·안내 문구로 구분한다.
 * 막대 끝 칩의 **글자는 교과 단계**(knowledge_level)이고 **색은 4밴드**
 * (level_label)다 — 두 축이 한 칩에 겹쳐 있는 것이 아니라, 표기만 교과 단계로
 * 모으고 색이 쓰던 축은 그대로 둔 것이다(lib/abilityDisplay.knowledgeLevelLabel).
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
        <p className="mt-0.5 text-xs leading-relaxed text-slate-500 lg:min-h-[39px]">
          {t('weatherBrain.mastery.subtitle')}
        </p>
        {/* 🔴 **초록 레이더**(2026-08-18 사용자 지시 — "개념 숙련도도 초록색으로
            다이어그램"). 왼쪽 θ 레이더와 **같은 부품·같은 치수·같은 자리**라
            두 열이 한 카드로 읽힌다. 다른 것은 색뿐이고, 그 색이 유일한 구분이다:
            왼쪽은 「지금 풀 수 있는 정도(θ)」, 이쪽은 「익혔을 확률(0~1)」이라
            축도 범위도 다르다 — 같은 파랑이면 두 그림을 겹쳐 읽게 된다.
            ⚠️ 임계(3종 미만이면 자리째 뺀다)는 왼쪽과 **같은 상수**를 읽는다.
            숫자를 베끼면 그쪽이 바뀔 때 여기만 빈 줄이 남는다. */}
        {masteryRows.length >= RADAR_MIN_CONCEPTS && (
          <div className="mt-3 flex justify-center">
            <AbilityRadar
              testId="mastery-radar"
              tone={RADAR_TONES.emerald}
              ratio={(m) => unitToRatio(m.p_mastery)}
              abilities={masteryRows.map((m) => ({
                concept_tag: m.concept_tag,
                theta: 0,
                level_label: m.level_label,
                p_mastery: m.p_mastery,
              }))}
              ariaLabel={t('weatherBrain.mastery.radarAria', {
                list: masteryRows
                  .map((m) => `${CONCEPT_KO[m.concept_tag] ?? m.concept_tag} ${pct(m.p_mastery)}%`)
                  .join(', '),
              })}
              className="h-[224px] w-[224px]"
            />
          </div>
        )}
        {/* 🔴 **빈 상태에도 그림이 앉는다**(2026-08-20). 종전에는 문구 한 줄뿐이라
            왼쪽이 레이더+행 여럿인데 오른쪽은 두 줄에서 끝나, 열 하나가
            통째로 비었다. 그런데 그 상태는 예외가 아니라 **갓 가입한 학습자의 기본값**
            이다 — θ는 응답 0회여도 사전분포로 개념 전건이 뜨고 숙련도(BKT)는
            응답이 쌓여야 행이 생기기 때문이다.
            자리 표시는 실제 레이더와 **같은 치수**를 쓴다(AbilityRadar가 소유) —
            데이터가 들어찬 순간 그림이 튀지 않게 하는 값이다.
            ⚠️ 행 높이까지 맞추려 유령 행을 그리지는 않는다. 없는 값을 그린
            막대는 "0%로 측정됐다"로 읽힌다 — 빈 것과 0은 다른 사실이다. */}
        {masteryRows.length === 0 ? (
          <div className="mt-3 flex flex-col items-center gap-2">
            <AbilityRadarPlaceholder testId="mastery-radar-placeholder" className="h-[224px] w-[224px]" />
            <p className="max-w-[280px] text-center text-xs leading-relaxed text-slate-400">
              {t('weatherBrain.mastery.empty')}
            </p>
          </div>
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
                  {/* 🔴 **왼쪽 θ 행과 같은 한 줄 구성**(2026-08-19 사용자 지시
                      "여기도 똑같이 배치 맞춰줘"). 어제 θ 쪽만 한 줄로 바꾸고
                      이쪽은 3줄(제목 / 막대 / 다음 확률)로 남겨 뒀는데, 두 열이
                      한 카드 안에서 **다른 리듬으로 내려가** 나란한 것으로
                      안 읽혔다.
                      순서·치수를 왼쪽과 맞춘다: 마스코트 28 · 이름 고정폭
                      132/sm 164 · 막대 flex-1 · 보조 문구는 lg에서만 · 칩.
                      ⚠️ 「다음 문제 정답 확률」이 왼쪽의 「아직 응답 없음」 자리를
                      물려받는다 — 그래서 lg 미만에서는 접힌다. 접혀도 잃는
                      정보가 없다: 같은 값을 행 `title` 툴팁이 이미 들고 있다.
                      ⚠️ %는 **접지 않는다.** 이 열에서 그 숫자가 본문이라
                      막대만 남으면 값을 읽을 수 없다(왼쪽은 등급 칩이 그
                      몫을 하지만 이쪽 칩은 데이터 충분/부족만 말한다). */}
                  <div className="flex items-center gap-2 text-xs">
                    <span className="flex w-[132px] flex-none items-center gap-1.5 sm:w-[164px]">
                      <Mascot
                        name={conceptCharacter(m.concept_tag)}
                        className="h-[28px] w-[28px] flex-none"
                      />
                      <span className="min-w-0 truncate font-semibold text-slate-700">
                        {CONCEPT_KO[m.concept_tag] ?? m.concept_tag}
                      </span>
                    </span>
                    <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-100">
                      <span
                        className="block h-full rounded-full transition-none"
                        style={{
                          width: `${percent}%`,
                          backgroundColor: cold ? COLOR_MASTERY_COLD : COLOR_MASTERY,
                        }}
                      />
                    </span>
                    <span className="hidden shrink-0 text-[10px] font-medium text-slate-400 lg:inline">
                      {t('weatherBrain.mastery.nextHint', { next })}
                    </span>
                    <span className="shrink-0 text-[11px] font-bold tabular-nums text-slate-600">
                      {percent}%
                    </span>
                    {/* 🔴 **이 칩은 교과 단계로 바꾸지 않는다**(2026-08-19 · PM 승인).
                        `m.level_label`은 θ 4밴드(초급/중급/고급/최상급)가 아니라
                        **BKT 숙련 축**이다 — insufficient·beginning·learning·mastered이고
                        화면 문구는 「데이터 부족 · 아직 익히는 중 · 거의 익힘 · 숙련」이다.
                        「이 개념을 익혔을 확률」을 「어느 교과 단계인가」로 갈아 끼우면
                        **숙련 정보가 사라진다**(난이도 축은 왼쪽 θ 칩이 이미 말한다).
                        두 축은 대체가 아니라 공존이다 — 왼쪽 칩이 교과 단계로 바뀌었다고
                        해서 여기도 같이 갈아엎지 말 것.

                        🔴 **함정은 두 축이 필드 이름을 공유한다는 것이다** —
                        `ConceptAbilityOut.level_label`(θ 4밴드)과
                        `ConceptMasteryOut.level_label`(BKT 4상태)이 **같은 이름**이다.
                        그래서 소스를 훑으면 여기가 θ 밴드로 보이고, 실제로
                        2026-08-19 지시가 이 줄을 포함한 3곳으로 나갔다(PM 실측 후 2곳으로
                        정정). 값이 무엇인지는 **이름이 아니라 어느 응답에서 왔는지**가
                        정한다: 이 `m`은 `GET /progress/mastery`의 행이다. */}
                    <span
                      data-testid="mastery-level-chip"
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${
                        MASTERY_CHIP[m.level_label] ?? MASTERY_CHIP.insufficient
                      }`}
                    >
                      {t(`weatherBrain.mastery.${m.level_label}`)}
                    </span>
                  </div>
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
  /**
   * 제목 줄 — **카드 안의 평범한 제목**이다.
   *
   * ⚠️ 2026-08-19에 잠깐 `absolute bottom-full`로 카드 위에 솟는 「탭」이었다가
   * **같은 날 되돌렸다**(사용자 지시 "원래대로 탭 바 없애고 하나의 카드로").
   * 탭은 왼쪽 열이 짧던 시절의 여백을 메우려던 장치였는데, 학습 지역이 왼쪽으로
   * 돌아와 두 열 길이가 맞으면서 **메울 여백 자체가 없어졌다** — 남은 것은
   * 카드가 둘로 보이는 인상뿐이었다. 되살릴 일이 없기를 바라지만, 되살린다면
   * `ProgressPage`의 판 위 여백(`lg:mt-*`)도 함께여야 한다(짝이다).
   */
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
    // 🔴 칩 **글자**는 교과 단계다(2026-08-19 사용자 지적 — 같은 카드 위 「현재
    // 지식 단계」가 「고등학교 진로선택」이라 말하는데 여기만 「중급」이었다).
    // 칩 **색**은 아래에서 여전히 `LEVEL_CHIP[level_label]`이 고르므로 `level_label`을
    // 계속 실어 보낸다 — 축을 지운 게 아니라 표기만 바꾼 것이라는 사실이 여기 남는다.
    // null·부재 폴백(4밴드)은 knowledgeLevelLabel이 소유한다.
    levelKo: knowledgeLevelLabel(a),
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
      {/* ⚠️ `lg:min-h-[39px]` — **두 열의 머리 높이를 맞춘다**(2026-08-19 사용자
          지시 "개념 숙련도를 아래로 살짝 내려서 위치 맞춰줘"). 왼쪽 설명은 두
          줄, 오른쪽은 한 줄이라 그 차이만큼 오른쪽 레이더가 **20px 위**에서
          시작했다(실측 986 ↔ 1006). 39px = 두 줄(12px × leading-relaxed 1.625).
          ⚠️ **두 값은 짝이다** — 한쪽만 바꾸면 다시 어긋난다. 설명이 세 줄로
          길어지면 이 값도 함께 올릴 것(`home.smoke` ⓔ가 짝을 문다). */}
      <p className="mb-3 mt-0.5 text-xs leading-relaxed text-slate-500 lg:min-h-[39px]">
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
      {/* ⚠️ 아래 `abilities`에 `knowledge_level`을 **반드시 실어 보낸다** — 레이더의
          기본 aria-label이 그 값으로 교과 단계를 읽는다. 빠뜨리면 그림의 낭독만
          조용히 4밴드 폴백으로 되돌아가, 눈으로 보는 칩(교과 단계)과 스크린리더가
          듣는 문구가 갈린다. `level_label`도 그 폴백의 재료라 함께 남긴다
          (축을 지운 것이 아니라 표기만 바꾼 것이다). */}
      {rows.length >= RADAR_MIN_CONCEPTS && (
        <div className="mt-3 flex justify-center">
          <AbilityRadar
            abilities={(Array.isArray(data) ? data : []).map((a) => ({
              concept_tag: a.concept_tag,
              theta: a.theta,
              level_label: a.level_label,
              knowledge_level: a.knowledge_level,
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
            {/* 🔴 **한 줄에 마스코트 · 개념 · 막대**(2026-08-18 사용자 지시 —
                "마스코트를 더 살려야 하니까"). 종전에는 막대가 **아랫줄**로
                내려가 한 개념이 두 줄을 먹었고, 14개가 쌓이니 캐릭터는
                22px 점처럼 보이고 세로만 길었다.

                ⚠️ 이름 열은 **고정폭**이다. `w-fit`으로 두면 「태풍」과
                「복사와 에너지 수지」에서 막대 시작점이 제각각이라 14줄이
                들쭉날쭉해진다 — 눈이 훑는 기준선을 하나로 만드는 값이다.
                sm 미만에서 좁히는 것은 그 폭에서 막대가 먼저 죽기 때문이다.
                ⚠️ 「아직 응답 없음」 안내는 **lg 이상에서만** 보인다. 좁은
                화면에서 막대·배지와 셋이 한 줄을 다투면 막대가 사라진다.
                안내가 접혀도 잃는 정보는 없다 — 같은 사실을 막대 색(연한
                회청)과 `title` 툴팁이 이미 말한다. */}
            <div className="flex items-center gap-2 text-xs">
              <span className="flex w-[132px] flex-none items-center gap-1.5 sm:w-[164px]">
                <Mascot
                  name={conceptCharacter(row.tag)}
                  className="h-[28px] w-[28px] flex-none"
                />
                <span className="min-w-0 truncate font-semibold text-slate-700">{row.name}</span>
              </span>
              <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-100">
                <span
                  className="block h-full rounded-full transition-none"
                  style={{
                    width: `${row.score}%`,
                    backgroundColor: row.isPrior ? COLOR_PRIOR : COLOR_MEASURED,
                    opacity: row.isPrior ? 0.7 : 1,
                  }}
                />
              </span>
              {row.isPrior && (
                <span className="hidden shrink-0 text-[10px] font-medium text-slate-400 lg:inline">
                  {t('weatherBrain.priorNote')}
                </span>
              )}
              {/* data-testid — 계약이 **렌더된 칩 하나**를 집어 글자를 재기 위한 손잡이다.
                  `knowledge_level`이 null일 때 여기가 **빈칸이 되는 것**이 이 변경의
                  회귀 지점이라, 소스 grep이 아니라 실제 노드의 textContent를 물어야 한다. */}
              <span
                data-testid="ability-level-chip"
                className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${
                  LEVEL_CHIP[row.level_label] ?? 'bg-slate-100 text-slate-600'
                }`}
              >
                {row.levelKo}
              </span>
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
