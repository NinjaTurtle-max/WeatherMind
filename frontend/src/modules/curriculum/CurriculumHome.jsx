import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { curriculumApi, progressApi } from '../../api';
import LoadingSpinner from '../../components/LoadingSpinner';
import PcCurriculumPath from './PcCurriculumPath';
import CourseSwitcher, { useCourses } from './CourseSwitcher';
import LearnHeroCard from './LearnHeroCard';
import LearnFooterCards from './LearnFooterCards';
import { pickLearnEntry } from './learnEntry';
import { useAttendance } from '../../hooks/useAttendance';
// R11-01 §6.2 마운트 통합 — props 없는 자급 계약(조건 미충족 시 자가 null).
// 복습 큐(ReviewQueueCard)는 2026-08-09부터 LearnFooterCards가 마운트한다.
import GuestSaveBanner from '../../components/GuestSaveBanner';
import { conceptLabel, useT } from '../../i18n';

/**
 * CurriculumHome (R5-01 §3.2·S4) — 학습 홈(기본 진입 /).
 * GET /curriculum 트리를 단계형 유닛 경로(길)로 렌더한다:
 *   섹션별로 유닛 노드를 세로 지그재그 경로에 배치하고, 완료(👑)·현재·잠금(🔒)을 표시.
 * 유닛 탭 → /learn/units/{id}에서 POST 세션 발급 후 플레이한다.
 * 완료 시 다음 유닛이 즉시 열리도록(체류 유도) 유닛 세션 완료 후 ['curriculum']를 무효화한다.
 *
 * 출석 체크(스트릭)는 기본 진입인 이 화면에서 수행한다(자유 세션에서 이동).
 *
 * R10-01 §3.1 (에너지 정책 전환 — 프론트 절): 세션 발급은 잔량 0이면 서버가
 * 429 OUT_OF_CLOUDS로 차단한다(D6: /session/today 신규 발급 · 유닛 세션 발급).
 * 그러므로 **누르기 전에** 알린다 — 잔량 0이면 진입 CTA·유닛 노드를 비활성화하고
 * 회복 ETA를 인라인 표기한다(429를 받고 나서 알리는 흐름 폐지). 소모 규칙 자체는
 * "노력이 아니라 실수" — 틀린 문항에만 1 소모이며, 진행 중 세션은 끊기지 않는다.
 */

// 표시명은 concept.* 리소스(i18n) — 여기는 아이콘만 남긴다.
// 기초과학 6종은 2026-08-08 추가. 그 전에는 표에 없어 전부 폴백('📘')이라
// 기초과학 코스의 유닛 노드가 죄다 같은 책 아이콘이었다.
// 캐릭터 배정(conceptCharacter.js)과 짝을 맞춘다 — 밀도와 부력 🌈 · 열의 이동 🌙.
const CONCEPT_ICON = {
  // 날씨 코스(weather)
  pressure_front: '🌀',
  typhoon: '🌪️',
  air_mass: '🧊',
  heat_island: '🏙️',
  co2_climate: '🌡️',
  anomaly: '⚡',
  // 기초과학 코스(basic-science)
  temperature_heat: '🌡️',
  radiation_budget: '☀️',
  pressure_basics: '🎈',
  density_buoyancy: '🌈',
  phase_change: '💧',
  energy_transfer: '🌙',
};

// 세로 경로의 좌우 지그재그 오프셋(%) — 섹션 내 유닛 순서로 순환
const ZIGZAG = [0, 16, 24, 16, 0, -16, -24, -16];

// 빈 트리 코스의 섹션 예고(R11-01 §6.2 — specs/11 §2). 유닛이 시드되기 전까지
// "무엇이 올지"를 보여준다. basic-science 외 코스는 예고 없이 안내문만.
// 문구는 curriculum.preview.* 리소스(i18n) — 여기는 키·아이콘만.
const COURSE_SECTION_PREVIEW = {
  'basic-science': [
    { k: 'heatLight', icon: '☀️' },
    { k: 'airWeight', icon: '🎈' },
    { k: 'waterEnergy', icon: '💧' },
  ],
};

export default function CurriculumHome() {
  const navigate = useNavigate();
  const t = useT();
  // 출석 체크(스트릭)의 **소유자는 이 화면**이다(2026-08-09). 종전 소유자는 홈
  // (HomePage)이었는데 홈을 지우고 학습 하나로 합치면서 넘어왔다 — 넘기지 않으면
  // 출석 POST를 만드는 화면이 앱에서 사라져 스트릭이 영영 안 오른다.
  // useAttendance가 sessionStorage로 하루 1회를 보장하므로 세션 러너와 겹쳐도
  // POST가 두 번 가지는 않지만, 소유자는 하나여야 추적이 된다.
  useAttendance(true);

  // 코스 선택 (R11-01 §6.2) — 명시 선택 전에는 is_default 코스를 따른다.
  // 코스 목록이 없는 환경(구 백엔드·미시드 DB)에서는 courses=[] → treeCourse=null
  // → 쿼리 키·요청이 현행과 동일해 무회귀다.
  const courses = useCourses();
  const [pickedCourse, setPickedCourse] = useState(null);
  const defaultSlug = courses.find((c) => c.is_default)?.id ?? courses[0]?.id ?? null;
  const selectedCourse = pickedCourse ?? defaultSlug;
  // 기본 코스(weather)는 ?course= 없이 조회한다 — 쿼리 키 ['curriculum']이 기존과
  // 같아서 유닛 세션 완료 후 invalidateQueries(['curriculum'])도 그대로 맞는다.
  const treeCourse = selectedCourse && selectedCourse !== defaultSlug ? selectedCourse : null;

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: treeCourse ? ['curriculum', treeCourse] : ['curriculum'],
    queryFn: () => curriculumApi.fetchCurriculum(treeCourse ?? undefined),
    staleTime: 30_000,
  });

  // 구름 잔량 — 세션 발급 차단(§3.1·D6)을 누르기 전에 알리기 위한 조회.
  // CloudEnergyBadge와 같은 쿼리 키라 헤더와 같은 값을 본다(중복 요청 없음).
  const { data: energy } = useQuery({
    queryKey: ['progress', 'energy'],
    queryFn: progressApi.fetchEnergy,
    staleTime: 10_000,
  });
  const { data: me } = useQuery({
    queryKey: ['progress', 'me'],
    queryFn: progressApi.fetchMyProgress,
    staleTime: 30_000,
  });

  // 잔량 0 = **새 세션 발급**이 429로 막히는 상태(D6). 유닛 세션은 호출마다 새
  // 세션이므로 항상 막힌다 → 노드 비활성이 정확하다(D10-3).
  const energyBlocked = energy?.clouds === 0;
  // 데일리(/session/today)는 **이미 발급된 세션이면 잔량 0에서도 200 재조회**다
  // ("풀던 것을 뺏기지 않는다" 불변식). 그래서 데일리 CTA를 무조건 비활성하면
  // 진행 중 세션 재개를 막아 버린다 — 오늘 응답이 1건이라도 있으면(=오늘 세션이
  // 살아 있음) 비활성하지 않고 안내만 한다. 오늘 응답 0이면 새 발급이 필요하므로
  // 비활성이 서버 판정과 일치한다.
  const dailyBlocked = energyBlocked && (me?.today_answered_count ?? 0) === 0;
  const regenMin = Math.max(1, Math.ceil((energy?.next_regen_sec ?? 0) / 60));

  // 진입 카드(§2.5) — 홈에서 넘어왔다. 트리가 아직 안 왔을 때(undefined) 곧바로
  // pickLearnEntry를 태우면 units=[]라 "오늘 몫" 또는 "완료"로 튀었다가 도착 후
  // 유닛으로 바뀐다 — 첫 페인트에서 CTA 문구가 번쩍인다. 도착 전에는 유닛 자리를
  // 비워 둔 unit 종류로 고정한다(문구는 '첫 유닛부터 시작해요').
  const flatUnits = (data?.sections ?? []).flatMap((s) => s.units);
  const goalTotal = me?.daily_goal_items ?? null;
  const goalDone = me?.today_answered_count ?? 0;
  const entry =
    data === undefined
      ? { kind: 'unit', unit: null, to: '/learn' }
      : pickLearnEntry({ units: flatUnits, todayAnswered: goalDone, dailyGoal: goalTotal });
  // 배너 머리글 — 시안대로 **어느 섹션의 몇 번째인지**를 말한다("섹션 1 · 하늘 읽기").
  // 섹션을 모르면(트리 도착 전·유닛 없음) 종전 문구('학습 세션')로 떨어진다.
  const entrySectionIdx = entry.unit
    ? (data?.sections ?? []).findIndex((s) => s.units.some((u) => u.id === entry.unit.id))
    : -1;
  const entrySection = entrySectionIdx >= 0 ? data.sections[entrySectionIdx] : null;
  const ENTRY_COPY = {
    unit: {
      eyebrow: entrySection
        ? t('curriculum.path.sectionEyebrow', {
            n: entrySectionIdx + 1,
            title: entrySection.section,
          })
        : t('home.entry.learn'),
      title: entry.unit?.title ?? t('home.entry.learnEmpty'),
      cta: t('home.entry.learnGo'),
    },
    daily: {
      eyebrow: t('home.entry.todayLabel'),
      title: t('curriculum.daily.title'),
      cta: t('curriculum.daily.cta'),
    },
    done: {
      eyebrow: t('home.entry.todayLabel'),
      title: t('home.entry.doneTitle'),
      cta: t('home.entry.doneCta'),
    },
  };

  if (isLoading) return <LoadingSpinner label={t('curriculum.loading')} />;

  if (isError) {
    return (
      <div className="mt-16 rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-slate-200">
        <p className="text-3xl">🎓</p>
        <p className="mt-2 font-bold text-slate-800">{t('curriculum.loadFailed')}</p>
        <p className="mt-1 text-sm text-slate-500">{error?.detail ?? t('common.retryLater')}</p>
        <button type="button" onClick={() => refetch()} className="mt-4 rounded-xl bg-sky-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-sky-700">
          {t('common.retry')}
        </button>
      </div>
    );
  }

  const sections = data?.sections ?? [];
  // 유닛이 하나도 없다 = 트리 설계만 착지했거나(basic-science 초기) **시드가 실패한**
  // 상태다. CO-S-8: 이 안내가 `treeCourse != null`(비기본 코스)에만 걸려 있어서
  // 기본 코스(weather)에서는 영원히 false였다 — 유닛 0건이면 제목·부제와 자유세션
  // 카드만 남아 **백지로 보이고, 시드 실패인지 정상인지 구분이 안 됐다.**
  // CO-J-7(`seed_courses` 누락)·J-15(빈 볼륨)가 나면 플래그십 화면이 그 꼴이 된다.
  // 코스 종류와 무관하게 "유닛이 0건이면 알린다"가 맞다(섹션 예고는 여전히
  // basic-science에만 있다 — COURSE_SECTION_PREVIEW).
  // PC 경로 뷰가 실제로 그려지는가 — PcCurriculumPath의 렌더 조건과 같은 식이다
  // (유닛이 하나도 없으면 null). 우측 레일이 그 안에 있어 여기 분기가 필요하다.
  const hasPath = sections.some((s) => s.units.length > 0);
  // 섹션이 있어도 그 안에 유닛이 0건이면 화면은 똑같이 비어 있다 — 경로가 안
  // 그려지는 조건(hasPath)과 안내가 뜨는 조건을 **같은 식**으로 묶는다.
  const emptyCourseTree = !hasPath;
  const sectionPreview = COURSE_SECTION_PREVIEW[selectedCourse] ?? null;

  return (
    <div className="pt-2">
      {/* 게스트 진도 저장 배너(§6.2 FE-B) — 게스트+진도 있음에만 자가 렌더 */}
      <GuestSaveBanner />

      {/* 코스 탭(§6.2) — 코스가 2개 이상일 때만 뜬다. 선택은 잠금이 아니라 조회 스코프. */}
      <CourseSwitcher selected={selectedCourse} onSelect={setPickedCourse} />

      {/* 페이지 머리말(🎓 학습 + 설명)은 **없앴다**(2026-08-09 사용자 지시).
          같은 설명을 진입 배너가 부제로 말한다 — 두 벌이면 세로만 66px 먹는다.
          문구의 소유자는 `curriculum.subtitle`이다(LearnHeroCard가 읽는다). */}


      {/* 구름 소진 안내 (§3.1) — 새 세션은 열 수 없지만 이유·회복 시점을 먼저 알린다 */}
      {energyBlocked && (
        <div className="mb-4 rounded-2xl bg-rose-50 p-4 ring-1 ring-rose-200">
          <p className="text-sm font-extrabold text-rose-700">{t('curriculum.energyEmpty.title')}</p>
          <p className="mt-1 text-xs leading-relaxed text-rose-600">
            {t('curriculum.energyEmpty.seg1')}
            <span className="font-bold">{t('curriculum.energyEmpty.strong1')}</span>
            {t('curriculum.energyEmpty.seg2')}
            <span className="font-bold">{t('curriculum.energyEmpty.strong2', { min: regenMin })}</span>
            {t('curriculum.energyEmpty.seg3')}
            {dailyBlocked ? '' : t('curriculum.energyEmpty.seg4')}
          </p>
        </div>
      )}

      {/* 빈 트리 코스 안내(§6.2) — 잠금·오류가 아니라 "준비 중"임을 밝힌다 */}
      {emptyCourseTree && (
        <div className="rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-slate-200">
          <p className="text-3xl">🧪</p>
          <p className="mt-2 font-bold text-slate-800">{t('curriculum.emptyCourse.title')}</p>
          <p className="mt-1 text-sm text-slate-500">{t('curriculum.emptyCourse.body')}</p>
          {sectionPreview && (
            <ul className="mx-auto mt-4 flex max-w-md flex-col gap-2 text-left">
              {sectionPreview.map((s, i) => (
                <li
                  key={s.k}
                  className="flex items-center gap-3 rounded-xl bg-slate-50 px-4 py-3 ring-1 ring-slate-100"
                >
                  <span className="text-xl">{s.icon}</span>
                  <div>
                    <p className="text-sm font-bold text-slate-700">
                      {t('curriculum.emptyCourse.section', {
                        n: i + 1,
                        title: t(`curriculum.preview.${s.k}.title`),
                      })}
                    </p>
                    <p className="text-xs text-slate-400">{t(`curriculum.preview.${s.k}.subtitle`)}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}


      {/* 3열 배치(2026-08-10 사용자 지시) — 왼쪽 진입 카드 · 가운데 경로 ·
          오른쪽 카드 2장. 세로 배너를 위에 두던 시절과 비교하면 **트랙 높이를
          한 픽셀도 안 뺏는 대신 폭을 나눠 쓴다**. 노드 지름은 높이만 보므로
          (index.css `--dot`) 이 교환은 노드에 유리하다.
          모바일에서는 flex가 꺼져 DOM 순서대로 쌓인다 — 진입 카드 → 경로 →
          오른쪽 카드들. PC 경로는 `hidden md:block`이라 모바일에서는 그 자리에
          모바일 지그재그가 대신 선다.
          `items-stretch`(flex 기본)로 두어 양옆 카드가 트랙 높이만큼 늘어난다. */}
      <div className="md:flex md:gap-3.5">
        {/* 왼쪽 — 진입 카드. `hasPath`와 무관하게 뜬다: 빈 트리 코스에서도
            「오늘의 세션」으로 갈 통로가 필요하다. */}
        <div className="mb-3.5 md:mb-0 md:w-[236px] md:flex-none lg:w-[252px]">
          <LearnHeroCard
            entry={entry}
            copy={ENTRY_COPY[entry.kind]}
            goalTotal={goalTotal}
            goalDone={goalDone}
            dailyBlocked={dailyBlocked}
            energyBlocked={energyBlocked}
            regenMin={regenMin}
          />
        </div>

        {/* 가운데 — 경로. min-w-0이 없으면 트랙 안의 긴 유닛명이 열을 밀어낸다. */}
        <div className="min-w-0 md:flex-1">
      {/* 모바일: 세로 지그재그 경로(기존 유지) */}
      <div className="md:hidden">
        {sections.map((section) => (
          <section key={section.section} className="mb-8">
            <div className="mb-4 flex items-center gap-2">
              <span className="rounded-full bg-sky-600 px-3 py-1 text-xs font-extrabold text-white">
                {section.section}
              </span>
              <span className="text-xs font-medium text-slate-400">
                {t('curriculum.sectionDone', {
                  cleared: section.units.filter((u) => u.cleared).length,
                  total: section.units.length,
                })}
              </span>
              <div className="h-px flex-1 bg-slate-200" />
            </div>

            <div className="flex flex-col items-center gap-1">
              {section.units.map((unit, i) => (
                <UnitNode
                  key={unit.id}
                  unit={unit}
                  offset={ZIGZAG[i % ZIGZAG.length]}
                  isFirst={i === 0}
                  energyBlocked={energyBlocked}
                  regenMin={regenMin}
                  onOpen={() => navigate(`/learn/units/${unit.id}`)}
                />
              ))}
            </div>
          </section>
        ))}
      </div>

      {/* PC(md↑) 경로. `energyBlocked`를 반드시 넘긴다 — 넘기지 않으면 구름 0에서
          모바일은 잠기고 PC는 열려, 문항 진입 전 차단(R10-01 S4)이 PC에서만 깨진다. */}
      <PcCurriculumPath
        sections={sections}
        energyBlocked={energyBlocked}
        regenMin={regenMin}
        onOpenUnit={(unitId) => navigate(`/learn/units/${unitId}`)}
      />
        </div>

        {/* 오른쪽 — 자유 일일 세션(위) · 복습(아래) */}
        <div className="mt-3.5 md:mt-0 md:w-[248px] md:flex-none lg:w-[264px]">
          <LearnFooterCards
            dailyBlocked={dailyBlocked}
            energyBlocked={energyBlocked}
            regenMin={regenMin}
            dailyIsPrimary={entry.kind === 'daily'}
          />
        </div>
      </div>
    </div>
  );
}

// status 4종(R7-02 S4 백엔드 파생 필드): 🔒 locked · current 강조 링(맥동) ·
// unlocked(열림, 강조 없음 — 배치 θ 선해제 포함) · cleared 👑.
const RING_BY_STATUS = {
  cleared: 'bg-amber-400 text-white ring-amber-200',
  current: 'bg-sky-500 text-white ring-sky-200 animate-pulse-ring',
  unlocked: 'bg-sky-400 text-white ring-sky-100',
  locked: 'bg-slate-200 text-slate-400 ring-slate-100',
};

function UnitNode({ unit, offset, isFirst, onOpen, energyBlocked = false, regenMin = 1 }) {
  const t = useT();
  const icon = CONCEPT_ICON[unit.concept_tag] ?? '📘';
  const label = conceptLabel(t, unit.concept_tag);
  // 서버 status 우선 — 부재 시(구 백엔드) 기존 cleared/locked로 파생(하위 호환)
  const status = unit.status ?? (unit.cleared ? 'cleared' : unit.locked ? 'locked' : 'current');
  const locked = status === 'locked';
  // 배치 θ 선해제(R7-02 S4): 왕관 0인데 열려 있는 유닛 — 진단으로 열렸음을 표기
  const openedByPlacement = status === 'unlocked' && (unit.crowns ?? 0) === 0;

  return (
    <div className="flex w-full flex-col items-center">
      {!isFirst && <div className={`h-6 w-1 rounded-full ${locked ? 'bg-slate-200' : 'bg-sky-200'}`} />}
      <div style={{ transform: `translateX(${offset}%)` }} className="flex flex-col items-center">
        <button
          type="button"
          data-wm-unit
          onClick={onOpen}
          disabled={locked || energyBlocked}
          aria-label={`${unit.title}${
            locked ? t('curriculum.unit.lockedSuffix') : energyBlocked ? t('curriculum.unit.energySuffix') : ''
          }`}
          title={
            locked
              ? t('curriculum.unit.lockedTitle')
              : energyBlocked
                ? t('curriculum.unit.energyTitle', { min: regenMin })
                : unit.title
          }
          className={`relative flex h-16 w-16 items-center justify-center rounded-full text-2xl shadow-md ring-4 transition ${
            RING_BY_STATUS[status] ?? RING_BY_STATUS.current
          } ${
            locked || energyBlocked
              ? 'cursor-not-allowed'
              : 'hover:brightness-105 active:scale-95'
          } ${!locked && energyBlocked ? 'opacity-60' : ''}`}
        >
          {locked ? '🔒' : status === 'cleared' ? '👑' : icon}
          {unit.kind === 'board' && !locked && (
            <span className="absolute -bottom-1 -right-1 rounded-full bg-white px-1 text-[10px] shadow ring-1 ring-slate-200" title={t('curriculum.unit.boardChip')}>
              🧩
            </span>
          )}
        </button>
        <p className={`mt-1.5 max-w-[8rem] text-center text-xs font-bold ${locked ? 'text-slate-400' : 'text-slate-700'}`}>
          {unit.title}
        </p>
        <p className="text-[10px] text-slate-400">{label}</p>
        {openedByPlacement && (
          <p className="mt-0.5 rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-bold text-indigo-600">
            {t('curriculum.unit.placementOpened')}
          </p>
        )}
      </div>
    </div>
  );
}
