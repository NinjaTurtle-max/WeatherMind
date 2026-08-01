import { Link } from 'react-router-dom';
import {
  requiredStage,
  selectUnlockStage,
  useOnboardingGate,
} from '../lib/onboardingGate';

/**
 * FeatureUnlockGate — 점진적 잠금 해제의 **동기 부여 화면** (R10-01 §3.4 / R10-F,
 * 클라이언트 판정 정정 2026-08-01).
 *
 * 잠긴 기능을 자물쇠로 차단하지 않는다. 탭·라우트는 그대로 열려 있고, 아직
 * 해제 전이면 그 자리에 "이 기능이 무엇인지 · 왜 해볼 만한지 · 언제 열리는지 ·
 * 열려면 지금 무엇을 하면 되는지(CTA)"를 보여준다. 차단이 아니라 다음 행동으로
 * 밀어주는 화면이다.
 *
 * 여전히 **프론트 표시 계층**이다 — 서버 권한이 아니고, 해제 단계는
 * lib/onboardingGate(세션 완료 횟수)에서 온다. 기존 사용자(진척 있음)는
 * 부트스트랩에서 전부 해제로 계산되므로 이 화면을 보지 않는다(회귀 0).
 *
 * 해제 조건(§3.4): 보드=세션 1회 · 예보 대결=2회 · 리그=3회.
 */

const COPY = {
  '/board': {
    icon: '🧩',
    title: '대기 보드란 무엇인가요?',
    points: [
      '기단·전선·습기·일사를 직접 배치해요',
      '배치한 대로 실제 대기 현상이 만들어져요',
      '외우지 않고 원리를 손으로 익혀요',
    ],
  },
  '/duel': {
    icon: '🌡️',
    title: '예보 대결이란 무엇인가요?',
    points: [
      '오늘의 기온·강수확률을 직접 예측해요',
      'AI 캐스터의 예보와 정확도를 겨뤄요',
      '실제 관측값으로 다음 날 채점돼요',
    ],
  },
  '/league': {
    icon: '🏆',
    title: '리그란 무엇인가요?',
    points: [
      '구름 티어(층운 → 태풍의 눈)로 승급해요',
      '예보 정확도로 순위가 정해져요',
      '주간 정산으로 티어가 오르내려요',
    ],
  },
};

/** 해제까지 남은 세션 수를 "지금 할 일"로 번역한 CTA */
const CTA = { to: '/daily', label: '오늘의 세션 시작하기 →' };

export default function FeatureUnlockGate({ to, children }) {
  const stage = useOnboardingGate(selectUnlockStage);
  const need = requiredStage(to);

  if (stage >= need) return children;

  const copy = COPY[to];
  const remain = Math.max(1, need - stage);

  return (
    <div className="mt-6 rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-slate-200">
      <p className="text-4xl" aria-hidden="true">
        {copy?.icon ?? '✨'}
      </p>
      <h1 className="mt-3 text-lg font-extrabold text-slate-900">
        {copy?.title ?? '아직 열리지 않은 기능이에요'}
      </h1>

      {copy?.points && (
        <ul className="mx-auto mt-4 flex max-w-xs flex-col gap-2 text-left">
          {copy.points.map((point) => (
            <li key={point} className="flex items-start gap-2 text-sm text-slate-600">
              <span className="mt-0.5 shrink-0 text-sky-500" aria-hidden="true">
                ✓
              </span>
              <span>{point}</span>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-5 rounded-xl bg-sky-50 px-4 py-3 text-sm font-bold text-sky-800 ring-1 ring-sky-100">
        세션을 {need}개 완료하면 시작할 수 있어요
        <span className="mt-1 block text-xs font-medium text-sky-600">
          지금까지 {stage}/{need} 완료 — {remain}개만 더!
        </span>
      </p>

      <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full bg-sky-500 transition-all duration-500"
          style={{ width: `${Math.round((stage / need) * 100)}%` }}
        />
      </div>

      <Link
        to={CTA.to}
        className="mt-5 block w-full rounded-xl bg-sky-600 py-3 text-sm font-bold text-white transition hover:bg-sky-700"
      >
        {CTA.label}
      </Link>
      <Link
        to="/"
        className="mt-2 inline-block text-xs font-medium text-slate-400 hover:text-slate-600"
      >
        학습 경로 보기
      </Link>
    </div>
  );
}
