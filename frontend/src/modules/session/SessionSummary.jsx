import { Link } from 'react-router-dom';

/**
 * SessionSummary (R2-01 S7) — 세션 완료 요약 화면.
 * POST /session/{id}/complete 응답 {xp_total, correct_count, total, streak_count} 표시.
 */
export default function SessionSummary({ summary }) {
  if (!summary) return null;
  const { xp_total, correct_count, total, streak_count } = summary;
  const allCorrect = correct_count === total;

  return (
    <div className="mt-10 rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-slate-200">
      <p className="text-4xl">{allCorrect ? '🌈' : '⛅'}</p>
      <h2 className="mt-3 text-xl font-extrabold text-slate-900">오늘의 세션 완료!</h2>
      <p className="mt-1 text-sm text-slate-500">
        {allCorrect
          ? '전부 정답이에요. 완벽한 하루!'
          : '틀린 개념은 내일 세션의 복습 문항으로 다시 만나요.'}
      </p>

      <div className="mt-6 grid grid-cols-3 gap-2">
        <div className="rounded-xl bg-emerald-50 p-3">
          <p className="text-lg font-extrabold text-emerald-600">
            {correct_count}
            <span className="text-sm font-medium text-emerald-500">/{total}</span>
          </p>
          <p className="mt-0.5 text-xs font-medium text-slate-500">정답 수</p>
        </div>
        <div className="rounded-xl bg-sky-50 p-3">
          <p className="text-lg font-extrabold text-sky-600">+{xp_total}</p>
          <p className="mt-0.5 text-xs font-medium text-slate-500">획득 XP</p>
        </div>
        <div className="rounded-xl bg-orange-50 p-3">
          <p className="text-lg font-extrabold text-orange-500">🔥 {streak_count}</p>
          <p className="mt-0.5 text-xs font-medium text-slate-500">스트릭</p>
        </div>
      </div>

      <p className="mt-6 text-sm text-slate-500">내일 또 새로운 5문항 세션이 준비돼요.</p>
      <Link
        to="/board"
        className="mt-4 inline-block rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-slate-700"
      >
        대기 보드 풀어보기 →
      </Link>
    </div>
  );
}
