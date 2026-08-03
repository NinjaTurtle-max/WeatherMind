import { useEffect, useMemo, useState } from 'react';
import AtmosphereBoard from '../board/AtmosphereBoard';

const CONCEPT_LABEL = {
  pressure_front: '기압과 전선',
  typhoon: '태풍',
  air_mass: '기단',
  heat_island: '열섬 현상',
  co2_climate: 'CO₂와 기후',
  anomaly: '이상 기후',
};

/**
 * QuestionCard (04번 스펙 + R3-01 S5) — question_type에 따라 렌더 분기.
 *  - multiple_choice: 객관식 버튼
 *  - short_answer:    텍스트 입력
 *  - slider:          슬라이더
 *  - board:           대기 보드 (AtmosphereBoard) — onSubmit('', {boardState})
 *  - match:           쌍 연결 (탭) — 제출 "l:r|l:r"
 *  - ordering:        순서 정렬 (위/아래 이동) — 제출 "0,2,1,3"(원본 인덱스)
 *  - cloze:           빈칸 입력 — short_answer와 동일 제출 규칙
 *
 * board는 board_state를 answer와 별도로 넘겨야 하므로(§3.4) onSubmit(answer, options)
 * 2인자 형태를 쓴다. 나머지 유형은 onSubmit(answer) 문자열만 넘긴다.
 *
 * answerResult (R9-01 §3.3 ⑤, board 분기 전용): 세션 채점 응답(AnswerResult).
 * phenomena가 있으면 AtmosphereBoard가 서버 판정 확정 리플레이(현상 애니메이션)를
 * 재생한다. 다른 유형은 무시(기존 렌더 불변).
 */
export default function QuestionCard({ question, disabled, onSubmit, answerResult = null }) {
  const [textAnswer, setTextAnswer] = useState('');
  const [sliderValue, setSliderValue] = useState(50);

  // 문제가 바뀌면 입력값 초기화
  useEffect(() => {
    setTextAnswer('');
    setSliderValue(50);
  }, [question?.quiz_id]);

  if (!question) return null;

  const conceptLabel = CONCEPT_LABEL[question.concept_tag] ?? question.concept_tag;
  const isBoard = question.question_type === 'board';

  return (
    <div className={isBoard ? '' : 'rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200'}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-sky-100 px-2.5 py-0.5 text-xs font-bold text-sky-700">
          {conceptLabel}
        </span>
        <span className="text-xs text-slate-400">#{question.quiz_id}</span>
      </div>

      {/* board는 자체 배너에 목표를 표시하므로 상단 질문 텍스트를 생략 */}
      {!isBoard && (
        <h2 className="mb-5 text-lg font-bold leading-relaxed text-slate-900">
          {question.question_text}
        </h2>
      )}

      {question.question_type === 'multiple_choice' && (
        <div className="flex flex-col gap-2.5">
          {(question.options ?? []).map((option, i) => (
            <button
              key={`${i}-${option}`}
              type="button"
              disabled={disabled}
              onClick={() => onSubmit(option)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-left text-sm font-medium text-slate-800 transition hover:border-sky-400 hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-sky-600 text-xs font-bold text-white">
                {i + 1}
              </span>
              {option}
            </button>
          ))}
        </div>
      )}

      {(question.question_type === 'short_answer' || question.question_type === 'cloze') && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (textAnswer.trim()) onSubmit(textAnswer.trim());
          }}
        >
          <input
            type="text"
            value={textAnswer}
            disabled={disabled}
            onChange={(e) => setTextAnswer(e.target.value)}
            placeholder={question.question_type === 'cloze' ? '빈칸에 들어갈 말을 입력하세요' : '답을 입력하세요'}
            className="min-w-0 flex-1 rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-200 disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={disabled || !textAnswer.trim()}
            className="shrink-0 rounded-xl bg-sky-600 px-5 py-3 text-sm font-bold text-white transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            제출
          </button>
        </form>
      )}

      {question.question_type === 'slider' && (
        <div>
          <div className="mb-2 text-center text-3xl font-extrabold text-sky-700">
            {sliderValue}
            <span className="ml-1 text-base font-medium text-slate-500">
              {question.unit ?? ''}
            </span>
          </div>
          <input
            type="range"
            min={question.min ?? 0}
            max={question.max ?? 100}
            step={question.step ?? 1}
            value={sliderValue}
            disabled={disabled}
            onChange={(e) => setSliderValue(Number(e.target.value))}
          />
          <div className="mt-1 flex justify-between text-xs text-slate-400">
            <span>{question.min ?? 0}</span>
            <span>{question.max ?? 100}</span>
          </div>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onSubmit(sliderValue)}
            className="mt-4 w-full rounded-xl bg-sky-600 py-3 text-sm font-bold text-white transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            이 값으로 제출
          </button>
        </div>
      )}

      {question.question_type === 'match' && (
        <MatchQuestion question={question} disabled={disabled} onSubmit={onSubmit} />
      )}

      {question.question_type === 'ordering' && (
        <OrderingQuestion question={question} disabled={disabled} onSubmit={onSubmit} />
      )}

      {isBoard && (
        <AtmosphereBoard
          puzzle={question.template_json ?? question}
          disabled={disabled}
          submitting={disabled}
          phenomena={answerResult?.phenomena ?? null}
          onSubmit={(boardState) => onSubmit('', { boardState })}
        />
      )}
    </div>
  );
}

// ── match: 쌍 연결 (§3.6 — 제출 "left1:right1|left2:right2|...") ──────────────
/**
 * R10-01 §3.5 마감 1 (관찰 보고서 §1-3 "짝 성립 시 목록 재배열로 연속 클릭이 어긋남"):
 * 목록의 **자리를 고정**한다. 배열 순서는 원래도 불변이었지만, 짝이 성립하면
 * 왼쪽 버튼에 "→ 상대 항목" 줄이 추가되며 버튼 높이가 커져 **아래 항목들이
 * 밀려 내려갔다**(다음 클릭이 옆 항목에 꽂히는 실제 오배치 원인).
 * → 연결 표시 줄을 처음부터 **항상 자리 확보**(빈 줄 렌더)해 높이가 변하지 않게 하고,
 *   해제 방법을 명시한다(짝지어진 항목을 다시 누르면 해제).
 * 두 열의 행 높이는 MATCH_ROW로 함께 고정한다(왼·오른쪽 정렬 유지).
 */
const MATCH_ROW = 'min-h-[3.75rem]';

function MatchQuestion({ question, disabled, onSubmit }) {
  const pairs = question.pairs ?? question.template_json?.pairs ?? [];
  const lefts = useMemo(() => pairs.map((p) => p.left), [pairs]);
  const rights = useMemo(() => shuffle(pairs.map((p) => p.right), question.quiz_id), [pairs, question.quiz_id]);

  const [activeLeft, setActiveLeft] = useState(null);
  const [mapping, setMapping] = useState({}); // left -> right

  useEffect(() => {
    setActiveLeft(null);
    setMapping({});
  }, [question.quiz_id]);

  const assign = (right) => {
    if (disabled || !activeLeft) return;
    setMapping((m) => {
      const next = {};
      // 같은 right가 다른 left에 이미 연결됐다면 해제(1:1 유지)
      for (const [l, r] of Object.entries(m)) if (r !== right) next[l] = r;
      next[activeLeft] = right;
      return next;
    });
    setActiveLeft(null);
  };

  /** 짝 해제 — 연결된 왼쪽 항목을 다시 누르면 풀린다(해제 방법 미안내 보완) */
  const unassign = (left) => {
    if (disabled) return;
    setMapping((m) => {
      const next = { ...m };
      delete next[left];
      return next;
    });
    setActiveLeft(null);
  };

  const handleLeftClick = (l) => {
    if (mapping[l]) {
      unassign(l); // 이미 연결됨 → 해제(자리·순서는 그대로)
      return;
    }
    setActiveLeft(activeLeft === l ? null : l);
  };

  const allMatched = lefts.every((l) => mapping[l]);
  const submit = () => {
    if (!allMatched) return;
    onSubmit(lefts.map((l) => `${l}:${mapping[l]}`).join('|'));
  };

  return (
    <div>
      <p className="mb-2 text-xs text-slate-500">
        왼쪽 항목을 누른 뒤 짝이 되는 오른쪽 항목을 누르세요. 연결된 왼쪽 항목을 다시 누르면 해제돼요
        — 목록의 자리는 바뀌지 않아요.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-2">
          {lefts.map((l) => (
            <button
              key={l}
              type="button"
              data-match-left={l}
              disabled={disabled}
              aria-pressed={activeLeft === l}
              onClick={() => handleLeftClick(l)}
              className={`flex ${MATCH_ROW} flex-col justify-center rounded-xl border px-3 py-2 text-left text-sm font-medium transition disabled:opacity-60 ${
                activeLeft === l
                  ? 'border-sky-500 bg-sky-600 text-white'
                  : mapping[l]
                    ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                    : 'border-slate-200 bg-slate-50 text-slate-800 hover:border-sky-400'
              }`}
            >
              <span>{l}</span>
              {/* 연결 표시 줄은 **항상** 자리를 차지한다 — 짝 성립으로 높이가 변해
                  아래 항목이 밀리는 재배열을 원천 차단(§3.5 마감 1). */}
              <span className="mt-0.5 block text-xs font-normal opacity-80">
                {mapping[l] ? `→ ${mapping[l]} · 다시 눌러 해제` : ' '}
              </span>
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-2">
          {rights.map((r) => {
            const usedBy = Object.entries(mapping).find(([, rr]) => rr === r)?.[0];
            return (
              <button
                key={r}
                type="button"
                data-match-right={r}
                disabled={disabled || !activeLeft}
                onClick={() => assign(r)}
                className={`flex ${MATCH_ROW} flex-col justify-center rounded-xl border px-3 py-2 text-left text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
                  usedBy
                    ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                    : 'border-slate-200 bg-white text-slate-800 hover:border-sky-400'
                }`}
              >
                <span>{r}</span>
                <span className="mt-0.5 block text-xs font-normal opacity-80">
                  {usedBy ? `↔ ${usedBy}` : ' '}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <button
        type="button"
        disabled={disabled || !allMatched}
        onClick={submit}
        className="mt-4 w-full rounded-xl bg-sky-600 py-3 text-sm font-bold text-white transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        제출
      </button>
    </div>
  );
}

// ── ordering: 순서 정렬 (§3.6 — 제출 "0,2,1,3" 원본 인덱스 순열) ──────────────
function OrderingQuestion({ question, disabled, onSubmit }) {
  const items = question.items ?? question.template_json?.items ?? [];
  const shuffled = question.shuffled ?? question.template_json?.shuffled ?? false;

  // 표시 순서는 원본 인덱스를 태그해 추적한다. shuffled면 초기 배열을 섞는다.
  const [order, setOrder] = useState([]); // [{idx, text}]
  useEffect(() => {
    const tagged = items.map((text, idx) => ({ idx, text }));
    setOrder(shuffled ? shuffle(tagged, question.quiz_id) : tagged);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question.quiz_id]);

  const move = (from, to) => {
    if (disabled || to < 0 || to >= order.length) return;
    setOrder((o) => {
      const next = [...o];
      const [m] = next.splice(from, 1);
      next.splice(to, 0, m);
      return next;
    });
  };

  return (
    <div>
      <p className="mb-2 text-xs text-slate-500">위/아래 버튼으로 올바른 순서로 정렬한 뒤 제출하세요.</p>
      <div className="flex flex-col gap-2">
        {order.map((item, i) => (
          <div key={item.idx} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
            <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sky-600 text-xs font-bold text-white">
              {i + 1}
            </span>
            <span className="min-w-0 flex-1 text-sm font-medium text-slate-800">{item.text}</span>
            <div className="flex shrink-0 flex-col gap-0.5">
              <button
                type="button"
                disabled={disabled || i === 0}
                onClick={() => move(i, i - 1)}
                aria-label="위로"
                className="rounded bg-white px-2 text-xs font-bold text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100 disabled:opacity-30"
              >
                ▲
              </button>
              <button
                type="button"
                disabled={disabled || i === order.length - 1}
                onClick={() => move(i, i + 1)}
                aria-label="아래로"
                className="rounded bg-white px-2 text-xs font-bold text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100 disabled:opacity-30"
              >
                ▼
              </button>
            </div>
          </div>
        ))}
      </div>
      <button
        type="button"
        disabled={disabled || order.length === 0}
        onClick={() => onSubmit(order.map((o) => o.idx).join(','))}
        className="mt-4 w-full rounded-xl bg-sky-600 py-3 text-sm font-bold text-white transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        제출
      </button>
    </div>
  );
}

// 문항별 고정 셔플 (quiz_id 시드 — 리렌더 시 순서 안정)
function shuffle(arr, seedStr = '') {
  let seed = 0;
  for (let i = 0; i < String(seedStr).length; i++) seed = (seed * 31 + seedStr.charCodeAt(i)) >>> 0;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
