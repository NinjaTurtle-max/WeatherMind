import { EVIDENCE_META } from './briefingDisplay';

/**
 * EvidencePicker (R9-01 §3.4 ②) — 판단 근거 복수 선택 카드.
 * 화이트리스트 5종(§3.1)을 카드 버튼으로 나열하고, 선택은 제출 body의
 * evidence 배열로 동봉된다(선택 0개도 허용 — 학습 장치이지 강제 아님).
 * 선택 상태는 색+체크 아이콘+aria-pressed 병기(색약·스크린리더 대응).
 */
export default function EvidencePicker({ selected, onToggle, disabled = false }) {
  const picked = new Set(selected);
  return (
    <div className="mt-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <h3 className="text-sm font-extrabold text-slate-900">🧭 판단 근거 고르기</h3>
      <p className="mb-2 mt-0.5 text-xs text-slate-500">
        브리핑에서 본 단서 중 예측의 근거를 골라요(복수 선택). 정산 후 근거가 맞았는지 해설해 줘요.
      </p>
      <ul className="grid grid-cols-1 gap-1.5">
        {EVIDENCE_META.map((m) => {
          const on = picked.has(m.code);
          return (
            <li key={m.code}>
              <button
                type="button"
                aria-pressed={on}
                disabled={disabled}
                onClick={() => onToggle(m.code)}
                className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left ring-1 transition disabled:opacity-50 ${
                  on
                    ? 'bg-sky-50 ring-sky-300'
                    : 'bg-slate-50 ring-slate-200 hover:bg-slate-100'
                }`}
              >
                <span className="text-lg" aria-hidden="true">
                  {m.icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block text-xs font-bold ${on ? 'text-sky-800' : 'text-slate-700'}`}>
                    {m.label}
                  </span>
                  <span className="block truncate text-[11px] text-slate-500">{m.desc}</span>
                </span>
                <span
                  className={`shrink-0 rounded-full px-1.5 py-0.5 text-[11px] font-bold ${
                    on ? 'bg-sky-600 text-white' : 'bg-slate-200 text-slate-500'
                  }`}
                >
                  {on ? '✓ 선택' : '선택'}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
