import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { curriculumApi, progressApi } from '../../api';
import LoadingSpinner from '../../components/LoadingSpinner';
import PcCurriculumPath from './PcCurriculumPath';
import CourseSwitcher, { useCourses } from './CourseSwitcher';
import LearnHeroCard from './LearnHeroCard';
import LearnFooterCards from './LearnFooterCards';
import { pickLearnEntry, pickSectionEntry } from './learnEntry';
import { useAttendance } from '../../hooks/useAttendance';
// R11-01 §6.2 마운트 통합 — props 없는 자급 계약(조건 미충족 시 자가 null).
// 복습 큐(ReviewQueueCard)는 2026-08-09부터 LearnFooterCards가 마운트한다.
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
  // 2026-08-18 — 캐릭터가 sun → grass, cloud → wind로 바뀌어 아이콘도 함께 옮겼다.
  // 짝이 어긋나면 같은 개념이 유닛 노드와 능력 분석에서 **다른 얼굴**로 보인다.
  radiation_budget: '🌿',
  pressure_basics: '💨',
  density_buoyancy: '🌈',
  phase_change: '💧',
  energy_transfer: '🌙',
  // 재난 축 2종 — 표에 없어 폴백('📘')으로 떨어져 있었다(2026-08-18에 발견).
  // 캐릭터는 진작 있었다(fire · raincloud).
  wildfire_weather: '🔥',
  flood_response: '🌊',
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
  /**
   * 배너가 **보고 있는 섹션**을 따라간다(2026-08-10 사용자 지시).
   *
   * 경로를 스크롤하면 PcCurriculumPath가 단계 번호를 올려 주고, 배너의 머리글·
   * 제목·CTA가 통째로 그 섹션 것으로 바뀐다. 제목만 바꾸면 "3섹션 제목 + 1섹션으로
   * 가는 버튼"이 되므로 **셋을 함께** 갈아야 한다(pickSectionEntry가 목적지까지 낸다).
   *
   * ⚠️ **진입 종류가 'unit'일 때만** 따라간다. 'daily'(오늘 몫이 남음)·'done'
   * (다 끝냄)은 §2.5의 **우선순위 메시지**라 스크롤로 덮으면 안 된다 — 전 유닛을
   * 깬 사람이 경로를 훑었다고 「오늘의 세션 풀기」가 사라지면 오늘 할 일이
   * 화면에서 없어진다.
   */
  // ⚠️ 초깃값은 **null**이다(0이 아니다. 2026-08-10 코드 리뷰).
   //  · 0으로 두면 트리가 도착한 첫 페인트에서 배너가 **1섹션**을 가리킨다 —
   //    정렬 effect가 현재 단계를 알려 주기 전 한 프레임 동안 제목뿐 아니라
   //    **CTA 목적지까지** 틀리다(이 파일이 119~122줄에서 막아 둔 그 깜빡임이다).
   //  · 더 나쁜 것은 모바일이다: PC 경로가 `hidden md:block`이라 clientHeight가
   //    0이고, 그래서 `syncViewed`가 **영영 안 뜬다**. 0으로 굳으면 3섹션을 풀고
   //    있는 사람의 폰 화면이 계속 1섹션의 이미 깬 유닛을 가리킨다.
  const [viewedIdx, setViewedIdx] = useState(null);
  const sectionsWithUnits = (data?.sections ?? []).filter((sec) => sec.units.length > 0);
  const viewedSection = viewedIdx == null ? null : (sectionsWithUnits[viewedIdx] ?? null);
  const followSection = entry.kind === 'unit' && viewedSection !== null;
  const bannerEntry = followSection ? pickSectionEntry(viewedSection) : entry;

  // 배너 머리글 — 시안대로 **어느 섹션의 몇 번째인지**를 말한다("섹션 1 · 하늘 읽기").
  // 따라가는 중이면 보고 있는 섹션, 아니면 진입 유닛이 속한 섹션이다.
  // 섹션을 모르면(트리 도착 전·유닛 없음) 종전 문구('학습 세션')로 떨어진다.
  const entrySectionIdx = followSection
    ? viewedIdx
    : bannerEntry.unit
      ? sectionsWithUnits.findIndex((sec) => sec.units.some((u) => u.id === bannerEntry.unit.id))
      : -1;
  const entrySection = entrySectionIdx >= 0 ? sectionsWithUnits[entrySectionIdx] : null;
  const ENTRY_COPY = {
    unit: {
      eyebrow: entrySection
        ? t('curriculum.path.sectionEyebrow', {
            n: entrySectionIdx + 1,
            title: entrySection.section,
          })
        : t('home.entry.learn'),
      title: bannerEntry.unit?.title ?? t('home.entry.learnEmpty'),
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
      {/* 게스트 진도 저장 배너는 **오른쪽 열로 옮겼다**(2026-08-12 클라이언트 지시).
          학습 화면 맨 위를 가로로 덮던 자리라, 첫 화면에서 학습 경로보다 먼저
          눈에 들어왔다. 같은 역할을 우측 여백의 저장 노드가 받는다.
          ⚠️ `GuestSaveBanner.jsx` 파일은 **남겨 둔다** — `guest-convert` 스모크
          2-a/2-b/2-c가 그 컴포넌트를 직접 마운트해 문구를 단정한다. 여기서는
          마운트만 걷는다. */}

      {/* 코스 탭(§6.2)은 **PC 경로 카드 안**으로 옮겼다(2026-08-13 클라이언트 지시
          — 아래 `<PcCurriculumPath tabs={...}>`). 모바일 목록에서는 여기 그대로
          남는다: 모바일에는 그 카드가 없다. */}
      <div className="md:hidden">
        <CourseSwitcher selected={selectedCourse} onSelect={setPickedCourse} />
      </div>

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


      {/* 2열(2026-08-10 사용자 지시) — 왼쪽 경로 · 오른쪽 세로 열.
          카드가 경로 **아래**가 아니라 **옆**에 서므로 트랙 높이를 안 뺏는다.
          노드 지름은 높이만 보므로(index.css `--dot`) 상한 86px에 붙는다 —
          카드가 아래 줄이던 배치에서는 68px이었다. 대신 트랙 **폭**을 나눠 쓴다.

          **2026-08-13(클라이언트 지시 ⑴): 가로로 눕던 진입 배너가 이 오른쪽 열로
          들어왔다.** 종전에는 배너가 폭 전체를 쓰는 한 줄로 경로 위에 있었고,
          위치 안내는 `Layout`이 본문 맨 위에 얹었다 — 화면 첫 두 줄이 통째로
          가로 띠였다. 둘 다 걷었으므로 **학습 경로가 세로를 그만큼 더 쓴다**
          (`PcCurriculumPath`는 읽기 전용이라 그쪽 상수는 손대지 않았다 — 트랙이
          받는 높이만 늘었다).

          ⚠️ **DOM 순서는 오른쪽 열이 먼저다.** 모바일에서는 `md:flex`가 꺼져
          DOM 순서대로 쌓이므로, 열이 뒤에 있으면 「이어서 풀기」가 경로 노드
          100여 개 **아래**로 밀린다 — 지금 할 일이 화면에서 사라지는 셈이다.
          PC에서는 `md:order-*`로 되돌려 왼쪽 경로 · 오른쪽 열을 유지한다. */}
      <div className="md:flex md:gap-3.5">
        {/* 오른쪽 열 — 진입 배너(위) · 나머지 노드(아래). DOM 첫째, 화면 둘째. */}
        <div className="mb-3.5 flex flex-col gap-3.5 md:order-2 md:mb-0 md:w-[248px] md:flex-none lg:w-[264px]">
          {/* 진입 배너. `hasPath`와 무관하게 뜬다: 빈 트리 코스에서도 통로가 필요하다. */}
          <LearnHeroCard
            entry={bannerEntry}
            copy={ENTRY_COPY[bannerEntry.kind]}
            lockedNote={bannerEntry.locked ? t('curriculum.unit.lockedTitle') : null}
            goalTotal={goalTotal}
            goalDone={goalDone}
            dailyBlocked={dailyBlocked}
            energyBlocked={energyBlocked}
            regenMin={regenMin}
          />
          <LearnFooterCards
            dailyBlocked={dailyBlocked}
            energyBlocked={energyBlocked}
            regenMin={regenMin}
            dailyIsPrimary={entry.kind === 'daily'}
          />
        </div>

        {/* 왼쪽 — 경로. min-w-0이 없으면 트랙 안의 긴 유닛명이 열을 밀어낸다. */}
        <div className="min-w-0 md:order-1 md:flex-1">
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
        tabs={
          <CourseSwitcher selected={selectedCourse} onSelect={setPickedCourse} variant="tab" />
        }
        sections={sections}
        energyBlocked={energyBlocked}
        regenMin={regenMin}
        onOpenUnit={(unitId) => navigate(`/learn/units/${unitId}`)}
        onViewSection={setViewedIdx}
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
