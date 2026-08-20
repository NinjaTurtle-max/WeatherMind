import { useEffect, useMemo, useRef, useState } from 'react';
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
  /*
   * 파생값은 `series`에만 매달린다 — `toRows`가 행마다 `find`를 도는 O(n²)라
   * 단서를 열 때마다 다시 돌 이유가 없다.
   *
   * ⚠️ **이것은 아래 「다시 그려짐」의 해결책이 아니다.** 처음에 그렇게 믿고
   *    이 memo만 넣었다가 실측으로 아무것도 안 바뀐 것을 확인했다 — 다음 사람이
   *    같은 데서 시작하지 않도록 남긴다. 진짜 이유는 아래 `introDone` 주석에 있다.
   * ⚠️ `series`는 react-query 캐시 객체라 같은 사건을 보는 동안 참조가 고정이다.
   *    호출부에서 매 렌더 새로 만들어 넘기면 이 memo는 통째로 무의미해진다.
   */
  const charts = useMemo(
    () => groupSeriesByUnit(series).map((group, gi) => ({
      key: group.unit || gi,
      gi,
      unit: group.unit,
      series: group.series,
      rows: toRows(group),
      metricIds: group.series.map((s) => s.metric_id),
      label: group.series.map((s) => s.metric_label).join(' / '),
    })),
    [series],
  );
  /*
   * 🔴 **선 그리기는 「처음 볼 때」 한 번이다**(2026-08-20 사용자 지적 — "단서
   * 누를 때마다 왼쪽에 그래프가 다시 그려지지?").
   *
   * 단서를 열면 기준선(`ReferenceLine`)이 하나 늘어 이 차트의 **children이
   * 바뀐다** — 거기까지는 그래야 한다. 문제는 recharts가 그때 무엇을 하느냐다:
   *   ⑴ `generateCategoricalChart`가 `isChildrenEqual`로 children을 비교해
   *      다르면 축 맵을 통째로 다시 계산한다 → `Line.points`가 **새 배열**이 된다
   *   ⑵ `Line.getDerivedStateFromProps`는 그때 `curPoints`만 갱신하고
   *      **`prevPoints`는 그대로 둔다**(그쪽은 `animationId`가 바뀔 때만 채워진다)
   *   ⑶ 그런데 `data`를 넘긴 차트는 children이 바뀌어도 `updateId`를 **안 올린다**
   *      → `animationId`가 영영 그대로 → `prevPoints`가 **끝까지 undefined**
   *   ⑷ 그리기 조건이 `!prevPoints && totalLength > 0`이라 **매번 참**이 된다
   * 그래서 데이터를 memo해도 소용이 없었다(실측으로 확인 — 위 memo 주석).
   * 참조가 아니라 **children**이 방아쇠이고, 기준선을 늘리는 것이 이 화면의
   * 목적 자체다. 고칠 자리는 「무엇을 memo하나」가 아니라 「언제 그리나」다.
   *
   * 🔴 **`onAnimationEnd`로 끄려던 첫 시도는 도입부 연출까지 죽였다.** 그 콜백은
   *    선이 실제로 그려졌을 때만 오는 것이 아니다 — recharts는 첫 렌더에서
   *    `totalLength`가 아직 0이라 **정적 곡선**을 그리면서도 콜백을 부른다.
   *    그래서 진짜 그리기가 시작되기 **전에** 플래그가 서서, 마운트 애니메이션이
   *    한 번도 안 돌았다(실측: 도입부 프레임 168개 전부 같은 값 ↔ 원본 66종).
   *    「애니메이션이 끝났나」가 아니라 **「사용자가 조사를 시작했나」**를 봐야 한다.
   *
   * 그래서 래치는 `markers`가 잡는다. 렌더 중에 세우는 것이 핵심이다 — `useEffect`로
   * 미루면 **첫 단서 한 번은 그대로 다시 그려진다**(플래그가 그 렌더 뒤에 선다).
   * 같은 입력에 같은 결과라 다시 렌더해도 값이 흔들리지 않는다.
   * ⚠️ 단서를 도로 닫아 `markers`가 0으로 돌아가도 **되살아나지 않는다**. ref라
   *    한 번 서면 그만이고, 그래야 열고 닫기를 반복할 때 화면이 안 튄다.
   */
  const introDone = useRef(false);
  if (markers.length > 0) introDone.current = true;
  const animate = !reduced && !introDone.current;
  if (charts.length === 0) return null;

  return (
    <div className="space-y-4">
      {charts.map((group) => {
        const { gi, rows, metricIds, label } = group;
        // 이 단위 묶음에 속한 계열을 가리키는 단서만 기준선으로 세운다.
        const groupMarkers = markers.filter(
          (m) => m.metric_id == null || metricIds.includes(m.metric_id),
        );
        return (
          <figure key={group.key} className="rounded-2xl bg-white p-3 ring-1 ring-slate-200">
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
                      // 🔴 **붉은 실과 같은 색**(2026-08-19). 단서 메모의 「차트
                      // 어느 지점」 줄이 같은 `#B8443C`라, 두 곳이 한 가닥으로
                      // 읽힌다 — 종전 amber는 「가상 자료 고지」 배지와 같은 색이라
                      // 기준선이 경고처럼 보였다.
                      stroke="#B8443C"
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
                      isAnimationActive={animate}
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
