import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { boardApi, progressApi } from '../../api';
import { useProgressStore } from '../../store/progressStore';
import LoadingSpinner from '../../components/LoadingSpinner';
import AtmosphereBoard from './AtmosphereBoard';
import { phenomenonMeta } from './boardDisplay';
import { SymbolIcon } from './boardSymbols';
import { ZONES } from '../../lib/boardEngine';

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
const DIFFICULTY_META = {
  1: { label: '쉬움', className: 'bg-emerald-100 text-emerald-700' },
  2: { label: '보통', className: 'bg-amber-100 text-amber-700' },
  3: { label: '도전', className: 'bg-rose-100 text-rose-700' },
};

function DifficultyBadge({ difficulty }) {
  const meta = DIFFICULTY_META[difficulty];
  if (!meta) return null; // 구 백엔드(difficulty 부재) 하위 호환 — 배지 미표시
  return (
    <span
      aria-label={`난이도: ${meta.label}`}
      className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${meta.className}`}
    >
      난이도 {meta.label}
    </span>
  );
}

// 자유 실험(R9-01 §3.3 ⑥) — 목표·채점·타이머 없는 전 요소 팔레트 샌드박스.
// 순수 클라이언트: 서버 호출 0 → 구름 미소모·시도 로그 없음(로컬 엔진만).
const SANDBOX_PUZZLE = {
  question_text: '자유 실험 — 요소를 마음껏 배치하고 어떤 날씨가 만들어지는지 관찰해 보세요',
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
  const queryClient = useQueryClient();
  const addXp = useProgressStore((s) => s.addXp);
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
        ? `👑 왕관 획득 — ${res.crown_award.unit_title}`
        : res.passed && res.xp_earned > 0
          ? `🧩 첫 클리어! +${res.xp_earned} XP`
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
        setResult({ passed: false, outOfClouds: true, feedback: err.detail ?? '구름이 모두 흩어졌어요 — 잠시 후 다시 시도해주세요.' });
        return;
      }
      setResult({ passed: false, feedback: err.detail ?? '제출에 실패했어요. 잠시 후 다시 시도해주세요.' });
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
      setEntryError(err.detail ?? '퍼즐을 열지 못했어요. 잠시 후 다시 시도해주세요.');
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
          ← 목록으로
        </button>
        <AtmosphereBoard puzzle={SANDBOX_PUZZLE} sandbox />
        <p className="mt-2 text-center text-xs text-slate-400">
          자유 실험은 채점하지 않아요 — 구름도 소모되지 않아요 ☁️
        </p>
      </div>
    );
  }

  if (isLoading) return <LoadingSpinner label="대기 보드 퍼즐을 불러오고 있어요..." />;

  if (isError) {
    return (
      <div className="mt-16 rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-slate-200">
        <p className="text-3xl">🧩</p>
        <p className="mt-2 font-bold text-slate-800">퍼즐을 불러오지 못했어요</p>
        <p className="mt-1 text-sm text-slate-500">{error?.detail ?? '잠시 후 다시 시도해주세요.'}</p>
        <button type="button" onClick={() => refetch()} className="mt-4 rounded-xl bg-sky-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-sky-700">
          다시 시도
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
          ← 목록으로
        </button>
        <AtmosphereBoard
          puzzle={selected.template_json}
          disabled={false}
          submitting={attemptMutation.isPending}
          result={result}
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
              {result.passed ? '한 번 더 도전' : '다시 시도'}
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
      <h1 className="mb-1 text-lg font-extrabold text-slate-900">🧩 대기 보드</h1>
      <p className="mb-3 text-sm text-slate-500">기상요소를 한반도 4개 지역에 배치해 목표 날씨를 만들어 보세요.</p>

      {/* 구름 소진 안내 (§3.1) — 퍼즐은 열 수 없지만 목록·클리어 표시는 그대로 보인다(D1) */}
      {energyBlocked && (
        <div className="mb-3 rounded-2xl bg-rose-50 p-4 ring-1 ring-rose-200">
          <p className="text-sm font-extrabold text-rose-700">☁️ 구름이 모두 흩어졌어요</p>
          <p className="mt-1 text-xs leading-relaxed text-rose-600">
            구름은 <span className="font-bold">틀린 시도에만 1개</span> 줄어들어요 — 열심히 푼
            만큼이 아니라 실수에만 소모돼요. 약 <span className="font-bold">{regenMin}분</span> 후
            구름 1개가 회복되면 새 퍼즐을 열 수 있어요. 채점 없는 자유 실험은 지금도 열려 있어요.
          </p>
        </div>
      )}

      {/* 진입 실패(429 경합 등) — 카드 비활성으로 대부분 예방되지만 최후 안내 */}
      {entryError && (
        <div className="mb-3 rounded-xl bg-amber-50 p-3 text-xs font-bold text-amber-700 ring-1 ring-amber-200">
          {entryError}
        </div>
      )}

      {/* 자유 실험(R9-01 §3.3 ⑥) + 탐구 실험실(§3.5) 진입 — 나란히 배치 */}
      <div className="mb-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setSandbox(true)}
          className="flex flex-col justify-between rounded-2xl bg-gradient-to-r from-sky-500 to-indigo-500 p-4 text-left shadow-sm transition hover:from-sky-600 hover:to-indigo-600"
        >
          <div className="min-w-0">
            <p className="text-sm font-bold text-white">🧪 자유 실험</p>
            <p className="mt-0.5 text-xs text-sky-100">목표 없이 마음껏 배치하고 즉시 반응을 관찰해요 (채점·구름 소모 없음)</p>
          </div>
          <span className="mt-2 self-start rounded-full bg-white/20 px-2.5 py-1 text-xs font-bold text-white">입장 →</span>
        </button>
        <Link
          to="/explore"
          className="flex flex-col justify-between rounded-2xl bg-gradient-to-r from-violet-500 to-fuchsia-500 p-4 text-left shadow-sm transition hover:from-violet-600 hover:to-fuchsia-600"
        >
          <div className="min-w-0">
            <p className="text-sm font-bold text-white">🌀 탐구 실험실</p>
            <p className="mt-0.5 text-xs text-violet-100">태풍·기후변화 시뮬로 변수를 바꿔 보며 원리를 탐구해요</p>
          </div>
          <span className="mt-2 self-start rounded-full bg-white/20 px-2.5 py-1 text-xs font-bold text-white">입장 →</span>
        </Link>
      </div>

      {list.length === 0 ? (
        <div className="rounded-2xl bg-white p-6 text-center text-sm text-slate-500 shadow-sm ring-1 ring-slate-200">
          아직 등록된 퍼즐이 없어요.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {list.map((p) => {
            const pending = entryMutation.isPending && entryMutation.variables === p.content_item_id;
            return (
              <button
                key={p.content_item_id}
                type="button"
                onClick={() => openPuzzle(p)}
                disabled={energyBlocked || entryMutation.isPending}
                aria-disabled={energyBlocked ? 'true' : undefined}
                aria-label={`${p.template_json?.question_text ?? '퍼즐'}${energyBlocked ? ' (구름 부족)' : ''}`}
                title={energyBlocked ? `구름이 회복되면 열 수 있어요 — 약 ${regenMin}분 후` : undefined}
                className={`flex items-center justify-between rounded-2xl bg-white p-4 text-left shadow-sm ring-1 ring-slate-200 transition ${
                  energyBlocked ? 'cursor-not-allowed opacity-60' : 'hover:ring-sky-300'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-slate-800">{p.template_json?.question_text}</p>
                  <div className="mt-0.5 flex items-center gap-1.5">
                    <p className="text-xs text-slate-400">
                      {p.template_json?.mode === 'guided' ? '안내 모드' : '목표 모드'}
                    </p>
                    <DifficultyBadge difficulty={p.difficulty} />
                  </div>
                  {/* 누르기 전에 알린다(§3.1) — 429를 받고 나서가 아니다 */}
                  {energyBlocked && (
                    <p className="mt-1 text-xs font-bold text-rose-600">☁️ 구름 회복까지 약 {regenMin}분</p>
                  )}
                </div>
                <span
                  className={`ml-3 shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${
                    p.cleared ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {pending ? '여는 중…' : p.cleared ? '✓ 클리어' : '도전'}
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
  if (!Array.isArray(phenomena) || phenomena.length === 0) return null;
  return (
    <div className="rounded-xl bg-white p-3 shadow-sm ring-1 ring-slate-200">
      <p className="mb-1.5 text-xs font-bold text-slate-500">서버 판정 결과</p>
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
