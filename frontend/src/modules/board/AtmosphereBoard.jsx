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
import { FALLBACK_REGIONS } from './boardLayout';
import { SymbolIcon } from './boardSymbols';
import CrossSectionPanel from './CrossSectionPanel';
import PeninsulaMap from './PeninsulaMap';
import useBoardDrag from './useBoardDrag';

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
 */
export default function AtmosphereBoard({ puzzle, onSubmit, disabled = false, submitting = false, result = null, phenomena = null, sandbox = false }) {
  const [board, setBoard] = useState(() => createBoard(puzzle?.initial_state));
  const [selected, setSelected] = useState(null); // 선택된 팔레트 토큰(탭 배치용)
  const [hintLevel, setHintLevel] = useState(0); // 공개한 힌트 수 (2단계 순차)
  const [guideStep, setGuideStep] = useState(0); // guided 안내 진행
  const [activeZone, setActiveZone] = useState(null); // 현상 스테이지 포커스 존(마지막 조작 존)

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

  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      {/* 목표 배너 */}
      <div className="mb-3 rounded-xl bg-sky-50 px-4 py-3 ring-1 ring-sky-100">
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
        dragging={dragging}
        dragOverZone={drag?.overZone ?? null}
        zoneVisuals={zoneVisuals}
      />

      {/* 드래그 고스트(§3.3 ③) — 존 위에서는 존 중심으로 스냅 */}
      {drag && (
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
      )}

      {/* 단면 모식도 패널(R9-08 §B) — rule_id→8종 스토리보드 단계 재생 + explain 캡션.
          로컬 미리보기 판정 성공 시 즉시 재생, 서버 판정 도착 시 확정 리플레이.
          prefers-reduced-motion이면 최종 장면 정지 + 단계 텍스트 목록. */}
      <CrossSectionPanel zoneResult={stageResult} confirmed={Boolean(confirmedPhenomena)} />

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
              } ${goalMet ? 'ring-2 ring-emerald-400' : ''}`}
            >
              <p className="mb-1 text-center text-xs font-bold text-slate-600">{region.name}</p>

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
                            setBoard((b) => removeElement(b, zone, 'air_mass'));
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
                            setBoard((b) => removeElement(b, zone, 'front'));
                            setActiveZone(zone);
                          }
                        : null
                    }
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
                  onChange={(v) => {
                    setBoard((b) => setLevel(b, zone, 'moisture', v));
                    setActiveZone(zone);
                  }}
                />
              )}
              {allowSun && (
                <ZoneSlider
                  label="☀️ 일사"
                  value={zoneLevel(zone, 'sun', 50)}
                  locked={isLocked(board, zone, 'sun')}
                  disabled={!interactive}
                  onChange={(v) => {
                    setBoard((b) => setLevel(b, zone, 'sun', v));
                    setActiveZone(zone);
                  }}
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

      {/* 제출 — 자유 실험(§3.3 ⑥)은 채점 자체가 없어 제출 버튼 미노출 */}
      {!result && !timedOut && !sandbox && (
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
