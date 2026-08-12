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
 * 화자는 **물방울이 하나**다(2026-08-11 사용자 지시). 이 패널을 띄우는 화면은
 * SessionRunner 하나뿐이고(자유 일일 세션 `/daily` · 유닛 세션 `/learn/units/*` ·
 * 배치고사), 그 화면들의 튜터가 물방울이다(SideNav `TUTOR_BY_PATH` — 담당표의
 * 소유자는 거기다. `/daily`가 표에 없어 폴백 구름이가 뜨던 것도 함께 고쳤다). 정답일 때만 다른 캐릭터가
 * 나오면 **한 세션 안에서 말하는 사람이 문항마다 바뀐다** — 튜터가 붙어 있다는
 * 느낌이 깨진다.
 *
 * ⚠️ 종전에는 정답 → 태양이 · 오답 → 구름이로 갈랐다(R13-01 §2.6). 그때 근거는
 * "같은 얼굴이 다른 말을 하면 사무적으로 읽힌다"였는데, 정오답은 **색 띠와
 * 배지**가 이미 말한다(초록/주황) — 캐릭터까지 바꿀 필요가 없었다. 태양이는
 * **보드 담당**이라 학습 세션에 나오면 배정표와도 어긋났다(Mascot.jsx의 표가
 * 2026-08-11까지 거꾸로 적혀 있어 헷갈리던 자리다 — 그 주석도 함께 고쳤다).
 * **문구는 서버 것 그대로**다 — 캐릭터는 말투를 바꾸지 않는다(§2.6 문구 불변).
 */
const SPEAKER = 'drop';

/** feedback_source → 배지 리소스 키. 미지 값·부재는 'ai'(구 응답 하위 호환). */
const SOURCE_LABEL_KEY = {
  ai: 'feedback.ai',
  authored: 'feedback.authored',
  board: 'feedback.board',
};

const TONE = (isCorrect) =>
  isCorrect
    ? { bar: 'bg-emerald-500', badge: 'bg-emerald-100 text-emerald-700', tail: 'border-emerald-100' }
    : { bar: 'bg-orange-500', badge: 'bg-orange-100 text-orange-700', tail: 'border-orange-100' };

/**
 * 말풍선 본문 — 고정 오버레이(좁은 화면)와 **오른쪽 열 인라인**(넓은 화면)이
 * 같은 것을 그린다. 2026-08-11에 세션이 2열이 되면서 넓은 화면에서는 해설이
 * 오른쪽 열에 그대로 들어간다 — 화면 아래를 덮는 오버레이가 필요 없다.
 * 두 자리에 마크업을 따로 두면 한쪽만 고치는 사고가 난다.
 */
export function FeedbackBubble({ message, isCorrect, source }) {
  const t = useT();
  const tone = TONE(isCorrect);
  const speaker = SPEAKER;
  return (
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
        <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-slate-700">{message}</p>
      </div>
    </div>
  );
}

/** 넓은 화면의 오른쪽 열에 놓는 해설 카드 — 색 띠 + 말풍선(고정 오버레이와 같은 꼴). */
export function FeedbackCard({ message, isCorrect, source }) {
  if (!message) return null;
  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
      <div className={`h-1.5 w-full ${TONE(isCorrect).bar}`} />
      <FeedbackBubble message={message} isCorrect={isCorrect} source={source} />
    </div>
  );
}

export default function FeedbackPanel({ message, isCorrect, source }) {
  if (!message) return null;
  const tone = TONE(isCorrect);

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
        <FeedbackBubble message={message} isCorrect={isCorrect} source={source} />
      </div>
    </div>
  );
}
