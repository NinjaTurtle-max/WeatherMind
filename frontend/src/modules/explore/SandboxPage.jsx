import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import AtmosphereBoard from '../board/AtmosphereBoard';
import { ZONES } from '../../lib/boardEngine';
import { useT } from '../../i18n';

/**
 * 자유 실험 (R9-01 §3.3 ⑥) — 라우트 `/explore/sandbox`.
 *
 * 목표·채점·타이머 없는 전 요소 팔레트 샌드박스. 판정은 **로컬 엔진**이 하므로
 * 구름을 소모하지 않고 시도 로그도 남기지 않는다.
 *
 * ⚠️ "서버 호출 0"은 아니다(보드에 있던 종전 주석의 표현은 틀렸다 — 2026-08-10
 * 실측). 판은 `/board/rules`·`/board/regions`를 부른다. 둘 다 판정 규칙과 지도라
 * 유저와 무관한 정적 자료다. **구름을 소모하는 것은 퍼즐 진입
 * (`/board/puzzles/{id}`) 하나뿐**이고 여기는 그걸 안 부른다 — 그래서 잔량 0에서도
 * 열린다.
 *
 * 2026-08-10(사용자 지시)에 **보드에서 탐구로 옮겨 왔다.** 보드는 목표가 있는
 * 미션판이고 여기는 목표가 없는 관찰이라, 같은 화면에 두면 "채점되는 것"과
 * "채점 안 되는 것"이 한 줄에 섞인다. 탐구(태풍 시뮬·기후 시뮬·기후 탐정)가
 * 정확히 그 성격의 모음이므로 그쪽이 제자리다.
 *
 * ⚠️ 화면 자체는 여전히 **보드**다(AtmosphereBoard). 그래서 문구도 `board.page.
 * sandbox*`에 그대로 두었다 — 옮긴 것은 입구이지 판이 아니다.
 */

// 팔레트는 요소 전종이다. 미션판과 달리 무엇을 놓을지 제한하지 않는다 —
// 제한이 곧 목표인데 여기에는 목표가 없다.
const SANDBOX_PUZZLE = {
  mode: 'sandbox',
  initial_state: { zones: [...ZONES], elements: [] },
  palette: [
    'air_mass:siberian',
    'air_mass:north_pacific',
    'air_mass:yangtze',
    'air_mass:okhotsk',
    'front:cold',
    'front:warm',
    'front:stationary',
    'moisture',
    'sun',
  ],
  goal_conditions: [],
  hints: [],
};

export default function SandboxPage() {
  const t = useT();
  // question_text는 로케일 의존이라 렌더 시 주입한다. **참조 안정성을 지켜야
  // 한다** — AtmosphereBoard가 puzzle identity가 바뀌면 보드를 리셋하므로,
  // 매 렌더 새 객체를 넘기면 놓은 요소가 계속 지워진다.
  const sandboxQuestion = t('board.page.sandboxQuestion');
  const puzzle = useMemo(
    () => ({ ...SANDBOX_PUZZLE, question_text: sandboxQuestion }),
    [sandboxQuestion],
  );

  return (
    <div className="pt-2">
      <Link
        to="/explore"
        className="mb-2 inline-block text-sm font-medium text-slate-500 hover:text-slate-700"
      >
        {t('explore.common.back')}
      </Link>
      <AtmosphereBoard puzzle={puzzle} sandbox layout="wide" />
      <p className="mt-2 text-center text-xs text-slate-400">{t('board.page.sandboxFooter')}</p>
    </div>
  );
}
