import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { boardApi } from '../../api';
import {
  ZONES,
  createBoard,
  evaluateBoard,
  checkGoals,
  placeElement,
  removeElement,
  setLevel,
  isLocked,
  toSubmitState,
} from '../../lib/boardEngine';
import {
  parsePaletteToken,
  subtypeLabel,
  phenomenonMeta,
  cloudMeta,
} from './boardDisplay';

/**
 * AtmosphereBoard (R3-01 S3·S5) — 한반도 단면 4존 대기 보드 플레이어.
 * 연습 탭(BoardPage)과 세션 문항(QuestionCard board 분기)이 공유한다.
 *
 * props:
 *   - puzzle: template_json (§3.3) — question_text/mode/guide_steps/initial_state/palette/goal_conditions/hints
 *   - onSubmit(boardState): 제출 콜백. 부모가 실제 API(연습 attempt / 세션 answer)를 호출.
 *   - disabled, submitting: 제출 중/비활성
 *   - result: 서버 판정 결과 {passed, phenomena, feedback} (있으면 표시)
 *
 * 규칙(§3.2)은 GET /board/rules로 로드해 배치 즉시 로컬 미리보기 판정을 한다(단일 진실원).
 * 서버 재판정이 권위 채점이며(§3.4), 로컬 판정은 학습용 미리보기일 뿐이다.
 */
export default function AtmosphereBoard({ puzzle, onSubmit, disabled = false, submitting = false, result = null }) {
  const [board, setBoard] = useState(() => createBoard(puzzle?.initial_state));
  const [selected, setSelected] = useState(null); // 선택된 팔레트 토큰(탭 배치용)
  const [hintLevel, setHintLevel] = useState(0); // 공개한 힌트 수 (2단계 순차)
  const [guideStep, setGuideStep] = useState(0); // guided 안내 진행

  // 미니 미션(§3.5): time_limit_sec 있으면 카운트다운, 초과 시 실패(재도전 무제한).
  const timeLimit = Number(puzzle?.time_limit_sec);
  const hasTimer = Number.isFinite(timeLimit) && timeLimit > 0;
  const [attemptKey, setAttemptKey] = useState(0); // 재도전마다 보드·타이머 리셋
  const [remaining, setRemaining] = useState(hasTimer ? timeLimit : 0);
  const [timedOut, setTimedOut] = useState(false);

  // 문항이 바뀌거나 재도전하면 상태 초기화 (타이머 포함)
  useEffect(() => {
    setBoard(createBoard(puzzle?.initial_state));
    setSelected(null);
    setHintLevel(0);
    setGuideStep(0);
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
  const allowMoisture = palette.includes('moisture');
  const allowSun = palette.includes('sun');
  const placeItems = paletteItems.filter((it) => it.type === 'air_mass' || it.type === 'front');

  // 로컬 미리보기 판정 (규칙 로드 전에는 빈 배열 → 기본값 흐림)
  const preview = useMemo(() => evaluateBoard(board, rules ?? []), [board, rules]);
  const goals = useMemo(
    () => checkGoals(preview, puzzle?.goal_conditions),
    [preview, puzzle?.goal_conditions],
  );

  const interactive = !disabled && !submitting && !result && !timedOut;

  // 존에 배치 (선택된 팔레트 항목 사용)
  const placeOn = (zone, item) => {
    if (!interactive || !item) return;
    if (item.type === 'air_mass' || item.type === 'front') {
      setBoard((b) => placeElement(b, zone, item.type, item.subtype));
    }
  };
  const handleZoneClick = (zone) => {
    if (selected) placeOn(zone, selected);
  };
  const handleDrop = (e, zone) => {
    if (!interactive) return;
    e.preventDefault();
    const token = e.dataTransfer.getData('text/board-token');
    if (token) placeOn(zone, { token, ...parsePaletteToken(token) });
  };

  const zoneElement = (zone, type) =>
    board.elements.find((el) => el.zone === zone && el.type === type);
  const zoneLevel = (zone, type, dflt) => zoneElement(zone, type)?.level ?? dflt;

  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      {/* 목표 배너 */}
      <div className="mb-3 rounded-xl bg-sky-50 px-4 py-3 ring-1 ring-sky-100">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-bold text-sky-900">🎯 {puzzle?.question_text}</p>
          {hasTimer && (
            <span
              className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-extrabold tabular-nums ${
                timedOut
                  ? 'bg-slate-200 text-slate-500'
                  : remaining <= 10
                    ? 'animate-pulse bg-orange-100 text-orange-700'
                    : 'bg-sky-100 text-sky-700'
              }`}
              title="제한 시간"
            >
              ⏱ {formatClock(remaining)}
            </span>
          )}
        </div>

        {/* 재현 퍼즐(§3.5): based_on 있으면 "실화" 배지 (사건명·날짜·지역) */}
        {puzzle?.based_on?.event_name && (
          <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-bold text-rose-700">
            <span aria-hidden="true">📖</span>
            실화 · {puzzle.based_on.event_name}
            {puzzle.based_on.event_date && <span className="font-medium">({puzzle.based_on.event_date}{puzzle.based_on.region ? `, ${puzzle.based_on.region}` : ''})</span>}
          </div>
        )}

        {puzzle?.mode === 'guided' && (puzzle?.guide_steps?.length ?? 0) > 0 && (
          <div className="mt-2 flex items-center gap-2">
            <p className="flex-1 text-xs text-sky-800">
              <span className="font-bold">안내 {guideStep + 1}/{puzzle.guide_steps.length}:</span>{' '}
              {puzzle.guide_steps[guideStep]}
            </p>
            {guideStep + 1 < puzzle.guide_steps.length && (
              <button
                type="button"
                onClick={() => setGuideStep((s) => Math.min(s + 1, puzzle.guide_steps.length - 1))}
                className="shrink-0 rounded-lg bg-sky-600 px-2.5 py-1 text-xs font-bold text-white hover:bg-sky-700"
              >
                다음 안내 →
              </button>
            )}
          </div>
        )}
      </div>

      {/* 팔레트 (배치 허용 요소만 — §3.3) */}
      {placeItems.length > 0 && (
        <div className="mb-3">
          <p className="mb-1.5 text-xs font-bold text-slate-500">요소 팔레트 (탭해서 고른 뒤 존을 탭하거나, 끌어다 놓으세요)</p>
          <div className="flex flex-wrap gap-2">
            {placeItems.map((item) => {
              const isSel = selected?.token === item.token;
              return (
                <button
                  key={item.token}
                  type="button"
                  draggable={interactive}
                  onDragStart={(e) => e.dataTransfer.setData('text/board-token', item.token)}
                  onClick={() => interactive && setSelected(isSel ? null : item)}
                  disabled={!interactive}
                  className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-medium transition disabled:opacity-60 ${
                    isSel
                      ? 'border-sky-500 bg-sky-600 text-white shadow'
                      : 'border-slate-200 bg-slate-50 text-slate-800 hover:border-sky-400 hover:bg-sky-50'
                  }`}
                  title={item.hint}
                >
                  <span aria-hidden="true">{item.icon}</span>
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* 한반도 지도 — 지역 노드에 요소를 드롭·탭 배치 (R5-01 §3.1). zone↔지역 고정 매핑. */}
      <PeninsulaMap
        regions={regions}
        preview={preview}
        board={board}
        goals={goals}
        goalConditions={puzzle?.goal_conditions}
        selected={selected}
        interactive={interactive}
        onZoneTap={handleZoneClick}
        onZoneDrop={handleDrop}
      />

      {/* 4개 지역 상세 조절(노드별 기단·전선·습기·일사) — 지도와 같은 zone을 가리킨다 */}
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
              onClick={() => handleZoneClick(zone)}
              onDragOver={(e) => interactive && e.preventDefault()}
              onDrop={(e) => handleDrop(e, zone)}
              className={`flex flex-col rounded-xl border p-2 transition ${
                selected && interactive ? 'cursor-pointer border-dashed border-sky-400 bg-sky-50/40' : 'border-slate-200'
              } ${goalMet ? 'ring-2 ring-emerald-400' : ''}`}
            >
              <p className="mb-1 text-center text-xs font-bold text-slate-600">{region.name}</p>

              {/* 미리보기 현상/구름 (즉시 가시화) */}
              <div className="mb-2 rounded-lg bg-slate-50 py-2 text-center">
                <div className="text-2xl leading-none" aria-hidden="true">{ph.icon}</div>
                <div className="mt-0.5 text-xs font-bold text-slate-800">{ph.label}</div>
                <div className="text-[10px] text-slate-400">{cl.icon} {cl.label}</div>
              </div>

              {/* 배치된 기단/전선 칩 */}
              <div className="mb-1.5 flex min-h-[1.5rem] flex-wrap gap-1">
                {airEl && (
                  <PlacedChip
                    label={subtypeLabel('air_mass', airEl.subtype)}
                    locked={isLocked(board, zone, 'air_mass')}
                    onRemove={interactive ? () => setBoard((b) => removeElement(b, zone, 'air_mass')) : null}
                  />
                )}
                {frontEl && (
                  <PlacedChip
                    label={subtypeLabel('front', frontEl.subtype)}
                    locked={isLocked(board, zone, 'front')}
                    onRemove={interactive ? () => setBoard((b) => removeElement(b, zone, 'front')) : null}
                  />
                )}
              </div>

              {/* moisture/sun 슬라이더 (팔레트 허용 시) */}
              {allowMoisture && (
                <ZoneSlider
                  label="💧 습기"
                  value={zoneLevel(zone, 'moisture', 40)}
                  locked={isLocked(board, zone, 'moisture')}
                  disabled={!interactive}
                  onChange={(v) => setBoard((b) => setLevel(b, zone, 'moisture', v))}
                />
              )}
              {allowSun && (
                <ZoneSlider
                  label="☀️ 일사"
                  value={zoneLevel(zone, 'sun', 50)}
                  locked={isLocked(board, zone, 'sun')}
                  disabled={!interactive}
                  onChange={(v) => setBoard((b) => setLevel(b, zone, 'sun', v))}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* 로컬 미리보기 목표 상태 */}
      {!result && (puzzle?.goal_conditions?.length ?? 0) > 0 && (
        <p className={`mt-3 text-center text-xs font-bold ${goals.passed ? 'text-emerald-600' : 'text-slate-400'}`}>
          {goals.passed ? '✓ 목표 조건을 모두 만족했어요 — 제출해 보세요!' : '미리보기: 아직 목표에 도달하지 않았어요'}
        </p>
      )}

      {/* 힌트 (2단계 순차 공개) */}
      {(puzzle?.hints?.length ?? 0) > 0 && !result && (
        <div className="mt-3">
          {puzzle.hints.slice(0, hintLevel).map((h, i) => (
            <p key={i} className="mb-1 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              💡 힌트 {i + 1}: {h}
            </p>
          ))}
          {hintLevel < puzzle.hints.length && interactive && (
            <button
              type="button"
              onClick={() => setHintLevel((l) => Math.min(l + 1, puzzle.hints.length))}
              className="text-xs font-bold text-amber-600 hover:text-amber-700"
            >
              💡 힌트 보기 ({hintLevel}/{puzzle.hints.length})
            </button>
          )}
        </div>
      )}

      {/* 구름 소진(§3.3) — 에너지 부족 안내(판정 실패와 구분) */}
      {result?.outOfClouds && (
        <div className="mt-3 rounded-xl bg-rose-50 px-4 py-3 ring-1 ring-rose-200">
          <p className="text-sm font-bold text-rose-700">☁️ 구름이 모두 흩어졌어요</p>
          {result.feedback && <p className="mt-1 whitespace-pre-line text-xs text-rose-600">{result.feedback}</p>}
        </div>
      )}

      {/* 서버 판정 결과 */}
      {result && !result.outOfClouds && (
        <div
          className={`mt-3 rounded-xl px-4 py-3 ${
            result.passed ? 'bg-emerald-50 ring-1 ring-emerald-200' : 'bg-orange-50 ring-1 ring-orange-200'
          }`}
        >
          <p className={`text-sm font-bold ${result.passed ? 'text-emerald-700' : 'text-orange-700'}`}>
            {result.passed ? '🎉 성공! 목표 대기현상을 만들었어요' : '아직이에요 — 배치를 바꿔 다시 시도해 보세요'}
          </p>
          {result.feedback && <p className="mt-1 whitespace-pre-line text-xs text-slate-600">{result.feedback}</p>}
        </div>
      )}

      {/* 시간 초과(§3.5) — 실패 처리 + 재도전(무제한) */}
      {timedOut && !result && (
        <div className="mt-3 rounded-xl bg-orange-50 px-4 py-3 ring-1 ring-orange-200">
          <p className="text-sm font-bold text-orange-700">⏱ 시간 초과! 제한 시간 안에 완성하지 못했어요</p>
          <button
            type="button"
            onClick={retry}
            className="mt-2 w-full rounded-xl bg-orange-600 py-2.5 text-sm font-bold text-white transition hover:bg-orange-700"
          >
            다시 도전 ({timeLimit}초)
          </button>
        </div>
      )}

      {/* 제출 */}
      {!result && !timedOut && (
        <button
          type="button"
          onClick={() => onSubmit?.(toSubmitState(board))}
          disabled={!interactive}
          className="mt-4 w-full rounded-xl bg-sky-600 py-3 text-sm font-bold text-white transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? '판정 중...' : '제출하기'}
        </button>
      )}
    </div>
  );
}

// 지리적 폴백 좌표(정규화 0~100) — /board/regions 미로드 시 사용.
// 서해상 왼쪽 · 수도권 중앙상단 · 영서·태백 우측 · 영동·동해 맨우측(§3.1 배치 지시).
const FALLBACK_REGIONS = [
  { name: '서해상', svg_point: [21, 54], label_anchor: [21, 66] },
  { name: '수도권', svg_point: [43, 33], label_anchor: [43, 21] },
  { name: '영서·태백', svg_point: [61, 47], label_anchor: [61, 35] },
  { name: '영동·동해', svg_point: [82, 43], label_anchor: [88, 55] },
];

/**
 * PeninsulaMap — 단순화한 한반도 지도(인라인 SVG, CSP상 외부 이미지 금지) 위에
 * 4개 지역 노드를 배치한다. 노드는 요소 드롭·탭 배치 대상이며 즉시 미리보기 현상을
 * 아이콘으로 보여준다. 판정 로직(boardEngine)은 불변 — zone index↔지역 매핑만 표현.
 */
function PeninsulaMap({ regions, preview, board, goals, goalConditions, selected, interactive, onZoneTap, onZoneDrop }) {
  return (
    <div className="relative mb-3 h-44 w-full overflow-hidden rounded-xl bg-gradient-to-b from-sky-100 to-sky-200 ring-1 ring-sky-200 sm:h-52">
      {/* 단순화 한반도 실루엣 (동서 단면 개념) */}
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden="true">
        <path
          d="M34,14 C40,10 50,12 53,20 C55,26 60,24 65,28 C70,32 67,39 71,44 C76,50 82,49 82,57
             C82,65 74,66 70,72 C65,79 60,86 52,88 C46,89 41,86 39,80 C37,74 40,69 35,65
             C30,61 24,60 24,52 C24,44 30,42 30,35 C30,29 28,24 32,19 C33,17 33,15 34,14 Z"
          fill="#bbf7d0"
          stroke="#86efac"
          strokeWidth="1"
        />
        {/* 태백산맥 능선 힌트 */}
        <path d="M56,30 L60,44 L57,58 L61,70" fill="none" stroke="#4ade80" strokeWidth="1.2" strokeLinejoin="round" opacity="0.7" />
      </svg>

      {/* 지역 노드 */}
      {regions.map((region, zone) => {
        const [x, y] = region.svg_point ?? [50, 50];
        const pv = preview?.[zone];
        const ph = phenomenonMeta(pv?.phenomenon);
        const airEl = board?.elements?.find((el) => el.zone === zone && el.type === 'air_mass');
        const frontEl = board?.elements?.find((el) => el.zone === zone && el.type === 'front');
        const goalMet =
          (goals?.unmet ?? []).every((g) => g.zone !== zone) &&
          (goalConditions ?? []).some((g) => g.zone === zone);
        const isGoalZone = (goalConditions ?? []).some((g) => g.zone === zone);
        return (
          <button
            type="button"
            key={zone}
            onClick={() => interactive && onZoneTap(zone)}
            onDragOver={(e) => interactive && e.preventDefault()}
            onDrop={(e) => onZoneDrop(e, zone)}
            disabled={!interactive}
            style={{ left: `${x}%`, top: `${y}%` }}
            title={region.name}
            className={`absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center rounded-xl px-1.5 py-1 shadow-md ring-1 transition ${
              goalMet
                ? 'bg-emerald-50 ring-2 ring-emerald-400'
                : isGoalZone
                  ? 'bg-white/95 ring-sky-300'
                  : 'bg-white/90 ring-slate-200'
            } ${selected && interactive ? 'cursor-pointer ring-2 ring-sky-400 hover:ring-sky-500' : ''}`}
          >
            <span className="text-xl leading-none" aria-hidden="true">{ph.icon}</span>
            <span className="mt-0.5 whitespace-nowrap text-[10px] font-bold text-slate-700">{region.name}</span>
            <span className="mt-0.5 flex gap-0.5 text-[9px]">
              {airEl && <span aria-hidden="true">{subtypeIcon('air_mass', airEl.subtype)}</span>}
              {frontEl && <span aria-hidden="true">{subtypeIcon('front', frontEl.subtype)}</span>}
              {isGoalZone && !goalMet && <span className="text-slate-400">🎯</span>}
              {goalMet && <span className="text-emerald-500">✓</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** 배치 요소 아이콘(지도 노드 미니 배지용) */
function subtypeIcon(type, subtype) {
  return parsePaletteToken(`${type}:${subtype}`).icon;
}

/** 초 → M:SS 표시 (미니 미션 카운트다운) */
function formatClock(sec) {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

function PlacedChip({ label, locked, onRemove }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${
        locked ? 'bg-slate-200 text-slate-500' : 'bg-sky-100 text-sky-700'
      }`}
    >
      {locked && <span aria-hidden="true">🔒</span>}
      {label}
      {!locked && onRemove && (
        <button type="button" onClick={onRemove} aria-label={`${label} 제거`} className="ml-0.5 text-sky-500 hover:text-sky-800">
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
