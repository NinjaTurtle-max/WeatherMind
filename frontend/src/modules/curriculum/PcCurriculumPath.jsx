/**
 * PcCurriculumPath — 학습 홈의 PC(데스크톱, md↑) 전용 경로 뷰.
 * 모바일의 세로 지그재그(§CurriculumHome)와 별도로, 섹션 구분 없이 4열 스네이크로
 * 이어진 곡선 리본 경로 + 튜터 카드를 보여준다. 모바일 뷰는 그대로 유지.
 *
 * 레이아웃 계약: 경로 캔버스는 고정 px 폭을 갖지 않는다(가로 오버플로 방지).
 *   - 노드 x는 컨테이너 폭 대비 %, y는 px.
 *   - 연결선 SVG는 viewBox "0 0 100 H"(x=%, y=px) + preserveAspectRatio="none"으로
 *     컨테이너를 그대로 채우고, vector-effect="non-scaling-stroke"로 가로 스케일이
 *     달라져도 선 두께는 일정하게 유지한다.
 *   - 튜터 카드는 lg 미만에서 경로 아래로 쌓아 경로가 좁아지지 않게 한다.
 */

// 4열 스네이크의 열 중심 x(컨테이너 폭 대비 %)
const COL_PCT = [12.5, 37.5, 62.5, 87.5];
const ROW_START = 110;
const ROW_HEIGHT = 190;
const ROW_BOTTOM_PAD = 95; // 마지막 줄 라벨 칩(2~3줄)이 잘리지 않을 만큼만
const COLS_PER_ROW = 4;

const STATUS_ICON = { cleared: '👑', current: '🌀', unlocked: '🌀', locked: '🔒' };

const CONCEPT_LABEL = {
  pressure_front: '기압과 전선',
  typhoon: '태풍',
  air_mass: '기단',
  heat_island: '열섬 현상',
  co2_climate: 'CO₂와 기후',
  anomaly: '이상 기후',
};

const PAW_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72"><g fill="#E8A400" fill-opacity="0.16"><ellipse cx="36" cy="46" rx="13" ry="10.5"/><ellipse cx="20" cy="30" rx="5.6" ry="6.8"/><ellipse cx="34" cy="21" rx="6.2" ry="7.4"/><ellipse cx="49" cy="27" rx="5.8" ry="7"/></g></svg>';
const PAW_BG = `url("data:image/svg+xml,${encodeURIComponent(PAW_SVG)}")`;

function bezierPath(points) {
  if (points.length === 0) return '';
  let d = `M ${points[0].x},${points[0].y} `;
  for (let i = 0; i < points.length - 1; i++) {
    const { x: x0, y: y0 } = points[i];
    const { x: x1, y: y1 } = points[i + 1];
    const mx = x0 + (x1 - x0) / 2;
    d += `C ${mx},${y0} ${mx},${y1} ${x1},${y1} `;
  }
  return d.trim();
}

function resolveStatus(unit) {
  return unit.status ?? (unit.cleared ? 'cleared' : unit.locked ? 'locked' : 'current');
}

function badgeStyle(status) {
  if (status === 'cleared') {
    return {
      background: 'linear-gradient(160deg, #2F5C82, #0E2A42)',
      color: '#fff',
      boxShadow: '0 6px 14px -4px rgba(14,42,66,0.45)',
    };
  }
  if (status === 'locked') return { background: '#E7ECF3', color: '#AEB9C7' };
  const base = {
    background: 'radial-gradient(circle at 32% 28%, #FFF3C4, #FFD34D 72%)',
    color: '#4A3300',
  };
  // current만 강조 글로우 — unlocked(배치 θ 선해제)는 열려 있되 강조하지 않는다.
  return status === 'current'
    ? { ...base, boxShadow: '0 0 0 5px rgba(255,211,77,0.28), 0 8px 16px -4px rgba(240,175,18,0.5)' }
    : base;
}

export default function PcCurriculumPath({ sections, onOpenUnit }) {
  const flat = [];
  sections.forEach((section) => {
    section.units.forEach((unit, i) => {
      flat.push({ ...unit, sectionName: section.section, isSectionStart: i === 0 });
    });
  });

  if (flat.length === 0) return null;

  const nodes = flat.map((unit, index) => {
    const row = Math.floor(index / COLS_PER_ROW);
    const colInRow = index % COLS_PER_ROW;
    // 짝수 줄 좌→우, 홀수 줄 우→좌 (스네이크)
    const col = row % 2 === 0 ? colInRow : COLS_PER_ROW - 1 - colInRow;
    return { ...unit, x: COL_PCT[col], y: ROW_START + row * ROW_HEIGHT };
  });

  const rows = Math.ceil(nodes.length / COLS_PER_ROW);
  const canvasH = ROW_START + (rows - 1) * ROW_HEIGHT + ROW_BOTTOM_PAD;

  const fullPath = bezierPath(nodes);
  const doneSegments = [];
  nodes.forEach((n, i) => {
    if (resolveStatus(n) === 'cleared' && nodes[i + 1]) {
      doneSegments.push({ key: n.id, d: bezierPath([nodes[i], nodes[i + 1]]) });
    }
  });

  const currentUnit =
    nodes.find((n) => resolveStatus(n) === 'current') ??
    nodes.find((n) => resolveStatus(n) === 'unlocked');

  return (
    <div className="relative left-1/2 right-1/2 -mx-[50vw] hidden w-screen md:block">
      <div className="mx-auto max-w-6xl px-6 pb-6">
        <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div
            className="relative min-w-0 rounded-[26px] px-5 py-9"
            style={{ background: 'linear-gradient(180deg, #F3F8FE 0%, #FBF6FF 100%)' }}
          >
            <div className="relative w-full" style={{ height: canvasH }}>
              <svg
                className="absolute inset-0 h-full w-full"
                viewBox={`0 0 100 ${canvasH}`}
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <path
                  d={fullPath}
                  fill="none"
                  stroke="#E3ECF7"
                  strokeWidth="10"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
                {doneSegments.map((seg) => (
                  <path
                    key={seg.key}
                    d={seg.d}
                    fill="none"
                    stroke="#FFD34D"
                    strokeWidth="10"
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
              </svg>

              {nodes.map((n) => {
                const status = resolveStatus(n);
                const locked = status === 'locked';
                const isCurrent = status === 'current';
                // 배치 θ 선해제(R7-02 S4): 왕관 0인데 열려 있는 유닛 — 모바일 뷰와 동일 표기
                const openedByPlacement = status === 'unlocked' && (n.crowns ?? 0) === 0;
                return (
                  <div
                    key={n.id}
                    className="absolute flex w-[148px] -translate-x-1/2 -translate-y-1/2 flex-col items-center"
                    style={{ left: `${n.x}%`, top: n.y }}
                  >
                    {n.isSectionStart && (
                      // 현재 노드에는 썬더가 위에 서므로 섹션 라벨을 더 올려 겹침을 피한다.
                      <span
                        className={`absolute whitespace-nowrap rounded-full bg-[#0E2A42] px-[11px] py-1 text-[10.5px] font-extrabold text-white ${
                          isCurrent ? '-top-[80px]' : '-top-[38px]'
                        }`}
                      >
                        {n.sectionName}
                      </span>
                    )}
                    {isCurrent && (
                      <img
                        src="/기본자세.png"
                        alt=""
                        aria-hidden="true"
                        className="absolute -top-[34px] w-[68px] drop-shadow-md"
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => !locked && onOpenUnit(n.id)}
                      disabled={locked}
                      aria-label={`${n.title}${locked ? ' (잠김)' : ''}`}
                      title={locked ? '선행 유닛을 완료하면 열려요' : n.title}
                      className={`relative flex h-[68px] w-[68px] items-center justify-center rounded-full border-4 border-white text-[26px] transition ${
                        locked ? 'cursor-not-allowed' : 'hover:brightness-105 active:scale-95'
                      }`}
                      style={badgeStyle(status)}
                    >
                      {STATUS_ICON[status] ?? '🌀'}
                      {n.kind === 'board' && !locked && (
                        <span
                          className="absolute -bottom-1 -right-1 rounded-full bg-white px-1 text-[10px] shadow ring-1 ring-slate-200"
                          title="보드 퍼즐 유닛"
                        >
                          🧩
                        </span>
                      )}
                    </button>
                    <div className="mt-[9px] max-w-[148px] rounded-xl bg-white px-2.5 py-[5px] text-center shadow-[0_3px_8px_rgba(20,30,50,0.08)]">
                      <p
                        className={`text-xs font-extrabold leading-tight ${
                          locked ? 'text-slate-400' : 'text-slate-900'
                        }`}
                      >
                        {n.title}
                      </p>
                      <p className="mt-0.5 text-[10px] text-slate-400">
                        {CONCEPT_LABEL[n.concept_tag] ?? n.concept_tag}
                      </p>
                      {openedByPlacement && (
                        <p className="mt-1 rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-bold text-indigo-600">
                          🧭 진단으로 열림
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <TutorCard unit={currentUnit} />
        </div>
      </div>
    </div>
  );
}

function TutorCard({ unit }) {
  // 튜터 코멘트 내용(사전형 기상 용어 등)은 아직 미확정 — 지금은 자리표시 문구만.
  const greeting = unit
    ? `"${unit.title}" 유닛이네요 — 차근차근 같이 풀어봐요!`
    : '오늘도 하늘 읽으러 가볼까요?';

  return (
    <div
      // lg 미만에서는 경로 아래로 쌓이므로, 가로로 늘어져 허전해 보이지 않게 폭을 제한한다.
      className="relative mx-auto w-full max-w-md overflow-hidden rounded-2xl p-5 lg:max-w-none"
      style={{
        backgroundImage: `${PAW_BG}, linear-gradient(180deg, #FFF9EA 0%, #FFF3D6 55%, #ffffff 100%)`,
        backgroundRepeat: 'repeat, no-repeat',
        backgroundSize: '72px 72px, auto',
      }}
    >
      <span className="absolute left-4 top-3.5 rounded-full bg-[#0E2A42] px-2.5 py-1 text-[10.5px] font-extrabold text-white">
        ⚡ 튜터
      </span>
      <div className="mt-8 flex justify-center">
        <img src="/헤헤한팔.png" alt="" aria-hidden="true" className="w-[200px] drop-shadow-lg" />
      </div>
      <div className="relative mt-1 rounded-2xl bg-white p-3 shadow-md">
        <p className="mb-0.5 text-[11px] font-extrabold text-[#E8A400]">썬더</p>
        <p className="text-[13.5px] font-bold leading-snug text-slate-800">{greeting}</p>
      </div>
    </div>
  );
}
