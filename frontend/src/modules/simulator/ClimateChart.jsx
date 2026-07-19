import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

/**
 * ClimateChart (04번 스펙) — Recharts, 슬라이더 값에 따라 실시간 리렌더.
 * data: [{year, temp, rain}] — 클라이언트 사이드 계산 결과.
 */
export default function ClimateChart({ data }) {
  return (
    <div className="h-72 w-full rounded-2xl bg-white p-3 shadow-sm ring-1 ring-slate-200">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 12, right: 12, bottom: 4, left: -14 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="year" tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} />
          <YAxis
            yAxisId="temp"
            tick={{ fontSize: 11, fill: '#64748b' }}
            tickLine={false}
            unit="°C"
            domain={['auto', 'auto']}
          />
          <YAxis
            yAxisId="rain"
            orientation="right"
            tick={{ fontSize: 11, fill: '#64748b' }}
            tickLine={false}
            unit="%"
            hide
          />
          <Tooltip
            formatter={(value, name) =>
              name === '평균기온 편차' ? [`+${value}°C`, name] : [`${value}%`, name]
            }
            labelFormatter={(year) => `${year}년`}
            contentStyle={{ fontSize: 12, borderRadius: 12, border: '1px solid #e2e8f0' }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line
            yAxisId="temp"
            type="monotone"
            dataKey="temp"
            name="평균기온 편차"
            stroke="#0284c7"
            strokeWidth={2.5}
            dot={false}
            isAnimationActive={false}
          />
          <Line
            yAxisId="rain"
            type="monotone"
            dataKey="rain"
            name="강수량 변화율"
            stroke="#f59e0b"
            strokeWidth={2}
            strokeDasharray="6 3"
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
