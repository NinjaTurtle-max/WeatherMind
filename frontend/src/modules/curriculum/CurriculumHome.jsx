import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { curriculumApi, progressApi } from '../../api';
import LoadingSpinner from '../../components/LoadingSpinner';
import PcCurriculumPath from './PcCurriculumPath';
import CourseSwitcher, { useCourses } from './CourseSwitcher';
// R11-01 §6.2 마운트 통합 — 둘 다 props 없는 자급 계약(조건 미충족 시 자가 null).
import ReviewQueueCard from '../../components/ReviewQueueCard';
import GuestSaveBanner from '../../components/GuestSaveBanner';
// R12 선행 §8 — 지역 칩(자급 컴포넌트, 제작 FE-R): 세션 실황 슬롯이 이 지역을 탄다.
import RegionPicker from '../../components/RegionPicker';
import { conceptLabel, useT } from '../../i18n';

/**
 * CurriculumHome (R5-01 §3.2·S4) — 학습 홈(기본 진입 /).
 * GET /curriculum 트리를 듀오링고식 유닛 경로(길)로 렌더한다:
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
const CONCEPT_ICON = {
  pressure_front: '🌀',
  typhoon: '🌪️',
  air_mass: '🧊',
  heat_island: '🏙️',
  co2_climate: '🌡️',
  anomaly: '⚡',
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
  // 출석 체크(스트릭)는 기본 진입인 홈(HomePage)이 맡는다. useAttendance가
  // sessionStorage로 하루 1회를 이미 보장하므로 두 곳에서 불러도 POST가 두 번
  // 가지는 않지만, 호출 지점이 둘이면 "어느 화면이 출석을 만드나"가 흐려진다.

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

      <h1 className="mb-1 text-lg font-extrabold text-slate-900 md:hidden">{t('curriculum.title')}</h1>
      <p className="mb-4 text-sm text-slate-500 md:hidden">{t('curriculum.subtitle')}</p>

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

      {/* PC(md↑): 4열 스네이크 곡선 경로 + 튜터 카드 */}
      {/* PC(md↑): 4열 스네이크 곡선 경로 + 튜터 카드.
          `energyBlocked`를 반드시 넘긴다 — 넘기지 않으면 구름 0에서 모바일은 잠기고
          PC는 열려, 문항 진입 전 차단(R10-01 S4)이 PC에서만 깨진다. */}
      <PcCurriculumPath
        sections={sections}
        energyBlocked={energyBlocked}
        regenMin={regenMin}
        onOpenUnit={(unitId) => navigate(`/learn/units/${unitId}`)}
        rail={
          <>
            <ReviewQueueCard />
            <DailySessionCard
              energyBlocked={energyBlocked}
              dailyBlocked={dailyBlocked}
              regenMin={regenMin}
            />
          </>
        }
      />

      {/* 모바일(md 미만) — 사이드 레일이 없으므로 경로 아래에 쌓는다.
          PC 경로 뷰는 hidden md:block이라 둘 중 하나만 보인다(기존 관례).
          단 **경로 자체가 없으면**(빈 트리 코스) PC에도 레일이 안 뜬다
          — PcCurriculumPath가 통째로 null을 돌려주기 때문이다. 그때는 여기서
          PC에도 보여준다(자유 세션 진입로가 사라지면 안 된다). */}
      <div className={hasPath ? 'flex flex-col gap-3 md:hidden' : 'flex max-w-sm flex-col gap-3'}>
        <ReviewQueueCard />
        <DailySessionCard
          energyBlocked={energyBlocked}
          dailyBlocked={dailyBlocked}
          regenMin={regenMin}
        />
      </div>

    </div>
  );
}

/**
 * 자유 일일 세션 카드 (§3.4 병존) — 정해진 경로 대신 오늘의 5문항.
 * PC는 우측 레일(튜터 아래), 모바일은 경로 아래에 놓인다. 두 자리가 같은 것을
 * 보여야 하므로 컴포넌트로 뽑아 한 곳에서 정의한다.
 */
function DailySessionCard({ energyBlocked, dailyBlocked, regenMin }) {
  const t = useT();
  return (
    <div className="flex min-h-[212px] flex-col rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[14px] font-extrabold text-slate-800">{t('curriculum.daily.title')}</p>
        {/* 지역 칩(R12 선행 §8) — 실황 문항이 어느 지역 날씨인지 세션 진입 전에 보여준다 */}
        <RegionPicker />
      </div>
      <p className="mt-1.5 text-[12px] leading-relaxed text-slate-500">{t('curriculum.daily.body')}</p>
      {dailyBlocked ? (
        <>
          <button
            type="button"
            disabled
            aria-disabled="true"
            className="mt-auto inline-block cursor-not-allowed self-start rounded-xl bg-slate-200 px-4 py-2 text-[12.5px] font-bold text-slate-400"
          >
            {t('curriculum.daily.cta')}
          </button>
          <p className="mt-1 text-[11px] font-bold text-rose-600">
            {t('curriculum.daily.regen', { min: regenMin })}
          </p>
        </>
      ) : (
        <>
          <Link
            to="/daily"
            className="mt-auto inline-block self-start rounded-xl bg-slate-900 px-4 py-2 text-[12.5px] font-bold text-white transition hover:bg-slate-700"
          >
            {energyBlocked ? t('curriculum.daily.resume') : t('curriculum.daily.cta')}
          </Link>
          {energyBlocked && (
            <p className="mt-1 text-[11px] font-bold text-rose-600">
              {t('curriculum.daily.regenResume', { min: regenMin })}
            </p>
          )}
        </>
      )}
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
