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
 *
 * variant (2026-08-09):
 *   'card'  기본 — 흰 카드. 다른 화면이 레일에 세울 때 쓴다.
 *   'strip' 카드 껍데기 없이 **한 줄**. 학습 화면이 흰 카드를 3장으로 줄이면서
 *           복습을 화면 맨 아래 줄로 내렸다(사용자 지시). 카드를 지우는 것이
 *           아니라 **껍데기만** 벗기는 이유는 due 0건 렌더 생략·상위 3개 자르기
 *           같은 계약이 두 모양에서 같아야 하기 때문이다 — 두 컴포넌트로 갈라
 *           두면 한쪽만 고쳐진다.
 *   'hero'  파란 진입 카드(LearnHeroCard) 안 — 「이어서 풀기」 밑(2026-08-09).
 *           대비 기준이 **파란 바탕**이라 칩·글자 색이 다르다(흰 바탕용 slate
 *           계열은 여기서 묻힌다). 모양만 다르고 계약은 위 둘과 같다.
 */
export default function ReviewQueueCard({ variant = 'card' }) {
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

  if (variant === 'hero') {
    return (
      <div
        data-testid="review-queue-hero"
        className="mt-4 w-full border-t border-slate-200/80 pt-3.5 text-left"
      >
        <div className="flex items-center gap-1.5">
          <span aria-hidden="true" className="text-[13px]">🔁</span>
          <p className="text-[12.5px] font-bold text-slate-700">{t('reviewQueue.title')}</p>
          <span className="ml-auto text-[11px] font-medium tabular-nums text-slate-400">
            {t('reviewQueue.count', { count: due.length })}
          </span>
        </div>
        {/* **개념명 키워드**로 보여준다(2026-08-09 사용자 결정). 한때 담당 캐릭터
            그림으로 바꿨는데 되돌렸다 — 캐릭터는 8장인데 개념은 14종이라 둘 이상이
            같은 얼굴을 쓰고(기압과 전선·기압의 기초 → 둘 다 구름이), 그러면 무엇을
            복습하는지가 그림만으로는 갈리지 않는다. 여기서 답해야 하는 질문은
            "무엇을"이므로 이름이 맞다. */}
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {top.map((item) => (
            <li
              key={item.concept_tag}
              className="rounded-full bg-slate-100 px-2.5 py-1 text-[11.5px] font-medium text-slate-600"
            >
              {CONCEPT_KO[item.concept_tag] ?? item.concept_tag}
            </li>
          ))}
          {rest > 0 && <li className="px-1 py-1 text-[11px] font-medium text-slate-400">+{rest}</li>}
        </ul>
        <Link
          to="/daily"
          className="mt-2.5 inline-block text-[12px] font-bold text-sky-600 hover:text-sky-700"
        >
          {t('reviewQueue.cta')}
        </Link>
      </div>
    );
  }

  if (variant === 'strip') {
    return (
      <div
        data-testid="review-queue-strip"
        className="flex flex-wrap items-center gap-x-3 gap-y-2 px-0.5 text-[12px] text-slate-400"
      >
        <span aria-hidden="true">🔁</span>
        <span className="font-extrabold text-slate-500">{t('reviewQueue.title')}</span>
        <ul className="flex flex-wrap gap-1.5">
          {top.map((item) => (
            <li
              key={item.concept_tag}
              className="rounded-full bg-white px-2.5 py-1 text-[12px] font-bold text-slate-700 ring-1 ring-slate-200"
            >
              {CONCEPT_KO[item.concept_tag] ?? item.concept_tag}
            </li>
          ))}
          {rest > 0 && <li className="px-1 py-1 text-[11px] font-bold text-slate-400">+{rest}</li>}
        </ul>
        <Link
          to="/daily"
          className="font-bold text-slate-500 underline-offset-4 hover:text-sky-700 hover:underline"
        >
          {t('reviewQueue.cta')}
        </Link>
      </div>
    );
  }

  return (
    <div
      data-testid="review-queue-card"
      // 여백은 마운트하는 쪽(레일 flex gap · 모바일 flex gap)이 준다 — 여기서
      // mb를 더하면 카드마다 간격이 달라진다.
      // 세로는 넉넉히 잡는다(2026-08-05): 튜터 카드를 걷어내 레일에 자리가 났고,
      // 트랙(710px) 옆에서 카드 둘이 150px씩이면 오른쪽이 비어 보였다.
      // CTA는 mt-auto로 바닥에 붙여 늘어난 높이를 쓴다.
      className="flex min-h-[236px] flex-col rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200"
    >
      <div className="flex items-center gap-2">
        <span aria-hidden="true" className="text-xl">
          🔁
        </span>
        <p className="text-[14px] font-extrabold text-slate-800">{t('reviewQueue.title')}</p>
        <span className="ml-auto rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-bold text-sky-700 tabular-nums">
          {t('reviewQueue.count', { count: due.length })}
        </span>
      </div>
      <p className="mt-1.5 text-[12px] leading-relaxed text-slate-500">{t('reviewQueue.body')}</p>
      <ul className="mt-3 flex flex-wrap gap-1.5">
        {top.map((item) => (
          <li
            key={item.concept_tag}
            className="rounded-full bg-slate-50 px-2.5 py-1 text-[12px] font-bold text-slate-700 ring-1 ring-slate-100"
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
        className="mt-auto inline-block self-start rounded-xl bg-sky-600 px-4 py-2 text-[12.5px] font-bold text-white transition hover:bg-sky-700"
      >
        {t('reviewQueue.cta')}
      </Link>
    </div>
  );
}
