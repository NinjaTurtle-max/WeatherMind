import { useEffect, useState } from 'react';
import { evaluateGoals } from './exploreGoals';
import { useT } from '../../i18n';

/**
 * 탐구 목표 패널 (**MT-25**) — 시뮬 화면 상단에 「무엇을 해내면 되는가」를 세운다.
 *
 * ⚠️ 여기 **MT-24**로 적혀 있었는데 그것은 **보드 순차 해제**다(대장 `:2041`).
 * 이 작업은 MT-25(시각화·인터랙티브 강화 — `:2561` S-5)다. 같은 오기가 판정부
 * `exploreGoals.js`·계약 `tests/exploreGoals.test.mjs`에도 있었고 함께 고쳤다.
 * 라벨이 틀리면 **다 된 일을 안 된 것으로 다시 배정**한다 — 2026-08-18에 실제로 그랬다.
 *
 * ⚠️ 파일 이름이 `ExploreGoals.jsx`가 아닌 이유: 같은 폴더에 판정부 `exploreGoals.js`가
 * 있어 **대소문자만 다른 두 파일**이 된다. macOS·Windows의 대소문자 무시 파일시스템에서
 * `./ExploreGoals` 확장자 없는 import가 `.js`(default export 없음) 쪽으로 풀려
 * SSR이 "Element type is invalid"로 죽는다 — 실제로 한 번 밟았다. 이름을 갈라 막는다.
 *
 * 판정만 있고 화면이 조용하면 학습자는 자기가 해냈다는 것을 모른다. 그래서 이
 * 패널이 하는 일은 세 가지다:
 *  ⑴ **들어서자마자 할 일이 보인다** — 목표 제목 + 지시문이 슬라이더보다 위에 있다.
 *  ⑵ **움직이는 즉시 반응한다** — 조건은 매 렌더 재판정되므로 슬라이더를 끌면
 *     체크가 실시간으로 켜지고 꺼진다. 「제출」 버튼이 없는 것이 요점이다.
 *  ⑶ **달성이 남는다(래치)** — 한 번 켜진 목표는 조건을 벗어나도 ✅로 남는다.
 *     계속 탐구하라고 만든 화면인데 다음 슬라이더 조작에서 성취가 지워지면
 *     학습자는 값을 고정해 두고 화면을 떠난다.
 *
 * 래치는 **세션(마운트) 한정**이다 — localStorage에 남기지 않는다. 탐구는 진도가
 * 아니라 체험이라 저장할 상태가 아니고, 저장하면 "이미 달성됨"으로 시작해 ⑴이
 * 죽는다. 되돌아오면 다시 해 보는 것이 이 화면의 의도다.
 *
 * ⚠️ SSR에서는 래치가 비어 있다(useEffect 미실행) — 첫 페인트는 항상 「미달성」이다.
 * 기본 입력에서 달성되는 목표가 없다는 계약(exploreGoals 설계 규칙 ①)과 맞물려,
 * 서버 렌더 결과에 ✅가 하나라도 있으면 그 자체가 회귀 신호다.
 *
 * 애니메이션을 쓰지 않는다 — 축하는 색·아이콘·문구로만 한다. prefers-reduced-motion
 * 분기를 늘리지 않으면서 저장소의 "색 단독으로 정보를 나르지 않는다" 관례를 지킨다
 * (✅/⭕ 아이콘과 「달성!」 라벨이 색과 함께 간다).
 */
export default function GoalPanel({ goals, facts }) {
  const t = useT();
  const met = evaluateGoals(goals, facts);

  // 래치 — 한 번 달성한 id는 남는다. 의존은 met의 **문자열 서명**이다: facts는 매
  // 렌더 새 객체라 참조로 걸면 효과가 매번 돈다.
  const [achieved, setAchieved] = useState(() => []);
  const signature = met.map((v) => (v ? '1' : '0')).join('');
  useEffect(() => {
    const fresh = goals.filter((g, i) => met[i] && !achieved.includes(g.id)).map((g) => g.id);
    if (fresh.length > 0) setAchieved((prev) => [...prev, ...fresh]);
    // signature가 바뀔 때만 재평가한다(achieved 갱신으로 인한 재실행은 fresh가 비어 멈춘다).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  const done = goals.map((g, i) => met[i] || achieved.includes(g.id));
  const doneCount = done.filter(Boolean).length;
  const allDone = goals.length > 0 && doneCount === goals.length;

  return (
    <section
      className={`rounded-2xl p-4 shadow-sm ring-1 ${
        allDone ? 'bg-emerald-50 ring-emerald-200' : 'bg-white ring-slate-200'
      }`}
      aria-label={t('explore.goals.title')}
    >
      <div className="flex items-baseline justify-between gap-2">
        {/* 🔴 제목만 한 단계 크게(2026-08-19 사용자 지시 — "「탐구 목표」 이 제목
            글씨 크기만 조금 더 키워줘"). `text-sm`(14) → `text-base`(16).
            ⚠️ **목표 항목의 글자는 건드리지 않는다** — 지시가 「이 제목 글씨만」
            이고, 항목까지 키우면 카드가 통째로 커져 2열 행 높이가 밀린다.
            같은 이유로 옆의 달성 배지도 그대로다: `items-baseline` 정렬이라
            제목만 커져도 두 글자의 밑선은 그대로 맞는다. */}
        <p className="text-base font-bold text-slate-700">{t('explore.goals.title')}</p>
        <span
          className={`rounded-full px-2.5 py-0.5 text-[11px] font-extrabold ${
            allDone ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-600'
          }`}
          // 진행도는 보조기술에도 숫자로 읽혀야 한다 — 색·굵기로만 나르지 않는다.
          role="status"
        >
          {t('explore.goals.progress', { done: doneCount, total: goals.length })}
        </span>
      </div>

      <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {goals.map((goal, i) => (
          <li
            key={goal.id}
            className={`rounded-xl px-3 py-2 ring-1 ${
              done[i] ? 'bg-emerald-50/70 ring-emerald-200' : 'bg-slate-50 ring-slate-200'
            }`}
          >
            <div className="flex items-start gap-2">
              <span aria-hidden="true" className="text-sm leading-5">
                {done[i] ? '✅' : '⭕'}
              </span>
              <div className="min-w-0 flex-1">
                <p
                  className={`text-[13px] font-bold ${done[i] ? 'text-emerald-800' : 'text-slate-700'}`}
                >
                  {t(goal.titleKey)}
                  {done[i] && (
                    <span className="ml-1.5 rounded-full bg-emerald-600 px-1.5 py-0.5 align-middle text-[10px] font-extrabold text-white">
                      {t('explore.goals.doneBadge')}
                    </span>
                  )}
                </p>
                {/* 미달성이면 **할 일**, 달성이면 **알아낸 것**으로 바뀐다 —
                    성취의 보상이 다음 지시문이 아니라 개념 한 줄이어야 탐구가 학습이 된다. */}
                {done[i] ? (
                  <p className="mt-0.5 text-[11px] leading-relaxed text-emerald-900">
                    <b className="font-bold">{t('explore.goals.lessonLabel')} </b>
                    {t(goal.lessonKey)}
                  </p>
                ) : (
                  <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">
                    {t(goal.taskKey)}
                  </p>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>

      {allDone ? (
        <p className="mt-3 rounded-xl bg-emerald-600 px-3 py-2 text-center text-[12px] font-bold text-white">
          {t('explore.goals.allDone')}
        </p>
      ) : (
        <p className="mt-3 text-[10.5px] leading-relaxed text-slate-400">
          {t('explore.goals.howto')}
        </p>
      )}
    </section>
  );
}
