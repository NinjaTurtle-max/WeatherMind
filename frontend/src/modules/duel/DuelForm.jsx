import { useState } from 'react';

/**
 * DuelForm (R4-01 §3.4) — 내일 예보 입력(최고기온·강수확률). 1일 1회 제출.
 * 리그 예측 폼(PredictionForm) 패턴을 따르되 대결 필드 2종만 받는다.
 */
export default function DuelForm({ onSubmit, submitting, baseForecast }) {
  const [form, setForm] = useState({ temp_max: '', rain_prob: '' });
  const [errorMsg, setErrorMsg] = useState(null);

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const handleSubmit = (e) => {
    e.preventDefault();
    const tempMax = Number(form.temp_max);
    const rainProb = Number(form.rain_prob);
    if (Number.isNaN(tempMax) || Number.isNaN(rainProb)) {
      setErrorMsg('모든 값을 숫자로 입력해주세요.');
      return;
    }
    if (rainProb < 0 || rainProb > 100) {
      setErrorMsg('강수확률은 0~100 사이여야 해요.');
      return;
    }
    setErrorMsg(null);
    onSubmit({ temp_max: tempMax, rain_prob: rainProb });
  };

  const fieldClass =
    'mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-200';

  return (
    <form onSubmit={handleSubmit} className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
      <h2 className="mb-1 text-base font-extrabold text-slate-900">내일 예보를 맞혀보세요</h2>
      <p className="mb-3 text-xs text-slate-500">
        AI 캐스터와 내일 실측을 두고 대결해요. 승리 시 +15 XP! (하루 1회)
      </p>

      {baseForecast && (
        <p className="mb-3 rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-700">
          📡 참고 예보 — 최고 {baseForecast.temp_max}℃ · 강수확률 {baseForecast.rain_prob}%
        </p>
      )}

      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs font-semibold text-slate-600">
          내일 최고기온(°C)
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
        {submitting ? '제출 중...' : '예보 제출 (1일 1회)'}
      </button>
    </form>
  );
}
