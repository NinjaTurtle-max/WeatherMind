/**
 * VariableSlider (04번 스펙) — 시뮬레이터 변수 슬라이더
 */
export default function VariableSlider({ label, unit, min, max, step = 1, value, onChange, hint }) {
  return (
    <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-sm font-bold text-slate-800">{label}</span>
        <span className="text-lg font-extrabold text-sky-700">
          {value}
          <span className="ml-0.5 text-xs font-medium text-slate-500">{unit}</span>
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <div className="mt-1 flex justify-between text-xs text-slate-400">
        <span>
          {min}
          {unit}
        </span>
        <span>
          {max}
          {unit}
        </span>
      </div>
      {hint && <p className="mt-2 text-xs leading-relaxed text-slate-500">{hint}</p>}
    </div>
  );
}
