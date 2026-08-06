import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { boardApi, progressApi } from '../../api';
import { useProgressStore } from '../../store/progressStore';
import LoadingSpinner from '../../components/LoadingSpinner';
import AtmosphereBoard from './AtmosphereBoard';
import { phenomenonMeta } from './boardDisplay';
import { SymbolIcon } from './boardSymbols';
import { ZONES } from '../../lib/boardEngine';
import { useT } from '../../i18n';

/**
 * BoardPage (R3-01 S3ui·S4) — "대기 보드" 연습 탭.
 * GET /board/puzzles 목록(클리어 표시) → 선택 → 플레이 → POST attempt.
 * 최초 클리어 시 +5 XP 토스트(재도전 0). 시뮬레이터 탭을 대체한다.
 *
 * R7-02 S5: 퍼즐 카드에 난이도 배지(difficulty 1|2|3 → 쉬움/보통/도전).
 * 목록은 서버가 **저작 순서(board_order)**로 내려준다 — 순차 진행이라 순서가 곧
 * 코스다. 클라이언트는 재정렬하지 않는다(2026-08-05, θ 인접 정렬을 대체).
 *
 * 순차 잠금: 앞 퍼즐을 전부 깨야 다음이 열린다(`locked`). 잠긴 칸도 제목·요약·
 * 난이도까지 **보여주고** 진입만 막는다. 판정 권위는 서버(403 PUZZLE_LOCKED)이고
 * 카드 비활성은 "누르기 전에 알린다"를 위한 표시다.
 *
 * R10-01 D1 (에너지 진입 게이트): 플레이 진입은 **반드시**
 * GET /board/puzzles/{id}(상세)를 통과한다 — 그 엔드포인트가 보드측 유일한 구름
 * 진입 차단 지점이라, 목록 payload로 바로 플레이하면 게이트가 도달 불가가 되고
 * (attempt는 미통과 시에만 소모 + 잔량 0에서는 무소모 200) 잔량 0에서 보드가
 * 무제한이 된다. 목록 조회 자체는 무차단 유지(잔량 0에서도 cleared 표시는 보인다).
 * 차단 안내는 429를 받고 나서가 아니라 **누르기 전에** — 잔량 0이면 카드 CTA
 * 비활성 + 회복 ETA 인라인(§3.1 프론트 절, CurriculumHome과 같은 관례).
 *
 * 화면 상태: LOADING → ERROR(재시도) → LIST(목록) → PLAY(선택 퍼즐 플레이).
 */

// 난이도 배지(R7-02 S5) — 색 구분 + 텍스트 병기(색맹 접근성: 색에만 의존하지 않음)
// 라벨은 i18n 키로 — 렌더 시 로케일에 맞춰 해석한다(R11-01 §6.3 외부화).
const DIFFICULTY_META = {
  1: { labelKey: 'board.page.difficulty1', className: 'bg-emerald-100 text-emerald-700' },
  2: { labelKey: 'board.page.difficulty2', className: 'bg-amber-100 text-amber-700' },
  3: { labelKey: 'board.page.difficulty3', className: 'bg-rose-100 text-rose-700' },
};

function DifficultyBadge({ difficulty }) {
  const t = useT();
  const meta = DIFFICULTY_META[difficulty];
  if (!meta) return null; // 구 백엔드(difficulty 부재) 하위 호환 — 배지 미표시
  const label = t(meta.labelKey);
  return (
    <span
      aria-label={t('board.page.difficultyAria', { label })}
      className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${meta.className}`}
    >
      {t('board.page.difficultyText', { label })}
    </span>
  );
}

// 자유 실험(R9-01 §3.3 ⑥) — 목표·채점·타이머 없는 전 요소 팔레트 샌드박스.
// 순수 클라이언트: 서버 호출 0 → 구름 미소모·시도 로그 없음(로컬 엔진만).
// question_text는 로케일 의존이라 렌더 시 useMemo로 주입한다(아래) — 참조 안정성
// 유지(AtmosphereBoard가 puzzle identity 변화에 보드를 리셋하므로).
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
export default function BoardPage() {
  const t = useT();
  const queryClient = useQueryClient();
  const addXp = useProgressStore((s) => s.addXp);
  // 번역된 문자열(로케일 변경 시에만 값이 바뀜)을 메모 키로 써서 puzzle 참조를
  // 안정화한다 — t 함수 자체는 렌더마다 새 클로저라 의존성으로 부적합.
  const sandboxQuestion = t('board.page.sandboxQuestion');
  const sandboxPuzzle = useMemo(
    () => ({ ...SANDBOX_PUZZLE, question_text: sandboxQuestion }),
    [sandboxQuestion],
  );
  const [selected, setSelected] = useState(null); // 플레이 중 퍼즐 {content_item_id, template_json}
  const [result, setResult] = useState(null); // 서버 판정 결과
  const [toast, setToast] = useState(null); // XP 토스트 메시지
  const [sandbox, setSandbox] = useState(false); // 자유 실험 모드(R9-01 §3.3 ⑥)
  const [entryError, setEntryError] = useState(null); // 진입 실패 안내(429 등)

  const { data: puzzles, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['board', 'puzzles'],
    queryFn: boardApi.fetchBoardPuzzles,
    staleTime: 60 * 1000,
  });

  // 구름 잔량 — 진입 차단(§3.1·D6)을 누르기 전에 알리기 위한 조회.
  // CloudEnergyBadge·CurriculumHome과 같은 쿼리 키라 헤더와 같은 값을 본다
  // (중복 요청·새 폴링 없음).
  const { data: energy } = useQuery({
    queryKey: ['progress', 'energy'],
    queryFn: progressApi.fetchEnergy,
    staleTime: 10_000,
  });
  // 잔량 0 = 상세(진입)가 429로 막히는 상태. 보드 퍼즐은 매 진입이 새 진입이므로
  // 세션(데일리)처럼 "이미 발급된 것 재조회" 예외가 없다 → 카드 비활성이 서버 판정과 일치.
  const energyBlocked = energy?.clouds === 0;
  const regenMin = Math.max(1, Math.ceil((energy?.next_regen_sec ?? 0) / 60));

  const attemptMutation = useMutation({
    mutationFn: ({ id, boardState }) => boardApi.submitBoardAttempt(id, boardState),
    onSuccess: (res) => {
      setResult(res);
      // R10-01 §3.1: 소모는 **미통과 시에만** 1(정답 0). 실측은 응답 clouds_spent가
      // 갖고 있고 표기는 AtmosphereBoard가 하므로, 여기서는 헤더 잔량만 갱신한다.
      queryClient.invalidateQueries({ queryKey: ['progress', 'energy'] });
      if (res.passed && res.xp_earned > 0) {
        addXp(res.xp_earned);
        queryClient.invalidateQueries({ queryKey: ['progress', 'me'] });
        queryClient.invalidateQueries({ queryKey: ['progress', 'quests'] });
        queryClient.invalidateQueries({ queryKey: ['board', 'puzzles'] });
      }
      // 왕관 유입(R8-01 §3.4): 최초 클리어가 열린 board 유닛 왕관으로 인정되면
      // 스파인·커리큘럼 갱신 + 왕관 토스트(첫 클리어 XP 토스트보다 우선 — 단일 노출)
      if (res.crown_award) {
        queryClient.invalidateQueries({ queryKey: ['curriculum'] });
        queryClient.invalidateQueries({ queryKey: ['progress', 'me'] });
      }
      const toastMsg = res.crown_award
        ? t('board.page.toastCrown', { title: res.crown_award.unit_title })
        : res.passed && res.xp_earned > 0
          ? t('board.page.toastFirstClear', { xp: res.xp_earned })
          : null;
      if (toastMsg) {
        setToast(toastMsg);
        setTimeout(() => setToast(null), 2600);
      }
    },
    onError: (err) => {
      // 구름 소진(§3.3): 소모 전 429 — 잔량 갱신 + 회복 ETA 안내
      if (err.code === 'OUT_OF_CLOUDS') {
        queryClient.invalidateQueries({ queryKey: ['progress', 'energy'] });
        setResult({ passed: false, outOfClouds: true, feedback: err.detail ?? t('board.page.outOfCloudsRetry') });
        return;
      }
      setResult({ passed: false, feedback: err.detail ?? t('board.page.submitFailed') });
    },
  });

  // 진입 게이트(R10-01 D1) — "퍼즐 시작"은 상세 엔드포인트를 통과해야 플레이에 들어간다.
  // 응답(단건 BoardPuzzle)이 플레이 payload가 된다. 목록 원소를 그대로 쓰지 않는 이유는
  // 파일 상단 주석 참고(게이트 도달 가능성 + 서버가 내려준 최신 cleared 반영).
  const entryMutation = useMutation({
    mutationFn: (contentItemId) => boardApi.fetchBoardPuzzle(contentItemId),
    onSuccess: (detail) => {
      setSelected(detail);
      setResult(null);
      setEntryError(null);
    },
    onError: (err) => {
      // 잔량 0인데 카드를 누른 경로(잔량 표시가 stale했을 때) — 잔량 갱신 후 안내.
      // 정상 흐름에서는 여기 오기 전에 카드가 비활성이다(누르기 전에 알린다).
      if (err.code === 'OUT_OF_CLOUDS') {
        queryClient.invalidateQueries({ queryKey: ['progress', 'energy'] });
      }
      // 순차 잠금(403)은 **아는 코드**라 우리 리소스로 말한다 — 서버 detail은
      // 한국어 고정이라 그대로 쓰면 영어 화면에 한국어가 뜬다. 목록도 새로
      // 받는다: 다른 기기에서 앞 퍼즐을 깼다면 잠금이 이미 풀렸을 수 있다.
      if (err.code === 'PUZZLE_LOCKED') {
        queryClient.invalidateQueries({ queryKey: ['board', 'puzzles'] });
        setEntryError(t('board.page.lockedError'));
        return;
      }
      setEntryError(err.detail ?? t('board.page.entryFailed'));
    },
  });

  const openPuzzle = (p) => {
    setEntryError(null);
    entryMutation.mutate(p.content_item_id);
  };
  const backToList = () => {
    setSelected(null);
    setResult(null);
    setSandbox(false);
    setEntryError(null);
    // 진입 시 소모는 없지만 플레이 중 오답으로 잔량이 줄었을 수 있다 → 목록 복귀 시 최신값.
    queryClient.invalidateQueries({ queryKey: ['progress', 'energy'] });
  };

  // 자유 실험 화면(R9-01 §3.3 ⑥) — 퍼즐 목록보다 먼저 분기(로딩과 무관하게 진입 가능)
  if (sandbox) {
    return (
      <div className="pt-2">
        <button type="button" onClick={backToList} className="mb-2 text-sm font-medium text-slate-500 hover:text-slate-700">
          {t('board.page.backToList')}
        </button>
        <AtmosphereBoard puzzle={sandboxPuzzle} sandbox layout="wide" />
        <p className="mt-2 text-center text-xs text-slate-400">
          {t('board.page.sandboxFooter')}
        </p>
      </div>
    );
  }

  if (isLoading) return <LoadingSpinner label={t('board.page.loading')} />;

  if (isError) {
    return (
      <div className="mt-16 rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-slate-200">
        <p className="text-3xl">🧩</p>
        <p className="mt-2 font-bold text-slate-800">{t('board.page.loadErrorTitle')}</p>
        <p className="mt-1 text-sm text-slate-500">{error?.detail ?? t('board.page.loadErrorBody')}</p>
        <button type="button" onClick={() => refetch()} className="mt-4 rounded-xl bg-sky-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-sky-700">
          {t('board.page.retry')}
        </button>
      </div>
    );
  }

  // PLAY 화면
  if (selected) {
    return (
      <div className="pt-2">
        {toast && (
          <div className="fixed left-1/2 top-16 z-50 -translate-x-1/2 animate-xp-pop rounded-full bg-emerald-500 px-4 py-2 text-sm font-bold text-white shadow-lg">
            {toast}
          </div>
        )}
        <button type="button" onClick={backToList} className="mb-2 text-sm font-medium text-slate-500 hover:text-slate-700">
          {t('board.page.backToList')}
        </button>
        <AtmosphereBoard
          puzzle={selected.template_json}
          disabled={false}
          submitting={attemptMutation.isPending}
          result={result}
          layout="wide"
          onSubmit={(boardState) => attemptMutation.mutate({ id: selected.content_item_id, boardState })}
        />
        {result && (
          <div className="mt-3 space-y-2">
            <PhenomenaSummary phenomena={result.phenomena} />
            <button
              type="button"
              onClick={() => setResult(null)}
              className="w-full rounded-xl border border-slate-300 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50"
            >
              {result.passed ? t('board.page.retryChallenge') : t('board.page.retry')}
            </button>
          </div>
        )}
      </div>
    );
  }

  // LIST 화면
  const list = puzzles ?? [];
  const clearedCount = list.filter((p) => p.cleared).length;
  return (
    <div className="pt-2">
      {toast && (
        <div className="fixed left-1/2 top-16 z-50 -translate-x-1/2 animate-xp-pop rounded-full bg-emerald-500 px-4 py-2 text-sm font-bold text-white shadow-lg">
          {toast}
        </div>
      )}
      {/* 실험 둘은 **우측 레일**이 소유한다(2026-08-05 새 시안) — 머리말에도 두면
          같은 입구가 화면에 두 번 뜬다. 머리말은 제목·부제만. */}
      <div className="mb-3 flex flex-wrap items-end gap-x-3 gap-y-2">
        <div className="min-w-0">
          <h1 className="text-lg font-extrabold text-slate-900">{t('board.page.title')}</h1>
          <p className="text-sm text-slate-500">{t('board.page.subtitle')}</p>
        </div>
      </div>

      {/* 구름 소진 안내 (§3.1) — 퍼즐은 열 수 없지만 목록·클리어 표시는 그대로 보인다(D1) */}
      {energyBlocked && (
        <div className="mb-3 rounded-2xl bg-rose-50 p-4 ring-1 ring-rose-200">
          <p className="text-sm font-extrabold text-rose-700">{t('board.common.outOfClouds')}</p>
          <p className="mt-1 text-xs leading-relaxed text-rose-600">
            {t('board.page.depletedBody1')} <span className="font-bold">{t('board.page.depletedBodyBold')}</span>{' '}
            {t('board.page.depletedBody2')} <span className="font-bold">{t('board.page.depletedMinutes', { min: regenMin })}</span>{' '}
            {t('board.page.depletedBody3')}
          </p>
        </div>
      )}

      {/* 진입 실패(429 경합 등) — 카드 비활성으로 대부분 예방되지만 최후 안내 */}
      {entryError && (
        <div className="mb-3 rounded-xl bg-amber-50 p-3 text-xs font-bold text-amber-700 ring-1 ring-amber-200">
          {entryError}
        </div>
      )}

      {list.length === 0 ? (
        <div className="rounded-2xl bg-white p-6 text-center text-sm text-slate-500 shadow-sm ring-1 ring-slate-200">
          {t('board.page.empty')}
        </div>
      ) : (
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_260px]">
          {/* 왼쪽 — 퍼즐 조각으로 이어지는 미션. 서버가 저작 순서(board_order)로
              내려주므로 클라이언트는 재정렬하지 않는다(순서가 곧 코스다). */}
          <div>
            {/* 정사각에 가깝게 — 3열이면 칸이 가로로 길어진다(실측 285×112).
                4열로 좁히고 sm↑에서 가로:세로 10:9로 잡는다 — 정사각(218×218)은
                살짝 키가 커 보여 한 뼘 낮췄다(218×196). 모바일 1열은 비율을 걸면
                한 칸이 화면을 다 먹으므로 높이를 내용에 맡긴다. */}
            <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {list.map((p, i) => (
                <PuzzlePiece
                  key={p.content_item_id}
                  puzzle={p}
                  index={i}
                  energyBlocked={energyBlocked}
                  regenMin={regenMin}
                  pending={entryMutation.isPending && entryMutation.variables === p.content_item_id}
                  busy={entryMutation.isPending}
                  onOpen={() => openPuzzle(p)}
                />
              ))}
            </div>

            {/* 전체 진행도 — 순차 진행이라 "몇 칸 남았나"가 곧 코스 진도다 */}
            <div className="mt-4 flex items-center gap-3 rounded-2xl bg-white px-4 py-3 shadow-sm ring-1 ring-slate-200">
              <span className="text-[11.5px] font-extrabold text-slate-500">
                {t('board.page.progressLabel')}
              </span>
              <span className="h-[7px] flex-1 overflow-hidden rounded-full bg-sky-100">
                <i
                  className="block h-full rounded-full bg-sky-600 transition-[width]"
                  style={{ width: `${Math.round((clearedCount / list.length) * 100)}%` }}
                />
              </span>
              <span className="flex-none text-[11.5px] font-bold tabular-nums text-slate-500">
                {t('board.page.progressCount', { done: clearedCount, total: list.length })}
              </span>
            </div>
          </div>

          {/* 오른쪽 — 채점도 구름 소모도 없는 상시 입구. 본선(미션)과 격이 달라
              같은 줄에 두지 않는다. */}
          <aside className="flex flex-col gap-3">
            <LabCard
              icon="🧪"
              title={t('board.page.sandboxTitle')}
              desc={t('board.page.sandboxDesc')}
              cta={t('board.page.enter')}
              onClick={() => setSandbox(true)}
            />
            <LabCard
              icon="🔬"
              title={t('board.page.exploreTitle')}
              desc={t('board.page.exploreDesc')}
              cta={t('board.page.enter')}
              to="/explore"
            />
          </aside>
        </div>
      )}
    </div>
  );
}

/**
 * 퍼즐 조각 한 칸 = 미션 하나 (2026-08-05 시안).
 *
 * 상태는 셋뿐이다 — 순차 진행이라 "열려 있는데 아직 안 깬" 칸이 **항상 하나**다:
 *   cleared(깬 칸) · current(지금 풀 칸) · locked(아직 잠긴 칸).
 * 색을 상태당 하나씩만 쓴다(초록·하늘·회색). 난이도 칩이 이미 색을 세 개 쓰므로
 * 카드까지 다채로우면 무엇이 신호인지 흐려진다.
 *
 * 퍼즐 느낌은 **카드 모양이 아니라 연결 꼭지**가 만든다. 카드를 실제 퍼즐 조각
 * 실루엣으로 깎으려면 clip-path에 px 좌표를 박아야 해서 반응형이 깨진다 —
 * 좌우에 작은 원(꼭지/홈)을 붙이면 열 수가 바뀌어도 그대로 이어져 보인다.
 */
function PuzzlePiece({ puzzle, index, energyBlocked, regenMin, pending, busy, onOpen }) {
  const t = useT();
  const tpl = puzzle.template_json ?? {};
  const locked = Boolean(puzzle.locked);
  const cleared = Boolean(puzzle.cleared);
  // 구름 부족은 **잠금과 사유가 다르다** — 잠긴 칸은 구름이 차도 안 열리고,
  // 구름이 없는 칸은 기다리면 열린다. 라벨을 구분하고 클릭 차단만 함께 묶는다.
  const blocked = locked || energyBlocked;
  const state = cleared ? 'cleared' : locked ? 'locked' : 'current';
  const goalPhenomenon = tpl.goal_conditions?.[0]?.phenomenon ?? null;

  const skin = {
    cleared: 'bg-emerald-50 ring-emerald-200 hover:ring-emerald-400',
    current: 'bg-white ring-sky-500 hover:ring-sky-600',
    locked: 'bg-slate-50 ring-slate-200',
  }[state];
  // 꼭지·홈은 카드 바탕과 페이지 바탕을 각각 흉내 낸다 — 색이 어긋나면 원이 보인다.
  const knob = { cleared: 'bg-emerald-50', current: 'bg-white', locked: 'bg-slate-50' }[state];

  const suffix = locked
    ? t('board.page.lockedSuffix')
    : energyBlocked
      ? t('board.page.blockedSuffix')
      : '';

  return (
    <div className="relative">
      <button
        type="button"
        onClick={onOpen}
        disabled={blocked || busy}
        aria-disabled={blocked ? 'true' : undefined}
        aria-label={`${index + 1}. ${tpl.title ?? tpl.question_text ?? t('board.page.puzzleFallback')}${suffix}`}
        title={
          locked
            ? t('board.page.lockedTitle')
            : energyBlocked
              ? t('board.page.blockedTitle', { min: regenMin })
              : (tpl.question_text ?? undefined)
        }
        className={`flex min-h-[132px] w-full flex-col overflow-hidden rounded-2xl p-3.5 text-left shadow-sm ring-1 transition sm:aspect-[10/9] ${skin} ${
          blocked ? 'cursor-not-allowed' : ''
        } ${locked ? 'opacity-70' : ''}`}
      >
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-extrabold tabular-nums text-slate-400">
            {String(index + 1).padStart(2, '0')}
          </span>
          <span className="ml-auto text-[13px]" aria-hidden="true">
            {cleared ? '✅' : locked ? '🔒' : '▶'}
          </span>
        </div>
        {/* 목표 현상 아이콘 — 정사각 칸의 빈 가운데를 실데이터로 채운다.
            정답 누설이 아니다: 목표 현상은 미션 문장이 이미 말한다("소나기를 내려
            보세요"). 목표가 없는 퍼즐(자유형)은 아이콘 줄 자체를 만들지 않는다. */}
        {goalPhenomenon && (
          <div className={`mt-1.5 ${locked ? 'opacity-50 grayscale' : ''}`}>
            <SymbolIcon kind="phenomenon" value={goalPhenomenon} className="h-8 w-8" />
          </div>
        )}
        <p className={`mt-1.5 text-[13.5px] font-extrabold ${locked ? 'text-slate-500' : 'text-slate-900'}`}>
          {tpl.title ?? tpl.question_text}
        </p>
        {tpl.summary && (
          <p
            className={`mt-0.5 overflow-hidden text-[11.5px] leading-snug ${
              locked ? 'text-slate-400' : 'text-slate-500'
            }`}
            // 칸이 정사각이라 요약이 길면 난이도 칩을 밀어낸다 — 3줄에서 자른다.
            style={{ display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 3 }}
          >
            {tpl.summary}
          </p>
        )}
        <div className="mt-auto flex items-center gap-1.5 pt-2">
          <DifficultyBadge difficulty={puzzle.difficulty} />
          {pending && <span className="text-[11px] font-bold text-sky-700">{t('board.page.opening')}</span>}
          {/* 누르기 전에 알린다(§3.1) — 429를 받고 나서가 아니다 */}
          {!locked && energyBlocked && (
            <span className="text-[11px] font-bold text-rose-600">{t('board.page.cardRecovery', { min: regenMin })}</span>
          )}
        </div>
      </button>

      {/* 연결 꼭지(오른쪽)와 홈(왼쪽) — 조각이 옆으로 이어져 보이게 한다.
          장식이라 스크린리더에서 감춘다. */}
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute -right-[7px] top-1/2 z-[1] h-3.5 w-3.5 -translate-y-1/2 rounded-full ${knob}`}
      />
      {/* 홈(왼쪽) — **페이지 바탕색과 같은 값이어야** 파인 것처럼 보인다.
          body가 slate-100이라 여기도 slate-100이다. 배경을 바꾸면 이 원이
          동그라미로 드러난다(같이 고칠 것). */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -left-[7px] top-1/2 z-[1] h-3.5 w-3.5 -translate-y-1/2 rounded-full bg-slate-100"
      />
    </div>
  );
}

/**
 * 실험 입구 카드 — 자유 실험·탐구 실험실이 같은 모양을 쓴다(격이 같다).
 *
 * 아이콘은 **prop으로 받는다.** 리소스 문자열이 이미 앞머리에 이모지를 달고 있어
 * (`🧪 자유 실험`) 그대로 두면 큰 아이콘과 나란히 두 번 뜬다 — 표시할 때 앞
 * 이모지를 떼고 이름만 쓴다. 리소스 값은 건드리지 않는다(다른 화면·번역 공유).
 */
function LabCard({ icon, title, desc, cta, onClick, to }) {
  const label = title.replace(/^\p{Extended_Pictographic}\uFE0F?\s*/u, '');
  const inner = (
    <>
      <span
        aria-hidden="true"
        className="grid h-14 w-14 place-items-center rounded-2xl bg-white text-[26px] ring-1 ring-indigo-100"
      >
        {icon}
      </span>
      <p className="mt-3 text-[13.5px] font-extrabold text-slate-900">{label}</p>
      <p className="mt-1 text-[11.5px] leading-snug text-slate-500">{desc}</p>
      {/* mt-auto — 카드를 키운 만큼 남는 높이를 여기서 먹어 CTA를 바닥에 붙인다.
          두 카드의 버튼 높이가 맞아야 레일이 정돈돼 보인다. */}
      <span className="mt-auto inline-block self-start rounded-lg bg-slate-900 px-3 py-1.5 text-[12px] font-bold text-white">
        {cta}
      </span>
    </>
  );
  // 퍼즐 칸과 **한 눈에 갈리게** 살짝 다른 바탕을 준다(2026-08-05). 미션 칸은
  // 흰색·초록·회색 셋을 쓰므로 여기만 옅은 남색 계열로 둔다 — 어느 쪽도 아니고
  // 본선 진도와 무관한 상시 입구라는 뜻이다. 색은 **하나만** 더 쓴다.
  const cls =
    'flex min-h-[224px] flex-col rounded-2xl bg-indigo-50 p-4 text-left shadow-sm ring-1 ring-indigo-200 transition hover:ring-indigo-400';
  return to ? (
    <Link to={to} className={cls}>
      {inner}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={`w-full ${cls}`}>
      {inner}
    </button>
  );
}

/** 서버 재판정 존별 현상 요약 (§3.4 phenomena) */
function PhenomenaSummary({ phenomena }) {
  const t = useT();
  if (!Array.isArray(phenomena) || phenomena.length === 0) return null;
  return (
    <div className="rounded-xl bg-white p-3 shadow-sm ring-1 ring-slate-200">
      <p className="mb-1.5 text-xs font-bold text-slate-500">{t('board.page.serverVerdict')}</p>
      <div className="grid grid-cols-4 gap-1">
        {phenomena.map((p, i) => {
          const meta = phenomenonMeta(p.phenomenon);
          return (
            <div key={i} className="rounded-lg bg-slate-50 py-1.5 text-center">
              <div className="flex justify-center">
                <SymbolIcon kind="phenomenon" value={p.phenomenon} className="h-6 w-6" />
              </div>
              <div className="text-[10px] text-slate-500">{p.zone_name ?? ZONES[p.zone] ?? ''}</div>
              <div className="text-[11px] font-bold text-slate-700">{meta.label}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
