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
import { Glyph, SymbolIcon } from './boardSymbols';
import CrossSectionPanel from './CrossSectionPanel';
import {
  InfographicDefs,
  PrecipCanvas,
  RealCloudMass,
  SunGlint,
  usePrefersReducedMotion,
} from './realisticEffects';
import { AirMassBloom, FlowArrow, FrontCurve, ZoneAnnotation } from './mapInfographic';
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

// 지리적 폴백 좌표(정규화 0~100) — /board/regions 미로드 시 사용.
// 좌표 SSOT = database/seed/board_regions.json (R9-01 §3.3 선행 리팩터: 시드↔폴백 일치).
// 값 변경은 시드 파일에서만 — 여기는 시드 사본(드리프트 금지).
const FALLBACK_REGIONS = [
  { name: '서해상', svg_point: [21, 54], label_anchor: [21, 66] },
  { name: '수도권', svg_point: [43, 33], label_anchor: [43, 21] },
  { name: '영서·태백', svg_point: [61, 47], label_anchor: [61, 35] },
  { name: '영동·동해', svg_point: [82, 43], label_anchor: [88, 55] },
];

// ── SVG userSpace 단일 좌표계 (R9-01 §3.3 선행 리팩터) ──────────────────────
// viewBox 100×80 고정 종횡비(aspect-ratio) — preserveAspectRatio="none" 왜곡과
// "SVG 안 지도 + SVG 밖 절대배치 노드" 2원화를 함께 제거한다.
// 시드 좌표(0~100 정규화)는 y만 0.8 사영해 같은 userSpace에 놓는다.
// userSpace는 등방(1unit x = 1unit y)이므로 노드·심볼은 왜곡되지 않는다.
const VIEW_W = 100;
const VIEW_H = 80;
/** 정규화 좌표(0~100) → SVG userSpace */
function toUser(point, dflt = [50, 50]) {
  const [x, y] = Array.isArray(point) && point.length >= 2 ? point : dflt;
  return [x * (VIEW_W / 100), y * (VIEW_H / 100)];
}

// 한반도 실루엣 path (정규화 0~100 좌표 저작 — scale(1, VIEW_H/100)로 사영)
const PENINSULA_PATH =
  'M34,14 C40,10 50,12 53,20 C55,26 60,24 65,28 C70,32 67,39 71,44 C76,50 82,49 82,57 ' +
  'C82,65 74,66 70,72 C65,79 60,86 52,88 C46,89 41,86 39,80 C37,74 40,69 35,65 ' +
  'C30,61 24,60 24,52 C24,44 30,42 30,35 C30,29 28,24 32,19 C33,17 33,15 34,14 Z';

// 현상 → 지도 구름 변형(R9-08 §A — 적란운 수직 발달·층운 평평·안개 저층 확산)
function cloudVariantFor(v) {
  if (!v) return null;
  if (v.phenomenon === 'fog') return 'fog';
  if (v.phenomenon === 'snow') return 'snowcloud';
  if (v.cloud === 'cumulonimbus') return 'cumulonimbus';
  if (v.cloud === 'nimbostratus') return 'nimbostratus';
  if (v.cloud === 'stratus') return 'stratus';
  if (v.rule_id && v.cloud === 'cumulus') return 'cumulus';
  return null; // 기본 흐림(규칙 미성립)은 노드 아이콘만 — 지도를 어지럽히지 않는다
}

// 현상 → Canvas 강수 에미터 메타(weight=입자 배분, slant=사선 강도)
const PRECIP_META = {
  shower: { kind: 'rain', weight: 2, slant: 1.4 },
  persistent_rain: { kind: 'rain', weight: 2, slant: 0.7 },
  rain: { kind: 'rain', weight: 1, slant: 0.9 },
  snow: { kind: 'snow', weight: 1 },
};

/**
 * PeninsulaMap — 기상청 인포그래픽 문법의 한반도 일기도 (R9-08 §A, 기준 하.png).
 * 4개 지역 노드는 요소 드롭·탭 배치 대상(R9-01 드래그 UX 불변)이며, 그 위에
 *  ① 기단 색 번짐 ② 전선 곡선+표준 기호 ③ 곡선 유동 화살표
 *  ④ 현상 구름(터뷸런스 질감)+주석 라벨 ⑤ Canvas 파티클 강수
 * 를 겹친다. 판정 로직(boardEngine)은 불변 — 전부 표현 레이어.
 * prefers-reduced-motion이면 모든 레이어가 정적 최종 장면으로 대체된다.
 */
function PeninsulaMap({ regions, preview, board, goals, goalConditions, selected, interactive, onZoneTap, dragging = false, dragOverZone = null, zoneVisuals = null }) {
  const reduced = usePrefersReducedMotion();
  const animate = !reduced;
  const zonePoint = (zone) => toUser(regions[zone]?.svg_point);

  // 전선 곡선(②) — 같은 subtype이 배치된 존들을 잇는 지역 스케일 곡선
  const frontZones = { cold: [], warm: [], stationary: [] };
  for (const el of board?.elements ?? []) {
    if (el.type === 'front' && frontZones[el.subtype]) {
      const [x, y] = zonePoint(el.zone);
      frontZones[el.subtype].push({ x, y });
    }
  }

  // Canvas 강수 에미터(⑤) — 강수 현상 존에만, 좌표는 컨테이너 분율
  const emitters = regions
    .map((region, zone) => {
      const m = PRECIP_META[zoneVisuals?.[zone]?.phenomenon];
      if (!m) return null;
      const [ux, uy] = toUser(region.svg_point);
      return {
        fx: (ux - 7) / VIEW_W,
        fy: (uy - 4) / VIEW_H,
        fw: 14 / VIEW_W,
        fh: 12 / VIEW_H,
        ...m,
      };
    })
    .filter(Boolean);

  return (
    <div className="relative mb-3 w-full overflow-hidden rounded-xl bg-[#dfe9f3] ring-1 ring-slate-200">
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className="block h-auto w-full"
        role="group"
        aria-label="한반도 대기 보드 지도 — 4개 지역 노드에 요소를 배치하세요"
      >
        <InfographicDefs />

        {/* 바다 + 주변 대륙 힌트(장식) — 밝은 인포그래픽 톤 */}
        <g aria-hidden="true">
          <rect x="0" y="0" width={VIEW_W} height={VIEW_H} fill="url(#wm-sea)" />
          {/* 대륙(북서) */}
          <path d="M0,0 L26,0 C20,6 22,13 15,19 C10,23 12,31 5,36 L0,38 Z" fill="url(#wm-land)" opacity="0.85" />
          {/* 일본 열도 힌트(남동) */}
          <path d="M100,52 C92,58 88,66 91,74 C93,78 97,80 100,80 Z" fill="url(#wm-land)" opacity="0.8" />
        </g>

        {/* 한반도 — 지형 그라디언트 + 터뷸런스 그레인 음영 + 태백 능선 */}
        <g transform={`scale(1 ${VIEW_H / 100})`} aria-hidden="true">
          <path d={PENINSULA_PATH} fill="url(#wm-land)" stroke="#a9bccb" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          <path d={PENINSULA_PATH} fill="#334155" filter="url(#wm-terrain)" opacity="0.5" />
          {/* 태백산맥 능선 — 음영 + 능선 하이라이트 */}
          <path d="M56,30 L60,44 L57,58 L61,70" fill="none" stroke="#8a9a7a" strokeWidth="2" strokeLinejoin="round" opacity="0.55" vectorEffect="non-scaling-stroke" />
          <path d="M55,31 L59,44 L56,58 L60,69" fill="none" stroke="#f8fafc" strokeWidth="0.7" strokeLinejoin="round" opacity="0.5" vectorEffect="non-scaling-stroke" />
        </g>

        {/* ① 기단 색 번짐 + ③ 곡선 유동 화살표 */}
        {(board?.elements ?? [])
          .filter((el) => el.type === 'air_mass')
          .map((el) => {
            const [ux, uy] = zonePoint(el.zone);
            return (
              <g key={`air-${el.zone}`}>
                <AirMassBloom subtype={el.subtype} x={ux} y={uy} animate={animate} />
                <FlowArrow subtype={el.subtype} x={ux} y={uy} animate={animate} />
              </g>
            );
          })}

        {/* ② 전선 곡선 — 지도를 가로지르는 경로 + 표준 기호 반복 */}
        {Object.entries(frontZones).map(([subtype, pts]) =>
          pts.length > 0 ? <FrontCurve key={subtype} subtype={subtype} points={pts} animate={animate} /> : null,
        )}

        {/* ④ 현상 구름(터뷸런스 질감)·태양 글로우 + 주석 라벨 */}
        {regions.map((region, zone) => {
          const v = zoneVisuals?.[zone];
          if (!v) return null;
          const [ux, uy] = toUser(region.svg_point);
          const variant = cloudVariantFor(v);
          const clearLike = v.cloud === 'none' && (v.phenomenon === 'clear' || v.phenomenon === 'heatwave');
          return (
            <g key={`ph-${zone}`}>
              {clearLike && <SunGlint x={ux} y={uy - 6} hot={v.phenomenon === 'heatwave'} animate={animate} />}
              {variant && (
                <RealCloudMass
                  variant={variant}
                  x={ux}
                  y={variant === 'fog' ? uy + 2.5 : variant === 'cumulonimbus' ? uy - 8 : uy - 7}
                  scale={variant === 'fog' ? 1.05 : 0.95}
                  animate={animate}
                  flash={v.phenomenon === 'shower' && v.cloud === 'cumulonimbus'}
                />
              )}
              {v.rule_id && <ZoneAnnotation x={ux} y={uy} ruleId={v.rule_id} animate={animate} />}
            </g>
          );
        })}

        {/* 지역 노드 — 지도와 같은 userSpace(<g transform>) */}
        {regions.map((region, zone) => {
          const [ux, uy] = toUser(region.svg_point);
          const [lx, ly] = toUser(region.label_anchor, [
            region.svg_point?.[0] ?? 50,
            (region.svg_point?.[1] ?? 50) + 11,
          ]);
          const pv = preview?.[zone];
          const ph = phenomenonMeta(pv?.phenomenon);
          const airEl = board?.elements?.find((el) => el.zone === zone && el.type === 'air_mass');
          const frontEl = board?.elements?.find((el) => el.zone === zone && el.type === 'front');
          const goalMet =
            (goals?.unmet ?? []).every((g) => g.zone !== zone) &&
            (goalConditions ?? []).some((g) => g.zone === zone);
          const isGoalZone = (goalConditions ?? []).some((g) => g.zone === zone);
          return (
            <g key={zone}>
              {/* 지역 라벨 — 시드 label_anchor 위치 (R9-01 §3.3) */}
              <text
                x={lx}
                y={ly}
                textAnchor="middle"
                fontSize="3.6"
                fontWeight="700"
                fill="#334155"
                stroke="#f0f9ff"
                strokeWidth="0.8"
                paintOrder="stroke"
                style={{ pointerEvents: 'none' }}
              >
                {region.name}
              </text>

              <g
                transform={`translate(${ux} ${uy})`}
                data-board-zone={zone}
                role="button"
                tabIndex={interactive ? 0 : -1}
                aria-label={`${region.name} 존${isGoalZone ? ' (목표 존)' : ''} — 현재 ${ph.label}`}
                aria-disabled={!interactive}
                onClick={() => interactive && onZoneTap(zone)}
                onKeyDown={(e) => {
                  if (interactive && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault();
                    onZoneTap(zone);
                  }
                }}
                className={interactive ? 'cursor-pointer' : ''}
              >
                {/* 터치 히트 영역 — 지도폭 320px 기준 지름 ≥44px (r 8.5 = 17unit ≈ 54px) */}
                <circle r="8.5" fill="transparent" />

                {/* 목표/충족 링 */}
                {isGoalZone && !goalMet && (
                  <circle r="7.4" fill="none" stroke="#7dd3fc" strokeWidth="0.8" strokeDasharray="1.6 1.2" />
                )}
                {goalMet && <circle r="7.4" fill="none" stroke="#34d399" strokeWidth="1" />}
                {/* 탭 배치 대기(팔레트 선택 중)·드래그 중 유효 존 안내 링 */}
                {(selected || dragging) && interactive && (
                  <circle r="8.2" fill="none" stroke="#38bdf8" strokeWidth="0.6" strokeDasharray="1 1" opacity="0.9" />
                )}
                {/* 드래그 오버 존 강조(스냅 대상) */}
                {dragging && dragOverZone === zone && (
                  <circle r="8.2" fill="#e0f2fe" fillOpacity="0.55" stroke="#0284c7" strokeWidth="1" />
                )}

                {/* 노드 본체 + 미리보기 현상 아이콘 */}
                <circle
                  r="6"
                  fill={goalMet ? '#ecfdf5' : '#ffffff'}
                  fillOpacity="0.95"
                  stroke={goalMet ? '#34d399' : isGoalZone ? '#7dd3fc' : '#cbd5e1'}
                  strokeWidth="0.5"
                />
                <Glyph kind="phenomenon" value={pv?.phenomenon} scale={0.4} />

                {/* 배치된 요소 미니 배지 (노드 우측 스택) — 표준 표기 SVG(§3.3 ②) */}
                {airEl && <Glyph kind="air_mass" value={airEl.subtype} x={8.4} y={-2.6} scale={0.26} />}
                {frontEl && <Glyph kind="front" value={frontEl.subtype} x={8.4} y={3.2} scale={0.28} />}
                {/* 목표 마커 */}
                {isGoalZone && !goalMet && (
                  <text x="-7.6" y="-5.4" textAnchor="middle" fontSize="3.2" aria-hidden="true" style={{ pointerEvents: 'none' }}>
                    🎯
                  </text>
                )}
                {goalMet && (
                  <text x="-7.6" y="-5.4" textAnchor="middle" fontSize="3.6" fill="#059669" fontWeight="700" aria-hidden="true" style={{ pointerEvents: 'none' }}>
                    ✓
                  </text>
                )}
              </g>
            </g>
          );
        })}
      </svg>

      {/* ⑤ Canvas 파티클 강수 — 비 사선 줄기+지면 스플래시 암시, 눈 흔들 낙하.
          상한 160(전역 200 이하), 탭 비활성·뷰포트 밖 정지, reduced-motion 정적 프레임. */}
      <PrecipCanvas emitters={emitters} reduced={reduced} cap={160} />
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
