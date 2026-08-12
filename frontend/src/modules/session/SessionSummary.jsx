import { Link } from 'react-router-dom';
import { DailyGoalMeter } from '../progress/DailyGoal';
import RewardChips from '../progress/RewardChips';
import { useT } from '../../i18n';

/**
 * SessionSummary (R2-01 S7) — 세션 완료 요약 화면.
 * POST /session/{id}/complete 응답 {xp_total, correct_count, total, streak_count} 표시.
 *
 * R10-01 §3.4 (S4 — R10-D): 완료 화면에 "오늘 목표 N/M"을 표기한다
 * (N=/progress/me의 today_answered_count, M=daily_goal_items — 미설정이면 미렌더).
 *
 * R13-01 §2.1 (만회 결산): `retry_resolved_count`·`all_resolved`는 **서버 실측만**
 * 쓴다. correct_count는 최초 정답 수 그대로라 만회분이 섞이지 않는다 — 두 값을
 * 프론트에서 합산하면 "만회로도 XP가 붙는다"는 오해를 만든다(만회는 XP 0).
 *
 * R13-01 §2.10 (블록 구분 표기): 15문항이 각각 무엇이었는지 `SessionItem.kind`
 * (new|review|live|unit)로 나눠 보인다. items를 받지 못하면(구 호출부·유닛 세션)
 * 이 블록은 통째로 렌더되지 않는다 — 추정하지 않는다.
 *
 * R13 CO-T-4 (보상 획득 표기): XP 타일은 `xp_total`이 아니라 **`xp_awarded`**
 * (= 문항 XP + 퀘스트 보상)를 그린다. `xp_total`만 그리던 종전에는 퀘스트 3종이
 * 동시에 완료돼도 표기가 **실지급보다 최대 25 적었다.** 합산은 서버가 한다 —
 * 여기서 더하면 같은 값을 그리는 다른 화면(UnitSessionPage)이 또 빠뜨린다.
 * 구 응답(필드 없음)에는 `xp_awarded`가 0으로 오므로 `xp_total`로 폴백한다.
 */

// 표기 순서 = 세션 배합 순서(서버 `plan_bank_picks`가 붙이는 순서와 같다).
//
// ⚠️ **`'board'`가 빠져 있었다**(2026-08-12 수리). 배합이
// `{live:2, new:4, review:3, board:1}`로 바뀌며 board가 명시 블록이 됐는데 이 배열이
// 그대로여서, `blockCounts`의 `BLOCK_ORDER.includes(kind)` 필터가 board 문항을
// **통째로 걸러냈다** — i18n에 `session.blocks.board`(「오늘의 하늘」)를 저작해 두고도
// 완료 화면에 그 블록이 영영 안 떴다(대장 I절 「만들어 두고 안 쓰는 것」 패턴).
// 이 배열이 표기의 **화이트리스트**라서, 배합에 kind를 추가하면 여기에도 반드시
// 추가해야 한다. 조용히 사라지는 방향이라 화면만 봐서는 눈치채기 어렵다.
//
// ⚠️ `'unit'`은 배합에서 빠졌지만 **남긴다** — 그 kind로 발급된 **레거시 세션**이
// 아직 완료될 수 있고, 목록에서 빼면 그 세션의 진도 블록이 같은 방식으로 증발한다.
// 죽은 값이지 틀린 값이 아니다.
const BLOCK_ORDER = ['new', 'review', 'live', 'unit', 'board'];

/** kind별 문항 수. items가 없거나 kind가 하나도 없으면 빈 배열(미렌더). */
export function blockCounts(items) {
  if (!Array.isArray(items) || items.length === 0) return [];
  const counts = new Map();
  for (const item of items) {
    const kind = item?.kind;
    if (!BLOCK_ORDER.includes(kind)) continue;
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  return BLOCK_ORDER.filter((k) => counts.get(k) > 0).map((k) => ({ kind: k, count: counts.get(k) }));
}

export default function SessionSummary({ summary, items }) {
  const t = useT();
  if (!summary) return null;
  const { xp_total, correct_count, total, streak_count } = summary;
  // 서버가 더한 표기용 총합. 구 응답(필드 부재 → 0)이면 문항 XP로 폴백한다.
  const xpShown = Number(summary.xp_awarded) || xp_total;
  const allCorrect = correct_count === total;
  const retryResolved = Number(summary.retry_resolved_count) || 0;
  const allResolved = Boolean(summary.all_resolved);
  const blocks = blockCounts(items);

  return (
    <div className="mt-10 rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-slate-200">
      <p className="text-4xl">{allCorrect || allResolved ? '🌈' : '⛅'}</p>
      <h2 className="mt-3 text-xl font-extrabold text-slate-900">{t('session.summary.title')}</h2>
      <p className="mt-1 text-sm text-slate-500">
        {allCorrect
          ? t('session.summary.allCorrect')
          : allResolved
            ? t('session.summary.allResolved')
            : t('session.summary.someWrong')}
      </p>

      {/* 만회 결산 (§2.1) — 서버 실측 retry_resolved_count. XP·구름과 무관한 줄이라
          정답 수 타일과 섞지 않고 별도 배지로 둔다. */}
      {retryResolved > 0 && (
        <p
          data-retry-resolved={retryResolved}
          className="mt-3 inline-flex items-center rounded-full bg-indigo-100 px-3 py-1 text-xs font-extrabold text-indigo-700"
        >
          {t('session.summary.retryResolved', { count: retryResolved })}
        </p>
      )}

      <div className="mt-6 grid grid-cols-3 gap-2">
        <div className="rounded-xl bg-emerald-50 p-3">
          <p className="text-lg font-extrabold text-emerald-600">
            {correct_count}
            <span className="text-sm font-medium text-emerald-500">/{total}</span>
          </p>
          <p className="mt-0.5 text-xs font-medium text-slate-500">{t('session.summary.correct')}</p>
        </div>
        <div className="rounded-xl bg-sky-50 p-3">
          <p className="text-lg font-extrabold text-sky-600">+{xpShown}</p>
          <p className="mt-0.5 text-xs font-medium text-slate-500">{t('session.summary.xp')}</p>
        </div>
        <div className="rounded-xl bg-orange-50 p-3">
          <p className="text-lg font-extrabold text-orange-500">🔥 {streak_count}</p>
          <p className="mt-0.5 text-xs font-medium text-slate-500">{t('session.summary.streak')}</p>
        </div>
      </div>

      {/* 방금 받은 보상 (CO-T-4) — 서버가 실은 것만. 없으면 통째로 미렌더 */}
      <RewardChips
        className="mt-4"
        quests={summary.quest_rewards}
        badges={summary.badges_earned}
      />

      {/* 블록 구분 표기 (§2.10) — 이 표기가 없으면 15문항이 그냥 길기만 하다.
          진도(unit) 블록은 항상 마지막 5문항이고, 왕관 판정도 이 블록이 소유한다. */}
      {blocks.length > 0 && (
        <div data-session-blocks={blocks.length} className="mt-5 text-left">
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
            {t('session.summary.blocksTitle')}
          </p>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {blocks.map(({ kind, count }) => (
              <li
                key={kind}
                data-block-kind={kind}
                className={`rounded-full px-2.5 py-1 text-xs font-bold ring-1 ${
                  kind === 'unit'
                    ? 'bg-amber-50 text-amber-700 ring-amber-200'
                    : 'bg-slate-50 text-slate-600 ring-slate-200'
                }`}
              >
                {t(`session.summary.blocks.${kind}`)}{' '}
                <span className="font-extrabold">{t('session.summary.blockCount', { count })}</span>
              </li>
            ))}
          </ul>
          {blocks.some((b) => b.kind === 'unit') && (
            <p className="mt-1.5 text-[11px] leading-relaxed text-slate-400">
              {t('session.summary.unitBlockNote')}
            </p>
          )}
        </div>
      )}

      {/* 오늘 목표 진행 (R10-01 §3.4) — 목표 미설정이면 렌더되지 않는다 */}
      <DailyGoalMeter className="mt-4" />

      {/* R10-01 §3.5 마감 4: 고정 "5문항" 카피를 실제 배합(complete 응답 total)과
          동기화한다. 배합은 Settings.SESSION_RECIPE로 env 조정될 수 있어 상수로
          적으면 어긋난다(관찰 보고서 §1-4: 표기 5 vs 실제 9). total이 없으면 수를 뺀다. */}
      <p className="mt-6 text-sm text-slate-500">
        {total > 0 ? t('session.summary.tomorrow', { total }) : t('session.summary.tomorrowNoCount')}
      </p>
      <Link
        to="/board"
        className="mt-4 inline-block rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-slate-700"
      >
        {t('session.summary.boardCta')}
      </Link>
    </div>
  );
}
