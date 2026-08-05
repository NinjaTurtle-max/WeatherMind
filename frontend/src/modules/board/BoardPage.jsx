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
 * 목록은 서버가 θ 인접 정렬로 내려주므로 클라이언트는 서버 순서 그대로 렌더한다.
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
  return (
    <div className="pt-2">
      {toast && (
        <div className="fixed left-1/2 top-16 z-50 -translate-x-1/2 animate-xp-pop rounded-full bg-emerald-500 px-4 py-2 text-sm font-bold text-white shadow-lg">
          {toast}
        </div>
      )}
      {/* 머리말 한 줄에 제목 + 상시 입구 둘. 미션(본선)과 실험(비채점 상시 입구)은
          격이 달라서, 예전처럼 큰 카드 두 장으로 나란히 두면 "셋 중 하나 고르세요"로
          읽히고 정작 미션 목록이 화면 아래로 밀린다(실측 첫 미션 y=266).
          시안 board_mockup의 배치를 따른다 — 실험은 헤더 우측 버튼. */}
      <div className="mb-3 flex flex-wrap items-end gap-x-3 gap-y-2">
        <div className="min-w-0">
          <h1 className="text-lg font-extrabold text-slate-900">{t('board.page.title')}</h1>
          <p className="text-sm text-slate-500">{t('board.page.subtitle')}</p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setSandbox(true)}
            title={t('board.page.sandboxDesc')}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-sm transition hover:border-sky-300 hover:text-sky-700"
          >
            {/* 아이콘은 리소스 문자열이 이미 갖고 있다(🧪 자유 실험) — 여기서 또
                붙이면 두 번 뜬다(실측). */}
            {t('board.page.sandboxTitle')}
          </button>
          <Link
            to="/explore"
            title={t('board.page.exploreDesc')}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-sm transition hover:border-sky-300 hover:text-sky-700"
          >
            {t('board.page.exploreTitle')}
          </Link>
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
        // 목록은 폭을 제한한다 — 셸은 플레이 3열 때문에 넓은데(7xl), 미션 한 줄이
        // 1200px로 늘어나면 제목과 오른쪽 「도전」 사이가 텅 빈다.
        <div className="flex max-w-4xl flex-col gap-2">
          {list.map((p) => {
            const pending = entryMutation.isPending && entryMutation.variables === p.content_item_id;
            return (
              <button
                key={p.content_item_id}
                type="button"
                onClick={() => openPuzzle(p)}
                disabled={energyBlocked || entryMutation.isPending}
                aria-disabled={energyBlocked ? 'true' : undefined}
                aria-label={`${p.template_json?.question_text ?? t('board.page.puzzleFallback')}${energyBlocked ? t('board.page.blockedSuffix') : ''}`}
                title={energyBlocked ? t('board.page.blockedTitle', { min: regenMin }) : undefined}
                className={`flex items-center justify-between rounded-2xl bg-white p-4 text-left shadow-sm ring-1 ring-slate-200 transition ${
                  energyBlocked ? 'cursor-not-allowed opacity-60' : 'hover:ring-sky-300'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-slate-800">{p.template_json?.question_text}</p>
                  <div className="mt-0.5 flex items-center gap-1.5">
                    <p className="text-xs text-slate-400">
                      {p.template_json?.mode === 'guided' ? t('board.page.modeGuided') : t('board.page.modeGoal')}
                    </p>
                    <DifficultyBadge difficulty={p.difficulty} />
                  </div>
                  {/* 누르기 전에 알린다(§3.1) — 429를 받고 나서가 아니다 */}
                  {energyBlocked && (
                    <p className="mt-1 text-xs font-bold text-rose-600">{t('board.page.cardRecovery', { min: regenMin })}</p>
                  )}
                </div>
                <span
                  className={`ml-3 shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${
                    p.cleared ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {pending ? t('board.page.opening') : p.cleared ? t('board.page.cleared') : t('board.page.challenge')}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
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
