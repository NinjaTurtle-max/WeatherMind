import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  CartesianGrid,
  LabelList,
} from 'recharts';
import LoadingSpinner from '../../components/LoadingSpinner';
import { CHART_COLORS, SKY_META, PTY_META, fmtHour, fmtMonthDay } from './briefingDisplay';
import { useT } from '../../i18n';

/**
 * BriefingRoom (R9-01 §3.4) — 예보 브리핑 차트 묶음.
 * GET /duel/briefing 자료로 ① 시간별 기온 라인(+TMX/TMN 기준선) ② POP 바(+PCP
 * 라벨) ③ SKY/PTY 아이콘 타임라인 ④ 보조 REH/WSD ⑤ 최근 7일 실측 추이를 그린다.
 *
 * 차트 원칙: 축 라벨·단위·툴팁 필수, 색+텍스트 병기(색약 대응), 비율 축(%)은
 * 0~100 고정·바는 0 기준(과장 없는 스케일), 이중 축 금지 — PCP는 POP 바 위
 * 텍스트 라벨, 실측 기온·강수는 별도 미니 차트로 분리한다.
 *
 * degraded(§3.4): hourly가 비면 "실황 자료 수신 대기" 카드만 — 예측 입력은
 * 부모(DuelPage)가 그대로 노출한다. compact=true(LeaguePage 재사용 카드)는
 * 기온·POP·하늘 타임라인만 그린다.
 */
export default function BriefingRoom({ briefing, loading = false, error = false, compact = false }) {
  const t = useT();
  if (loading) {
    return (
      <Card>
        <BriefingHeader briefing={null} />
        <LoadingSpinner label={t('briefing.loading')} />
      </Card>
    );
  }

  if (error || !briefing) {
    return (
      <Card>
        <BriefingHeader briefing={null} />
        <WaitingNotice text={t('briefing.loadError')} />
      </Card>
    );
  }

  const hourly = Array.isArray(briefing.hourly) ? briefing.hourly : [];
  const recentDays = Array.isArray(briefing.recent_days) ? briefing.recent_days : [];

  // degraded 모드 (§3.4): KMA 키 부재·수집 실패 — 시계열이 비어 있다
  if (hourly.length === 0) {
    return (
      <Card>
        <BriefingHeader briefing={briefing} />
        <WaitingNotice text={t('briefing.waitingBody')} />
      </Card>
    );
  }

  const rows = hourly.map((h) => ({ ...h, hour: fmtHour(h.datetime, t) }));
  const temps = rows.map((r) => r.tmp).filter((v) => typeof v === 'number');
  const tmx = temps.length ? Math.max(...temps) : null;
  const tmn = temps.length ? Math.min(...temps) : null;

  return (
    <Card>
      <BriefingHeader briefing={briefing} />

      <SectionTitle color={CHART_COLORS.temp} title={t('briefing.tempTitle')} unit="℃" />
      <TempChart rows={rows} tmx={tmx} tmn={tmn} />

      <SectionTitle color={CHART_COLORS.pop} title={t('briefing.popTitle')} unit="%" />
      <PopChart rows={rows} />
      <p className="mb-1 mt-0.5 text-[11px] text-slate-500">
        <ColorChip color={CHART_COLORS.pop} />
        {t('briefing.popLegend1')}{' '}
        <ColorChip color={CHART_COLORS.rain} />
        {t('briefing.popLegend2')}
      </p>

      <SectionTitle title={t('briefing.skyTitle')} />
      <SkyTimeline rows={rows} />

      {!compact && (
        <>
          <SectionTitle title={t('briefing.auxTitle')} />
          <div className="grid grid-cols-2 gap-2">
            <MiniLineChart
              rows={rows}
              dataKey="reh"
              color={CHART_COLORS.pop}
              title={t('briefing.humidity')}
              unit="%"
              domain={[0, 100]}
            />
            <MiniLineChart
              rows={rows}
              dataKey="wsd"
              color={CHART_COLORS.wind}
              title={t('briefing.wind')}
              unit="m/s"
              domain={[0, (dataMax) => Math.ceil(dataMax + 1)]}
            />
          </div>

          {briefing.today_observed ? (
            <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 ring-1 ring-slate-200">
              {t('briefing.observed', {
                max: briefing.today_observed.max_ta,
                min: briefing.today_observed.min_ta,
                rain: briefing.today_observed.sum_rn,
              })}
            </p>
          ) : (
            <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-400 ring-1 ring-slate-200">
              {t('briefing.observedWaiting')}
            </p>
          )}

          {recentDays.length > 0 && (
            <>
              <SectionTitle title={t('briefing.recentTitle')} />
              <RecentDaysCharts recentDays={recentDays} />
            </>
          )}
        </>
      )}
    </Card>
  );
}

/* ── 조각들 ─────────────────────────────────────────────────────────────── */

function Card({ children }) {
  return <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">{children}</div>;
}

function BriefingHeader({ briefing }) {
  const t = useT();
  return (
    <div className="mb-2 flex items-baseline justify-between">
      <h2 className="text-base font-extrabold text-slate-900">{t('briefing.title')}</h2>
      <span className="text-xs text-slate-500">
        {briefing?.region ?? t('briefing.regionDefault')}
        {briefing?.target_date ? ` · ${briefing.target_date}` : ''}
      </span>
    </div>
  );
}

function WaitingNotice({ text }) {
  const t = useT();
  return (
    <div className="rounded-xl bg-slate-50 p-4 text-center ring-1 ring-slate-200">
      <p className="text-2xl" aria-hidden="true">
        📡
      </p>
      <p className="mt-1 text-sm font-bold text-slate-600">{t('briefing.waitingTitle')}</p>
      <p className="mt-1 text-xs leading-relaxed text-slate-500">{text}</p>
    </div>
  );
}

function SectionTitle({ color, title, unit }) {
  const t = useT();
  return (
    <p className="mb-1 mt-3 flex items-center gap-1.5 text-xs font-bold text-slate-700">
      {color && <ColorChip color={color} />}
      {title}
      {unit && <span className="font-medium text-slate-400">{t('briefing.unit', { unit })}</span>}
    </p>
  );
}

function ColorChip({ color }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-2 w-2 rounded-full align-middle"
      style={{ backgroundColor: color }}
    />
  );
}

/** 공용 툴팁 카드 — WeatherBrainPanel 관례(흰 카드·ring) 답습 */
function ChartTooltip({ active, payload, label, lines }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="rounded-xl bg-white px-3 py-2 text-xs shadow-md ring-1 ring-slate-200">
      <p className="font-bold text-slate-800">{label}</p>
      {lines(row).map((text) => (
        <p key={text} className="mt-0.5 text-slate-500">
          {text}
        </p>
      ))}
    </div>
  );
}

const AXIS_TICK = { fontSize: 11, fill: CHART_COLORS.tick };

/** ① 시간별 기온 라인 + TMX/TMN 기준선 */
function TempChart({ rows, tmx, tmn }) {
  const t = useT();
  const domain = [
    tmn != null ? Math.floor(tmn) - 2 : 'auto',
    tmx != null ? Math.ceil(tmx) + 2 : 'auto',
  ];
  return (
    <div style={{ width: '100%', height: 180 }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 14, right: 8, bottom: 0, left: -22 }}>
          <CartesianGrid stroke={CHART_COLORS.grid} vertical={false} />
          <XAxis dataKey="hour" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: CHART_COLORS.grid }} />
          <YAxis domain={domain} tick={AXIS_TICK} tickLine={false} axisLine={false} />
          <Tooltip
            content={<ChartTooltip lines={(r) => [t('briefing.tipTempHum', { tmp: r.tmp, reh: r.reh })]} />}
          />
          {tmx != null && (
            <ReferenceLine
              y={tmx}
              stroke={CHART_COLORS.reference}
              strokeDasharray="4 3"
              label={{ value: t('briefing.refMax', { v: tmx }), position: 'insideTopRight', fontSize: 10, fill: CHART_COLORS.tick }}
            />
          )}
          {tmn != null && (
            <ReferenceLine
              y={tmn}
              stroke={CHART_COLORS.reference}
              strokeDasharray="4 3"
              label={{ value: t('briefing.refMin', { v: tmn }), position: 'insideBottomRight', fontSize: 10, fill: CHART_COLORS.tick }}
            />
          )}
          <Line
            dataKey="tmp"
            stroke={CHART_COLORS.temp}
            strokeWidth={2}
            dot={{ r: 3, fill: CHART_COLORS.temp, strokeWidth: 0 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** POP 바 위 PCP(㎜) 텍스트 라벨 — 이중 축 대신 텍스트 병기 */
function PcpLabel({ x, y, width, value }) {
  if (!value) return null;
  return (
    <text
      x={x + width / 2}
      y={y - 4}
      textAnchor="middle"
      fontSize={10}
      fontWeight={700}
      fill={CHART_COLORS.rain}
    >
      {value}㎜
    </text>
  );
}

/** ② 강수확률 바(0~100 고정) + 예상 강수량 라벨 */
function PopChart({ rows }) {
  const t = useT();
  return (
    <div style={{ width: '100%', height: 150 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 14, right: 8, bottom: 0, left: -22 }} barCategoryGap={4}>
          <CartesianGrid stroke={CHART_COLORS.grid} vertical={false} />
          <XAxis dataKey="hour" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: CHART_COLORS.grid }} />
          <YAxis domain={[0, 100]} tick={AXIS_TICK} tickLine={false} axisLine={false} />
          <Tooltip
            cursor={{ fill: '#f1f5f9' }}
            content={
              <ChartTooltip
                lines={(r) => [
                  t('briefing.tipPop', { pop: r.pop }),
                  r.pcp > 0 ? t('briefing.tipPcp', { pcp: r.pcp }) : t('briefing.tipNoPcp'),
                ]}
              />
            }
          />
          <Bar dataKey="pop" fill={CHART_COLORS.pop} radius={[4, 4, 0, 0]} isAnimationActive={false}>
            <LabelList dataKey="pcp" content={<PcpLabel />} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** ③ SKY/PTY 아이콘 타임라인 — 아이콘+텍스트 병기(색약·이모지 톤 무관 판독) */
function SkyTimeline({ rows }) {
  const t = useT();
  return (
    <ul className="flex gap-1 overflow-x-auto pb-1">
      {rows.map((r) => {
        const sky = SKY_META[r.sky] ?? { labelKey: null, icon: '❔' };
        const pty = PTY_META[r.pty] ?? null;
        const labelKey = pty ? pty.labelKey : sky.labelKey;
        return (
          <li
            key={r.datetime}
            className="flex min-w-[52px] flex-1 flex-col items-center rounded-lg bg-slate-50 px-1 py-1.5 ring-1 ring-slate-100"
          >
            <span className="text-[10px] font-semibold text-slate-500">{r.hour}</span>
            <span className="text-lg leading-6" aria-hidden="true">
              {pty ? pty.icon : sky.icon}
            </span>
            <span className="text-[10px] font-medium text-slate-600">
              {labelKey ? t(labelKey) : '-'}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** ④ 보조 미니 라인 차트 (REH·WSD 등 — 지표당 1색 고정) */
function MiniLineChart({ rows, dataKey, color, title, unit, domain }) {
  return (
    <div className="rounded-xl bg-slate-50 p-2 ring-1 ring-slate-100">
      <p className="mb-0.5 flex items-center gap-1 text-[11px] font-bold text-slate-600">
        <ColorChip color={color} /> {title}
      </p>
      <div style={{ width: '100%', height: 96 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 4, right: 4, bottom: 0, left: -26 }}>
            {/* ⚠️ `interval`을 고정하지 않는다. 종전 `interval={1}`은 "2칸마다 하나"라
                데이터 길이와 무관하게 33건 중 17개를 밀어 넣었는데, 이 차트는 폭이
                절반(grid-cols-2)이라 라벨이 서로 겹쳤다. 큰 차트가 멀쩡했던 이유가
                바로 interval을 안 줘서 recharts가 폭에 맞춰 솎아냈기 때문이다.
                `minTickGap`으로 **픽셀 간격**을 요구하면 폭·건수가 바뀌어도 따라온다.
                (2026-08-10: 시각 라벨이 전부 "0시"로 찍히던 버그를 고치자 드러났다 —
                같은 글자였을 때는 겹쳐도 눈에 안 띄었다.) */}
            <XAxis
              dataKey="hour"
              tick={{ fontSize: 9, fill: CHART_COLORS.tick }}
              tickLine={false}
              axisLine={{ stroke: CHART_COLORS.grid }}
              minTickGap={18}
            />
            <YAxis domain={domain} tick={{ fontSize: 9, fill: CHART_COLORS.tick }} tickLine={false} axisLine={false} />
            <Tooltip content={<ChartTooltip lines={(r) => [`${title.split('(')[0]} ${r[dataKey]}${unit}`]} />} />
            <Line dataKey={dataKey} stroke={color} strokeWidth={2} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** ⑤ 최근 7일 실측 — 기온 라인·강수량 바(0 기준) 미니 차트 2장(이중 축 금지) */
function RecentDaysCharts({ recentDays }) {
  const t = useT();
  // 서버는 어제부터 역순(≤7) — 차트는 시간 순으로 뒤집어 그린다
  const rows = [...recentDays]
    .reverse()
    .map((d) => ({ ...d, day: fmtMonthDay(d.date) }));
  const temps = rows.map((r) => r.max_ta).filter((v) => typeof v === 'number');
  const tDomain = temps.length
    ? [Math.floor(Math.min(...temps)) - 2, Math.ceil(Math.max(...temps)) + 2]
    : ['auto', 'auto'];
  return (
    <div className="grid grid-cols-2 gap-2">
      <div className="rounded-xl bg-slate-50 p-2 ring-1 ring-slate-100">
        <p className="mb-0.5 flex items-center gap-1 text-[11px] font-bold text-slate-600">
          <ColorChip color={CHART_COLORS.temp} /> {t('briefing.recentTemp')}
        </p>
        <div style={{ width: '100%', height: 96 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows} margin={{ top: 4, right: 4, bottom: 0, left: -26 }}>
              <XAxis
                dataKey="day"
                tick={{ fontSize: 9, fill: CHART_COLORS.tick }}
                tickLine={false}
                axisLine={{ stroke: CHART_COLORS.grid }}
                interval={1}
              />
              <YAxis domain={tDomain} tick={{ fontSize: 9, fill: CHART_COLORS.tick }} tickLine={false} axisLine={false} />
              <Tooltip content={<ChartTooltip lines={(r) => [t('briefing.tipMaxTemp', { v: r.max_ta })]} />} />
              <Line
                dataKey="max_ta"
                stroke={CHART_COLORS.temp}
                strokeWidth={2}
                dot={{ r: 2.5, fill: CHART_COLORS.temp, strokeWidth: 0 }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="rounded-xl bg-slate-50 p-2 ring-1 ring-slate-100">
        <p className="mb-0.5 flex items-center gap-1 text-[11px] font-bold text-slate-600">
          <ColorChip color={CHART_COLORS.rain} /> {t('briefing.recentRain')}
        </p>
        <div style={{ width: '100%', height: 96 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} margin={{ top: 4, right: 4, bottom: 0, left: -26 }} barCategoryGap={3}>
              <XAxis
                dataKey="day"
                tick={{ fontSize: 9, fill: CHART_COLORS.tick }}
                tickLine={false}
                axisLine={{ stroke: CHART_COLORS.grid }}
                interval={1}
              />
              <YAxis
                domain={[0, (dataMax) => Math.max(5, Math.ceil(dataMax + 1))]}
                tick={{ fontSize: 9, fill: CHART_COLORS.tick }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                cursor={{ fill: '#f1f5f9' }}
                content={<ChartTooltip lines={(r) => [t('briefing.tipDayRain', { v: r.sum_rn })]} />}
              />
              <Bar dataKey="sum_rn" fill={CHART_COLORS.rain} radius={[3, 3, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
