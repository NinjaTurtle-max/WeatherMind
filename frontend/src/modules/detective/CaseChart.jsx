import { useEffect, useState } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  ReferenceLine,
} from 'recharts';
import { useT } from '../../i18n';

/**
 * 사건 시계열 차트 (R13 기후 탐정) — 이 모듈의 값은 여기에 있다.
 *
 * BriefingRoom(예보 대결)의 차트 원칙을 그대로 따른다: 축 라벨·단위 명시,
 * 툴팁 필수, 색+텍스트 병기, **이중 축 금지**. 케이스 2(바다를 건넌 눈)는
 * ℃ 2종 + cm 2종 = 4계열이라 한 차트에 담으면 이중 축이 된다 —
 * `series[].unit`으로 **묶어서 단위마다 차트를 하나씩** 그린다(하드코딩 아님:
 * 케이스가 새 단위를 저작하면 차트가 자동으로 하나 더 생긴다).
 *
 * 연 단서가 가리키는 시점(clue.x)은 세로 기준선으로 표시한다 — "조사한 것이
 * 자료 위에 쌓인다"가 눈에 보여야 조사가 절차가 아니라 행위가 된다.
 *
 * prefers-reduced-motion: 라인 그리기 애니메이션을 끈다(정적 최종 프레임).
 * 리듀스드 모션 훅은 board 모듈에서 끌어오지 않고 여기 5줄로 둔다 — 이 모듈이
 * 보드 파일에 의존하지 않아야 두 팀이 같은 워킹트리에서 부딪히지 않는다.
 */

// 색약 대응: 색만으로 계열을 구분하지 않는다 — 범례에 계열명이 항상 붙는다.
const SERIES_COLORS = ['#0284c7', '#f97316', '#16a34a', '#9333ea', '#dc2626'];

export function usePrefersReducedMotion() {
  const query = '(prefers-reduced-motion: reduce)';
  const [reduced, setReduced] = useState(
    () => globalThis.matchMedia?.(query)?.matches ?? false,
  );
  useEffect(() => {
    const mq = globalThis.matchMedia?.(query);
    if (!mq?.addEventListener) return undefined;
    const onChange = (event) => setReduced(event.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

/** 단위(unit)가 같은 계열끼리 묶는다 — 저작 순서를 보존한다. */
export function groupSeriesByUnit(series) {
  const groups = [];
  for (const s of series ?? []) {
    const unit = s.unit ?? '';
    let group = groups.find((g) => g.unit === unit);
    if (!group) {
      group = { unit, series: [] };
      groups.push(group);
    }
    group.series.push(s);
  }
  return groups;
}

/** 계열 묶음을 recharts 행으로 — x는 저작 순서(문자열 라벨)를 그대로 쓴다. */
export function toRows(group) {
  const xs = [];
  for (const s of group.series) {
    for (const p of s.points ?? []) {
      if (!xs.includes(p.x)) xs.push(p.x);
    }
  }
  return xs.map((x) => {
    const row = { x };
    for (const s of group.series) {
      const point = (s.points ?? []).find((p) => p.x === x);
      if (point) row[s.metric_id] = point.y;
    }
    return row;
  });
}

export default function CaseChart({ series = [], markers = [] }) {
  const t = useT();
  const reduced = usePrefersReducedMotion();
  const groups = groupSeriesByUnit(series);
  if (groups.length === 0) return null;

  return (
    <div className="space-y-4">
      {groups.map((group, gi) => {
        const rows = toRows(group);
        // 이 단위 묶음에 속한 계열을 가리키는 단서만 기준선으로 세운다.
        const metricIds = group.series.map((s) => s.metric_id);
        const groupMarkers = markers.filter(
          (m) => m.metric_id == null || metricIds.includes(m.metric_id),
        );
        const label = group.series.map((s) => s.metric_label).join(' / ');
        return (
          <figure key={group.unit || gi} className="rounded-2xl bg-white p-3 ring-1 ring-slate-200">
            <figcaption className="mb-1 flex items-baseline justify-between">
              <span className="text-[12.5px] font-bold text-slate-700">{label}</span>
              <span className="text-[11px] font-medium text-slate-500">{group.unit}</span>
            </figcaption>
            {/* 스크린리더용 텍스트 대체 — 차트는 aria-hidden이 아니라 라벨을 갖는다 */}
            <div
              className="h-[200px] w-full"
              role="img"
              aria-label={t('detective.play.chartAria', { label })}
            >
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 4, left: -18 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="x" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    stroke="#94a3b8"
                    domain={['auto', 'auto']}
                    unit={group.unit}
                  />
                  <Tooltip formatter={(value) => `${value}${group.unit}`} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {groupMarkers.map((marker) => (
                    <ReferenceLine
                      key={`${marker.clue_id}-${marker.x}`}
                      x={marker.x}
                      stroke="#f59e0b"
                      strokeDasharray="4 3"
                      label={{ value: '🔎', position: 'top', fontSize: 12 }}
                    />
                  ))}
                  {group.series.map((s, i) => (
                    <Line
                      key={s.metric_id}
                      type="monotone"
                      dataKey={s.metric_id}
                      name={s.metric_label}
                      stroke={SERIES_COLORS[(gi * 2 + i) % SERIES_COLORS.length]}
                      strokeWidth={2}
                      dot={{ r: 2.5 }}
                      isAnimationActive={!reduced}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </figure>
        );
      })}
    </div>
  );
}
