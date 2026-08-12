import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { boardApi, progressApi } from '../../api';
import { useProgressStore } from '../../store/progressStore';
import LoadingSpinner from '../../components/LoadingSpinner';
import Mascot from '../../components/Mascot';
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
 * **잠금 없음**(2026-08-06 제품 결정): 순차 잠금을 넣었다가 걷어냈다 — 학습자가
 * 원하는 퍼즐을 골라 푼다. 미클리어 칸은 회색으로 표시하되 눌러서 바로 들어간다
 * (회색 = "아직 안 풀었다"이지 "막혔다"가 아니다).
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
// 배경 없이 **글자만** 쓴다(2026-08-06) — 알약 배경이 칸마다 색 덩어리로 튀어,
// 정작 신호인 「깬 칸(초록) / 미클리어(회색)」보다 먼저 눈에 들어왔다.
// 색은 남기되 접근성 규칙은 그대로다: 색에만 의존하지 않고 텍스트를 병기한다.
const DIFFICULTY_META = {
  1: { labelKey: 'board.page.difficulty1', className: 'text-emerald-600' },
  2: { labelKey: 'board.page.difficulty2', className: 'text-amber-600' },
  3: { labelKey: 'board.page.difficulty3', className: 'text-rose-600' },
};

// compact — 「난이도」 접두어를 떼고 등급만 쓴다. 잠긴 칸에서만 켠다: 같은 줄에
// 잠금 사유가 따라붙어 접두어까지 놓을 폭이 없다(en 「Difficulty Normal」 +
// 「Previous tier first」 = 187px 칸에서 줄임표. 2026-08-10 실측). **읽어 주는
// 이름은 줄지 않는다** — aria-label은 두 경우 모두 전체 문구다.
function DifficultyBadge({ difficulty, compact = false }) {
  const t = useT();
  const meta = DIFFICULTY_META[difficulty];
  if (!meta) return null; // 구 백엔드(difficulty 부재) 하위 호환 — 배지 미표시
  const label = t(meta.labelKey);
  return (
    <span
      aria-label={t('board.page.difficultyAria', { label })}
      className={`shrink-0 text-[11px] font-bold ${meta.className}`}
    >
      {compact ? label : t('board.page.difficultyText', { label })}
    </span>
  );
}

// 자유 실험(SANDBOX_PUZZLE)은 2026-08-10에 **탐구로 이사했다**(사용자 지시) —
// `modules/explore/SandboxPage.jsx`. 보드는 목표가 있는 미션판이고 자유 실험은
// 목표가 없는 관찰이라, 한 화면에 두면 "채점되는 것"과 "채점 안 되는 것"이 섞였다.
// 그래서 여기에는 사이드바 카드도, 샌드박스 분기도 없다.

/**
 * 판의 크기 — **가로 6 × 세로 8**(2026-08-10 사용자 지시. 종전 4열).
 * 48칸이고, 저작된 퍼즐이 그보다 적으면 나머지는 「???」로 채운다.
 *
 * ⚠️ 6열은 **xl(1280px)부터**다(계단은 useGridCols가 소유). sm(640)에 걸면 셸이
 * 아직 `max-w-xl`(576px)이라 칸이 96px로 내려가 제목이 대여섯 줄로 접힌다
 * (2026-08-10 리뷰). 칸 187px은 1440에서 나오는 값이고 1280에서 약 173px이다.
 */
const GRID_COLS = 6;
const GRID_ROWS = 8;

/**
 * 지금 격자가 **몇 열인가** — 경계선·돌기를 "마지막 열/행에는 긋지 않는다"로
 * 판정하려면 열 수를 알아야 한다. Tailwind `sm:`(640px)과 같은 기준을 본다.
 * 하드코딩하면 모바일 2열에서 선이 엉뚱한 칸에 붙고 돌기가 판 밖으로 잘린다.
 */
/**
 * 열 수의 **단일 소유자** — 아래 `grid-cols-*` 클래스와 **반드시 같은 계단**이어야
 * 한다. 어긋나면 경계선·돌기가 엉뚱한 칸에 붙는다(그 판정이 이 값을 쓴다).
 *   기본 2 · md(768) 4 · xl(1280) 6
 * 6열을 sm(640)에 걸면 셸이 아직 `max-w-xl`(576px)이라 칸이 96px로 내려간다.
 * 반대로 xl에서만 갈라 두면 1024px에서 2열이 되어 칸이 392px로 불어난다
 * (둘 다 2026-08-10에 실측하고 이 계단으로 정착했다).
 */
const COL_STEPS = [
  { mq: '(min-width: 1280px)', cols: GRID_COLS }, // xl
  { mq: '(min-width: 768px)', cols: 4 }, // md
];
const NARROW_COLS = 2;

function resolveCols() {
  if (typeof window === 'undefined' || !window.matchMedia) return NARROW_COLS;
  return COL_STEPS.find((s) => window.matchMedia(s.mq).matches)?.cols ?? NARROW_COLS;
}

function useGridCols() {
  // ⚠️ 초깃값을 **동기로** 읽는다. 상수로 두면 모바일 첫 페인트가 2열 격자에
  // 48칸을 쏟아 내고(유령 「???」 14개) 경계선·돌기 계산도 6열 기준으로 돌다가
  // effect 뒤에 고쳐진다 — 종전 초깃값이 4라 눈에 안 띄던 결함이다(2026-08-10 리뷰).
  const [cols, setCols] = useState(resolveCols);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const apply = () => setCols(resolveCols());
    apply();
    const mqs = COL_STEPS.map((s) => window.matchMedia(s.mq));
    mqs.forEach((mq) => mq.addEventListener('change', apply));
    return () => mqs.forEach((mq) => mq.removeEventListener('change', apply));
  }, []);
  return cols;
}

export default function BoardPage() {
  const t = useT();
  const cols = useGridCols();
  const queryClient = useQueryClient();
  const addXp = useProgressStore((s) => s.addXp);
  const [selected, setSelected] = useState(null); // 플레이 중 퍼즐 {content_item_id, template_json}
  const [result, setResult] = useState(null); // 서버 판정 결과
  const [toast, setToast] = useState(null); // XP 토스트 메시지
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
    setEntryError(null);
    // 진입 시 소모는 없지만 플레이 중 오답으로 잔량이 줄었을 수 있다 → 목록 복귀 시 최신값.
    queryClient.invalidateQueries({ queryKey: ['progress', 'energy'] });
  };

  // 목록은 **PLAY 분기보다 먼저** 확정한다(CO-K11) — 결과 블록의 「다음 퍼즐 →」이
  // 서버가 내려준 저작 순서(board_order)에서 다음 칸을 찾아야 하기 때문이다.
  const list = puzzles ?? [];
  const selectedIndex = selected
    ? list.findIndex((p) => p.content_item_id === selected.content_item_id)
    : -1;
  // 잠긴 칸은 **건너뛴다**(2026-08-10 코드 리뷰). 바로 다음 칸을 집으면 밴드
  // 경계에 선 사람(초등의 23번, 중·고등의 36번)이 클리어한 순간 403이 나는
  // 「다음 퍼즐 →」을 받는다 — 상 대신 빨간 에러가 뜬다. 뒤가 전부 잠겼으면
  // null이고, 그때는 「마지막 퍼즐까지 마쳤어요」가 뜬다(lastPuzzleDone).
  const nextPuzzle =
    selectedIndex >= 0 ? (list.slice(selectedIndex + 1).find((p) => !p.locked) ?? null) : null;

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
          <div className="fixed left-[calc(50%_+_var(--wm-shell-left)/2)] top-16 z-50 -translate-x-1/2 animate-toast-pop rounded-full bg-emerald-500 px-4 py-2 text-sm font-bold text-white shadow-lg">
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
        {/* 결과 블록 = 자동 스크롤이 도착하는 자리(CO-K11).
            종전에는 여기 버튼이 **「다시 도전」 하나**뿐이었고, 유일한 출구인
            상단 「목록으로」 링크는 그 스크롤에 밀려 화면 밖으로 나갔다. 게다가
            이 파일 머리말이 스스로 "순차 진행"이라 적어 놓고 **「다음 퍼즐」이
            없었다** — 34칸을 이어 풀려면 매번 목록→스크롤→탐색→클릭이었다.
            3버튼으로 바꾼다: 클리어면 「다음 퍼즐 →」이 주 버튼, 미클리어면
            「다시 도전」이 주 버튼, 「목록으로」는 항상 있다.
            ⚠️ 다음 퍼즐도 **반드시 openPuzzle(=GET /board/puzzles/{id})을 탄다** —
            그 상세 엔드포인트가 보드측 유일한 구름 진입 게이트라(D1·CO-K5)
            여기서 우회하면 잔량 0에서 보드가 무제한이 된다. */}
        {result && (
          <div className="mt-3 space-y-2">
            <PhenomenaSummary phenomena={result.phenomena} />
            {entryError && (
              <p className="rounded-xl bg-amber-50 p-3 text-xs font-bold text-amber-700 ring-1 ring-amber-200">
                {entryError}
              </p>
            )}
            {result.passed &&
              (nextPuzzle ? (
                <button
                  type="button"
                  data-board-next
                  disabled={entryMutation.isPending}
                  onClick={() => openPuzzle(nextPuzzle)}
                  className="w-full rounded-xl bg-sky-600 py-2.5 text-sm font-extrabold text-white hover:bg-sky-700 disabled:opacity-50"
                >
                  {t('board.page.nextPuzzle')}
                </button>
              ) : (
                // 마지막 칸 — 다음이 없으면 「목록으로」가 주 버튼이 된다
                <p className="text-center text-sm font-extrabold text-emerald-600">
                  {t('board.page.lastPuzzleDone')}
                </p>
              ))}
            <button
              type="button"
              onClick={() => setResult(null)}
              className={
                result.passed
                  ? 'w-full rounded-xl border border-slate-300 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50'
                  : 'w-full rounded-xl bg-sky-600 py-2.5 text-sm font-extrabold text-white hover:bg-sky-700'
              }
            >
              {result.passed ? t('board.page.retryChallenge') : t('board.page.retry')}
            </button>
            <button
              type="button"
              data-board-back
              onClick={backToList}
              className={
                result.passed && !nextPuzzle
                  ? 'w-full rounded-xl bg-sky-600 py-2.5 text-sm font-extrabold text-white hover:bg-sky-700'
                  : 'w-full rounded-xl border border-slate-300 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50'
              }
            >
              {t('board.page.backToList')}
            </button>
          </div>
        )}
      </div>
    );
  }

  // LIST 화면
  const clearedCount = list.filter((p) => p.cleared).length;
  // 격자를 **꽉 채운다** — 남는 자리는 「???」(아직 저작되지 않은 칸)로 메운다.
  // 빈 자리를 그냥 두면 한 판짜리 퍼즐의 아래쪽이 뜯겨 나간 것처럼 보인다.
  //
  // PC(6열)에서는 **6×8 = 48칸을 고정**한다(사용자 지시) — 저작이 늘어도 줄어도
  // 판 모양이 그대로여서, 화면을 볼 때마다 판 크기가 달라지지 않는다.
  // 저작이 48을 넘으면 자르지 않고 6의 배수로 늘린다(퍼즐을 감추면 안 된다).
  // 모바일(2열)은 목록에 맞춰 최소로만 채운다 — 48칸이면 24행짜리 두루마리가 된다.
  const target =
    cols === GRID_COLS
      ? Math.max(GRID_COLS * GRID_ROWS, Math.ceil(list.length / cols) * cols)
      : Math.ceil(list.length / cols) * cols;
  const cells = [...list];
  while (cells.length < target) cells.push(null);
  return (
    <div className="pt-2">
      {toast && (
        <div className="fixed left-[calc(50%_+_var(--wm-shell-left)/2)] top-16 z-50 -translate-x-1/2 animate-toast-pop rounded-full bg-emerald-500 px-4 py-2 text-sm font-bold text-white shadow-lg">
          {toast}
        </div>
      )}
      {/* 태양이 튜터 배너 — /learn의 물방울이 배너(LearnHeroCard)와 **같은 치수**로
          맨 위에 선다(2026-08-11 사용자 지시). 보드 담당 마스코트가 태양이라
          (Mascot 배정표 · SideNav TUTOR_BY_PATH `/board` → sun) 보드 설명을
          태양이가 하는 것이 배정표와 맞는다(담당표 소유자는 SideNav.TUTOR_BY_PATH
          — Mascot.jsx 머리말의 표는 2026-08-11까지 거꾸로였다).
          ⚠️ 사이드바 튜터는 이 배너가 생기면서 `/board`에서 **접힌다** — 안 접으면
          같은 태양이가 74px·62px로 한 화면에 둘, 각자 다른 말을 한다(SideNav
          HERO_PATHS). /learn이 같은 이유로 이미 접고 있었다.
          ⚠️ 치수는 눈대중이 아니라 LearnHeroCard에서 그대로 옮긴 값이다 —
          px-5 py-3.5 · 원 62px · 그림 50px · eyebrow 11.5 · 제목 21.
          한쪽만 고치면 두 화면의 같은 자리 배너가 서로 다른 크기가 된다. */}
      <div
        data-testid="board-hero"
        className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-3 rounded-[20px] bg-gradient-to-r from-[#1F3A5F] to-[#16293F] px-5 py-3.5 shadow-[0_2px_10px_rgba(15,23,42,0.18)]"
      >
        <span className="hidden h-[62px] w-[62px] flex-none place-items-center rounded-full bg-white/10 sm:grid">
          <Mascot name="sun" className="h-[50px] w-[50px]" />
        </span>
        <div className="min-w-0 flex-1 basis-[220px]">
          {/* 페이지 제목은 **h1이어야 한다**(2026-08-11 코드 리뷰). 배너로 바꾸면서
              종전 `<h1>🧩 대기 보드</h1>`가 사라져 이 화면만 heading이 0개였다 —
              보조기기에는 페이지 이름이 없는 화면이 된다. 눈에 보이는 위계는
              그대로 두고(11.5px eyebrow) 태그만 h1로 올린다. */}
          <h1 className="truncate text-[11.5px] font-bold tracking-[0.02em] text-sky-300">
            {t('board.page.title')}
          </h1>
          {/* truncate — LearnHeroCard 제목과 같은 처리다. 없으면 en 제목이
              두 줄로 접혀 배너가 /learn보다 높아진다("같은 치수"가 깨진다). */}
          <p className="mt-0.5 truncate text-[21px] font-extrabold leading-tight tracking-[-0.02em] text-white">
            {t('board.hero.title')}
          </p>
        </div>
        {/* 설명 + 진도 — LearnHeroCard와 같이 좁아지면 통째로 접힌다(hidden lg:block).
            잃는 정보가 없다: 설명은 안내문이고 진도는 판 아래 진행도 바가 같은
            값을 보여준다. */}
        <div className="hidden min-w-0 basis-[260px] lg:block">
          <p className="truncate text-[11.5px] leading-relaxed text-slate-300">
            {t('board.page.subtitle')}
          </p>
          {list.length > 0 && (
            <span className="mt-2 block h-[6px] overflow-hidden rounded-full bg-white/15">
              <i
                className="block h-full rounded-full bg-sky-400"
                style={{ width: `${Math.round((clearedCount / list.length) * 100)}%` }}
              />
            </span>
          )}
        </div>
        {/* 저작이 0건이면 진도를 말하지 않는다 — 「전체 진행도 0/0」과 0% 바가
            "아직 퍼즐이 없어요" 카드 위에 뜬다(2026-08-11 코드 리뷰). */}
        {list.length > 0 && (
          <span className="flex-none whitespace-nowrap text-[11.5px] font-bold tabular-nums text-slate-300">
            {t('board.page.progressLabel')} {clearedCount}/{list.length}
          </span>
        )}
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

      {/* 학습 수준 잠금 안내 — 잠긴 칸이 하나라도 있을 때만. 칸 안의 「수준 올리면
          열림」은 **왜**만 말하고 **어디서**를 못 말한다(폭이 없다). 여는 통로가
          화면에 없으면 잠금이 그냥 벽이 되므로 여기서 한 번, /me로 보낸다.
          잠긴 칸이 없으면(성인) 통째로 사라진다 — 열려 있는 사람에게 잠금 이야기를
          할 이유가 없다. */}
      {list.some((p) => p.locked) && (
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl bg-slate-50 p-3.5 ring-1 ring-slate-200">
          <p className="text-sm font-extrabold text-slate-700">{t('board.page.lockedBannerTitle')}</p>
          <p className="min-w-0 flex-1 text-xs leading-relaxed text-slate-500">
            {t('board.page.lockedBannerBody')}
          </p>
          <Link
            to="/me"
            className="flex-none rounded-full bg-white px-3 py-1.5 text-xs font-extrabold text-sky-700 ring-1 ring-sky-200 transition hover:bg-sky-50"
          >
            {t('board.page.lockedBannerCta')}
          </Link>
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
        <div>
          {/* 왼쪽 — **하나의 큰 퍼즐**을 구역으로 나눈 미션 격자(2026-08-06 시안).
              칸을 따로 띄우지 않고 한 판 안에서 실선으로 가른다. 서버가 저작
              순서(board_order = 난이도 오름차순)로 내려주므로 재정렬하지 않는다. */}
          <div>
            {/* 판이 **폭 전체**를 쓴다(2026-08-10) — 오른쪽 실험 레일이 탐구로
                옮겨 가 묶어 둘 이유가 없어졌다. 열 너비가 곧 칸 크기라(aspect
                고정) 6열에서 폭까지 묶으면 칸이 143px로 내려가 제목이 안 들어간다.
                종전의 max-w-[860px]·lg:ml-auto는 레일과 짝이던 값이라 함께 걷었다. */}
            <div className="grid grid-cols-2 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 md:grid-cols-4 xl:grid-cols-6">
              {cells.map((p, i) =>
                p ? (
                  <PuzzlePiece
                    key={p.content_item_id}
                    puzzle={p}
                    index={i}
                    cols={cols}
                    total={cells.length}
                    energyBlocked={energyBlocked}
                    regenMin={regenMin}
                    pending={entryMutation.isPending && entryMutation.variables === p.content_item_id}
                    busy={entryMutation.isPending}
                    onOpen={() => openPuzzle(p)}
                  />
                ) : (
                  <EmptyPiece key={`empty-${i}`} index={i} cols={cols} total={cells.length} />
                ),
              )}
            </div>

            {/* 전체 진행도 — 순차 진행이라 "몇 칸 남았나"가 곧 코스 진도다.
                폭은 위 판과 **짝**이다. 한쪽만 묶으면 좌우 끝이 어긋난다(실측 20px).
                판 폭을 바꾸면 여기도 같이 바꿀 것. */}
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

        </div>
      )}
    </div>
  );
}

/**
 * 퍼즐 한 칸 = 미션 하나 (2026-08-06 시안 — 한 판을 구역으로 나눈다).
 *
 * 칸을 따로 띄우지 않는다. 바깥 격자가 한 판(둥근 테두리 하나)이고 칸은 그 안을
 * 실선으로 가른 구역이다. 조각처럼 보이게 하는 것은 **경계선 위의 돌기**다 —
 * 오른쪽·아래 경계 가운데에 반원을 얹는다. 칸을 진짜 조각 실루엣으로 깎으려면
 * clip-path에 px 좌표를 박아야 해서 열 수가 바뀌면 깨진다.
 *
 * 상태는 셋 + 빈 칸: cleared(깬 칸, 초록) · 미클리어(회색) · **잠김**(자물쇠) ·
 * 「???」(EmptyPiece).
 *
 * 잠김의 열쇠는 **학습 수준**이다(2026-08-10 사용자 지시) — 초등은 쉬움, 중·고등은
 * 보통까지, 성인은 전부. 진도가 아니라 수준이라 「내 정보 → 학습 수준」 한 번으로
 * 바뀐다. 열린 난이도 안에서는 미클리어도 눌러서 바로 들어간다(2026-08-06 결정).
 *
 * ⚠️ 같은 날의 첫 판은 「쉬움 23칸 전건 클리어 → 보통 개방」이었는데 뒤집혔다.
 * 로그인 없이 여는 심사 화면에서 보통·어려움을 볼 방법이 없었기 때문이다.
 *
 * ⚠️ 잠긴 칸도 **제목을 보여준다**. 「???」로 덮으면 아직 저작되지 않은 칸
 * (EmptyPiece)과 구분이 안 되고, 무엇이 기다리는지 안 보이면 잠금이 동기가
 * 아니라 벽이 된다. 화면은 누르는 것만 막고, 진짜 차단은 서버가 한다
 * (GET /puzzles/{id} → 403 PUZZLE_LOCKED) — 주소창으로 들어오면 화면 판정이 없다.
 */
function PuzzlePiece({ puzzle, index, cols, total, energyBlocked, regenMin, pending, busy, onOpen }) {
  const t = useT();
  const tpl = puzzle.template_json ?? {};
  const cleared = Boolean(puzzle.cleared);
  const locked = Boolean(puzzle.locked);
  const goalPhenomenon = tpl.goal_conditions?.[0]?.phenomenon ?? null;

  // 잠긴 칸은 **구름 안내를 하지 않는다** — 기다리면 열리는 줄 알게 된다.
  // 두 사유가 겹치면 잠금이 이긴다(구름이 차도 안 열린다).
  const blockedReason = locked ? 'locked' : energyBlocked ? 'energy' : null;
  const skin = locked
    ? 'bg-slate-100/70'
    : cleared
      ? 'bg-emerald-50 hover:bg-emerald-100/70'
      : 'bg-slate-50 hover:bg-white';
  const bump = locked ? 'bg-slate-100' : cleared ? 'bg-emerald-50' : 'bg-slate-50';

  return (
    <div className={`relative ${edgeClass(index, cols, total)}`}>
      <button
        type="button"
        onClick={onOpen}
        disabled={Boolean(blockedReason) || busy}
        aria-disabled={blockedReason ? 'true' : undefined}
        aria-label={`${index + 1}. ${tpl.title ?? tpl.question_text ?? t('board.page.puzzleFallback')}${
          locked
            ? t('board.page.lockedSuffix')
            : energyBlocked
              ? t('board.page.blockedSuffix')
              : ''
        }`}
        title={
          locked
            ? t('board.page.lockedTitle')
            : energyBlocked
              ? t('board.page.blockedTitle', { min: regenMin })
              : (tpl.question_text ?? undefined)
        }
        className={`flex h-full w-full flex-col p-3.5 text-left transition sm:aspect-[10/9] ${skin} ${
          blockedReason ? 'cursor-not-allowed' : ''
        } ${locked ? 'opacity-70' : energyBlocked ? 'opacity-60' : ''}`}
      >
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-extrabold tabular-nums text-slate-400">
            {String(index + 1).padStart(2, '0')}
          </span>
          <span className="ml-auto text-[13px]" aria-hidden="true">
            {locked ? '🔒' : cleared ? '✅' : '▶'}
          </span>
        </div>
        {goalPhenomenon && (
          <div className="mt-1.5">
            <SymbolIcon kind="phenomenon" value={goalPhenomenon} className="h-8 w-8" />
          </div>
        )}
        <p className="mt-1.5 text-[13.5px] font-extrabold text-slate-900">
          {tpl.title ?? tpl.question_text}
        </p>
        {/* 3줄 → **2줄**(2026-08-10). 판이 4열에서 6열이 되며 칸이 215 → 187px로
            좁아졌고, 제목이 두 줄로 접히는 퍼즐에서는 3줄 요약이 칸 높이를 넘어
            **마지막 줄이 반쯤 잘려** 보였다(실측: 필요 150px > 내용 141px).
            줄임표로 끊는 편이 반 잘린 글자보다 낫다. */}
        {tpl.summary && (
          <p
            className="mt-0.5 overflow-hidden text-[11.5px] leading-snug text-slate-500"
            style={{ display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2 }}
          >
            {tpl.summary}
          </p>
        )}
        {/* 배지 줄은 **한 줄로 끝나야 한다**(2026-08-10). 6열이 되며 칸이 187px로
            좁아져 「난이도 보통」+ 사유 문구가 두 줄로 접혔고, 접힌 줄이 요약을
            밀어 칸이 답답해졌다. 두 가지로 폭을 벌었다: 사유 문구에서 자물쇠
            이모지를 뺐고(이미 칸 오른쪽 위에 있어 중복이었다), 잠긴 칸에서는
            배지를 compact로 줄였다. 여기에 무엇을 더 붙이기 전에 **en으로**
            xl(6열)에서 줄임표가 나는지 재 볼 것 — ko는 통과하고 en만 깨진다. */}
        <div className="mt-auto flex items-center gap-1.5 pt-2">
          <DifficultyBadge difficulty={puzzle.difficulty} compact={locked} />
          {pending && <span className="text-[11px] font-bold text-sky-700">{t('board.page.opening')}</span>}
          {/* 누르기 전에 알린다(§3.1) — 429/403을 받고 나서가 아니다.
              잠김이 이긴다: 구름이 차도 안 열리는데 "회복까지 N분"이라고 하면
              기다리면 열리는 줄 안다. */}
          {locked ? (
            <span className="truncate text-[11px] font-bold text-slate-500">
              {t('board.page.cardLocked')}
            </span>
          ) : energyBlocked ? (
            <span className="truncate text-[11px] font-bold text-rose-600">
              {t('board.page.cardRecovery', { min: regenMin })}
            </span>
          ) : null}
        </div>
      </button>
      <Bumps index={index} cols={cols} total={total} color={bump} />
    </div>
  );
}

/** 아직 저작되지 않은 자리 — 판(xl에서 6×8=48칸)을 꽉 채우기 위한 칸. */
function EmptyPiece({ index, cols, total }) {
  const t = useT();
  return (
    <div className={`relative ${edgeClass(index, cols, total)}`}>
      <div className="flex h-full w-full items-center justify-center bg-slate-100/70 p-3.5 sm:aspect-[10/9]">
        <span aria-hidden="true" className="text-[20px] font-extrabold tracking-widest text-slate-300">
          ???
        </span>
        <span className="sr-only">{t('board.page.comingSoon')}</span>
      </div>
      <Bumps index={index} cols={cols} total={total} color="bg-slate-100" />
    </div>
  );
}

/** 칸의 오른쪽·아래 경계선 — 판의 바깥 테두리에는 긋지 않는다. */
function edgeClass(index, cols, total) {
  const lastCol = (index + 1) % cols === 0;
  const lastRow = index >= total - cols;
  return [
    lastCol ? '' : 'border-r border-slate-200',
    lastRow ? '' : 'border-b border-slate-200',
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * 경계선 위의 돌기 — 이것이 "한 판을 나눈 조각"으로 보이게 하는 유일한 장치다.
 * 자기 칸 색으로 칠해 이웃 쪽으로 반원만큼 튀어나간다. 판의 바깥 테두리에는 안
 * 붙인다(밖으로 삐져나오면 조각이 아니라 흠집으로 보인다).
 */
function Bumps({ index, cols, total, color }) {
  const lastCol = (index + 1) % cols === 0;
  const lastRow = index >= total - cols;
  return (
    <>
      {!lastCol && (
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute right-[-7px] top-1/2 z-[1] h-4 w-[7px] -translate-y-1/2 rounded-r-full border border-l-0 border-slate-200 ${color}`}
        />
      )}
      {!lastRow && (
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute bottom-[-7px] left-1/2 z-[1] h-[7px] w-4 -translate-x-1/2 rounded-b-full border border-t-0 border-slate-200 ${color}`}
        />
      )}
    </>
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
