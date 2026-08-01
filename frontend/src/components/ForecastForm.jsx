import { useState } from 'react';

const FIELD_CLASS =
  'mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-200';

/**
 * ForecastForm — 숫자 예측 입력 폼 (리그 주간 예측 04번 스펙 · 예보 대결 R4-01 §3.4 공용).
 *
 * fields: [{name, label, step?, min?, max?}] — 입력 순서대로 그리드 렌더.
 * 공통 검증: 숫자 여부, rain_prob 0~100. 그 외 규칙은 validate(values)로 주입
 * (에러 문자열 반환 시 표시, null이면 통과).
 */
export default function ForecastForm({
  title,
  description,
  notice,
  fields,
  submitLabel,
  validate,
  onSubmit,
  submitting,
}) {
  const [form, setForm] = useState(
    Object.fromEntries(fields.map((f) => [f.name, '']))
  );
  const [errorMsg, setErrorMsg] = useState(null);

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const handleSubmit = (e) => {
    e.preventDefault();
    const values = Object.fromEntries(
      fields.map((f) => [f.name, Number(form[f.name])])
    );
    if (Object.values(values).some(Number.isNaN)) {
      setErrorMsg('모든 값을 숫자로 입력해주세요.');
      return;
    }
    if ('rain_prob' in values && (values.rain_prob < 0 || values.rain_prob > 100)) {
      setErrorMsg('강수확률은 0~100 사이여야 해요.');
      return;
    }
    const customError = validate?.(values);
    if (customError) {
      setErrorMsg(customError);
      return;
    }
    setErrorMsg(null);
    onSubmit(values);
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200"
    >
      <h2 className={`${description ? 'mb-1' : 'mb-3'} text-base font-extrabold text-slate-900`}>
        {title}
      </h2>
      {description && <p className="mb-3 text-xs text-slate-500">{description}</p>}

      {notice && (
        <p className="mb-3 rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-700">{notice}</p>
      )}

      <div className={`grid gap-2 ${fields.length === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
        {fields.map((f) => (
          <label key={f.name} className="text-xs font-semibold text-slate-600">
            {f.label}
            <input
              type="number"
              name={f.name}
              step={f.step}
              min={f.min}
              max={f.max}
              required
              value={form[f.name]}
              onChange={handleChange}
              className={FIELD_CLASS}
            />
          </label>
        ))}
      </div>

      {errorMsg && (
        <p className="mt-3 rounded-lg bg-orange-50 px-3 py-2 text-sm text-orange-700">{errorMsg}</p>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="mt-4 w-full rounded-xl bg-sky-600 py-3 text-sm font-bold text-white transition hover:bg-sky-700 disabled:opacity-50"
      >
        {submitting ? '제출 중...' : submitLabel}
      </button>
    </form>
  );
}
