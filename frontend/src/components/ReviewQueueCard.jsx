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
 * **CTA 목적지 = `/learn`**(2026-08-12 변경. 종전 `/daily` 3곳).
 * 자유 일일 세션이 폐지되면서 세 variant의 「복습하러 가기」가 전부 죽은 링크가
 * 됐다 — 눌러도 `*` → `/learn`으로 조용히 되돌아왔고, **스모크는 초록이었다**
 * (앵커 존재만 봤다. 그 결함은 review-queue 스모크 쪽에서 함께 고쳤다).
 *
 * `/learn`인 이유: 복습 전용 라우트는 **없다**. 복습 문항은 세션 배합(복습 4문항)
 * 으로 세션에 섞여 나오므로 학습자가 할 일은 "세션을 연다"이고, 그 입구가
 * 학습 화면이다. 이 카드는 **무엇이** 도래했는지를 말하는 자리이지 세션을 직접
 * 발급하는 자리가 아니다(props 없는 자급 컴포넌트라 유닛 트리를 모른다 —
 * 특정 유닛으로 보내려면 소유하지 않은 데이터가 필요하다).
 *
 * variant (2026-08-09):
 *   'card'  기본 — 흰 카드. 다른 화면이 레일에 세울 때 쓴다.
 *   'strip' 카드 껍데기 없이 **한 줄**. 학습 화면이 흰 카드를 3장으로 줄이면서
 *           복습을 화면 맨 아래 줄로 내렸다(사용자 지시). 카드를 지우는 것이
 *           아니라 **껍데기만** 벗기는 이유는 due 0건 렌더 생략·상위 3개 자르기
 *           같은 계약이 두 모양에서 같아야 하기 때문이다 — 두 컴포넌트로 갈라
 *           두면 한쪽만 고쳐진다.
 *   'tile'  학습 화면 **경로 아래 3카드**의 첫 칸(2026-08-09 시안). 스스로
 *           흰 카드까지 그린다 — 격자 칸에 그대로 떨어뜨리려고 그렇다.
 *           본문 없이 제목·키워드 칩·링크뿐이라 세로가 얕다(하단 줄은 세로
 *           예산이 빠듯하다 — 트랙 높이를 그만큼 뺏는다). 계약은 위 둘과 같다.
 */
/**
 * @param bare  true면 **자기 테두리·그림자·모서리를 그리지 않는다**(2026-08-13
 *   클라이언트 지시: 우측 열을 카드 한 장으로 묶고 구분은 음영으로).
 *   바깥 카드가 테두리를 소유하고 이 컴포넌트는 **음영 띠 한 칸**이 된다.
 *   기본 false는 종전 동작(단독 카드로 서는 자리 — /me 등).
 */
export default function ReviewQueueCard({ variant = 'card', bare = false }) {
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

  if (variant === 'tile') {
    return (
      <div
        data-testid="review-queue-tile"
        // md:flex-1 — 학습 화면 오른쪽 열에서 자유 일일 세션과 트랙 높이를 나눠
        // 쓴다(그 파일의 주석 참조). 다른 마운트처(모바일 스택)에서는 md 미만이라
        // 영향이 없다.
        className={`flex flex-col p-4 text-left md:max-h-[340px] md:flex-1 ${bare ? 'bg-white' : 'rounded-2xl bg-white shadow-sm ring-1 ring-slate-200'}`}
      >
        <div className="flex items-center gap-1.5">
          <p className="text-[13.5px] font-extrabold text-slate-800">{t('reviewQueue.title')}</p>
          <span className="ml-auto text-[11px] font-medium tabular-nums text-slate-400">
            {t('reviewQueue.count', { count: due.length })}
          </span>
        </div>
        {/* **개념명 키워드**로 보여준다(2026-08-09 사용자 결정). 한때 담당 캐릭터
            그림으로 바꿨는데 되돌렸다 — 캐릭터는 8장인데 개념은 14종이라 둘 이상이
            같은 얼굴을 쓰고(기압과 전선·기압의 기초 → 둘 다 구름이), 그러면 무엇을
            복습하는지가 그림만으로는 갈리지 않는다. 여기서 답해야 하는 질문은
            "무엇을"이므로 이름이 맞다. */}
        <ul className="mt-2.5 flex flex-wrap gap-1.5">
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
          to="/learn"
          className="mt-auto pt-2.5 text-[12px] font-bold text-sky-600 hover:text-sky-700"
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
          to="/learn"
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
        to="/learn"
        className="mt-auto inline-block self-start rounded-xl bg-sky-600 px-4 py-2 text-[12.5px] font-bold text-white transition hover:bg-sky-700"
      >
        {t('reviewQueue.cta')}
      </Link>
    </div>
  );
}
