import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { curriculumApi, progressApi } from '../../api';
import { useAttendance } from '../../hooks/useAttendance';
import LoadingSpinner from '../../components/LoadingSpinner';

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

const CONCEPT_META = {
  pressure_front: { label: '기압과 전선', icon: '🌀' },
  typhoon: { label: '태풍', icon: '🌪️' },
  air_mass: { label: '기단', icon: '🧊' },
  heat_island: { label: '열섬 현상', icon: '🏙️' },
  co2_climate: { label: 'CO₂와 기후', icon: '🌡️' },
  anomaly: { label: '이상 기후', icon: '⚡' },
};

// 세로 경로의 좌우 지그재그 오프셋(%) — 섹션 내 유닛 순서로 순환
const ZIGZAG = [0, 16, 24, 16, 0, -16, -24, -16];

export default function CurriculumHome() {
  const navigate = useNavigate();
  useAttendance(true);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['curriculum'],
    queryFn: curriculumApi.fetchCurriculum,
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

  if (isLoading) return <LoadingSpinner label="학습 경로를 불러오고 있어요..." />;

  if (isError) {
    return (
      <div className="mt-16 rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-slate-200">
        <p className="text-3xl">🎓</p>
        <p className="mt-2 font-bold text-slate-800">학습 경로를 불러오지 못했어요</p>
        <p className="mt-1 text-sm text-slate-500">{error?.detail ?? '잠시 후 다시 시도해주세요.'}</p>
        <button type="button" onClick={() => refetch()} className="mt-4 rounded-xl bg-sky-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-sky-700">
          다시 시도
        </button>
      </div>
    );
  }

  const sections = data?.sections ?? [];

  return (
    <div className="pt-2">
      <h1 className="mb-1 text-lg font-extrabold text-slate-900">🎓 학습</h1>
      <p className="mb-4 text-sm text-slate-500">유닛을 순서대로 클리어하며 날씨 개념을 쌓아요.</p>

      {/* 구름 소진 안내 (§3.1) — 새 세션은 열 수 없지만 이유·회복 시점을 먼저 알린다 */}
      {energyBlocked && (
        <div className="mb-4 rounded-2xl bg-rose-50 p-4 ring-1 ring-rose-200">
          <p className="text-sm font-extrabold text-rose-700">☁️ 구름이 모두 흩어졌어요</p>
          <p className="mt-1 text-xs leading-relaxed text-rose-600">
            구름은 <span className="font-bold">틀린 문항에만 1개</span> 줄어들어요 — 열심히 푼
            만큼이 아니라 실수에만 소모돼요. 약 <span className="font-bold">{regenMin}분</span> 후
            구름 1개가 회복되면 새 세션을 열 수 있어요.
            {dailyBlocked ? '' : ' 오늘 시작한 세션은 지금도 끝까지 마칠 수 있어요.'}
          </p>
        </div>
      )}

      {sections.map((section) => (
        <section key={section.section} className="mb-8">
          <div className="mb-4 flex items-center gap-2">
            <span className="rounded-full bg-sky-600 px-3 py-1 text-xs font-extrabold text-white">
              {section.section}
            </span>
            <span className="text-xs font-medium text-slate-400">
              {section.units.filter((u) => u.cleared).length}/{section.units.length} 완료
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

      {/* 자유 일일 세션 별도 진입(§3.4 병존) */}
      <div className="mt-2 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <p className="text-sm font-bold text-slate-800">자유 일일 세션</p>
        <p className="mt-0.5 text-xs text-slate-500">정해진 경로 대신 오늘의 5문항을 바로 풀고 싶다면.</p>
        {dailyBlocked ? (
          <>
            <button
              type="button"
              disabled
              aria-disabled="true"
              className="mt-3 inline-block cursor-not-allowed rounded-xl bg-slate-200 px-4 py-2 text-sm font-bold text-slate-400"
            >
              오늘의 세션 풀기 →
            </button>
            <p className="mt-1.5 text-xs font-bold text-rose-600">
              ☁️ 구름 회복까지 약 {regenMin}분
            </p>
          </>
        ) : (
          <>
            <Link
              to="/daily"
              className="mt-3 inline-block rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white transition hover:bg-slate-700"
            >
              {energyBlocked ? '풀던 세션 이어서 풀기 →' : '오늘의 세션 풀기 →'}
            </Link>
            {energyBlocked && (
              <p className="mt-1.5 text-xs font-bold text-rose-600">
                ☁️ 구름 회복까지 약 {regenMin}분 — 오늘 시작한 세션은 끝까지 마칠 수 있어요.
              </p>
            )}
          </>
        )}
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
  const meta = CONCEPT_META[unit.concept_tag] ?? { label: unit.concept_tag, icon: '📘' };
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
          onClick={onOpen}
          disabled={locked || energyBlocked}
          aria-label={`${unit.title}${locked ? ' (잠김)' : energyBlocked ? ' (구름 부족)' : ''}`}
          title={
            locked
              ? '선행 유닛을 완료하면 열려요'
              : energyBlocked
                ? `구름이 회복되면 열 수 있어요 — 약 ${regenMin}분 후`
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
          {locked ? '🔒' : status === 'cleared' ? '👑' : meta.icon}
          {unit.kind === 'board' && !locked && (
            <span className="absolute -bottom-1 -right-1 rounded-full bg-white px-1 text-[10px] shadow ring-1 ring-slate-200" title="보드 퍼즐 유닛">
              🧩
            </span>
          )}
        </button>
        <p className={`mt-1.5 max-w-[8rem] text-center text-xs font-bold ${locked ? 'text-slate-400' : 'text-slate-700'}`}>
          {unit.title}
        </p>
        <p className="text-[10px] text-slate-400">{meta.label}</p>
        {openedByPlacement && (
          <p className="mt-0.5 rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-bold text-indigo-600">
            🧭 진단으로 열림
          </p>
        )}
      </div>
    </div>
  );
}
