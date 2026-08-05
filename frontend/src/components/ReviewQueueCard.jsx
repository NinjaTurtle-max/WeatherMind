import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import client from '../api/client';
import { CONCEPT_KO } from '../lib/abilityDisplay';
import { useT } from '../i18n';

/**
 * ReviewQueueCard (R11-01 §6.2) — 간격반복 복습 큐 카드. props 없는 자급 컴포넌트
 * (마운트는 CurriculumHome 소유자 FE-A가 1줄 import로 한다).
 *
 * GET /progress/review-queue(ReviewQueueItem[] — 전 개념 + due 플래그)를 직접
 * 소비해 **due=true 상위 3개**만 보여준다. 서버가 next_review_at 오름차순으로
 * 정렬해 보내므로(도래분이 앞) 재정렬 없이 앞에서 자른다.
 *
 * 렌더 생략(null) 계약 — 빈 카드 금지:
 * - due 0건(이력 없음 포함) · 로딩 중 · 에러(구 백엔드에 엔드포인트 없음 404 포함).
 *   홈의 보조 카드라 실패를 화면 결함으로 승격하지 않는다(SpineBadge 선례).
 *
 * 숨긴 것: consecutive_correct·interval_days·타임스탬프 원값 — 스케줄 내부값이라
 * 학습자에게 소음이다. 보여주는 것은 "무엇을(개념명) 지금 복습할 때"뿐.
 */
export default function ReviewQueueCard() {
  const t = useT();
  const { data } = useQuery({
    queryKey: ['progress', 'review-queue'],
    queryFn: async () => (await client.get('/progress/review-queue')).data,
    staleTime: 60 * 1000,
  });

  const due = (data ?? []).filter((item) => item.due);
  if (due.length === 0) return null;

  const top = due.slice(0, 3);
  const rest = due.length - top.length;

  return (
    <div
      data-testid="review-queue-card"
      // 여백은 마운트하는 쪽(레일 flex gap · 모바일 flex gap)이 준다 — 여기서
      // mb를 더하면 카드마다 간격이 달라진다. 치수는 우측 레일 기준으로 촘촘하게
      // 잡는다(2026-08-05: 레일 카드가 커서 학습 트랙이 상대적으로 작아 보였다).
      className="rounded-2xl bg-white p-3 shadow-sm ring-1 ring-slate-200"
    >
      <div className="flex items-center gap-1.5">
        <span aria-hidden="true" className="text-base">
          🔁
        </span>
        <p className="text-[13px] font-extrabold text-slate-800">{t('reviewQueue.title')}</p>
        <span className="ml-auto rounded-full bg-sky-100 px-1.5 py-0.5 text-[10px] font-bold text-sky-700 tabular-nums">
          {t('reviewQueue.count', { count: due.length })}
        </span>
      </div>
      <p className="mt-0.5 text-[11px] leading-snug text-slate-500">{t('reviewQueue.body')}</p>
      <ul className="mt-2 flex flex-wrap gap-1.5">
        {top.map((item) => (
          <li
            key={item.concept_tag}
            className="rounded-full bg-slate-50 px-2 py-0.5 text-[11px] font-bold text-slate-700 ring-1 ring-slate-100"
          >
            {CONCEPT_KO[item.concept_tag] ?? item.concept_tag}
          </li>
        ))}
        {rest > 0 && (
          <li className="rounded-full px-1.5 py-0.5 text-[11px] font-bold text-slate-400">+{rest}</li>
        )}
      </ul>
      <Link
        to="/daily"
        className="mt-2 inline-block rounded-lg bg-sky-600 px-3 py-1.5 text-[12px] font-bold text-white transition hover:bg-sky-700"
      >
        {t('reviewQueue.cta')}
      </Link>
    </div>
  );
}
