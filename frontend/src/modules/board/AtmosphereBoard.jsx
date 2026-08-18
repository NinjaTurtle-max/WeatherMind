import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { boardApi } from '../../api';
import {
  ZONES,
  DEFAULT_MOISTURE,
  DEFAULT_SUN,
  DEFAULT_WIND,
  createBoard,
  evaluateBoard,
  checkGoals,
  placeElement,
  removeElement,
  setLevel,
  isLocked,
  toSubmitState,
  zoneStates,
} from '../../lib/boardEngine';
import {
  parsePaletteToken,
  subtypeLabel,
  phenomenonMeta,
  cloudMeta,
} from './boardDisplay';
import { FALLBACK_REGIONS } from './boardLayout';
// 존 표시명 — 서버 원문(한국어)을 로케일 리소스로 덮는다(MT-28)
import { zoneLabel } from './PeninsulaMap';
import { SymbolIcon } from './boardSymbols';
import BoardHintPanel from './BoardHintPanel';
import Mascot from '../../components/Mascot';
import CrossSectionPanel from './CrossSectionPanel';
import PeninsulaMap from './PeninsulaMap';
import useBoardDrag from './useBoardDrag';
import { useT } from '../../i18n';

// 언두 스택 상한 (§3.5 — "히스토리 스택(≤ 20)")
export const HISTORY_LIMIT = 20;

// 히스토리 병합 키의 유일 번호 — 배치·제거는 매번 새 칸을 쌓는다(연속 병합 금지).
let _historySeq = 0;
const historySeq = () => ++_historySeq;

// 힌트 2단이 노출하는 "요소 종류" 라벨 키 (§3.5 — subtype = 정답 요소는 절대 미노출)
// 값은 i18n 키 — 렌더 시 t()로 해석한다(R11-01 §6.3 외부화).
export const HINT_KIND_LABEL = Object.freeze({
  front: 'board.atmosphere.kind.front',
  air_mass: 'board.atmosphere.kind.airMass',
  moisture: 'board.atmosphere.kind.moisture',
  sun: 'board.atmosphere.kind.sun',
  wind: 'board.atmosphere.kind.wind',
});

/** 조절값(level) 요소의 미배치 기본값 — 엔진 상수와 같은 값이어야 한다 (§3.1) */
const LEVEL_DEFAULTS = Object.freeze({
  moisture: DEFAULT_MOISTURE,
  sun: DEFAULT_SUN,
  wind: DEFAULT_WIND,
});

/**
 * 재난 판정(R13 CO-A3·CO-K4) — 다른 현상과 **다르게 보여야 하는** 판정 결과.
 * 재난 보드가 목표를 'clear'(맑음)로 잡던 시절에는 산불을 만들어도 화면이
 * "☀️ 맑음"이라고 말했다. 이제 판정 자체가 재난이고, 그 순간 이 배너가 뜬다.
 */
export const DISASTER_META = Object.freeze({
  wildfire_risk: {
    titleKey: 'board.atmosphere.disasterWildfireTitle',
    bodyKey: 'board.atmosphere.disasterWildfireBody',
    tone: 'bg-orange-50 text-orange-800 ring-orange-200',
  },
  flood_risk: {
    titleKey: 'board.atmosphere.disasterFloodTitle',
    bodyKey: 'board.atmosphere.disasterFloodBody',
    tone: 'bg-sky-100 text-sky-900 ring-sky-300',
  },
});

/** 두 보드의 배치가 실질적으로 같은지 (히스토리에 빈 칸을 쌓지 않기 위한 비교) */
function sameElements(a, b) {
  return JSON.stringify(a?.elements ?? []) === JSON.stringify(b?.elements ?? []);
}

/** 규칙 when 조건에서 요소 **종류**만 뽑는다(타입 접두어). subtype·임계값은 버린다. */
export function ruleHintKinds(rule) {
  const kinds = [];
  for (const cond of rule?.when ?? []) {
    const m = /^(air_mass|front|moisture|sun|wind)/.exec(String(cond).trim());
    if (m && !kinds.includes(m[1])) kinds.push(m[1]);
  }
  return kinds;
}

/**
 * 조건이 이 퍼즐에서 **성립 가능**한지 — 팔레트로 놓을 수 있거나(존재 조건),
 * 조절 가능하거나 기본값이 이미 만족(수치 조건)이면 true.
 * 같은 현상을 내는 규칙이 여럿일 때(예: shower = 한랭전선/대류) 이 퍼즐이 겨냥한
 * 규칙만 남기는 데 쓴다. 판정에는 쓰이지 않는다(힌트 선택 전용).
 */
export function conditionReachable(condition, palette, zoneState) {
  const cond = String(condition ?? '').trim();
  const exists = /^(air_mass|front):([a-z_]+)$/.exec(cond);
  if (exists) {
    const [, type, subtype] = exists;
    if ((palette ?? []).includes(`${type}:${subtype}`)) return true;
    return zoneState?.[type === 'air_mass' ? 'airMass' : 'front'] === subtype;
  }
  const numeric = /^(moisture|sun|wind)(>=|<=)(\d+(?:\.\d+)?)$/.exec(cond);
  if (numeric) {
    const [, field, op, raw] = numeric;
    if ((palette ?? []).includes(field)) return true; // 슬라이더로 도달 가능
    const actual = zoneState?.[field] ?? LEVEL_DEFAULTS[field];
    return op === '>=' ? actual >= Number(raw) : actual <= Number(raw);
  }
  return false;
}

/**
 * 목표 현상을 만드는 규칙 후보 — goal(현상·구름) 일치 + 이 퍼즐에서 성립 가능.
 * 힌트 2단의 "필요한 요소 종류"·`hint_needs` 문구 출처.
 */
export function hintRulesForGoal(rules, goal, palette, zoneState) {
  if (!goal) return [];
  return (rules ?? []).filter((rule) => {
    if (goal.phenomenon != null && rule?.then?.phenomenon !== goal.phenomenon) return false;
    if (goal.cloud != null && rule?.then?.cloud !== goal.cloud) return false;
    return (rule?.when ?? []).every((c) => conditionReachable(c, palette, zoneState));
  });
}

/**
 * AtmosphereBoard (R3-01 S3·S5) — 한반도 단면 4존 대기 보드 플레이어.
 * 연습 탭(BoardPage)과 세션 문항(QuestionCard board 분기)이 공유한다.
 *
 * props:
 *   - puzzle: template_json (§3.3) — question_text/mode/guide_steps/initial_state/palette/goal_conditions/hints
 *   - onSubmit(boardState): 제출 콜백. 부모가 실제 API(연습 attempt / 세션 answer)를 호출.
 *   - disabled, submitting: 제출 중/비활성
 *   - result: 서버 판정 결과 {passed, phenomena, feedback} (있으면 표시 — 연습 탭 경로)
 *   - phenomena: 서버 판정 존별 현상 배열만 (R9-01 §3.3 ⑤ 세션 경로 —
 *     세션은 피드백 UI(ResultBanner)를 부모가 그리므로 결과 배너 없이
 *     확정 리플레이(현상 스테이지)만 트리거한다)
 *   - sandbox: 자유 실험 모드 (R9-01 §3.3 ⑥) — 목표·채점·제출 없이 배치→
 *     로컬 엔진 즉시 반응만. 서버 호출 0 (구름 미소모·로그 없음).
 *
 * 규칙(§3.2)은 GET /board/rules로 로드해 배치 즉시 로컬 미리보기 판정을 한다(단일 진실원).
 * 서버 재판정이 권위 채점이며(§3.4), 로컬 판정은 학습용 미리보기일 뿐이다.
 *
 * ── R10-01 §3.5 (S5 / R10-E) 풀이 보조 ──
 * 1) 언두: 배치 히스토리 스택(≤ HISTORY_LIMIT) + "되돌리기". 순수 클라이언트 —
 *    서버 호출 0이므로 **구름을 소모하지 않는다**(에너지는 오답 제출에만 소모).
 *    제출·판정 확정·시간 초과 후에는 비활성(interactive=false).
 * 2) 점진적 힌트 2단(기존 0/2 카운터 재사용) — **정답 배치를 보여주지 않는다**:
 *      1단 = 목표 존만 하이라이트(어느 지역을 먼저 볼지)
 *      2단 = 필요한 "요소 종류"(전선 계열·기단 계열·습기·일사) + 저작 문구
 *    문구는 board_rules.json의 `hint_needs`(R10-01 §3.5 additive 저작 필드, 8종
 *    전부)를 그대로 쓴다. explain(현상 해설 — 정답 요소명 포함)은 힌트에 쓰지 않고,
 *    요소 종류는 규칙 `when`의 **타입 접두어만** 사용해 subtype(정답 요소)이 새지
 *    않게 한다. 문항 저작 `hints`(정답 좌표·수치를 그대로 알려주는 기존 문구)는
 *    이 경로에서 쓰지 않는다.
 */
/**
 * `layout` — 이 보드가 어디에 놓이느냐.
 *
 *   'stacked'(기본) : 세로로 쌓는다. **세션 문항**이 쓰는 배치다. 세션은 보드를
 *                     좁은 문항 카드 안에 넣으므로 3열을 켜면 안 된다(뷰포트 기준
 *                     미디어쿼리라 카드가 좁아도 3열이 켜진다).
 *   'wide'          : 보드 탭 전용 3열 — 팔레트 / 지도 / 미션·가이드·판정.
 *                     시안 `docs/design/board_mockup.html`의 배치다.
 *
 * 'wide'에서만 **존 카드 4장을 걷어낸다**(2026-08-05 결정). 같은 값을 지도 노드 ·
 * 요약 줄 · 카드 셋이 말하고 있었고, 카드가 세로 200px를 먹어 지도와 제출 버튼을
 * 한 화면에서 못 봤다. 대신 「지금 고른 존」한 줄 + 팔레트의 슬라이더 1개로 옮긴다.
 * 슬라이더를 1개로 줄여도 잃는 것이 없는 근거: 시드 board 문항이 **전부** 목표 존
 * 1개다(`goal_conditions` zone 단일 — 문항 수는 늘어나므로 세지 않는다). 값 자체는
 * 존마다 그대로 따로 갖는다.
 */
export default function AtmosphereBoard({ puzzle, onSubmit, disabled = false, submitting = false, result = null, phenomena = null, sandbox = false, layout = 'stacked' }) {
  const wide = layout === 'wide';
  const t = useT();
  const [board, setBoard] = useState(() => createBoard(puzzle?.initial_state));
  const boardRef = useRef(board); // 같은 turn 내 연속 변경의 기준값 (applyBoard)
  const [history, setHistory] = useState([]); // 언두 스택 [{key, board}] — 최근 HISTORY_LIMIT개
  const [selected, setSelected] = useState(null); // 선택된 팔레트 토큰(탭 배치용)
  const [hintLevel, setHintLevel] = useState(0); // 공개한 힌트 수 (2단계 순차)
  const [guideStep, setGuideStep] = useState(0); // guided 안내 진행
  const [guideOpen, setGuideOpen] = useState(false); // 배너 「가이드」 칩의 오버레이(wide)
  const guideRef = useRef(null);
  const guideToggleRef = useRef(null);
  // 닫으면 **칩으로 포커스를 돌려준다**. 안 돌려주면 포커스가 사라진 노드와 함께
  // <body>로 떨어져 키보드 사용자가 처음부터 Tab을 다시 밟아야 한다
  // (ConfirmDialog가 쓰는 관례와 같다 — 2026-08-12 리뷰).
  const closeGuide = () => {
    setGuideOpen(false);
    guideToggleRef.current?.focus();
  };
  const [activeZone, setActiveZone] = useState(null); // 현상 스테이지 포커스 존(마지막 조작 존)

  // 미니 미션(§3.5): time_limit_sec 있으면 카운트다운, 초과 시 실패(재도전 무제한).
  const timeLimit = Number(puzzle?.time_limit_sec);
  const hasTimer = Number.isFinite(timeLimit) && timeLimit > 0;
  const [attemptKey, setAttemptKey] = useState(0); // 재도전마다 보드·타이머 리셋
  const [remaining, setRemaining] = useState(hasTimer ? timeLimit : 0);
  const [timedOut, setTimedOut] = useState(false);

  // 「가이드」 오버레이는 바깥을 누르거나 Esc로 닫힌다. 떠 있는 카드는 닫는
  // 길이 명확해야 한다 — 칩을 다시 찾아 누르게 만들면 지도 위를 덮은 채 남는다.
  // 리스너는 **열려 있을 때만** 붙인다(닫힌 동안 document 이벤트를 받지 않는다).
  useEffect(() => {
    if (!guideOpen) return undefined;
    const onPointerDown = (e) => {
      // 칩 자신은 제외 — 여기서 닫으면 칩의 onClick이 곧바로 다시 연다.
      if (guideRef.current?.contains(e.target)) return;
      if (e.target.closest?.('[data-testid="board-guide-toggle"]')) return;
      // 포커스가 카드 안(예: 「다음 안내」)에 있었으면 그 노드가 지금 사라진다.
      // 그렇다고 여기서 곧바로 칩에 focus()를 주면 **사용자가 방금 누른 요소에서
      // 포커스를 빼앗는다**. 브라우저가 클릭 대상에 포커스를 옮길 기회를 준 뒤,
      // 아무도 안 가져갔을 때(=<body>로 떨어졌을 때)만 칩으로 돌려준다.
      const wasInside = guideRef.current?.contains(document.activeElement);
      setGuideOpen(false);
      if (!wasInside) return;
      requestAnimationFrame(() => {
        if (document.activeElement === document.body) guideToggleRef.current?.focus();
      });
    };
    const onKeyDown = (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      closeGuide();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [guideOpen]);

  // 문항이 바뀌거나 재도전하면 상태 초기화 (타이머 포함)
  useEffect(() => {
    const fresh = createBoard(puzzle?.initial_state);
    boardRef.current = fresh;
    setBoard(fresh);
    setHistory([]); // 언두 스택도 함께 초기화 — 다른 문항의 배치로 되돌아가지 않게
    setSelected(null);
    setHintLevel(0);
    setGuideStep(0);
    setGuideOpen(false); // 다른 문항으로 넘어갔는데 앞 문항의 안내가 떠 있으면 안 된다
    setActiveZone(null);
    setTimedOut(false);
    setRemaining(hasTimer ? timeLimit : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [puzzle, attemptKey]);

  // 카운트다운: 제출(result)·시간초과 전까지 1초씩 감소, 0에서 실패 처리.
  // 세션 컨텍스트(R8-01 B①): 부모가 disabled/submitting으로 잠근 동안(채점 왕복·
  // 피드백 표시 — 세션은 result prop을 쓰지 않음)은 타이머를 일시정지해
  // 응답 완료된 문항이 뒤늦게 '시간 초과'로 뒤집히지 않게 한다.
  useEffect(() => {
    if (!hasTimer || timedOut || result || disabled || submitting) return;
    if (remaining <= 0) {
      setTimedOut(true);
      return;
    }
    const t = setTimeout(() => setRemaining((r) => r - 1), 1000);
    return () => clearTimeout(t);
  }, [hasTimer, remaining, timedOut, result, disabled, submitting]);

  const retry = () => setAttemptKey((k) => k + 1);

  const { data: rules } = useQuery({
    queryKey: ['board', 'rules'],
    queryFn: boardApi.fetchBoardRules,
    staleTime: 60 * 60 * 1000, // 규칙은 세션 내 불변 — 한 번만 로드
  });

  // 지도 지역 좌표(R5-01 §3.1) — zone index↔지역 고정 매핑. 렌더 전용(판정 불변).
  // 로드 실패/지연 시 지리적 폴백 좌표를 쓴다(서해 왼쪽·수도권 중앙·태백 우측·동해 맨우측).
  const { data: regionsData } = useQuery({
    queryKey: ['board', 'regions'],
    queryFn: boardApi.fetchBoardRegions,
    staleTime: 60 * 60 * 1000,
  });
  const regions = useMemo(() => {
    const byZone = new Map((regionsData ?? []).map((r) => [r.zone, r]));
    return ZONES.map((zoneName, zone) => byZone.get(zone) ?? { zone, name: zoneName, ...FALLBACK_REGIONS[zone] });
  }, [regionsData]);

  const palette = puzzle?.palette ?? [];
  const paletteItems = useMemo(() => palette.map((t) => ({ token: t, ...parsePaletteToken(t) })), [palette]);
  // 조절값 슬라이더 — 팔레트가 허용한 것만, **항상 같은 순서**로 그린다.
  // 종류를 배열로 두는 것이 wind 추가의 전부다(전에는 moisture·sun 두 벌을 손으로
  // 복제해 두 배치에 각각 박아 두었고, 그래서 요소 하나 늘리는 데 네 곳을 고쳐야 했다).
  const levelKnobs = useMemo(
    () =>
      [
        { type: 'moisture', labelKey: 'board.atmosphere.moisture' },
        { type: 'sun', labelKey: 'board.atmosphere.sun' },
        { type: 'wind', labelKey: 'board.atmosphere.wind' },
      ].filter((knob) => palette.includes(knob.type)),
    [palette],
  );
  const placeItems = paletteItems.filter((it) => it.type === 'air_mass' || it.type === 'front');

  // 로컬 미리보기 판정 (규칙 로드 전에는 빈 배열 → 기본값 흐림)
  const preview = useMemo(() => evaluateBoard(board, rules ?? []), [board, rules]);
  const goals = useMemo(
    () => checkGoals(preview, puzzle?.goal_conditions),
    [preview, puzzle?.goal_conditions],
  );

  const interactive = !disabled && !submitting && !result && !timedOut;

  // ── 언두(§3.5) — 모든 보드 변경은 이 래퍼를 통과한다(히스토리 누락 방지) ──
  /**
   * @param key 연속 병합 키. 같은 키가 스택 top이면 새로 쌓지 않는다 —
   *   슬라이더 드래그 1회가 히스토리 수십 칸을 먹지 않게 하고, 언두 1회로
   *   드래그 시작 전 값으로 돌아가게 한다. 배치·제거는 매번 유일 키를 쓴다.
   */
  const applyBoard = (key, mutate) => {
    // boardRef: 같은 이벤트 turn에서 두 번 호출돼도(예: 칩 제거 클릭이 존 카드로
    // 버블링) 뒤 호출이 앞 호출을 덮어쓰지 않게 최신 상태를 들고 간다.
    const prev = boardRef.current;
    const next = mutate(prev);
    // 잠금·동일 배치 재적용 등 실질 변화가 없으면 히스토리를 남기지 않는다
    // (되돌리기를 눌러도 아무 일 없는 빈 칸이 쌓이는 것을 막는다)
    if (next === prev || sameElements(next, prev)) return;
    boardRef.current = next;
    setHistory((h) => {
      const top = h[h.length - 1];
      if (top && top.key === key) return h; // 같은 조작의 연속 — 최초 상태만 보존
      return [...h, { key, board: prev }].slice(-HISTORY_LIMIT);
    });
    setBoard(next);
  };
  const undo = () => {
    if (!interactive || history.length === 0) return;
    const last = history[history.length - 1];
    boardRef.current = last.board;
    setHistory((h) => h.slice(0, -1));
    setBoard(last.board);
    setActiveZone(null);
  };

  // 존에 배치 (선택된 팔레트 항목 사용)
  const placeOn = (zone, item) => {
    if (!interactive || !item) return;
    if (item.type === 'air_mass' || item.type === 'front') {
      applyBoard(`place:${zone}:${item.type}:${historySeq()}`, (b) => placeElement(b, zone, item.type, item.subtype));
      setActiveZone(zone); // 배치 즉시 해당 존 현상 재생(§3.3 ④)
    }
  };
  const handleZoneClick = (zone) => {
    if (selected) placeOn(zone, selected);
    else setActiveZone(zone); // 조회 탭 — 스테이지 포커스만 이동
  };

  // Pointer Events 드래그(R9-01 §3.3 ③) — 마우스+터치 공통, 탭-탭 경로 병행
  const { drag, dragging, handlePointerDown, shouldSuppressClick } = useBoardDrag({
    enabled: interactive,
    onDropZone: (zone, item) => placeOn(zone, item),
  });

  const zoneElement = (zone, type) =>
    board.elements.find((el) => el.zone === zone && el.type === type);
  const zoneLevel = (zone, type, dflt) => zoneElement(zone, type)?.level ?? dflt;

  // 현상 스테이지(§3.3 ④) 데이터 — 로컬 미리보기 즉시 재생, 서버 판정 후 확정 리플레이.
  // 서버 phenomena는 로컬 엔진과 같은 형태({zone, zone_name, phenomenon, cloud, rule_id, explain}).
  const goalZone = puzzle?.goal_conditions?.[0]?.zone ?? null;
  const confirmedPhenomena = Array.isArray(result?.phenomena)
    ? result.phenomena // 연습 탭: attempt 응답
    : Array.isArray(phenomena)
      ? phenomena // 세션: AnswerResult.phenomena (§3.3 ⑤)
      : null;
  const stageZone = confirmedPhenomena ? (goalZone ?? activeZone ?? 0) : (activeZone ?? goalZone ?? 0);
  const stageResult = confirmedPhenomena
    ? (confirmedPhenomena.find((p) => p.zone === stageZone) ?? confirmedPhenomena[stageZone] ?? null)
    : (preview[stageZone] ?? null);

  // ── 성공 시 애니메이션으로 스크롤 (2026-08-06 요청) ────────────────────────
  // 단면 패널은 지도 **아래**에 있어서, 목표를 달성해도 화면 밖에서 재생됐다 —
  // 직접 내려가야 볼 수 있으니 사실상 못 보고 지나친다. 성공 순간 패널을 화면
  // 안으로 끌어온다.
  const stageRef = useRef(null);
  // 같은 국면으로 두 번 스크롤하지 않는다(리렌더마다 화면이 튄다). 미리보기 성공과
  // 서버 확정은 **다른 장면**이라 각각 한 번씩 안내한다.
  const scrolledFor = useRef(null);
  // CO-K7: 목표가 **없는** 판(자유 실험 SANDBOX_PUZZLE.goal_conditions=[])에서는
  // JS `checkGoals`가 빈 목표를 `passed:true`로 돌려주므로, 아무것도 안 했는데
  // 마운트 즉시 단면 패널로 화면이 튀었다. 달성할 목표가 있어야 "달성"이다.
  const hasGoals = (puzzle?.goal_conditions?.length ?? 0) > 0;
  const scrollPhase = confirmedPhenomena ? 'confirmed' : hasGoals && goals.passed ? 'preview' : null;
  useEffect(() => {
    scrolledFor.current = null; // 재도전·다른 퍼즐이면 다시 안내한다
  }, [attemptKey, puzzle]);
  useEffect(() => {
    if (!scrollPhase || scrolledFor.current === scrollPhase) return;
    scrolledFor.current = scrollPhase;
    const el = stageRef.current;
    if (!el?.scrollIntoView) return;
    // 동작 줄이기 설정이면 순간 이동 — 스크롤도 애니메이션이다(index.css §접근성)
    const reduce = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
  }, [scrollPhase]);

  // 지도 오버레이용 존별 표시 결과(R9-08 §A) — 서버 확정이 있으면 확정, 없으면 미리보기.
  const zoneVisuals = useMemo(
    () =>
      ZONES.map((_, z) => {
        if (confirmedPhenomena) {
          return confirmedPhenomena.find?.((p) => p?.zone === z) ?? confirmedPhenomena[z] ?? preview[z] ?? null;
        }
        return preview[z] ?? null;
      }),
    [confirmedPhenomena, preview],
  );

  // ── 점진적 힌트 2단(§3.5) ──────────────────────────────────────────────────
  // 1단: 목표 존만 지목·하이라이트 (정답 요소 미공개)
  // 2단: 필요한 요소 **종류** + board_rules.json `hint_needs` 저작 문구
  // 문항 저작 hints(정답 배치·수치 노출)는 쓰지 않는다 — 계약 "정답 배치 미공개".
  const hintZone = goalZone;
  const hintGoal = puzzle?.goal_conditions?.[0] ?? null;
  const hintZoneState = useMemo(
    () => (hintZone == null ? null : zoneStates(createBoard(puzzle?.initial_state))[hintZone] ?? null),
    [puzzle, hintZone],
  );
  const hintRules = useMemo(
    () => hintRulesForGoal(rules, hintGoal, palette, hintZoneState),
    [rules, hintGoal, palette, hintZoneState],
  );
  const hintKinds = useMemo(() => {
    const kinds = [];
    for (const rule of hintRules) {
      for (const kind of ruleHintKinds(rule)) if (!kinds.includes(kind)) kinds.push(kind);
    }
    // 후보 규칙을 못 찾았을 때만 팔레트 종류로 대체(정답 요소는 여전히 미노출).
    // **방어 코드다** — 실데이터에서는 걸리지 않는다(P2-2 조사, 2026-08-03):
    // 시드 board 12건 전부 후보 규칙이 정확히 1개로 좁혀지고(폴백 0/12), 규칙 8종이
    // 모두 어느 퍼즐에서든 후보로 선택된다. `boardAssistRetention.smoke.test.mjs`가
    // 이 사실을 상주 고정하므로, 새 퍼즐이 폴백에 빠지면 테스트가 먼저 실패한다.
    // 남겨두는 이유(실제로 도달 가능한 경로):
    //   ① 규칙 로드 전(GET /board/rules 지연·실패) ② ai-worker 생성 퍼즐이 규칙
    //   8종으로 성립 불가한 목표를 담은 경우 ③ 규칙 파일만 먼저 축소 저작된 경우.
    if (kinds.length === 0) {
      for (const item of paletteItems) if (!kinds.includes(item.type)) kinds.push(item.type);
    }
    return kinds;
  }, [hintRules, paletteItems]);
  // 문항 저작 `hints`는 **표시하지 않는다** — 시드 문구가 "존 1에 한랭전선을 놓고
  // 습기를 60 이상"처럼 정답 배치를 그대로 알려주기 때문(§3.5 "정답 배치 미공개").
  // 다만 "이 퍼즐에 힌트를 제공한다"는 저작 의사는 그대로 존중해 여부만 읽는다
  // (백엔드 template_json 화이트리스트와 양방향 일치 계약 —
  //  backend/tests/test_session_board_item.py TestWhitelistFrontendContract).
  const hintsAuthored = (puzzle?.hints?.length ?? 0) > 0;
  const hintSteps = useMemo(() => {
    if (sandbox || hintZone == null || !hintsAuthored) return [];
    const zoneName = regions[hintZone]?.name ?? ZONES[hintZone];
    const needs = hintRules.map((r) => r.hint_needs).filter(Boolean);
    return [
      t('board.atmosphere.hintStep1', { zone: zoneName }),
      // needs가 비는 경로는 hintKinds 폴백과 동일한 방어 케이스다(주석 참조 —
      // 실시드 12/12는 후보 1개). 그때도 "요소 종류" 칩은 팔레트에서 채워지므로
      // 2단이 완전히 무내용이 되지는 않는다.
      needs.length > 0
        ? needs.join(t('board.atmosphere.hintJoiner'))
        : t('board.atmosphere.hintFallbackStep2'),
    ];
    // t는 렌더마다 새 클로저(로케일 변경 반영) — 매 렌더 재계산이지만 배열 2칸이라 무시 가능
  }, [sandbox, hintZone, hintsAuthored, regions, hintRules, t]);
  const hintZoneActive = hintLevel > 0 && hintZone != null;

  // 「지금 보고 있는 존」 — wide 배치에서 존 카드 4장을 대신하는 한 줄이 이 존을 말한다.
  // stageZone과 같은 규칙(마지막 조작 존 → 목표 존 → 0)이라 단면 패널과 초점이 어긋나지 않는다.
  const focusZone = stageZone;
  const focusAir = board.elements.find((el) => el.zone === focusZone && el.type === 'air_mass');
  const focusFront = board.elements.find((el) => el.zone === focusZone && el.type === 'front');
  const goalTotal = puzzle?.goal_conditions?.length ?? 0;
  const goalMetCount = goalTotal - goals.unmet.length;

  // ── 조각들 ────────────────────────────────────────────────────────────────
  // 배치(stacked/wide)마다 순서가 달라서, 렌더 트리를 먼저 조각으로 만들고 아래에서
  // 조립한다. 조각 안에서 배치를 분기하지 않는다 — 분기는 조립부 한 곳에만 둔다.

  // 지금 보고 있는 존이 재난이면 배너를 띄운다 — 로컬 미리보기든 서버 확정이든
  // 같게 뜬다(stageResult가 둘을 이미 하나로 합쳐 준다).
  const disasterKey = DISASTER_META[stageResult?.phenomenon] ? stageResult.phenomenon : null;
  const disasterBanner = disasterKey && (
    <div
      data-board-disaster={disasterKey}
      className={`mt-2 flex items-start gap-2 rounded-lg px-2.5 py-2 ring-1 ${DISASTER_META[disasterKey].tone}`}
      role="status"
    >
      <SymbolIcon kind="phenomenon" value={disasterKey} className="mt-0.5 h-5 w-5 flex-none" />
      <div className="min-w-0">
        <p className="text-xs font-extrabold">{t(DISASTER_META[disasterKey].titleKey)}</p>
        <p className="mt-0.5 text-[11px] leading-snug opacity-90">{t(DISASTER_META[disasterKey].bodyKey)}</p>
      </div>
    </div>
  );

  // ⚠️ stacked(세션 안 보드) **전용**이다. wide(보드 플레이)는 2026-08-11부터
  // 태양이 문제 배너가 이 역할을 한다 — 거기서 이 블록을 또 그리면 같은 미션이
  // 한 화면에 두 번 뜬다.
  const missionBlock = (
    <div className="rounded-xl bg-sky-50 px-4 py-3 ring-1 ring-sky-100">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-bold text-sky-900">{sandbox ? '🧪' : '🎯'} {puzzle?.question_text}</p>
        {hasTimer && (
          <span
            className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-extrabold tabular-nums ${
              timedOut
                ? 'bg-slate-200 text-slate-500'
                : remaining <= 10
                  ? 'animate-pulse bg-orange-100 text-orange-700'
                  : 'bg-sky-100 text-sky-700'
            }`}
            title={t('board.atmosphere.timerTitle')}
          >
            ⏱ {formatClock(remaining)}
          </span>
        )}
      </div>

      {/* 재현 퍼즐(§3.5): based_on 있으면 "실화" 배지 (사건명·날짜·지역) */}
      {puzzle?.based_on?.event_name && (
        <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-bold text-rose-700">
          <span aria-hidden="true">📖</span>
          {t('board.atmosphere.basedOn')} {puzzle.based_on.event_name}
          {puzzle.based_on.event_date && <span className="font-medium">({puzzle.based_on.event_date}{puzzle.based_on.region ? `, ${puzzle.based_on.region}` : ''})</span>}
        </div>
      )}

      {/* wide는 안내를 아래 「가이드」 카드가 통째로 소유한다 — 여기 한 줄을 같이
          두면 같은 문장이 두 번 뜬다. stacked(세션)는 카드가 없으니 여기 남긴다. */}
      {!wide && puzzle?.mode === 'guided' && (puzzle?.guide_steps?.length ?? 0) > 0 && (
        <div className="mt-2 flex items-center gap-2">
          <p className="flex-1 text-xs text-sky-800">
            <span className="font-bold">{t('board.atmosphere.guidePrefix', { step: guideStep + 1, total: puzzle.guide_steps.length })}</span>{' '}
            {puzzle.guide_steps[guideStep]}
          </p>
          {guideStep + 1 < puzzle.guide_steps.length && (
            <button
              type="button"
              onClick={() => setGuideStep((s) => Math.min(s + 1, puzzle.guide_steps.length - 1))}
              className="shrink-0 rounded-lg bg-sky-600 px-2.5 py-1 text-xs font-bold text-white hover:bg-sky-700"
            >
              {t('board.atmosphere.guideNext')}
            </button>
          )}
        </div>
      )}

      {/* 목표 진행 — "무엇을 만들면 끝나는가"를 수로 보여준다. 로컬 미리보기 판정이라
          제출 전에도 즉시 움직인다(서버 판정이 최종인 것은 아래 「판정」이 말한다).
          시안의 첫 클리어 XP·왕관 목표는 뺐다 — 사전에 알려 주는 API가 없다. */}
      {!sandbox && goalTotal > 0 && (
        <div className="mt-2 flex items-center gap-2 rounded-lg bg-white/70 px-2.5 py-1.5 ring-1 ring-sky-100">
          <span className="text-[11px] font-bold text-slate-500">{t('board.atmosphere.goalProgressLabel')}</span>
          <span className="ml-auto text-[11px] font-extrabold tabular-nums text-sky-700">
            {goalMetCount} / {goalTotal}
          </span>
        </div>
      )}

      {disasterBanner}
    </div>
  );

  /**
   * 「가이드」 — wide에서는 **배너의 칩 하나**이고, 누르면 회색 카드가 뜬다
   * (2026-08-12 사용자 지시. 그 전에는 오른쪽 열 카드였다).
   *
   * 자리를 옮긴 이유는 폭이 아니라 **여백**이다. 두 열이 같은 높이로 끝나는
   * 배치라, 어느 열에 카드를 넣든 반대쪽 열에 그만큼(실측 ~150px) 흰 자리가
   * 생긴다. 세 배치를 실측했는데 단면 그림 크기(459×265)는 어디에 두든 같았다 —
   * 그림은 열 **폭**에만 묶여 있기 때문이다. 그래서 「항상 펼쳐진 카드」를 버리고
   * 「필요할 때 여는 오버레이」로 바꿨다: 여백 0, 단면 그대로.
   *
   * 칩은 **목표 진행 칩 자리**를 대신 쓴다(사용자 지시). 목표가 하나뿐이면
   * 액션 바 미리보기가 같은 것을 말하므로 칩을 뺀다. 목표가 둘 이상이면
   * 미리보기(이분값)로 대체가 안 돼 칩이 함께 남는다.
   *
   * ⚠️ **패널은 칩이 아니라 배너에 매단다.** 칩에 매달면 칩이 줄 어디에 있느냐에
   * 따라 카드가 화면 밖으로 나간다 — 목표 칩·타이머가 함께 뜨면 칩이 줄 가운데로
   * 밀리는데, 그때 `right-0`은 카드를 왼쪽 화면 밖으로(640~900px에서 -92px),
   * `left-0`은 오른쪽 밖으로 보낸다(2026-08-12 리뷰 2차). 배너는 항상 화면
   * 전체를 차지하므로 거기 매달면 어느 조합에서도 안 넘친다.
   *
   * stacked(세션 안 보드)는 안 건드렸다 — 종전대로 missionBlock의 한 줄 안내.
   */
  const guideSteps = wide && puzzle?.mode === 'guided' ? (puzzle?.guide_steps ?? []) : [];
  const hasGuide = guideSteps.length > 0;

  const guideChip = hasGuide && (
    <button
      type="button"
      ref={guideToggleRef}
      data-testid="board-guide-toggle"
      aria-expanded={guideOpen}
      // 닫혀 있으면 가리킬 대상이 없다 — 없는 id를 가리키는 aria-controls는
      // 보조기기에 깨진 참조로 간다(2026-08-12 리뷰).
      aria-controls={guideOpen ? 'board-guide-panel' : undefined}
      onClick={() => setGuideOpen((o) => !o)}
      className={`rounded-full px-2.5 py-1 text-[11.5px] font-bold tabular-nums transition ${
        guideOpen ? 'bg-white text-slate-900' : 'bg-white/15 text-slate-200 hover:bg-white/25'
      }`}
    >
      📋 {t('board.atmosphere.guidePanelTitle')} {guideStep + 1}/{guideSteps.length}
    </button>
  );

  /** 「가이드」 카드 — **배너**(`relative`) 기준으로 떠 있다. 위 주석의 앵커 이유. */
  const guidePanel = hasGuide && guideOpen && (
        <div
          id="board-guide-panel"
          ref={guideRef}
          // 배너 안에서 **떠 있는** 카드다 — 격자 높이에 영향을 주지 않는다.
          // 폰은 배너 폭을 꽉 채우고(left-4 right-4), sm↑는 오른쪽에 320px.
          className="absolute left-4 right-4 top-full z-30 mt-2 rounded-xl bg-slate-200 p-3.5 text-left shadow-lg ring-1 ring-slate-400/40 sm:left-auto sm:right-4 sm:w-[320px]"
        >
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-extrabold tracking-[0.4px] text-slate-500">
              {t('board.atmosphere.guidePanelTitle')}
            </p>
            <button
              type="button"
              onClick={closeGuide}
              aria-label={t('board.atmosphere.guideClose')}
              className="text-xs font-bold text-slate-400 hover:text-slate-700"
            >
              ✕
            </button>
          </div>
          <ol className="mt-2 flex flex-col gap-1.5">
            {guideSteps.map((step, i) => {
              const done = i < guideStep;
              const now = i === guideStep;
              return (
                <li key={i} className="flex gap-2">
                  <span
                    className={`mt-0.5 grid h-4 w-4 flex-none place-items-center rounded-full text-[9px] font-extrabold ${
                      done ? 'bg-emerald-100 text-emerald-600' : now ? 'bg-sky-600 text-white' : 'bg-white text-slate-400'
                    }`}
                  >
                    {done ? '✓' : i + 1}
                  </span>
                  <span className={`text-[12px] leading-snug ${done ? 'text-slate-400 line-through' : now ? 'font-bold text-slate-800' : 'text-slate-500'}`}>
                    {step}
                  </span>
                </li>
              );
            })}
          </ol>
          {guideStep + 1 < guideSteps.length && (
            <button
              type="button"
              onClick={() => setGuideStep((s) => Math.min(s + 1, guideSteps.length - 1))}
              className="mt-2.5 w-full rounded-lg bg-sky-600 px-2.5 py-1.5 text-[12px] font-bold text-white hover:bg-sky-700"
            >
              {t('board.atmosphere.guideNext')}
            </button>
          )}
        </div>
  );

  const paletteBlock = placeItems.length > 0 && (
    <div>
      <p className="mb-1.5 text-xs font-bold text-slate-500">{t('board.atmosphere.paletteHeader')}</p>
      <div className="flex flex-wrap gap-2">
        {placeItems.map((item) => {
          const isSel = selected?.token === item.token;
          return (
            <button
              key={item.token}
              type="button"
              onPointerDown={handlePointerDown(item)}
              onClick={() => {
                if (shouldSuppressClick()) return; // 드래그 직후 합성 click 무시
                if (interactive) setSelected(isSel ? null : item);
              }}
              disabled={!interactive}
              style={{ touchAction: 'none' }} // 터치 드래그 중 스크롤 차단(§3.3 ③)
              className={`flex min-h-[44px] items-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-medium transition disabled:opacity-60 ${
                isSel
                  ? 'border-sky-500 bg-sky-600 text-white shadow'
                  : 'border-slate-200 bg-slate-50 text-slate-800 hover:border-sky-400 hover:bg-sky-50'
              } ${dragging && drag?.item?.token === item.token ? 'opacity-40' : ''}`}
              title={item.hint}
            >
              {/* 표준 표기 SVG 심볼 (R9-01 §3.3 ② — 이모지 폴백은 SymbolIcon 내부) */}
              <SymbolIcon kind={item.type} value={item.subtype} className="h-5 w-5" />
              {item.label}
            </button>
          );
        })}
      </div>
    </div>
  );

  // wide 전용 — 「지금 고른 존」 하나만 다루는 카드. 존 카드 4장이 하던 일
  // (배치 칩 제거 + 조절값)을 여기로 모은다. 현상·구름 표시는 넣지 않는다 —
  // 지도 아래 단면 패널이 이미 그 존의 현상을 제목으로 달고 있어 겹친다.
  const focusPanel = wide && (
    <div className="rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2.5">
      <p className="text-[11px] font-bold text-slate-500">
        {t('board.atmosphere.focusControls', { zone: regions[focusZone]?.name ?? '' })}
      </p>
      <div className="mt-1.5 flex min-h-[1.75rem] flex-wrap items-center gap-1">
        {focusAir && (
          <PlacedChip
            label={subtypeLabel('air_mass', focusAir.subtype)}
            locked={isLocked(board, focusZone, 'air_mass')}
            onRemove={
              interactive
                ? () => {
                    applyBoard(`remove:${focusZone}:air_mass:${historySeq()}`, (b) => removeElement(b, focusZone, 'air_mass'));
                    setActiveZone(focusZone);
                  }
                : null
            }
          />
        )}
        {focusFront && (
          <PlacedChip
            label={subtypeLabel('front', focusFront.subtype)}
            locked={isLocked(board, focusZone, 'front')}
            onRemove={
              interactive
                ? () => {
                    applyBoard(`remove:${focusZone}:front:${historySeq()}`, (b) => removeElement(b, focusZone, 'front'));
                    setActiveZone(focusZone);
                  }
                : null
            }
          />
        )}
        {!focusAir && !focusFront && (
          <span className="text-[11px] text-slate-400">{t('board.atmosphere.focusEmpty')}</span>
        )}
      </div>
      {levelKnobs.map((knob) => (
        <ZoneSlider
          key={knob.type}
          label={t(knob.labelKey)}
          value={zoneLevel(focusZone, knob.type, LEVEL_DEFAULTS[knob.type])}
          locked={isLocked(board, focusZone, knob.type)}
          disabled={!interactive}
          onChange={(v) => {
            applyBoard(`level:${focusZone}:${knob.type}`, (b) => setLevel(b, focusZone, knob.type, v));
            setActiveZone(focusZone);
          }}
        />
      ))}
    </div>
  );

  const mapBlock = (
    <PeninsulaMap
      regions={regions}
      preview={preview}
      board={board}
      goals={goals}
      goalConditions={puzzle?.goal_conditions}
      selected={selected}
      interactive={interactive}
      onZoneTap={handleZoneClick}
      dragging={dragging}
      dragOverZone={drag?.overZone ?? null}
      zoneVisuals={zoneVisuals}
    />
  );

  const dragGhost = drag && (
    <div
      className="pointer-events-none fixed z-50"
      style={{
        left: drag.snap?.x ?? drag.x,
        top: drag.snap?.y ?? drag.y,
        transform: 'translate(-50%, -50%)',
      }}
      aria-hidden="true"
    >
      <div
        className={`flex items-center gap-1.5 rounded-xl border bg-white/95 px-3 py-2 text-sm font-bold shadow-lg transition-transform ${
          drag.overZone != null ? 'scale-110 border-sky-400 ring-2 ring-sky-500' : 'border-slate-200 ring-1 ring-slate-300'
        }`}
      >
        <SymbolIcon kind={drag.item.type} value={drag.item.subtype} className="h-5 w-5" />
        {drag.item.label}
      </div>
    </div>
  );

  // stacked 전용 — 4개 지역 상세 조절(노드별 기단·전선·습기·일사). 지도와 같은 zone.
  const zoneCards = !wide && (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {ZONES.map((_zoneName, zone) => {
        const region = regions[zone];
        const airEl = zoneElement(zone, 'air_mass');
        const frontEl = zoneElement(zone, 'front');
        const pv = preview[zone];
        const ph = phenomenonMeta(pv.phenomenon);
        const cl = cloudMeta(pv.cloud);
        const goalMet =
          goals.unmet.every((g) => g.zone !== zone) &&
          (puzzle?.goal_conditions ?? []).some((g) => g.zone === zone);
        return (
          <div
            key={zone}
            data-board-zone={zone}
            onClick={() => handleZoneClick(zone)}
            className={`flex flex-col rounded-xl border p-2 transition ${
              selected && interactive ? 'cursor-pointer border-dashed border-sky-400 bg-sky-50/40' : 'border-slate-200'
            } ${
              dragging
                ? drag?.overZone === zone
                  ? 'border-sky-500 bg-sky-50 ring-2 ring-sky-400'
                  : 'border-dashed border-sky-300 bg-sky-50/30'
                : ''
            } ${goalMet ? 'ring-2 ring-emerald-400' : ''} ${
              hintZoneActive && hintZone === zone && !goalMet ? 'ring-2 ring-amber-400 bg-amber-50/40' : ''
            }`}
          >
            <p className="mb-1 text-center text-xs font-bold text-slate-600">
              {zoneLabel(region, zone, t)}
              {hintZoneActive && hintZone === zone && (
                <span className="ml-1 rounded-full bg-amber-200 px-1.5 py-0.5 text-[10px] font-extrabold text-amber-900">
                  {t('board.atmosphere.hintHere')}
                </span>
              )}
            </p>

            {/* 미리보기 현상/구름 (즉시 가시화) — 표준 표기 SVG(§3.3 ②) */}
            <div className="mb-2 rounded-lg bg-slate-50 py-2 text-center">
              <div className="flex justify-center">
                <SymbolIcon kind="phenomenon" value={pv.phenomenon} className="h-8 w-8" />
              </div>
              <div className="mt-0.5 text-xs font-bold text-slate-800">{ph.label}</div>
              <div className="flex items-center justify-center gap-1 text-[10px] text-slate-400">
                <SymbolIcon kind="cloud" value={pv.cloud} className="h-3.5 w-3.5" /> {cl.label}
              </div>
            </div>

            {/* 배치된 기단/전선 칩 */}
            <div className="mb-1.5 flex min-h-[1.5rem] flex-wrap gap-1">
              {airEl && (
                <PlacedChip
                  label={subtypeLabel('air_mass', airEl.subtype)}
                  locked={isLocked(board, zone, 'air_mass')}
                  onRemove={
                    interactive
                      ? () => {
                          applyBoard(`remove:${zone}:air_mass:${historySeq()}`, (b) => removeElement(b, zone, 'air_mass'));
                          setActiveZone(zone);
                        }
                      : null
                  }
                />
              )}
              {frontEl && (
                <PlacedChip
                  label={subtypeLabel('front', frontEl.subtype)}
                  locked={isLocked(board, zone, 'front')}
                  onRemove={
                    interactive
                      ? () => {
                          applyBoard(`remove:${zone}:front:${historySeq()}`, (b) => removeElement(b, zone, 'front'));
                          setActiveZone(zone);
                        }
                      : null
                  }
                />
              )}
            </div>

            {/* moisture/sun/wind 슬라이더 (팔레트 허용 시) */}
            {levelKnobs.map((knob) => (
              <ZoneSlider
                key={knob.type}
                label={t(knob.labelKey)}
                value={zoneLevel(zone, knob.type, LEVEL_DEFAULTS[knob.type])}
                locked={isLocked(board, zone, knob.type)}
                disabled={!interactive}
                onChange={(v) => {
                  applyBoard(`level:${zone}:${knob.type}`, (b) => setLevel(b, zone, knob.type, v));
                  setActiveZone(zone);
                }}
              />
            ))}
          </div>
        );
      })}
    </div>
  );

  const goalPreview = !result && (puzzle?.goal_conditions?.length ?? 0) > 0 && (
    <p className={`text-center text-xs font-bold ${goals.passed ? 'text-emerald-600' : 'text-slate-400'}`}>
      {goals.passed ? t('board.atmosphere.goalMet') : t('board.atmosphere.goalPending')}
    </p>
  );

  // 힌트 표시는 BoardHintPanel이 소유한다(R13-01 §2.6 — 교사 캐릭터 말풍선).
  // 문구·순서·칩은 그대로 옮겼다. 여기서는 "무엇을 말할지"만 정하고 "누가 어떻게
  // 말하는지"는 패널이 정한다.
  const hintBlock = hintSteps.length > 0 && !result && (
    <BoardHintPanel
      steps={hintSteps}
      level={hintLevel}
      kindLabels={hintKinds.map((kind) => (HINT_KIND_LABEL[kind] ? t(HINT_KIND_LABEL[kind]) : kind))}
      interactive={interactive}
      onReveal={() => setHintLevel((l) => Math.min(l + 1, hintSteps.length))}
      // wide는 힌트를 168px 조절값 열 아래에 둔다 — 가로 배치로는 글자 폭이
      // 92px밖에 안 남는다(BoardHintPanel의 `stack` 주석). stacked(세션)는 넓다.
      stack={wide}
    />
  );

  // 판정 영역이 **실제로 무언가를 그리는가** — wide 배치에서 순서용 래퍼를 씌울지
  // 판단하는 데 쓴다. 아무것도 안 그리는데 래퍼를 씌우면 빈 격자칸이 gap만 벌린다.
  const hasVerdict = Boolean(result) || timedOut;
  const verdictBlock = (
    <>
      {/* 구름 소진(§3.3) — 에너지 부족 안내(판정 실패와 구분) */}
      {result?.outOfClouds && (
        <div className="rounded-xl bg-rose-50 px-4 py-3 ring-1 ring-rose-200">
          <p className="text-sm font-bold text-rose-700">{t('board.common.outOfClouds')}</p>
          {result.feedback && <p className="mt-1 whitespace-pre-line text-xs text-rose-600">{result.feedback}</p>}
        </div>
      )}

      {/* 서버 판정 결과 */}
      {result && !result.outOfClouds && (
        <div
          className={`rounded-xl px-4 py-3 ${
            result.passed ? 'bg-emerald-50 ring-1 ring-emerald-200' : 'bg-orange-50 ring-1 ring-orange-200'
          }`}
        >
          <p className={`text-sm font-bold ${result.passed ? 'text-emerald-700' : 'text-orange-700'}`}>
            {result.passed ? t('board.atmosphere.resultSuccess') : t('board.atmosphere.resultFail')}
          </p>
          {result.feedback && <p className="mt-1 whitespace-pre-line text-xs text-slate-600">{result.feedback}</p>}
        </div>
      )}

      {/* 시간 초과(§3.5) — 실패 처리 + 재도전(무제한) */}
      {timedOut && !result && (
        <div className="rounded-xl bg-orange-50 px-4 py-3 ring-1 ring-orange-200">
          <p className="text-sm font-bold text-orange-700">{t('board.atmosphere.timeoutTitle')}</p>
          <button
            type="button"
            onClick={retry}
            className="mt-2 w-full rounded-xl bg-orange-600 py-2.5 text-sm font-bold text-white transition hover:bg-orange-700"
          >
            {t('board.atmosphere.timeoutRetry', { sec: timeLimit })}
          </button>
        </div>
      )}
    </>
  );

  // 되돌리기(§3.5) — 순수 클라이언트 언두. 서버 호출 0 = 구름 무소모.
  // 제출·판정 확정 후에는 interactive=false로 비활성된다.
  const undoButton = !sandbox && (
    <button
      type="button"
      onClick={undo}
      disabled={!interactive || history.length === 0}
      title={t('board.atmosphere.undoTitle')}
      className="inline-flex min-h-[36px] items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
    >
      <span aria-hidden="true">↩</span> {t('board.atmosphere.undo')}
      {history.length > 0 && <span className="tabular-nums text-slate-400">({history.length})</span>}
    </button>
  );

  // 제출 — 자유 실험(§3.3 ⑥)은 채점 자체가 없어 제출 버튼 미노출.
  // 판정이 확정(confirmedPhenomena)되면 버튼을 내린다 — 세션 경로는 result를
  // 쓰지 않아 예전에는 "판정 중..." 표기가 그대로 남았다(§3.5 마감 2).
  const submitButton = !result && !confirmedPhenomena && !timedOut && !sandbox && (
    <button
      type="button"
      onClick={() => onSubmit?.(toSubmitState(board))}
      disabled={!interactive}
      className={`rounded-xl bg-sky-600 text-sm font-bold text-white transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50 ${
        wide ? 'flex-none whitespace-nowrap px-6 py-2.5' : 'mt-4 w-full py-3'
      }`}
    >
      {submitting ? t('board.atmosphere.submitting') : t('board.atmosphere.submit')}
    </button>
  );

  // ── 조립 ──────────────────────────────────────────────────────────────────
  //
  // wide(보드 플레이)는 2026-08-11 사용자 지시로 **3열 → 문제 배너 + 2열**이 됐다.
  //   위    문제 출제 카드 — 태양이가 미션을 읽어 준다(종전에는 오른쪽 252px 열
  //         맨 위에 작게 있어 "잘 안 보였다"는 제보)
  //   왼쪽  조작하는 것 — 팔레트·조절값(슬라이더)·지도·액션 바, 그리고 **맨 아래**
  //         태양이 힌트
  //   오른쪽 보는 것 — 단면 애니메이션·가이드·판정
  // 「만지는 쪽」과 「보는 쪽」이 갈려야 배치를 바꿀 때마다 눈이 오가지 않는다.
  if (wide) {
    return (
      <div className="flex flex-col gap-4">
        {/* 문제 출제 카드 — 보드 목록의 태양이 배너와 같은 남색 밴드다. 같은 화면
            계열에서 같은 꼴이 「지금 할 일」을 뜻하게 맞춘다(치수는 미션 내용이
            길어 배너보다 자유롭게 두되 마스코트 원·그림 크기는 같은 값). */}
        <div
          data-testid="board-mission-hero"
          // relative — 「가이드」 카드가 **이 배너** 기준으로 뜬다(guidePanel 주석).
          className="relative flex flex-wrap items-center gap-x-5 gap-y-3 rounded-[20px] bg-gradient-to-r from-[#1F3A5F] to-[#16293F] px-5 py-3.5 shadow-[0_2px_10px_rgba(15,23,42,0.18)]"
        >
          <span className="hidden h-[62px] w-[62px] flex-none place-items-center rounded-full bg-white/10 sm:grid">
            <Mascot name="sun" className="h-[50px] w-[50px]" />
          </span>
          <div className="min-w-0 flex-1 basis-[260px]">
            <p className="text-[11.5px] font-bold tracking-[0.02em] text-sky-300">
              {sandbox ? t('board.atmosphere.missionSandbox') : t('board.atmosphere.missionEyebrow')}
            </p>
            <p className="mt-0.5 text-[19px] font-extrabold leading-snug tracking-[-0.02em] text-white">
              {puzzle?.question_text}
            </p>
          </div>
          {/* 실화 배지·타이머·목표 진행은 미션에 딸린 것이라 같은 카드에 남는다 */}
          <div className="flex flex-none flex-wrap items-center gap-2">
            {puzzle?.based_on?.event_name && (
              <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-0.5 text-xs font-bold text-rose-200">
                <span aria-hidden="true">📖</span>
                {t('board.atmosphere.basedOn')} {puzzle.based_on.event_name}
                {/* 날짜·지역까지 붙여야 "실화"가 실화가 된다 — stacked 배지와 같은 꼴 */}
                {puzzle.based_on.event_date && (
                  <span className="font-medium">
                    ({puzzle.based_on.event_date}
                    {puzzle.based_on.region ? `, ${puzzle.based_on.region}` : ''})
                  </span>
                )}
              </span>
            )}
            {/* 가이드가 있으면 **목표 진행 칩 자리**를 가이드가 쓴다(2026-08-12
                사용자 지시).
                ⚠️ 단, **목표가 2개 이상이면 칩을 같이 남긴다.** 대체할 수 있다고
                본 근거는 액션 바의 미리보기 문구인데, 그것은 「다 됐다 / 아직」
                **이분값**이라 1/2와 2/2를 구분하지 못하고 제출 뒤에는(`!result`)
                아예 사라진다. 시드 board 46건 중 11건이 목표 복수이고 그중
                guided가 4건이다 — 그 4건에서만 칩이 함께 뜬다(2026-08-12 리뷰). */}
            {!sandbox && goalTotal > 0 && (!hasGuide || goalTotal > 1) && (
              <span className="rounded-full bg-white/15 px-2.5 py-1 text-[11.5px] font-bold tabular-nums text-slate-200">
                {t('board.atmosphere.goalProgressLabel')} {goalMetCount}/{goalTotal}
              </span>
            )}
            {guideChip}
            {hasTimer && (
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-extrabold tabular-nums ${
                  timedOut
                    ? 'bg-white/15 text-slate-300'
                    : remaining <= 10
                      ? 'animate-pulse bg-orange-400 text-white'
                      : 'bg-sky-500 text-white'
                }`}
                title={t('board.atmosphere.timerTitle')}
              >
                ⏱ {formatClock(remaining)}
              </span>
            )}
          </div>
          {guidePanel}
        </div>
        {disasterBanner}

        {/* 2026-08-12(사용자 지시) — **오른쪽 애니메이션이 너무 작다**. 셸 폭은
            그대로 두고(헤더와 어긋나므로 — Layout.jsx:42) 안에서 다시 나눴다:
              · 오른쪽 열 320px 고정 → `1fr`(왼쪽 1.25fr) — 단면이 288 → 약 470px
              · 조절값 열 212 → 168px, 지도는 그만큼 작아지고 왼쪽으로 붙는다
              · 「가이드」 카드 제거(사용자 지시 "완전히 없애기")
            두 열은 **같은 높이로 끝난다**(`items-stretch` = items-start 제거) —
            오른쪽 단면 카드가 `flex-1`로 늘고 그림이 세로 가운데에 온다.

            ⚠️ **lg 미만에서는 두 열 래퍼가 사라진다**(`contents`) — 세 블록
            (조작 카드·판정·단면)이 바깥 격자의 직계 칸이 되어 `order-*`로 다시
            줄 세울 수 있다. 2열은 lg에서만 성립하는데, 래퍼를 그대로 두면 좁은
            화면에서 「왼쪽 통째 → 오른쪽 통째」로 접혀 **판정이 지도 아래로
            내려간다**. 종전 3열 배치가 오른쪽 열에 `order-first`를 준 이유가
            그것이었고, 2열로 바꾸면서 그 장치가 사라졌다(2026-08-11 리뷰).
            좁은 화면 순서: 조작 카드(order-2) → 판정(order-3) → 단면(order-4).
            **힌트는 이 순서에 없다** — 조작 카드 *안*의 조절값 열에 들어 있어
            좁은 화면에서는 지도보다 위에 온다(아래 조절값 열 주석). */}
        {/* 🔴 **카드 두 장만 셸 밖으로 넓힌다**(2026-08-18 사용자 지시 —
            "상단바는 고정시키고 아래 보드/해설 카드 크기를 전체적으로 다 키워줘").

            셸은 `md:max-w-6xl`(1152)인데 1536 화면에서 사이드바를 뺀 자리는
            1328이라 **양옆 88px씩이 그냥 빈다**(실측). 지도와 단면 그림은 둘 다
            `w-full`이라 크기가 열 폭에 비례하므로, 이 여백을 되찾는 것 말고는
            그림을 키울 방법이 없다 — 카드를 세로로만 늘리면 흰 여백만 는다.

            ⚠️ **셸 자체를 넓히지 않는다.** 넓히면 위 미션 배너까지 함께 커지는데
            사용자가 "상단바는 고정"이라고 못박았다. 그래서 이 행에만 음수 마진을
            준다 — 좌우 대칭이라 가운데 정렬은 그대로다.

            음수 마진은 **남는 공간만큼만, 최대 120px**이다:
              clamp(0, (100vw − 사이드바 − 4rem − 1152) / 2, 120)
            · 1440 → 8px  · 1536 → 56px  · 1920 → 120px(상한)
            · 1280 이하 → 계산이 음수라 clamp가 0으로 막는다 = **넘칠 수 없다**
            ⚠️ 빼는 여유를 `4rem`으로 넉넉히 잡은 이유: `100vw`는 스크롤바 폭을
            **포함**하는데(`html`에 `scrollbar-gutter: stable`이라 항상 있다)
            그 몫을 안 빼면 좌우로 7~8px씩 삐져나온다. */}
        <div className="-mx-[clamp(0px,(100vw_-_var(--wm-shell-left)_-_4rem_-_1152px)/2,120px)] grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
          {/* 왼쪽 — **만지는 쪽**: 조절값·지도·액션. 힌트는 조절값 열 아래. */}
          <div className="contents lg:flex lg:flex-col lg:gap-3">
            <div className="order-2 flex flex-col gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 lg:order-none">
              <div className="grid gap-3 md:grid-cols-[168px_minmax(0,1fr)]">
                {/* 조절값 열 — 힌트가 **이 열 아래**에 붙어 폭이 같다
                    (2026-08-12 사용자 지시 "튜터 힌트를 슬라이드 아래에 칸 맞춰서").
                    ⚠️ **인스턴스는 하나다.** 좁은 화면용을 따로 그려 CSS로 감추면
                    BoardHintPanel이 두 개 마운트돼 `data-testid="board-hint"`가
                    중복된다(2026-08-12 코드 리뷰). 좁은 화면에서는 이 열이 지도
                    위로 접히므로 힌트가 지도보다 앞에 오는데, 조작 도움말 바로
                    뒤라 묶음으로는 맞는 자리다. */}
                <div className="flex flex-col gap-3">
                  {paletteBlock}
                  {focusPanel}
                  <p className="text-[11px] leading-relaxed text-slate-400">
                    {t('board.atmosphere.paletteHowTo')}
                  </p>
                  {hintBlock}
                </div>
                <div className="min-w-0">{mapBlock}</div>
              </div>
              {dragGhost}
              <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                {undoButton}
                <div className="ml-auto flex min-w-0 items-center gap-3">
                  {goalPreview}
                  {submitButton}
                </div>
              </div>
            </div>
          </div>

          {/* 오른쪽 — **보는 쪽**: 단면 애니메이션과 해설이 통째로 갖는다.
              `aside`가 아니라 `div`인 이유: lg 미만에서 `display:contents`가 되는데
              그때 랜드마크가 접근성 트리에서 사라진다 — 있다 없다 하는 랜드마크보다
              없는 편이 낫다(이 묶음에 aria-label도 없었다). */}
          <div className="contents lg:flex lg:flex-col lg:gap-3">
            <div
              ref={stageRef}
              // ⚠️ **세로 가운데 정렬(`justify-center`)을 걷었다**(2026-08-17
              // 사용자 지시 "오른쪽 수도권-흐림 이거 상단으로 올려줘").
              // 카드가 `lg:flex-1`로 왼쪽 열 높이만큼 늘어나는데 가운데 정렬이면
              // 내용이 빈 카드 한복판에 떠 있다 — 아직 규칙이 안 선 상태에서는
              // 캡션 한 줄뿐이라 특히 그렇게 보였다. 위로 붙이면 애니메이션이
              // 생겨도 그 자리에서 아래로 자라 **눈이 따라갈 곳이 안 바뀐다**.
              // ⚠️ `lg:flex-1`은 남긴다 — 두 열이 같은 높이로 끝나는 계약
              // (`items-stretch`)이 그것에 걸려 있다. 바꾼 것은 **정렬**뿐이다.
              //
              // 「애니메이션 위 · 수도권 결과 아래」는 **이미 그 순서다** —
              // `CrossSectionPanel`이 [단면 그림][캡션 상자] 순으로 그린다.
              // 규칙이 안 서면 그림 없이 캡션만 나온다. 그래서 여기서 손댈 것은
              // 정렬 하나뿐이었다.
              className="order-4 flex flex-col rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 lg:order-none lg:flex-1"
            >
              <CrossSectionPanel zoneResult={stageResult} confirmed={Boolean(confirmedPhenomena)} />
            </div>
          </div>

          {/* 🔴 **판정 결과는 두 열을 가로지른다**(2026-08-18 사용자 지시 —
              "한반도 지도/애니메이션 카드 크기로 가로로 길게"). 자리를 두 번
              옮겼다: 오른쪽 열(단면 폭 약 500px) → 왼쪽 열(보드 폭 약 700px) →
              **행 전체**(1536에서 1232px). 판정은 어느 한쪽 카드의 결과가
              아니라 **그 판 전체의 결과**라 행을 다 쓰는 쪽이 뜻에도 맞는다.

              ⚠️ 열 래퍼 **밖**의 직계 격자 칸이라야 `col-span-2`가 듣는다.
              래퍼 안에 두면 그 열 폭에 갇힌다(그래서 왼쪽 열에 넣었던 판이
              700px에서 멈췄다).
              ⚠️ `order-3`은 그대로다 — lg 미만에서는 두 열 래퍼가 `contents`라
              이 블록이 어차피 직계 칸이 되고, 좁은 화면 순서(조작 2 → 판정 3 →
              단면 4)는 **어느 자리에 적혀 있든 이 숫자가** 정한다. 옮겨도 좁은
              화면은 한 픽셀도 안 바뀐다.
              ⚠️ `lg:` 접두사로만 flex를 켠다 — 좁은 화면에서 켜면 종전에 없던
              간격이 생긴다(이 변경의 범위 밖). */}
          {hasVerdict && (
            <div className="order-3 lg:col-span-2 lg:flex lg:flex-col lg:gap-3">{verdictBlock}</div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <div className="mb-3">{missionBlock}</div>
      {paletteBlock && <div className="mb-3">{paletteBlock}</div>}
      {mapBlock}
      {dragGhost}

      {/* 단면 모식도 패널(R9-08 §B) — rule_id→8종 스토리보드 단계 재생 + explain 캡션.
          로컬 미리보기 판정 성공 시 즉시 재생, 서버 판정 도착 시 확정 리플레이.
          prefers-reduced-motion이면 최종 장면 정지 + 단계 텍스트 목록.
          ref는 성공 시 자동 스크롤 대상 — 두 레이아웃 중 실제로 렌더되는 쪽에만
          붙는다(동시에 렌더되지 않는다). */}
      <div ref={stageRef}>
        <CrossSectionPanel zoneResult={stageResult} confirmed={Boolean(confirmedPhenomena)} />
      </div>

      {zoneCards}

      {goalPreview && <div className="mt-3">{goalPreview}</div>}
      {hintBlock && <div className="mt-3">{hintBlock}</div>}
      <div className="mt-3 flex flex-col gap-3 empty:mt-0">{verdictBlock}</div>
      {undoButton && <div className="mt-3 flex justify-end">{undoButton}</div>}
      {submitButton}
    </div>
  );
}

/** 초 → M:SS 표시 (미니 미션 카운트다운) */
function formatClock(sec) {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

function PlacedChip({ label, locked, onRemove }) {
  const t = useT();
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${
        locked ? 'bg-slate-200 text-slate-500' : 'bg-sky-100 text-sky-700'
      }`}
    >
      {locked && <span aria-hidden="true">🔒</span>}
      {label}
      {!locked && onRemove && (
        <button
          type="button"
          // 존 카드로 버블링되면 "선택된 팔레트 항목 재배치"가 이어 실행돼 제거가
          // 즉시 되돌려진다(그리고 언두 스택에도 빈 칸이 남는다).
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          aria-label={t('board.atmosphere.removeAria', { label })}
          className="ml-0.5 text-sky-500 hover:text-sky-800"
        >
          ×
        </button>
      )}
    </span>
  );
}

function ZoneSlider({ label, value, locked, disabled, onChange }) {
  return (
    <div className="mt-1">
      <div className="flex items-center justify-between text-[10px] text-slate-500">
        <span>{label}{locked && ' 🔒'}</span>
        <span className="font-bold text-slate-700">{value}</span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        value={value}
        disabled={disabled || locked}
        onChange={(e) => onChange(Number(e.target.value))}
        onClick={(e) => e.stopPropagation()}
        className="w-full"
      />
    </div>
  );
}
