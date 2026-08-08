import { useT } from '../i18n';
import Mascot from './Mascot';

/**
 * FeedbackPanel (04번 스펙) — RAG 피드백 표시용 슬라이드업 패널.
 * 세션 경로 공용 — props로 message, isCorrect를 받는다.
 * 채점 순간에 퀴즈 담당 캐릭터(번개)가 함께 선다.
 * message 본문은 서버(RAG) 파생 — 외부화 대상 아님(§6.3 시드/서버 데이터 제외).
 */
export default function FeedbackPanel({ message, isCorrect }) {
  const t = useT();
  if (!message) return null;

  const tone = isCorrect
    ? { bar: 'bg-emerald-500', badge: 'bg-emerald-100 text-emerald-700' }
    : { bar: 'bg-orange-500', badge: 'bg-orange-100 text-orange-700' };

  return (
    // 사이드바 오른쪽부터 시작시킨다 — Layout의 헤더와 같은 처리다. `inset-x-0`
    // 그대로 두면 이 패널만 **화면 전체** 기준으로 가운데 정렬되는데, 본문(문항
    // 카드·결과 배너)은 사이드바를 뺀 폭 기준이라 카드만 104px 왼쪽으로 밀려
    // 결과 배너와 어긋났다.
    // 폭은 `--wm-shell-left`(styles/index.css)가 갖는다. 208px을 여기 박으면 안
    // 된다 — 이 패널은 **사이드바가 없는 배치고사 화면**(/onboarding/placement,
    // Layout 밖인데 같은 SessionRunner를 쓴다)에서도 그려져, 거기서는 반대로
    // 104px 오른쪽으로 틀어진다. 변수는 Layout 안이면 208 · 밖이면 0이 온다.
    <div className="fixed bottom-14 right-0 z-40 mx-auto max-w-xl px-3 pb-3 left-[var(--wm-shell-left)]">
      <div className="animate-slide-up overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200">
        <div className={`h-1.5 w-full ${tone.bar}`} />
        <div className="flex gap-3 p-4">
          {/* 정오답은 배지·문구가 전달하므로 캐릭터는 장식 — 스크린리더 중복 방지.
              포즈가 1종뿐이라 정오답으로 그림을 바꾸지 않는다. */}
          <Mascot name="bolt" className="h-14 w-14 shrink-0 self-start" />
          <div className="min-w-0 flex-1">
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${tone.badge}`}>
              {t('feedback.ai')}
            </span>
            <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-slate-700">
              {message}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
