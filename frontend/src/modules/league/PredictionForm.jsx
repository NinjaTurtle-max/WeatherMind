import { useState } from 'react';

/**
 * PredictionForm (04번 스펙) — temp_max/min, rain_prob 입력
 */
export default function PredictionForm({ onSubmit, submitting }) {
  const [form, setForm] = useState({ temp_max: '', temp_min: '', rain_prob: '' });
  const [errorMsg, setErrorMsg] = useState(null);

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const handleSubmit = (e) => {
    e.preventDefault();
    const tempMax = Number(form.temp_max);
    const tempMin = Number(form.temp_min);
    const rainProb = Number(form.rain_prob);
    if (Number.isNaN(tempMax) || Number.isNaN(tempMin) || Number.isNaN(rainProb)) {
      setErrorMsg('모든 값을 숫자로 입력해주세요.');
      return;
    }
    if (tempMin > tempMax) {
      setErrorMsg('최저기온이 최고기온보다 높을 수 없어요.');
      return;
    }
    if (rainProb < 0 || rainProb > 100) {
      setErrorMsg('강수확률은 0~100 사이여야 해요.');
      return;
    }
    setErrorMsg(null);
    onSubmit({ temp_max: tempMax, temp_min: tempMin, rain_prob: rainProb });
  };

  const fieldClass =
    'mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-200';

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200"
    >
      <h2 className="mb-3 text-base font-extrabold text-slate-900">이번 주 날씨를 예측해보세요</h2>
      <div className="grid grid-cols-3 gap-2">
        <label className="text-xs font-semibold text-slate-600">
          최고기온(°C)
          <input
            type="number"
            name="temp_max"
            step="0.1"
            required
            value={form.temp_max}
            onChange={handleChange}
            className={fieldClass}
          />
        </label>
        <label className="text-xs font-semibold text-slate-600">
          최저기온(°C)
          <input
            type="number"
            name="temp_min"
            step="0.1"
            required
            value={form.temp_min}
            onChange={handleChange}
            className={fieldClass}
          />
        </label>
        <label className="text-xs font-semibold text-slate-600">
          강수확률(%)
          <input
            type="number"
            name="rain_prob"
            min="0"
            max="100"
            required
            value={form.rain_prob}
            onChange={handleChange}
            className={fieldClass}
          />
        </label>
      </div>

      {errorMsg && (
        <p className="mt-3 rounded-lg bg-orange-50 px-3 py-2 text-sm text-orange-700">{errorMsg}</p>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="mt-4 w-full rounded-xl bg-sky-600 py-3 text-sm font-bold text-white transition hover:bg-sky-700 disabled:opacity-50"
      >
        {submitting ? '제출 중...' : '예측 제출 (주 1회)'}
      </button>
    </form>
  );
}
