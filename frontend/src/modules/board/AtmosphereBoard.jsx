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

  // 문항이 바뀌면 상태 초기화
  useEffect(() => {
    setBoard(createBoard(puzzle?.initial_state));
    setSelected(null);
    setHintLevel(0);
    setGuideStep(0);
  }, [puzzle]);

  const { data: rules } = useQuery({
    queryKey: ['board', 'rules'],
    queryFn: boardApi.fetchBoardRules,
    staleTime: 60 * 60 * 1000, // 규칙은 세션 내 불변 — 한 번만 로드
  });

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

  const interactive = !disabled && !submitting && !result;

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

  const zoneElement = (zone, type) =>
    board.elements.find((el) => el.zone === zone && el.type === type);
  const zoneLevel = (zone, type, dflt) => zoneElement(zone, type)?.level ?? dflt;

  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      {/* 목표 배너 */}
      <div className="mb-3 rounded-xl bg-sky-50 px-4 py-3 ring-1 ring-sky-100">
        <p className="text-sm font-bold text-sky-900">🎯 {puzzle?.question_text}</p>
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

      {/* 4존 가로 보드 */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {ZONES.map((zoneName, zone) => {
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
              onDrop={(e) => {
                if (!interactive) return;
                e.preventDefault();
                const token = e.dataTransfer.getData('text/board-token');
                if (token) placeOn(zone, { token, ...parsePaletteToken(token) });
              }}
              className={`flex flex-col rounded-xl border p-2 transition ${
                selected && interactive ? 'cursor-pointer border-dashed border-sky-400 bg-sky-50/40' : 'border-slate-200'
              } ${goalMet ? 'ring-2 ring-emerald-400' : ''}`}
            >
              <p className="mb-1 text-center text-xs font-bold text-slate-600">{zoneName}</p>

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

      {/* 서버 판정 결과 */}
      {result && (
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

      {/* 제출 */}
      {!result && (
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
