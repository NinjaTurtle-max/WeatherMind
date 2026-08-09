import { useT } from '../i18n';
import Mascot from './Mascot';

/**
 * FeedbackPanel (04번 스펙) — RAG 피드백 표시용 슬라이드업 패널.
 * 세션 경로 공용 — props로 message, isCorrect를 받는다.
 * message 본문은 서버 파생 — 외부화 대상 아님(§6.3 시드/서버 데이터 제외).
 *
 * ⚠️ **배지는 출처를 말한다**(CO-I-1 후속, 2026-08-08). 종전에는 무조건
 * `feedback.ai`("AI 피드백")를 찍었는데, `explanation_hint`(배선 당시 158건 ·
 * 2026-08-09 실측 193건)가 배선된 뒤로는
 * **사람이 저작한 해설**과 **board 판정 근거**가 같은 배지 아래로 나갔다 — 심사
 * 배점 ⑤(생성형 AI 활용)에 직결되는 표기 오류다. 서버가 `AnswerResult.feedback_source`
 * ("board"|"authored"|"ai")로 출처를 알려주므로 그것으로 라벨을 고른다.
 * 필드가 없는 구 응답은 종전대로 'ai'로 떨어진다(하위 호환).
 *
 * R13-01 §2.6(교사 캐릭터): 화자를 정오답에 따라 갈랐다. 예전에는 캐릭터가
 * 한 종(번개)뿐이라 "포즈가 1종이니 그림을 바꾸지 않는다"고 적어 뒀지만, 지금은
 * 마스코트 6종이 **표정 6종**으로 쓰인다 — 맞혔을 때와 틀렸을 때 같은 얼굴이
 * 같은 자리에서 다른 말을 하면 피드백이 사무적으로 읽힌다.
 *   정답 → 태양이(칭찬·개념 굳히기)  오답 → 구름이(메인 튜터가 다시 설명)
 * **문구는 서버 것 그대로**다 — 캐릭터는 말투를 바꾸지 않는다(§2.6 문구 불변).
 */
const SPEAKER = { correct: 'sun', wrong: 'cloud' };

/** feedback_source → 배지 리소스 키. 미지 값·부재는 'ai'(구 응답 하위 호환). */
const SOURCE_LABEL_KEY = {
  ai: 'feedback.ai',
  authored: 'feedback.authored',
  board: 'feedback.board',
};

export default function FeedbackPanel({ message, isCorrect, source }) {
  const t = useT();
  if (!message) return null;

  const speaker = isCorrect ? SPEAKER.correct : SPEAKER.wrong;
  const tone = isCorrect
    ? { bar: 'bg-emerald-500', badge: 'bg-emerald-100 text-emerald-700', tail: 'border-emerald-100' }
    : { bar: 'bg-orange-500', badge: 'bg-orange-100 text-orange-700', tail: 'border-orange-100' };

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
          {/* 정오답은 배지·문구가 전달하므로 캐릭터는 장식 — 스크린리더 중복 방지. */}
          <span
            data-testid="feedback-mascot"
            data-mascot={speaker}
            className="grid h-14 w-14 shrink-0 place-items-center self-start rounded-full bg-slate-50"
          >
            <Mascot name={speaker} className="h-12 w-12" />
          </span>
          {/* 말풍선 — 꼬리가 캐릭터를 가리켜 "이 캐릭터가 말한다"가 된다.
              보드 힌트(BoardHintPanel)와 같은 관례다. */}
          <div className="relative min-w-0 flex-1 rounded-2xl bg-slate-50 px-3 py-2.5">
            <span
              aria-hidden="true"
              className={`absolute -left-[5px] top-5 h-2.5 w-2.5 rotate-45 border-b border-l bg-slate-50 ${tone.tail}`}
            />
            <span
              data-feedback-source={source ?? 'ai'}
              className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${tone.badge}`}
            >
              {t(SOURCE_LABEL_KEY[source] ?? SOURCE_LABEL_KEY.ai)}
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
