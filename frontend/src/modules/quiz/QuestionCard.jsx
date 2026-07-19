import { useEffect, useState } from 'react';

const CONCEPT_LABEL = {
  pressure_front: '기압과 전선',
  typhoon: '태풍',
  air_mass: '기단',
  heat_island: '열섬 현상',
  co2_climate: 'CO₂와 기후',
  anomaly: '이상 기후',
};

/**
 * QuestionCard (04번 스펙) — question_type에 따라 3가지 렌더 분기
 *  - multiple_choice: 객관식 버튼
 *  - short_answer:    텍스트 입력
 *  - slider:          슬라이더
 */
export default function QuestionCard({ question, disabled, onSubmit }) {
  const [textAnswer, setTextAnswer] = useState('');
  const [sliderValue, setSliderValue] = useState(50);

  // 문제가 바뀌면 입력값 초기화
  useEffect(() => {
    setTextAnswer('');
    setSliderValue(50);
  }, [question?.quiz_id]);

  if (!question) return null;

  const conceptLabel = CONCEPT_LABEL[question.concept_tag] ?? question.concept_tag;

  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-sky-100 px-2.5 py-0.5 text-xs font-bold text-sky-700">
          {conceptLabel}
        </span>
        <span className="text-xs text-slate-400">#{question.quiz_id}</span>
      </div>

      <h2 className="mb-5 text-lg font-bold leading-relaxed text-slate-900">
        {question.question_text}
      </h2>

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

      {question.question_type === 'short_answer' && (
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
            placeholder="답을 입력하세요"
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
    </div>
  );
}
