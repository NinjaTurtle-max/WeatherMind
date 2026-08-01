/**
 * 디자인/개발용 목 API 플러그인.
 * `VITE_MOCK=1 npm run dev`로 실행하면 backend 없이 /api/v1 전 엔드포인트가 동작한다.
 * 응답 스키마는 backend/app/schemas/*.py(02번 스펙)와 1:1로 맞춘다.
 *
 * R3-01: 대기 보드(§3.5)·신규 4유형(§3.6) 엔드포인트를 추가한다.
 * 보드 판정은 프론트 인터프리터(src/lib/boardEngine.js)를 그대로 재사용해
 * 백엔드 권위 채점(§3.4)을 흉내 낸다.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { evaluateBoard, checkGoals, validateBoardState } from '../src/lib/boardEngine.js';
import { tierFromElo } from '../src/lib/tierMeta.js';
import { levelFromTheta } from '../src/lib/abilityDisplay.js';

const here = dirname(fileURLToPath(import.meta.url));

// 규칙은 database/seed/board_rules.json을 단일 진실원으로 읽는다(데이터 직군 저작).
// 파일이 없으면 계약 §3.2의 8종 명세로 임시 작성한 폴백을 쓴다(주석 표시).
function loadBoardRules() {
  try {
    return JSON.parse(readFileSync(resolve(here, '../../database/seed/board_rules.json'), 'utf-8'));
  } catch {
    // --- 폴백(임시): board_rules.json 부재 시 계약 §3.2 8종 명세로 작성 ---
    return FALLBACK_BOARD_RULES;
  }
}

// 계약 §3.2 8종 임시 규칙(데이터 실제 파일이 있으면 위에서 덮어씀)
const FALLBACK_BOARD_RULES = [
  { id: 'cold_front_shower', priority: 100, when: ['front:cold', 'moisture>=60'], then: { phenomenon: 'shower', cloud: 'cumulonimbus' }, explain: '한랭전선이 습한 공기를 파고들면 강한 상승기류로 적란운이 발달해 소나기가 내린다.' },
  { id: 'stationary_front_monsoon', priority: 90, when: ['front:stationary', 'moisture>=70'], then: { phenomenon: 'persistent_rain', cloud: 'nimbostratus' }, explain: '정체전선에 습기가 계속 공급되면 장마처럼 여러 날 비가 이어진다.' },
  { id: 'warm_front_steady_rain', priority: 80, when: ['front:warm', 'moisture>=50'], then: { phenomenon: 'rain', cloud: 'nimbostratus' }, explain: '온난전선은 따뜻한 공기가 완만하게 타고 올라 넓은 지역에 약한 비를 오래 내린다.' },
  { id: 'siberian_snow', priority: 70, when: ['air_mass:siberian', 'moisture>=60'], then: { phenomenon: 'snow', cloud: 'nimbostratus' }, explain: '시베리아 기단이 서해를 건너며 수증기를 얻으면 눈구름이 발달한다.' },
  { id: 'convective_shower', priority: 60, when: ['sun>=80', 'moisture>=60'], then: { phenomenon: 'shower', cloud: 'cumulonimbus' }, explain: '강한 일사가 습한 공기를 데우면 대류로 적란운이 발달해 소나기가 쏟아진다.' },
  { id: 'radiation_fog', priority: 50, when: ['sun<=30', 'moisture>=80'], then: { phenomenon: 'fog', cloud: 'stratus' }, explain: '일사가 약하고 습도가 높으면 복사냉각으로 안개가 낀다.' },
  { id: 'north_pacific_heatwave', priority: 40, when: ['air_mass:north_pacific', 'sun>=70'], then: { phenomenon: 'heatwave', cloud: 'none' }, explain: '덥고 습한 북태평양 기단과 강한 일사가 겹치면 폭염이 나타난다.' },
  { id: 'siberian_clear', priority: 30, when: ['air_mass:siberian', 'moisture<=40'], then: { phenomenon: 'clear', cloud: 'none' }, explain: '차고 건조한 시베리아 기단이 자리 잡으면 춥고 맑다.' },
];

const BOARD_RULES = loadBoardRules();

const todayISO = () => new Date().toISOString().slice(0, 10);

const weekStartISO = () => {
  const d = new Date();
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // 월요일 기준
  return d.toISOString().slice(0, 10);
};

// 세션 간 유지되는 간단한 인메모리 상태 (dev server 재시작 시 초기화)
const state = {
  xp: 1180,
  level: 4,
  streak: 6,
  streakFreeze: 1, // 구름 방패 보유 수 (§3.5, 최대 2) — 스트릭 방어 자원(clouds와 독립)
  answeredToday: false,
  // 오늘 응답한 문항 수 (R10-01 D4) — /progress/me의 today_answered_count.
  // 서버는 quest_service._today_facts() 집계를 쓴다(새 테이블 없음).
  answeredTodayCount: 0,
  // 일일 목표 문항 수 (R10-01 D4, users.daily_goal_items) — null=미설정.
  dailyGoalItems: null,
  predicted: false,
  tier: 'nimbostratus', // 최근 정산 티어 (§3.2 /progress/me)
  // 일일 퀘스트 진행 (§3.1) — 당일 집계 흉내. 디자인 검토용 초기 진행값 시드.
  quest: { xpToday: 20, weakCorrect: 0, liveAnswered: 0 },
  // 예보 대결 (§3.4) — 오늘 제출 상태. evidence: 선택한 판단 근거 (R9-01 §3.1)
  duel: { submitted: false, userPred: null, aiPred: null, evidence: null },
  // 구름 에너지 (R5-01 §3.3) — 소모성 플레이 자원. 지연 회복 모델.
  clouds: 5,
  cloudsUpdatedAt: Date.now(),
  // 온보딩 배치고사 (R7-01 S3) — 1회 완료 여부. 완료 후 start는 409.
  placementDone: false,
};

// ── 개발자 모드 (R7-03) ─────────────────────────────────────────────────────
// 실서버는 Settings.DEV_MODE가 꺼져 있으면 /dev/* 전 경로 404 — 목은
// VITE_MOCK_DEV=0 으로 같은 404 모드를 재현한다(기본은 켜짐).
const DEV_MODE = process.env.VITE_MOCK_DEV !== '0';

// 개념별 능력(θ) 저장소 — /dev/state·/dev/theta·(배치 완료 시 갱신) 공유.
// 초기값은 사전(prior) 배정 흉내: θ 0.0 · num_responses 0.
const CONCEPT_TAGS = ['air_mass', 'anomaly', 'co2_climate', 'heat_island', 'pressure_front', 'typhoon'];
const seedAbilities = () =>
  new Map(CONCEPT_TAGS.map((tag) => [tag, { theta: 0.0, num_responses: 0 }]));
let devAbilities = seedAbilities();

const abilitySE = (n) => Number((1 / Math.sqrt(n + 1)).toFixed(2));
const abilityRows = () =>
  [...devAbilities.entries()].map(([concept_tag, { theta, num_responses }]) => ({
    concept_tag,
    theta: Number(theta.toFixed(2)),
    theta_se: abilitySE(num_responses),
    num_responses,
  }));

/** θ 평균 → 출제 대상 레벨 그룹. 경계(-0.5, 0.5)는 backend
 *  weatherbrain_service.theta_level_label·ai-worker theta_to_target_level_group과 동일. */
function thetaToLevelGroup(theta) {
  if (theta < -0.5) return 'elementary';
  if (theta < 0.5) return 'middle_high';
  return 'adult';
}

// DEV_MODE 꺼진 실서버(FastAPI 라우터 미등록)의 기본 404 본문과 동일
const DEV_404 = [404, { detail: 'Not Found' }];

/** GET /dev/state 페이로드 (R7-03 계약) — 조작 POST들도 최신 상태를 되돌려준다 */
function devStatePayload() {
  regenClouds();
  const rows = abilityRows();
  const overallTheta = rows.length
    ? Number((rows.reduce((sum, r) => sum + r.theta, 0) / rows.length).toFixed(2))
    : 0;
  return {
    dev_mode: true,
    abilities: rows,
    overall_theta: overallTheta,
    target_level_group: thetaToLevelGroup(overallTheta),
    // unlock_floor: 배치 θ 선해제가 연 선두 연속 유닛 수 (backend placement_unlock_floor)
    unlock_floor: preUnlockedUnits.size,
    clouds: state.clouds,
    streak_count: state.streak,
    placement_done: state.placementDone,
    // θ 파생 약점 (R8-01 §3.5, backend build_state와 동일 규칙): n>0 AND θ<0.41.
    // /dev/theta 조작이 즉시 반영된다 — 정적 WEAK_TAGS(퀘스트 판정용)와 별개.
    weak_tags: rows
      .filter((r) => r.num_responses > 0 && r.theta < 0.41)
      .map((r) => r.concept_tag),
  };
}

// ── 구름 에너지 상수 (R5-01 §3.3) ──
const ENERGY_ENABLED = true; // §3.4 기능 플래그(기본 true). false면 무제한.
const CLOUD_MAX = 5;
const CLOUD_REGEN_MS = 20 * 60 * 1000; // 20분당 1개 회복
const CLOUD_COST = 1; // 소모 1회분 (R10-01 §3.1: 수치 불변, 트리거만 변경)

// 일일 목표 허용값 (R10-01 §3.4·D4) — SESSION_RECIPE(합 5)와 독립된 표시용 타깃.
const DAILY_GOAL_CHOICES = [3, 5, 9];

/** 지연 회복(§3.3): 읽기·소모 시점에 elapsed로 회복량 계산·clamp·anchor 갱신 */
function regenClouds() {
  if (state.clouds >= CLOUD_MAX) {
    state.cloudsUpdatedAt = Date.now();
    return;
  }
  const elapsed = Date.now() - state.cloudsUpdatedAt;
  const gained = Math.floor(elapsed / CLOUD_REGEN_MS);
  if (gained > 0) {
    state.clouds = Math.min(CLOUD_MAX, state.clouds + gained);
    state.cloudsUpdatedAt =
      state.clouds >= CLOUD_MAX ? Date.now() : state.cloudsUpdatedAt + gained * CLOUD_REGEN_MS;
  }
}

/** 다음 1개 회복까지 남은 초 (가득 차면 0) */
function nextRegenSec() {
  if (state.clouds >= CLOUD_MAX) return 0;
  return Math.max(0, Math.ceil((state.cloudsUpdatedAt + CLOUD_REGEN_MS - Date.now()) / 1000));
}

/** GET /progress/energy 페이로드 (§3.3) */
function energyPayload() {
  regenClouds();
  return {
    clouds: state.clouds,
    max: CLOUD_MAX,
    next_regen_sec: nextRegenSec(),
    updated_at: new Date(state.cloudsUpdatedAt).toISOString(),
  };
}

// ── R10-01 §3.1 에너지 정책 전환 ────────────────────────────────────────────
// 구름은 **노력이 아니라 실수에 소모된다**: 소모는 채점 결과가 오답일 때만 1.
// 대신 문항을 열기 전에 잔량을 검사해 차단한다. 이미 발급된 세션의 진행 중
// 문항은 절대 차단하지 않는다("풀던 것을 뺏기지 않는다" 불변식 — §3.1 각주 7).
// 서버 대응: energy_service.should_consume / require_entry / consume_if_available.
// 회복 모델(만렙 5·20분당 1)은 불변 — 바뀐 것은 소모 트리거와 차단 시점뿐이다.

/** 소모 트리거(순수, server should_consume). 오답·미통과에만 true.
 *  정답·재제출(멱등 히트)·배치고사는 false. 보드는 passed를 isCorrect로 넘긴다. */
function shouldConsumeCloud({ isCorrect, alreadyAnswered = false, isPlacement = false }) {
  return !isCorrect && !alreadyAnswered && !isPlacement;
}

/** 진입 게이트(server require_entry). {ok:true} 또는 {ok:false, next_regen_sec}.
 *  **소모하지 않는다** — 검사 전용. 잔량 부족이면 호출측이 429 OUT_OF_CLOUDS로 변환.
 *  차단 지점 3곳(D6): 세션 신규 발급 · 유닛 세션 발급 · 퍼즐 상세 진입. */
function requireCloudEntry() {
  if (!ENERGY_ENABLED) return { ok: true };
  regenClouds();
  if (state.clouds < CLOUD_COST) return { ok: false, next_regen_sec: nextRegenSec() };
  return { ok: true };
}

/** 가드된 소모(server consume_if_available). 반환: 소모 후 잔량.
 *  잔량이 부족하면 **429 없이** 무소모로 통과한다(§3.1 각주 7) — 마지막 구름으로
 *  진입해 오답을 낸 진행 중 세션을 끊지 않기 위한 예외. 음수가 되지 않는다. */
function consumeCloudIfAvailable() {
  if (!ENERGY_ENABLED) return CLOUD_MAX;
  regenClouds();
  if (state.clouds < CLOUD_COST) return state.clouds; // 가드 UPDATE 0행 분기
  // MAX에서 처음 소모하면 이 시점부터 회복 타이머 시작
  if (state.clouds >= CLOUD_MAX) state.cloudsUpdatedAt = Date.now();
  state.clouds -= CLOUD_COST;
  return state.clouds;
}

/** OUT_OF_CLOUDS 429 응답 본문 (회복 ETA 포함 — 리텐션 훅 §3.3) */
function outOfCloudsError(nextSec) {
  const min = Math.max(1, Math.ceil(nextSec / 60));
  return [
    429,
    {
      detail: `구름이 모두 흩어졌어요 — 약 ${min}분 후 구름 1개가 회복돼요.`,
      code: 'OUT_OF_CLOUDS',
      next_regen_sec: nextSec,
      clouds: 0,
      max: CLOUD_MAX,
    },
  ];
}

// ── 지도 지역 좌표 (R5-01 §3.1) — 판정 미사용, 렌더 전용. 정규화 0~100. ──
// zone index 0~3 ↔ 지역 고정 매핑(계약 §3.1). 존 의미(boardEngine.ZONES)는 불변.
// 좌표 SSOT = database/seed/board_regions.json — R9-01 §3.3 시드↔목 일치(사본, 드리프트 금지).
const BOARD_REGIONS = [
  { zone: 0, name: '서해상', svg_point: [21, 54], label_anchor: [21, 66] },
  { zone: 1, name: '수도권', svg_point: [43, 33], label_anchor: [43, 21] },
  { zone: 2, name: '영서·태백', svg_point: [61, 47], label_anchor: [61, 35] },
  { zone: 3, name: '영동·동해', svg_point: [82, 43], label_anchor: [88, 55] },
];

// ── 커리큘럼 유닛 (R5-01 §3.2) — 2섹션·유닛 5개·선행 잠금 포함 ──
//   각 유닛은 concept_tag로 기존 content_items 풀과 연결(§3.2). kind: quiz|board.
//   slug(R8-01 §3.3): 백엔드 유닛 식별자 — spine.current_unit·crown_award가 노출한다.
const UNITS = [
  { id: 'u0000001-0000-4000-8000-000000000001', slug: 'pressure-front-intro', section: '하늘 읽기', unit_order: 1, title: '기압과 전선 입문', concept_tag: 'pressure_front', prereq_unit_id: null, kind: 'quiz', crown_target: 1 },
  { id: 'u0000002-0000-4000-8000-000000000002', slug: 'air-mass-basics', section: '하늘 읽기', unit_order: 2, title: '기단의 성질', concept_tag: 'air_mass', prereq_unit_id: 'u0000001-0000-4000-8000-000000000001', kind: 'quiz', crown_target: 1 },
  { id: 'u0000003-0000-4000-8000-000000000003', slug: 'front-weather-board', section: '하늘 읽기', unit_order: 3, title: '전선으로 날씨 만들기', concept_tag: 'pressure_front', prereq_unit_id: 'u0000002-0000-4000-8000-000000000002', kind: 'board', crown_target: 1 },
  { id: 'u0000004-0000-4000-8000-000000000004', slug: 'typhoon-structure', section: '큰 바람', unit_order: 1, title: '태풍의 구조', concept_tag: 'typhoon', prereq_unit_id: null, kind: 'quiz', crown_target: 1 },
  { id: 'u0000005-0000-4000-8000-000000000005', slug: 'anomaly-replay-board', section: '큰 바람', unit_order: 2, title: '이상 기후 재현', concept_tag: 'anomaly', prereq_unit_id: 'u0000004-0000-4000-8000-000000000004', kind: 'board', crown_target: 1 },
];

// user_unit_progress 흉내 (unit_id → {crowns, cleared_at}). 첫 유닛 1개를 클리어 상태로 시드
// → u2 열림(현재), u3 잠금, u4 열림, u5 잠금 혼합을 학습 홈에서 보여준다.
const unitProgress = new Map([
  ['u0000001-0000-4000-8000-000000000001', { crowns: 1, cleared_at: '2026-07-18T09:00:00Z' }],
]);

// id 또는 slug로 조회 — 프론트 라우트는 트리의 id를, spine.current_unit은 slug를 쓴다(R8-01 §3.3).
const getUnit = (idOrSlug) => UNITS.find((u) => u.id === idOrSlug || u.slug === idOrSlug) ?? null;
const getUnitProgress = (id) => {
  if (!unitProgress.has(id)) unitProgress.set(id, { crowns: 0, cleared_at: null });
  return unitProgress.get(id);
};
// 배치 θ 선해제(R7-02 S4): 배치 실응답 θ로 선두 연속 잠금 유닛이 왕관 0인 채
// 열릴 수 있다(백엔드 파생). 목은 선해제된 유닛 id 집합으로 흉내 낸다.
const preUnlockedUnits = new Set();

/** 선행 잠금(§3.2): prereq 유닛 crowns>=1 이어야 열림. 첫 유닛(무 prereq)은 항상 열림.
 *  배치 θ 선해제(R7-02 S4) 유닛은 왕관 0이어도 열림. */
const isUnitLocked = (unit) => {
  if (!unit.prereq_unit_id) return false;
  if (preUnlockedUnits.has(unit.id)) return false;
  return (unitProgress.get(unit.prereq_unit_id)?.crowns ?? 0) < 1;
};

/** GET /curriculum 트리 (섹션→유닛→유저 진도·잠금·상태)
 *  status 4종(R7-02 S4 계약, 백엔드 build_curriculum과 동일): cleared(완료)
 *  > locked > unlocked(열림 — 배치 θ 선해제 포함). 이후 트리 전체 노출 순서에서
 *  잠기지 않은 첫 미클리어(unlocked) 유닛 **정확히 1개**를 current로 승격한다
 *  — 섹션별 1개가 아니라 전역 1개(R7-14 통합에서 백엔드 계약과 정렬).
 *  기존 crowns/cleared/locked 불변. */
function curriculumPayload() {
  const bySection = new Map();
  for (const u of UNITS) {
    if (!bySection.has(u.section)) bySection.set(u.section, []);
    bySection.get(u.section).push(u);
  }
  const sections = [...bySection.entries()].map(([section, units]) => ({
    section,
    units: [...units]
      .sort((a, b) => a.unit_order - b.unit_order)
      .map((u) => {
        const prog = getUnitProgress(u.id);
        const cleared = prog.crowns >= u.crown_target;
        const locked = isUnitLocked(u);
        const status = cleared ? 'cleared' : locked ? 'locked' : 'unlocked';
        return {
          id: u.id,
          slug: u.slug,
          unit_order: u.unit_order,
          title: u.title,
          concept_tag: u.concept_tag,
          kind: u.kind,
          crown_target: u.crown_target,
          crowns: prog.crowns,
          cleared,
          cleared_at: prog.cleared_at,
          locked,
          status,
        };
      }),
  }));
  // 'current' 승격 — 백엔드 build_curriculum과 동일: 트리 노출 순서 전체에서
  // 첫 'unlocked' 정확히 1개만 current (없으면 0개).
  const firstOpen = sections.flatMap((s) => s.units).find((v) => v.status === 'unlocked');
  if (firstOpen) firstOpen.status = 'current';
  return { sections };
}

/** 스파인 집계 (R8-01 §3.3) — GET /progress/me의 additive spine 필드.
 *  서버 계산과 동일 정의: cleared=crown_target 도달, crowns_total=Σcrown_target,
 *  current=트리 노출 순서에서 잠기지 않은 첫 미클리어 유닛(없으면 null). */
function spinePayload() {
  let unitsCleared = 0;
  let crownsEarned = 0;
  let crownsTotal = 0;
  for (const u of UNITS) {
    const crowns = unitProgress.get(u.id)?.crowns ?? 0;
    crownsTotal += u.crown_target;
    crownsEarned += Math.min(crowns, u.crown_target);
    if (crowns >= u.crown_target) unitsCleared += 1;
  }
  const current =
    UNITS.find((u) => (unitProgress.get(u.id)?.crowns ?? 0) < u.crown_target && !isUnitLocked(u)) ?? null;
  return {
    units_total: UNITS.length,
    units_cleared: unitsCleared,
    crowns_earned: crownsEarned,
    crowns_total: crownsTotal,
    current_unit: current ? { slug: current.slug, title: current.title } : null,
  };
}

/** 왕관 유입로 (R8-01 §3.4) — 유닛에 왕관 +1(crown_target 초과 불가).
 *  실제로 부여됐을 때만 crown_award 페이로드 {unit_slug, unit_title, crowns, cleared}를
 *  반환하고, 대상 없음/이미 만관이면 null(무동작). 백엔드 grant_unit_crown과 동일하게
 *  cleared 전환 시 +20 XP(XP_UNIT_CLEAR) 1회 — 보드 +5 XP·데일리 문항 XP는 별도
 *  기존 경로 그대로다. crown_award 페이로드 계약(4필드)은 불변. */
function grantUnitCrown(unit) {
  if (!unit) return null;
  const prog = getUnitProgress(unit.id);
  if (prog.crowns >= unit.crown_target) return null;
  prog.crowns += 1;
  const cleared = prog.crowns >= unit.crown_target;
  if (cleared && !prog.cleared_at) {
    prog.cleared_at = new Date().toISOString();
    state.xp += 20; // 유닛 cleared 전환 보상 — backend xp_service.XP_UNIT_CLEAR
  }
  return { unit_slug: unit.slug, unit_title: unit.title, crowns: prog.crowns, cleared };
}

// 약점 태그(§3.1 weak_correct_1 판정용) — /progress/weak-tags 목데이터와 일치
const WEAK_TAGS = new Set(['typhoon', 'anomaly', 'pressure_front']);

// 퀘스트 진행 반영 헬퍼 (세션·보드·퀴즈 응답 시 호출 — 당일 재계산 흉내)
function bumpQuest({ xp = 0, correctTag = null, live = false }) {
  state.quest.xpToday += xp;
  if (correctTag && WEAK_TAGS.has(correctTag)) state.quest.weakCorrect = 1;
  if (live) state.quest.liveAnswered = 1;
}

// GET /progress/quests 응답 3종 (§3.1 코드 고정)
function questPayload() {
  const q = state.quest;
  return [
    {
      code: 'daily_xp_30',
      title: '오늘 30 XP 모으기',
      progress: Math.min(q.xpToday, 30),
      target: 30,
      done: q.xpToday >= 30,
      xp_reward: 10,
    },
    {
      code: 'weak_correct_1',
      title: '약점 개념 정답 맞히기',
      progress: q.weakCorrect,
      target: 1,
      done: q.weakCorrect >= 1,
      xp_reward: 10,
    },
    {
      code: 'live_answered',
      title: '오늘의 실황 문항 풀기',
      progress: q.liveAnswered,
      target: 1,
      done: q.liveAnswered >= 1,
      xp_reward: 5,
    },
  ];
}

// GET /progress/badges 응답 5종 (§3.3 저작 코드) — 일부 획득/미획득 혼합
const BADGES = [
  { code: 'streak_7', title: '7일 연속', description: '7일 연속 출석 달성', earned_at: '2026-07-12T00:00:00Z' },
  { code: 'streak_30', title: '30일 연속', description: '30일 연속 출석 달성', earned_at: null },
  { code: 'streak_100', title: '100일 연속', description: '100일 연속 출석 달성', earned_at: null },
  { code: 'perfect_session', title: '무오답 세션', description: '세션 5문항을 모두 맞힘', earned_at: '2026-07-18T09:20:00Z' },
  { code: 'tier_promoted', title: '티어 승급', description: '리그 티어 승급 달성', earned_at: null },
];

// ── 예보 대결 브리핑 (R9-01 §3.1 /duel/briefing) ─────────────────────────────
// KMA 키 부재 degraded 모드 재현: VITE_MOCK_BRIEFING=degraded 로 실행하면
// briefing 필드가 null/빈 배열이고 base_forecast도 null(§3.1 — 실패 시 비노출).
const BRIEFING_DEGRADED = process.env.VITE_MOCK_BRIEFING === 'degraded';

// 예보 대결 참고 예보(§3.4 KMA 내일 예보 흉내)와 AI 캐스터 결정적 예측.
// R9-01 §3.2: ai_pred JSONB에 noise_scale 스냅샷 동봉(감사 가능) —
// state.tier(nimbostratus)의 티어 5계단 계약값 0.70.
const DUEL_BASE_FORECAST = { temp_max: 30, rain_prob: 40 };
const DUEL_AI_PRED = { temp_max: 31.2, rain_prob: 55, noise_scale: 0.7 }; // base + 결정적 노이즈(온도 +1.2·강수 +15)

// 근거 선택 화이트리스트 5종 (R9-01 §3.1 — 미지 코드 422)
const EVIDENCE_CODES = ['pop_trend', 'humidity_high', 'temp_drop', 'sky_overcast', 'recent_rain'];

const isoDaysFromToday = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
};

/** 내일 3시간 간격 8행 결정적 시계열 — 랜덤 없음(스모크·디자인 재현성).
 *  시나리오: 오후 소나기(pop 상승 추세·습도 높음 — 근거 판정 이야기와 정합). */
function briefingHourly() {
  const target = isoDaysFromToday(1);
  const rows = [
    // [시, tmp℃, pop%, pcp(mm), reh%, wsd(m/s), sky(1맑음|3구름많음|4흐림), pty(0없음|1비|4소나기)]
    [0, 24.1, 20, 0, 70, 1.8, 1, 0],
    [3, 23.4, 20, 0, 75, 1.5, 1, 0],
    [6, 23.9, 30, 0, 80, 2.0, 3, 0],
    [9, 26.8, 40, 0, 70, 2.6, 3, 0],
    [12, 29.6, 60, 1.5, 65, 3.4, 4, 1],
    [15, 30.4, 70, 4.0, 60, 3.8, 4, 4],
    [18, 28.2, 60, 1.0, 70, 3.0, 4, 1],
    [21, 25.7, 40, 0, 80, 2.2, 3, 0],
  ];
  return rows.map(([h, tmp, pop, pcp, reh, wsd, sky, pty]) => ({
    datetime: `${target}T${String(h).padStart(2, '0')}:00:00`,
    tmp,
    pop,
    pcp,
    reh,
    wsd,
    sky,
    pty,
  }));
}

/** GET /duel/briefing 페이로드 (§3.1) — 실패 필드는 null/빈 배열 */
function duelBriefingPayload() {
  if (BRIEFING_DEGRADED) {
    return {
      region: '서울',
      target_date: isoDaysFromToday(1),
      hourly: [],
      today_observed: null,
      recent_days: [],
    };
  }
  return {
    region: '서울',
    target_date: isoDaysFromToday(1),
    hourly: briefingHourly(),
    today_observed: { max_ta: 29.3, min_ta: 22.8, sum_rn: 0.0 },
    // 최근 7일 실측(어제부터 역순) — 3일 전 강수 이력(recent_rain 근거 판정용)
    recent_days: [
      { date: isoDaysFromToday(-1), max_ta: 29.3, sum_rn: 0.0 },
      { date: isoDaysFromToday(-2), max_ta: 28.1, sum_rn: 12.5 },
      { date: isoDaysFromToday(-3), max_ta: 27.4, sum_rn: 3.0 },
      { date: isoDaysFromToday(-4), max_ta: 30.2, sum_rn: 0.0 },
      { date: isoDaysFromToday(-5), max_ta: 31.0, sum_rn: 0.0 },
      { date: isoDaysFromToday(-6), max_ta: 29.8, sum_rn: 0.5 },
      { date: isoDaysFromToday(-7), max_ta: 28.6, sum_rn: 0.0 },
    ],
  };
}

function duelTodayPayload() {
  const submitted = state.duel.submitted;
  return {
    duel_date: todayISO(),
    status: submitted ? 'submitted' : 'open',
    base_forecast: BRIEFING_DEGRADED ? null : DUEL_BASE_FORECAST,
    caster_grade: state.tier, // R9-01 §3.2 — 유저 티어 기준 적응형 캐스터 등급(additive)
    user_pred: state.duel.userPred,
    ai_pred: submitted ? state.duel.aiPred : null, // 제출 후 공개 (§3.4)
    evidence: state.duel.evidence, // R9-01 §3.1 — 선택한 판단 근거(additive)
    evidence_review: null, // 정산 후 조회 시 계산 — 오늘 대결은 미정산이므로 null
    actual: null, // 오늘 대결은 미정산 (다음날 실측)
    user_score: null,
    ai_score: null,
    result: null,
  };
}

const nextLevelXp = (level) => 50 * (level + 1) ** 2;

const QUIZ = {
  quiz_id: `${todayISO()}-middle_high-general`,
  concept_tag: 'pressure_front',
  question_type: 'multiple_choice',
  question_text:
    '오늘 서울은 고기압의 영향으로 맑고 건조합니다. 고기압 중심부에서 하강 기류가 생길 때 날씨가 맑아지는 이유로 가장 알맞은 것은?',
  options: [
    '공기가 하강하며 단열 압축되어 구름이 증발하기 때문',
    '공기가 상승하며 팽창해 수증기가 응결하기 때문',
    '지표면의 복사열이 우주로 모두 빠져나가기 때문',
    '바람이 강해져 구름을 밀어내기 때문',
  ],
  level_group: 'middle_high',
};

// ── 세션 모드 (R2-01 계약 §3.1) ─────────────────────────────────────────────
// SessionItem = QuizQuestion + {source, slot_filled}. 배합 §3.2를 흉내 내되
// (new 2 / review 2 / live 1, 같은 question_type 3연속 금지) 데이터는 고정이다.
// _mock 필드는 목 전용 채점 정보로, 실제 응답 직전에 제거한다.
const SESSION_ITEMS = [
  {
    quiz_id: `${todayISO()}-s1-bank`,
    concept_tag: 'pressure_front',
    question_type: 'multiple_choice',
    question_text: '전선을 경계로 성질이 다른 두 공기가 만납니다. 찬 공기가 따뜻한 공기를 밀어 올리며 이동할 때 만들어지는 전선은?',
    options: ['한랭 전선', '온난 전선', '정체 전선', '폐색 전선'],
    level_group: 'middle_high',
    source: 'bank',
    slot_filled: false,
    _mock: {
      correct: '한랭 전선',
      feedbackCorrect:
        '정확해요! 찬 공기는 무거워서 따뜻한 공기 밑을 파고들며 급하게 밀어 올립니다. 그래서 한랭 전선 뒤에는 적운형 구름과 소나기가 잘 생겨요.',
      feedbackWrong:
        '아쉬워요! 정답은 "한랭 전선"이에요. 찬 공기가 따뜻한 공기를 밀어 올리면 상승 기류가 급해져 적운형 구름과 짧고 강한 비가 내립니다. 온난 전선은 반대로 따뜻한 공기가 찬 공기 위로 완만하게 타고 오르는 경우예요.',
    },
  },
  {
    quiz_id: `${todayISO()}-s2-bank`,
    concept_tag: 'air_mass',
    question_type: 'short_answer',
    question_text: '여름철 우리나라에 덥고 습한 날씨를 가져오는, 남동쪽 해양에서 발달하는 기단의 이름은? (○○○○ 기단)',
    options: null,
    level_group: 'middle_high',
    source: 'bank',
    slot_filled: false,
    _mock: {
      correct: '북태평양 기단',
      accept: ['북태평양', '북태평양기단', '북태평양 기단'],
      feedbackCorrect:
        '맞아요! 북태평양 기단은 저위도 해양에서 만들어져 고온 다습합니다. 한여름 무더위와 열대야의 주범이에요.',
      feedbackWrong:
        '아쉬워요! 정답은 "북태평양 기단"이에요. 저위도 해양에서 발달해 고온 다습하고, 여름철 우리나라를 덮으면 무더위와 열대야가 이어집니다. 시베리아 기단(한랭 건조)과 성질을 비교해 기억해 보세요.',
    },
  },
  {
    quiz_id: `${todayISO()}-s3-review`,
    concept_tag: 'typhoon',
    question_type: 'multiple_choice',
    question_text: '태풍이 우리나라 쪽으로 북상할 때, 일반적으로 바람 피해가 더 큰 "위험 반원"은 태풍 진행 방향의 어느 쪽일까요?',
    options: ['오른쪽(동쪽) 반원', '왼쪽(서쪽) 반원', '태풍의 눈 정중앙', '진행 방향과 무관하게 남쪽'],
    level_group: 'middle_high',
    source: 'bank',
    slot_filled: false,
    _mock: {
      correct: '오른쪽(동쪽) 반원',
      feedbackCorrect:
        '정답이에요! 오른쪽 반원에서는 태풍 자체의 바람과 태풍을 이동시키는 바람(이동 속도)이 같은 방향으로 겹쳐 풍속이 더 강해집니다. 그래서 위험 반원이라고 불러요.',
      feedbackWrong:
        '아쉬워요! 정답은 "오른쪽(동쪽) 반원"이에요. 태풍의 회전 바람에 태풍의 이동 방향 바람이 더해지는 쪽이라 풍속이 훨씬 강해집니다. 왼쪽 반원은 두 바람이 반대로 작용해 상대적으로 약한 "가항 반원"이에요.',
    },
  },
  {
    quiz_id: `${todayISO()}-s4-live`,
    concept_tag: 'anomaly',
    question_type: 'slider',
    question_text: '오늘 서울의 강수확률은 60%로 예보됐어요. 예보관이 말하는 "강수확률 60%"에 가장 가까운 값을 슬라이더로 맞춰보세요. (같은 조건이 100번 있을 때 비가 오는 횟수)',
    options: null,
    level_group: 'middle_high',
    source: 'generated',
    slot_filled: true,
    _mock: {
      correct: '60',
      tolerance: 10,
      feedbackCorrect:
        '잘했어요! 강수확률 60%는 "오늘과 같은 기상 조건이 100번 있으면 약 60번은 비가 온다"는 통계적 의미예요. 우산을 챙기는 게 합리적인 수준이죠.',
      feedbackWrong:
        '아쉬워요! 정답은 60이에요. 강수확률은 비의 양이 아니라, 같은 조건에서 비가 관측될 통계적 빈도를 뜻해요. 60%면 100번 중 60번꼴이니 우산을 챙기는 편이 좋아요.',
    },
  },
  {
    quiz_id: `${todayISO()}-s5-review`,
    concept_tag: 'heat_island',
    question_type: 'multiple_choice',
    question_text: '한여름 밤, 도심 기온이 주변 교외보다 눈에 띄게 높게 유지되는 열섬 현상의 원인으로 보기 어려운 것은?',
    options: [
      '도시 상공의 오존층이 두꺼워져서',
      '아스팔트·콘크리트가 낮 동안 저장한 열을 밤에 방출해서',
      '건물·자동차·에어컨 실외기가 인공열을 배출해서',
      '녹지와 수면이 적어 증발 냉각이 약해서',
    ],
    level_group: 'middle_high',
    source: 'bank',
    slot_filled: false,
    _mock: {
      correct: '도시 상공의 오존층이 두꺼워져서',
      feedbackCorrect:
        '정확해요! 오존층은 성층권의 이야기로 열섬과는 무관해요. 열섬은 인공 피복의 축열, 인공열 배출, 증발 냉각 감소가 겹쳐 생기는 도시 기후 현상입니다.',
      feedbackWrong:
        '아쉬워요! 정답은 "오존층" 보기예요. 오존층은 성층권에 있어 도시 열섬과 관련이 없습니다. 열섬은 아스팔트의 축열, 인공열, 녹지 부족으로 인한 증발 냉각 감소가 원인이에요.',
    },
  },
  // ── R3-01 §3.6 신규 유형 4종 (세션 통합 검증용, 각 1건) ──
  {
    quiz_id: `${todayISO()}-s6-board`,
    concept_tag: 'pressure_front',
    question_type: 'board',
    question_text: '수도권에 소나기를 내려 보세요',
    template_json: {
      question_text: '수도권에 소나기를 내려 보세요',
      mode: 'guided',
      // R8-01 버그픽스 B①: 백엔드 세션 template_json 화이트리스트에
      // time_limit_sec·based_on이 추가됨 — 세션 안 board 문항에도 미니 미션
      // 타이머(§3.5)와 실화 배지가 렌더되는지 목으로 검증한다.
      time_limit_sec: 90,
      based_on: { event_name: '2022년 8월 수도권 집중호우', event_date: '2022-08-08', region: '수도권' },
      guide_steps: [
        '수도권(2번째 존)에 한랭전선을 놓아 보세요.',
        '습기 슬라이더를 60 이상으로 올려 상승기류를 강하게 만드세요.',
      ],
      initial_state: { zones: ['서해', '수도권', '태백산맥', '동해안'], elements: [] },
      palette: ['front:cold', 'moisture'],
      goal_conditions: [{ zone: 1, phenomenon: 'shower' }],
      hints: ['비가 오려면 공기 중에 무엇이 충분해야 할까요?', '차가운 공기가 파고들면 상승기류가 강해져요.'],
    },
    level_group: 'middle_high',
    source: 'bank',
    slot_filled: false,
    _mock: {
      goal_conditions: [{ zone: 1, phenomenon: 'shower' }],
      feedbackCorrect: '정확해요! 한랭전선이 습한 공기를 파고들며 적란운이 발달해 수도권에 소나기가 내렸어요.',
      feedbackWrong: '아직이에요. 수도권에 한랭전선을 놓고 습기를 60 이상으로 올려 보세요.',
    },
  },
  {
    quiz_id: `${todayISO()}-s7-match`,
    concept_tag: 'air_mass',
    question_type: 'match',
    question_text: '기단과 그 성질을 알맞게 연결하세요.',
    pairs: [
      { left: '시베리아 기단', right: '한랭 건조' },
      { left: '북태평양 기단', right: '고온 다습' },
      { left: '오호츠크해 기단', right: '한랭 다습' },
      { left: '양쯔강 기단', right: '온난 건조' },
    ],
    level_group: 'middle_high',
    source: 'bank',
    slot_filled: false,
    _mock: {
      pairs: [
        { left: '시베리아 기단', right: '한랭 건조' },
        { left: '북태평양 기단', right: '고온 다습' },
        { left: '오호츠크해 기단', right: '한랭 다습' },
        { left: '양쯔강 기단', right: '온난 건조' },
      ],
      feedbackCorrect: '완벽해요! 각 기단은 발원지(대륙/해양·고위도/저위도)에 따라 성질이 결정됩니다.',
      feedbackWrong: '아쉬워요! 발원지가 대륙이면 건조, 해양이면 다습하고, 고위도면 한랭, 저위도면 고온입니다.',
    },
  },
  {
    quiz_id: `${todayISO()}-s8-ordering`,
    concept_tag: 'typhoon',
    question_type: 'ordering',
    question_text: '태풍의 일생을 이른 단계부터 순서대로 정렬하세요.',
    items: ['열대저압부 발생', '태풍으로 발달', '최성기(최대 세력)', '온대저기압으로 쇠약'],
    shuffled: true,
    level_group: 'middle_high',
    source: 'bank',
    slot_filled: false,
    _mock: {
      // items가 정답 순서로 저작됨 → 정답 순열은 항등 "0,1,2,3" (§3.6)
      correctOrder: '0,1,2,3',
      feedbackCorrect: '정확해요! 태풍은 열대저압부 → 발달 → 최성기 → 쇠약(온대저기압) 순으로 일생을 마칩니다.',
      feedbackWrong: '아쉬워요! 태풍은 열대저압부에서 시작해 세력을 키우다 최성기를 지나 온대저기압으로 약해집니다.',
    },
  },
  {
    quiz_id: `${todayISO()}-s9-cloze`,
    concept_tag: 'pressure_front',
    question_type: 'cloze',
    question_text: '공기가 상승하면 단열 팽창으로 온도가 낮아지고, 수증기가 ___하여 구름이 만들어진다.',
    level_group: 'middle_high',
    source: 'bank',
    slot_filled: false,
    _mock: {
      correct: '응결',
      accept: ['응결', '응축'],
      feedbackCorrect: '맞아요! 상승한 공기가 이슬점 아래로 식으면 수증기가 응결해 물방울(구름)이 됩니다.',
      feedbackWrong: '아쉬워요! 정답은 "응결"이에요. 수증기가 물방울로 바뀌는 과정을 응결이라고 합니다.',
    },
  },
];

// ── 온보딩 배치고사 (R7-01 S3) — 6문항 진단 세션. 6개 concept_tag 전 영역 1문항씩. ──
// 기존 세션 문항을 배치 전용 quiz_id로 재사용하고(응답은 세션별 독립 저장),
// 세션 시드에 없는 co2_climate 1문항만 새로 저작한다. 실황 슬롯 없음(진단 성격).
const PLACEMENT_ITEMS = [
  { ...SESSION_ITEMS[0], quiz_id: `${todayISO()}-p1` }, // pressure_front
  { ...SESSION_ITEMS[1], quiz_id: `${todayISO()}-p2` }, // air_mass
  { ...SESSION_ITEMS[2], quiz_id: `${todayISO()}-p3` }, // typhoon
  { ...SESSION_ITEMS[3], quiz_id: `${todayISO()}-p4`, source: 'bank', slot_filled: false }, // anomaly
  { ...SESSION_ITEMS[4], quiz_id: `${todayISO()}-p5` }, // heat_island
  {
    quiz_id: `${todayISO()}-p6`,
    concept_tag: 'co2_climate',
    question_type: 'multiple_choice',
    question_text: '대기 중 이산화탄소(CO₂)가 지구 평균 기온을 높이는 주된 원리는 무엇일까요?',
    options: [
      '지표가 내보내는 적외선(지구 복사)을 흡수해 다시 방출하기 때문',
      '태양에서 오는 자외선을 모두 반사하기 때문',
      '공기의 무게를 늘려 지표 기압을 높이기 때문',
      '구름 생성을 막아 비를 줄이기 때문',
    ],
    level_group: 'middle_high',
    source: 'bank',
    slot_filled: false,
    _mock: {
      correct: '지표가 내보내는 적외선(지구 복사)을 흡수해 다시 방출하기 때문',
      feedbackCorrect:
        '정확해요! CO₂는 지표가 내보내는 적외선을 흡수했다가 다시 방출해 열을 대기에 가두는 온실 효과를 일으킵니다.',
      feedbackWrong:
        '아쉬워요! 정답은 "적외선 흡수·재방출"이에요. CO₂는 지구 복사(적외선)를 가두는 온실 기체로, 자외선 반사나 기압 변화와는 무관합니다.',
    },
  },
];

const PLACEMENT_SESSION_ID = '91ac8b1e-0000-4000-8000-0000000000bb';

/** 배치 세션 발급(미완료 당일 세션은 멱등 재사용) — mode:'placement'는 구름 미소모 */
function ensurePlacementSession() {
  const today = todayISO();
  let s = sessions.get(PLACEMENT_SESSION_ID);
  if (!s || s.completed || s.session_date !== today) {
    s = {
      session_id: PLACEMENT_SESSION_ID,
      session_date: today,
      mode: 'placement',
      unit_id: null,
      items: PLACEMENT_ITEMS,
      answers: {},
      completed: false,
    };
    sessions.set(PLACEMENT_SESSION_ID, s);
  }
  return s;
}

// ── 보드 연습 퍼즐 (§3.5 /board/puzzles) ──
// difficulty 1|2|3 (R7-02 S5): 목록은 서버가 θ 인접 정렬로 내려준다 — 목은
// 저작 순서를 그대로 반환(비단조 난이도로 클라이언트가 재정렬하지 않음을 검증).
const BOARD_PUZZLES = [
  {
    content_item_id: 'b0000001-0000-4000-8000-000000000001',
    difficulty: 1,
    concept_tag: 'pressure_front',
    template_json: {
      question_text: '수도권에 소나기를 내려 보세요 (미니 미션)',
      mode: 'guided',
      // 미니 미션(§3.5): 제한 시간 90초 카운트다운, 초과 시 실패·재도전
      time_limit_sec: 90,
      guide_steps: [
        '수도권(2번째 존)에 한랭전선을 놓아 보세요.',
        '습기 슬라이더를 60 이상으로 올려 보세요.',
      ],
      initial_state: { zones: ['서해', '수도권', '태백산맥', '동해안'], elements: [] },
      palette: ['front:cold', 'moisture'],
      goal_conditions: [{ zone: 1, phenomenon: 'shower' }],
      hints: ['비가 오려면 공기 중에 무엇이 충분해야 할까요?', '차가운 공기가 파고들면 상승기류가 강해져요.'],
    },
  },
  {
    content_item_id: 'b0000002-0000-4000-8000-000000000002',
    difficulty: 2,
    concept_tag: 'air_mass',
    template_json: {
      question_text: '동해안에 폭염을 만들어 보세요',
      mode: 'goal_only',
      initial_state: { zones: ['서해', '수도권', '태백산맥', '동해안'], elements: [] },
      palette: ['air_mass:north_pacific', 'sun'],
      goal_conditions: [{ zone: 3, phenomenon: 'heatwave' }],
      hints: ['여름철 무더위를 부르는 기단은 무엇일까요?', '강한 햇볕(일사 70 이상)이 더해져야 해요.'],
    },
  },
  {
    content_item_id: 'b0000003-0000-4000-8000-000000000003',
    difficulty: 1,
    concept_tag: 'air_mass',
    template_json: {
      question_text: '서해안에 눈을 내려 보세요',
      mode: 'goal_only',
      initial_state: { zones: ['서해', '수도권', '태백산맥', '동해안'], elements: [] },
      palette: ['air_mass:siberian', 'moisture'],
      goal_conditions: [{ zone: 0, phenomenon: 'snow' }],
      hints: ['겨울철 찬 공기를 몰고 오는 기단은?', '서해를 건너며 습기를 얻어야 눈구름이 생겨요(습기 60 이상).'],
    },
  },
  {
    // 재현 퍼즐(§3.5): based_on 실제 사건 초기조건 — anomaly 태그 필수
    content_item_id: 'b0000004-0000-4000-8000-000000000004',
    difficulty: 3,
    concept_tag: 'anomaly',
    template_json: {
      question_text: '2018년 기록적 폭염을 재현해 보세요',
      mode: 'goal_only',
      based_on: { event_name: '2018년 기록적 폭염', event_date: '2018-08-01', region: '서울' },
      initial_state: { zones: ['서해', '수도권', '태백산맥', '동해안'], elements: [] },
      palette: ['air_mass:north_pacific', 'sun'],
      goal_conditions: [{ zone: 1, phenomenon: 'heatwave' }],
      hints: ['한여름 무더위를 부르는 기단은?', '강한 일사(70 이상)가 더해져야 폭염이 나타나요.'],
    },
  },
];

// 최초 클리어 기록 (content_item_id 집합) — 재도전 0 XP (§3.5)
const clearedBoardPuzzles = new Set();

/** BoardPuzzle 1건 (서버 schemas/board.BoardPuzzle) — 목록·상세가 공유한다.
 *  R10-01 D1: 상세 엔드포인트는 단건 전용 스키마를 만들지 않고 이 형태를 그대로 쓴다. */
const boardPuzzlePayload = (p) => ({
  content_item_id: p.content_item_id,
  difficulty: p.difficulty ?? 1, // R7-02 S5: 난이도 1|2|3
  template_json: p.template_json,
  cleared: clearedBoardPuzzles.has(p.content_item_id),
});

/** 보드 재판정 + 목표 검사 → {passed, phenomena, feedback} (권위 채점 흉내) */
function judgeBoard(boardState, goalConditions) {
  const phenomena = evaluateBoard(boardState, BOARD_RULES);
  const { passed, unmet } = checkGoals(phenomena, goalConditions);
  let feedback;
  if (passed) {
    // 목표 존의 성립 규칙 explain을 우선 사용(§3.4 RAG 절약)
    const goalZone = goalConditions?.[0]?.zone ?? 0;
    feedback = phenomena[goalZone]?.explain ?? '목표 대기현상을 만들었어요!';
  } else {
    feedback = `아직 목표에 도달하지 않았어요. (${unmet.map((u) => `${u.zone}번 존`).join(', ')} 조건 미충족)`;
  }
  return { passed, phenomena, feedback };
}

// 목 세션 저장소: session_id → 세션. 일일 세션과 유닛 세션(§3.2)이 같은
// /session/:id/answer·/complete 엔진을 공유한다(계약: 기존 세션 엔진 재사용).
// 각 세션은 자체 items(_mock 포함)를 들고 있어 세션별로 독립 채점한다.
const sessions = new Map();
const DAILY_SESSION_ID = '5e1c8b1e-0000-4000-8000-0000000000aa';

/** 오늘자 일일 세션이 이미 발급돼 있는가 (R10-01 §3.1·D6).
 *  ensureSession의 발급 조건과 동일 — 진입 게이트를 **신규 발급 분기에서만**
 *  적용하기 위해 분리했다(기존 세션 재조회는 무차단: "풀던 것을 뺏기지 않는다"). */
function dailySessionIssued() {
  const existing = sessions.get(DAILY_SESSION_ID);
  return !!existing && existing.session_date === todayISO();
}

function ensureSession() {
  const today = todayISO();
  const existing = sessions.get(DAILY_SESSION_ID);
  if (!existing || existing.session_date !== today) {
    sessions.set(DAILY_SESSION_ID, {
      session_id: DAILY_SESSION_ID,
      session_date: today,
      mode: 'daily',
      unit_id: null,
      items: SESSION_ITEMS,
      answers: {},
      completed: false,
      // Router 라우팅 결정 흉내 (backend sessions.route_decision.target_concept_tag)
      // — 데일리 만점 왕관 동률 시 이 개념 우선(R8-01 §3.4 majority_concept 정렬).
      // 목 Router는 약점 θ 최하 개념을 겨냥한다고 가정: typhoon(WEAK_TAGS 최약).
      route_target_concept_tag: 'typhoon',
    });
  }
  return sessions.get(DAILY_SESSION_ID);
}

const sessionProgress = (s) => ({
  answered: Object.keys(s.answers).length,
  total: s.items.length,
});

/** 유닛 kind+concept_tag로 문항 풀을 결정해 세션 items 구성 (§3.2) */
function buildUnitItems(unit) {
  if (unit.kind === 'board') {
    const puzzle =
      BOARD_PUZZLES.find((p) => p.concept_tag === unit.concept_tag) ?? BOARD_PUZZLES[0];
    return [
      {
        quiz_id: `${todayISO()}-unit${unit.unit_order}-${unit.section}-board`,
        concept_tag: unit.concept_tag,
        question_type: 'board',
        question_text: puzzle.template_json.question_text,
        template_json: puzzle.template_json,
        level_group: 'middle_high',
        source: 'bank',
        slot_filled: false,
        _mock: {
          goal_conditions: puzzle.template_json.goal_conditions,
          feedbackCorrect: '정확해요! 목표 대기현상을 만들었어요.',
          feedbackWrong: '아직이에요 — 배치를 바꿔 다시 시도해 보세요.',
        },
      },
    ];
  }
  // quiz 유닛: 같은 concept_tag 기존 문항(board 제외) 최대 3건 (기존 시드 하위 호환)
  const pool = SESSION_ITEMS.filter(
    (it) => it.concept_tag === unit.concept_tag && it.question_type !== 'board',
  );
  return (pool.length ? pool : SESSION_ITEMS.filter((it) => it.question_type !== 'board')).slice(0, 3);
}

/** POST /curriculum/units/{id|slug}/session — 유닛 문항으로 세션 발급(멱등, §3.2).
 *  R8-01: slug 진입("이어서 학습")도 허용 — 세션 unit_id는 항상 정규 id로 저장해
 *  id/slug 어느 쪽으로 발급해도 같은 세션·같은 진도 키(unitProgress)를 쓴다. */
function startUnitSession(unitIdOrSlug) {
  const unit = getUnit(unitIdOrSlug);
  if (!unit) return [404, { detail: '유닛을 찾을 수 없습니다', code: 'UNIT_NOT_FOUND' }];
  if (isUnitLocked(unit)) {
    return [403, { detail: '선행 유닛을 먼저 완료해야 열려요', code: 'UNIT_LOCKED' }];
  }
  // 진입 게이트 (R10-01 §3.1·D6): 잠금 403 판정 **이후**, 세션 생성 직전.
  // 서버 create_unit_session은 호출마다 새 세션을 만들므로(멱등 재사용 없음)
  // 이 경로는 조건 없이 차단한다 — 목의 아래 멱등 재사용은 목 전용 편의다.
  const gate = requireCloudEntry();
  if (!gate.ok) return outOfCloudsError(gate.next_regen_sec);
  const unitId = unit.id; // 정규화 — slug 발급이어도 진도는 id 키로 기록
  const today = todayISO();
  const sessionId = `unit-${unitId}-${today}`;
  let s = sessions.get(sessionId);
  if (!s || s.completed || s.session_date !== today) {
    // 미완료 당일 세션은 멱등 재사용, 완료됐으면 새 세션(재도전) 발급
    s = {
      session_id: sessionId,
      session_date: today,
      mode: 'unit',
      unit_id: unitId,
      items: buildUnitItems(unit),
      answers: {},
      completed: false,
    };
    sessions.set(sessionId, s);
  }
  return [
    200,
    {
      session_id: s.session_id,
      session_date: s.session_date,
      mode: s.mode,
      unit_id: s.unit_id,
      unit: { id: unit.id, title: unit.title, kind: unit.kind, concept_tag: unit.concept_tag },
      items: s.items.map(stripMock),
      progress: sessionProgress(s),
    },
  ];
}

const stripMock = ({ _mock, ...item }) => item;

function gradeSessionItem(item, rawAnswer) {
  const answer = String(rawAnswer ?? '').trim();
  const { correct, accept, tolerance } = item._mock;
  const norm = (v) => v.replace(/\s+/g, '').toLowerCase();

  if (item.question_type === 'slider') {
    return Math.abs(Number(answer) - Number(correct)) <= (tolerance ?? 0);
  }
  if (item.question_type === 'short_answer' || item.question_type === 'cloze') {
    // cloze는 short_answer와 동일 규칙(공백·대소문자 무시) (§3.6)
    return [correct, ...(accept ?? [])].some((a) => norm(a) === norm(answer));
  }
  if (item.question_type === 'match') {
    // 제출 "left:right|left:right" 전 쌍 일치 (순서 무관)
    const submitted = new Map(answer.split('|').map((seg) => {
      const idx = seg.indexOf(':');
      return [seg.slice(0, idx).trim(), seg.slice(idx + 1).trim()];
    }));
    const expected = item._mock.pairs ?? [];
    return expected.length === submitted.size && expected.every((p) => submitted.get(p.left) === p.right);
  }
  if (item.question_type === 'ordering') {
    // 제출 "0,2,1,3" 원본 인덱스 순열이 정답 순서와 완전 일치 (§3.6)
    return answer === item._mock.correctOrder;
  }
  return answer === correct;
}

const routes = {
  'POST /auth/register': () => [
    201,
    { user_id: '2b1c8b1e-0000-4000-8000-000000000001', access_token: 'mock-access' },
  ],
  'POST /auth/login': () => [
    200,
    { access_token: 'mock-access', refresh_token: 'mock-refresh' },
  ],
  'POST /auth/refresh': () => [200, { access_token: 'mock-access-2' }],
  'POST /auth/logout': () => [200, { success: true }],

  'GET /quiz/today': () => [200, QUIZ],
  'POST /quiz/:id/answer': (body) => {
    const isCorrect = body?.answer === QUIZ.options[0] || body?.answer === '0';
    const xp = isCorrect ? 15 : 2;
    state.xp += xp;
    state.answeredToday = true;
    // 레거시 단일 퀴즈도 quiz_logs 1행 → 서버 today_answered_count에 포함된다.
    // (이 경로는 R5부터 구름을 소모하지 않았고 R10에서도 무소모 유지)
    state.answeredTodayCount += 1;
    bumpQuest({ xp, correctTag: isCorrect ? QUIZ.concept_tag : null });
    return [
      200,
      {
        is_correct: isCorrect,
        correct_answer: QUIZ.options[0],
        feedback: isCorrect
          ? '정확해요! 고기압 중심에서는 공기가 천천히 내려오면서 눌려 따뜻해지고(단열 압축), 상대습도가 낮아져 구름이 사라집니다. 그래서 오늘처럼 하늘이 맑고 건조한 날씨가 나타나요. 내일 아침에는 복사 냉각으로 일교차가 커질 수 있으니 겉옷을 챙기면 좋아요.'
          : '아쉬워요! 정답은 "단열 압축" 때문이에요. 고기압에서는 공기가 하강하며 눌려 따뜻해지고, 따뜻해진 공기는 수증기를 더 많이 머금을 수 있어 구름이 증발해요. 상승 기류·응결은 반대로 저기압에서 구름이 만들어지는 과정입니다.',
        xp_earned: xp,
        concept_tag: QUIZ.concept_tag,
      },
    ];
  },
  'GET /quiz/history': () => [
    200,
    Array.from({ length: 5 }, (_, i) => ({
      id: `3f1c8b1e-0000-4000-8000-00000000000${i}`,
      quiz_id: `2026-07-0${5 + i}-middle_high-general`,
      concept_tag: ['typhoon', 'air_mass', 'heat_island', 'co2_climate', 'anomaly'][i],
      question_type: 'multiple_choice',
      question_json: { question_text: `지난 퀴즈 ${i + 1}` },
      user_answer: '1',
      is_correct: i % 3 !== 0,
      elapsed_sec: 20 + i * 7,
      answered_at: `2026-07-0${5 + i}T09:1${i}:00Z`,
    })),
  ],

  // ── 세션 API (R2-01 계약 §3.1) ──
  'GET /session/today': () => {
    // 진입 게이트 (R10-01 §3.1·D6): **신규 발급 분기에서만** 429 OUT_OF_CLOUDS.
    // 이미 발급된 오늘 세션의 재조회는 잔량 0이어도 무차단 — 새로고침으로
    // 진행 중 세션을 잃지 않는다("풀던 것을 뺏기지 않는다" 불변식).
    if (!dailySessionIssued()) {
      const gate = requireCloudEntry();
      if (!gate.ok) return outOfCloudsError(gate.next_regen_sec);
    }
    const s = ensureSession();
    return [
      200,
      {
        session_id: s.session_id,
        session_date: s.session_date,
        mode: s.mode,
        items: s.items.map(stripMock),
        progress: sessionProgress(s),
      },
    ];
  },
  // GET /session/{id} — 세션 재조회(유닛 세션 새로고침 복원용)
  'GET /session/:id': (_body, params) => {
    const s = sessions.get(params?.id);
    if (!s) return [404, { detail: '세션을 찾을 수 없습니다', code: 'SESSION_NOT_FOUND' }];
    return [
      200,
      {
        session_id: s.session_id,
        session_date: s.session_date,
        mode: s.mode,
        unit_id: s.unit_id ?? null,
        items: s.items.map(stripMock),
        progress: sessionProgress(s),
      },
    ];
  },
  'POST /session/:id/answer': (body, params) => {
    const s = sessions.get(params?.id);
    if (!s) {
      return [404, { detail: '세션을 찾을 수 없습니다', code: 'SESSION_NOT_FOUND' }];
    }
    if (s.completed) {
      // 완료된 세션 = 전 문항 응답 완료이므로 실서버와 동일하게 ALREADY_ANSWERED (§3.1 코드 표준)
      return [409, { detail: '이미 답안을 제출한 퀴즈입니다.', code: 'ALREADY_ANSWERED' }];
    }
    const item = s.items.find((it) => it.quiz_id === body?.quiz_id);
    if (!item) {
      return [404, { detail: '세션에 없는 문항입니다', code: 'QUIZ_NOT_FOUND' }];
    }
    // 멱등 가드: 이미 응답한 문항 재제출 금지 (재제출은 구름 미소모 — §3.3)
    if (s.answers[item.quiz_id]) {
      return [409, { detail: '이미 답한 문항이에요', code: 'ALREADY_ANSWERED' }];
    }

    // board 유형(§3.4): board_state 필수·유효성 검사 (구름 소모 전에 422 판정)
    if (item.question_type === 'board') {
      if (!body?.board_state) {
        return [422, { detail: '보드 상태(board_state)가 필요합니다', code: 'BOARD_STATE_REQUIRED' }];
      }
      const validationErrors = validateBoardState(body.board_state);
      if (validationErrors.length > 0) {
        return [422, { detail: `보드 상태가 올바르지 않습니다: ${validationErrors[0]}`, code: 'BOARD_STATE_INVALID' }];
      }
    }

    // R10-01 §3.1: 여기서는 **아무것도 소모하지 않고 차단하지도 않는다**.
    // 발급된 세션의 문항 제출은 잔량 0이어도 항상 200 — 소모는 채점 이후,
    // 오답일 때만 1 (아래 shouldConsumeCloud 분기). 429 OUT_OF_CLOUDS는 발급·
    // 퍼즐 상세 진입에서만 발생한다.
    let isCorrect;
    let phenomena;
    if (item.question_type === 'board') {
      const judged = judgeBoard(body.board_state, item._mock.goal_conditions);
      isCorrect = judged.passed;
      phenomena = judged.phenomena;
    } else {
      isCorrect = gradeSessionItem(item, body?.answer);
    }

    // 배치고사(R7-01 S3 계약 확정): 진단 전용 — XP·스트릭·퀘스트 미부여
    const isPlacement = s.mode === 'placement';
    // 구름 소모 (R10-01 §3.1): **채점 이후** 오답에만 1. 정답·배치고사는 0.
    // 재제출은 위 멱등 가드(409)에서 이미 걸러졌으므로 alreadyAnswered=false.
    // 잔량 0에서 오답이어도 429가 아니라 무소모 200 (§3.1 각주 7).
    if (shouldConsumeCloud({ isCorrect, isPlacement })) consumeCloudIfAvailable();
    const xp = isPlacement ? 0 : isCorrect ? 15 : 2;
    s.answers[item.quiz_id] = { is_correct: isCorrect, xp_earned: xp };
    if (!isPlacement) {
      state.xp += xp;
      state.answeredToday = true;
      state.answeredTodayCount += 1;
      bumpQuest({ xp, correctTag: isCorrect ? item.concept_tag : null, live: item.slot_filled });
    }
    return [
      200,
      {
        is_correct: isCorrect,
        correct_answer: item._mock.correct ?? null,
        feedback: isCorrect ? item._mock.feedbackCorrect : item._mock.feedbackWrong,
        xp_earned: xp,
        concept_tag: item.concept_tag,
        session_progress: sessionProgress(s),
        ...(phenomena ? { phenomena } : {}),
      },
    ];
  },
  'POST /session/:id/complete': (_body, params) => {
    const s = sessions.get(params?.id);
    if (!s) {
      return [404, { detail: '세션을 찾을 수 없습니다', code: 'SESSION_NOT_FOUND' }];
    }
    const progress = sessionProgress(s);
    if (progress.answered < progress.total) {
      return [
        409,
        {
          detail: `아직 답하지 않은 문항이 있어요 (${progress.answered}/${progress.total})`,
          code: 'SESSION_NOT_COMPLETED',
        },
      ];
    }
    s.completed = true;
    const results = Object.values(s.answers);
    const correctCount = results.filter((r) => r.is_correct).length;

    // 유닛 세션(§3.2 + R8-01 §3.1): 전 문항 정답 시 왕관 +1, cleared 전환 시 +20 XP(1회).
    // unit_result는 백엔드 grant_unit_crown 반환 dict와 동일한 5필드 고정 형태
    // {all_correct, crowns, crown_target, cleared, unit_xp} — 유닛 세션이 아니면 null.
    let unitResult = null;
    if (s.unit_id) {
      const unit = getUnit(s.unit_id);
      const prog = getUnitProgress(s.unit_id);
      const crownTarget = unit?.crown_target ?? 1;
      const allCorrect = progress.total > 0 && correctCount === progress.total;
      let unitXp = 0;
      if (allCorrect && prog.crowns < crownTarget) {
        prog.crowns += 1;
        if (prog.crowns >= crownTarget && !prog.cleared_at) {
          prog.cleared_at = new Date().toISOString();
          unitXp = 20;
          state.xp += 20;
        }
      }
      unitResult = {
        all_correct: allCorrect,
        crowns: prog.crowns,
        crown_target: crownTarget,
        cleared: prog.crowns >= crownTarget,
        unit_xp: unitXp,
      };
    }
    // 데일리 왕관 유입로 (R8-01 §3.4): daily 세션 전 문항 정답이면 세션 문항 최다
    // 개념의 "열려 있는 첫 미클리어 quiz 유닛"에 왕관 +1. 동률 규칙은 백엔드
    // majority_concept과 동일 — route target_concept_tag 우선, 그래도 동률이면
    // 태그 사전순(결정적). 대상 없으면 무동작(null).
    // placement는 제외. daily는 하루 1세션 멱등이라 파밍 자연 상한.
    let crownAward = null;
    if (s.mode === 'daily' && progress.total > 0 && correctCount === progress.total) {
      const tagCounts = new Map();
      for (const item of s.items) {
        tagCounts.set(item.concept_tag, (tagCounts.get(item.concept_tag) ?? 0) + 1);
      }
      const topCount = Math.max(0, ...tagCounts.values());
      const tied = [...tagCounts.entries()]
        .filter(([, count]) => count === topCount)
        .map(([tag]) => tag)
        .sort();
      const routeTarget = s.route_target_concept_tag ?? null;
      const topTag = tied.includes(routeTarget) ? routeTarget : tied[0];
      const target = UNITS.find(
        (u) =>
          u.kind === 'quiz' &&
          u.concept_tag === topTag &&
          !isUnitLocked(u) &&
          (unitProgress.get(u.id)?.crowns ?? 0) < u.crown_target,
      );
      crownAward = grantUnitCrown(target ?? null);
    }
    // 배치고사 세션(R7-01 S3): 응답 이력으로 개념별 초기 능력(θ) 배정 흉내.
    // 실서버는 IRT EAP 추정 — 목은 개념별 정답률의 결정적 선형 근사를 쓴다.
    let placementResult = null;
    if (s.mode === 'placement') {
      state.placementDone = true;
      const byConcept = new Map();
      for (const item of s.items) {
        const r = s.answers[item.quiz_id];
        if (!r) continue;
        const agg = byConcept.get(item.concept_tag) ?? { correct: 0, n: 0 };
        agg.n += 1;
        if (r.is_correct) agg.correct += 1;
        byConcept.set(item.concept_tag, agg);
      }
      // 필드 형식은 /progress/abilities와 통일 (PM 계약 확정 — R7-01 S3)
      placementResult = {
        placement_done: true,
        abilities: [...byConcept.entries()].map(([conceptTag, { correct, n }]) => {
          const theta = Number(((correct / n - 0.5) * 2.4).toFixed(2)); // 0%→-1.2 · 50%→0 · 100%→+1.2
          return {
            concept_tag: conceptTag,
            theta,
            theta_se: Number((1 / Math.sqrt(n + 1)).toFixed(2)),
            num_responses: n,
            level_label: levelFromTheta(theta),
          };
        }),
      };
      // 배치 실응답 θ를 능력 저장소에도 반영 — /dev/state·/progress/abilities 일관 (R7-03)
      for (const a of placementResult.abilities) {
        devAbilities.set(a.concept_tag, { theta: a.theta, num_responses: a.num_responses });
      }
      // 배치 θ 선해제(R7-02 S4): 평균 θ>0이면 커리큘럼 선두(트리 순서)에서
      // 잠금 유닛을 1개(θ>=0.6이면 2개) 연속 선해제 — 왕관 0인데 열림(unlocked)
      // 케이스를 만든다. 실서버는 θ 기반 파생 — 목은 결정적 근사.
      const thetas = placementResult.abilities.map((a) => a.theta);
      const meanTheta = thetas.length ? thetas.reduce((sum, t) => sum + t, 0) / thetas.length : 0;
      const unlockCount = meanTheta >= 0.6 ? 2 : meanTheta > 0 ? 1 : 0;
      let unlocked = 0;
      for (const u of UNITS) {
        if (unlocked >= unlockCount) break;
        if (isUnitLocked(u)) {
          preUnlockedUnits.add(u.id);
          unlocked += 1;
        }
      }
    }
    return [
      200,
      {
        xp_total: results.reduce((sum, r) => sum + r.xp_earned, 0),
        correct_count: correctCount,
        total: progress.total,
        streak_count: state.streak,
        unit_result: unitResult, // R8-01 §3.1 — 유닛 세션이 아니면 null(additive)
        crown_award: crownAward, // R8-01 §3.4 — daily 만점 왕관 유입, 없으면 null(additive)
        ...(placementResult ?? {}),
      },
    ];
  },

  // ── 온보딩 배치고사 (R7-01 S3) — SessionToday 형태로 진단 세션 발급 ──
  'POST /onboarding/placement/start': () => {
    if (state.placementDone) {
      return [409, { detail: '이미 실력 진단을 마쳤어요', code: 'PLACEMENT_ALREADY_DONE' }];
    }
    const s = ensurePlacementSession();
    return [
      200,
      {
        session_id: s.session_id,
        session_date: s.session_date,
        mode: s.mode,
        items: s.items.map(stripMock),
        progress: sessionProgress(s),
      },
    ];
  },

  // POST /onboarding/placement/submit-all (R7-02 S1) — 일괄 채점.
  // body {answers:[{quiz_id, answer, elapsed_sec?}]} → {results, progress}.
  // 이미 채점된 로그는 멱등 스킵(재채점 없이 저장된 결과 반환). 피드백 텍스트 없음.
  // 채점은 기존 answer mock 로직(gradeSessionItem)을 재사용한다(placement에 board 없음).
  'POST /onboarding/placement/submit-all': (body) => {
    const s = sessions.get(PLACEMENT_SESSION_ID);
    if (!s || s.session_date !== todayISO()) {
      return [404, { detail: '배치 세션을 찾을 수 없습니다', code: 'SESSION_NOT_FOUND' }];
    }
    const answers = Array.isArray(body?.answers) ? body.answers : [];
    const results = [];
    for (const a of answers) {
      const item = s.items.find((it) => it.quiz_id === a?.quiz_id);
      if (!item) {
        // 세션 외 quiz_id → 404 (백엔드 QuizNotInSessionError 계약과 일치 — R7-14 판정)
        return [404, { detail: '세션에 해당 퀴즈가 없습니다.', code: 'QUIZ_NOT_FOUND' }];
      }
      const prev = s.answers[item.quiz_id];
      if (prev) {
        // 멱등 스킵 — 이미 채점된 로그는 저장된 결과를 그대로 돌려준다
        results.push({ quiz_id: item.quiz_id, is_correct: prev.is_correct });
        continue;
      }
      const isCorrect = gradeSessionItem(item, a?.answer);
      s.answers[item.quiz_id] = { is_correct: isCorrect, xp_earned: 0 }; // 진단 — XP 미부여
      results.push({ quiz_id: item.quiz_id, is_correct: isCorrect });
    }
    return [200, { results, progress: sessionProgress(s) }];
  },

  // ── 대기 보드 연습 API (R3-01 §3.5) ──
  'GET /board/rules': () => [200, BOARD_RULES],
  // GET /board/regions (R5-01 §3.1) — 지도 지역 좌표(렌더 전용, 판정 미사용)
  'GET /board/regions': () => [200, BOARD_REGIONS],
  // 목록은 **무차단**(R10-01 D1) — 잔량 0이어도 퍼즐 화면·cleared 표시는 열린다.
  'GET /board/puzzles': () => [200, BOARD_PUZZLES.map(boardPuzzlePayload)],
  // GET /board/puzzles/{content_item_id} (R10-01 D1 신설) — 단건 BoardPuzzle.
  // 서버 스키마 재사용(목록 원소와 동일 필드, 단건 전용 스키마 없음).
  // §3.1 차단 지점 3: **퍼즐 상세 진입**에서 잔량 부족이면 429 OUT_OF_CLOUDS.
  // 프론트는 "퍼즐 시작" 시 이 엔드포인트를 호출한다(목록 payload로 바로 플레이 금지).
  'GET /board/puzzles/:id': (_body, params) => {
    const puzzle = BOARD_PUZZLES.find((p) => p.content_item_id === params?.id);
    if (!puzzle) {
      return [404, { detail: '퍼즐을 찾을 수 없습니다', code: 'PUZZLE_NOT_FOUND' }];
    }
    const gate = requireCloudEntry();
    if (!gate.ok) return outOfCloudsError(gate.next_regen_sec);
    return [200, boardPuzzlePayload(puzzle)];
  },
  'POST /board/puzzles/:id/attempt': (body, params) => {
    const puzzle = BOARD_PUZZLES.find((p) => p.content_item_id === params?.id);
    if (!puzzle) {
      return [404, { detail: '퍼즐을 찾을 수 없습니다', code: 'PUZZLE_NOT_FOUND' }];
    }
    if (!body?.board_state) {
      return [422, { detail: '보드 상태(board_state)가 필요합니다', code: 'BOARD_STATE_REQUIRED' }];
    }
    const validationErrors = validateBoardState(body.board_state);
    if (validationErrors.length > 0) {
      return [422, { detail: `보드 상태가 올바르지 않습니다: ${validationErrors[0]}`, code: 'BOARD_STATE_INVALID' }];
    }
    // R10-01 §3.1: 시도 시점 소모·차단 없음. 판정 후 **미통과에만** 1 소모.
    const { passed, phenomena, feedback } = judgeBoard(body.board_state, puzzle.template_json.goal_conditions);
    // 보드는 멱등 가드가 없어 매 시도가 새 판정이다 → alreadyAnswered=false.
    // 통과 시 0 (재도전 자체가 무료가 아니라 "틀린 시도"에만 과금 — §3.1).
    if (shouldConsumeCloud({ isCorrect: passed })) consumeCloudIfAvailable();
    // 최초 클리어만 +5 XP (재도전 0) (§3.5)
    const firstClear = passed && !clearedBoardPuzzles.has(puzzle.content_item_id);
    let xpEarned = 0;
    if (firstClear) {
      clearedBoardPuzzles.add(puzzle.content_item_id);
      xpEarned = 5;
      state.xp += 5;
      bumpQuest({ xp: 5 });
    }
    // 보드 왕관 유입로 (R8-01 §3.4): 그 퍼즐 최초 클리어(기존 +5 XP와 동일 조건)이고
    // 같은 concept_tag의 kind='board' 유닛이 열려 있으면 왕관 +1. 같은 퍼즐 재클리어
    // 불인정(첫 클리어 집합이 자연 차단 — crown_target=2는 서로 다른 퍼즐 2개로 달성).
    let crownAward = null;
    if (firstClear && puzzle.concept_tag) {
      const unit = UNITS.find(
        (u) => u.kind === 'board' && u.concept_tag === puzzle.concept_tag && !isUnitLocked(u),
      );
      crownAward = grantUnitCrown(unit ?? null);
    }
    return [200, { passed, phenomena, feedback, xp_earned: xpEarned, crown_award: crownAward }];
  },

  'GET /progress/me': () => {
    regenClouds();
    return [
      200,
      {
        xp: state.xp,
        level: state.level,
        streak_count: state.streak,
        next_level_xp: nextLevelXp(state.level),
        streak_freeze_count: state.streakFreeze,
        tier: state.tier, // 현재 리그 티어 (§3.2 — 최근 정산, 없으면 stratus)
        clouds: state.clouds, // 구름 에너지 잔량 (§3.3)
        max_clouds: CLOUD_MAX,
        next_regen_sec: nextRegenSec(),
        placement_done: state.placementDone, // 온보딩 배치고사 완료 여부 (R7-01 S3)
        spine: spinePayload(), // 스파인 집계 (R8-01 §3.3, additive)
        // 일일 목표 (R10-01 §3.4·D4, additive) — null이면 미설정(온보딩 1스텝 노출).
        daily_goal_items: state.dailyGoalItems,
        // 오늘 응답한 문항 수 — "오늘 목표 N/M" 표기의 N.
        today_answered_count: state.answeredTodayCount,
      },
    ];
  },
  // ── 구름 에너지 (R5-01 §3.3) ──
  'GET /progress/energy': () => [200, energyPayload()],
  // PUT /progress/daily-goal {items} (R10-01 §3.4·D4) — 허용값 3|5|9, 그 외 422.
  // SESSION_RECIPE(합 5)와 독립된 표시용 타깃이다(계약 수치 드리프트 아님).
  'PUT /progress/daily-goal': (body) => {
    const items = Number(body?.items);
    if (!DAILY_GOAL_CHOICES.includes(items)) {
      return [
        422,
        {
          detail: `일일 목표는 ${DAILY_GOAL_CHOICES.join('·')} 중 하나여야 합니다`,
          code: 'VALIDATION_ERROR',
        },
      ];
    }
    state.dailyGoalItems = items;
    return [
      200,
      { daily_goal_items: items, today_answered_count: state.answeredTodayCount },
    ];
  },

  // ── 커리큘럼 단계별 학습 (R5-01 §3.2) ──
  'GET /curriculum': () => [200, curriculumPayload()],
  'POST /curriculum/units/:id/session': (_body, params) => startUnitSession(params?.id),

  // ── 일일 퀘스트·배지 (R4-01 §3.1·§3.3) ──
  'GET /progress/quests': () => [200, questPayload()],
  'GET /progress/badges': () => [200, BADGES],
  // GET /progress/weak-tags (R8-01 §3.5) — θ 파생 WeakConceptOut[] 형태.
  // 백엔드와 동일 판정: num_responses>0 AND θ < threshold, θ 오름차순(약한 순).
  // threshold는 middle_high 기준 b(0.0)+logit(0.6)≈0.41 고정(목 단순화).
  'GET /progress/weak-tags': () => {
    const threshold = 0.41;
    return [
      200,
      abilityRows()
        .filter((row) => row.num_responses > 0 && row.theta < threshold)
        .sort((a, b) => a.theta - b.theta)
        .map(({ concept_tag, theta, num_responses }) => ({
          concept_tag,
          theta,
          threshold,
          num_responses,
        })),
    ];
  },
  'POST /progress/attendance': () => [
    200,
    { streak_count: state.streak, is_new_record: false },
  ],
  // GET /progress/abilities (R6 WeatherBrain) — 약한 개념(θ 낮은 순) 우선 정렬.
  // R7-03에서 devAbilities 저장소를 공유해 /dev/theta 조작이 즉시 반영된다.
  'GET /progress/abilities': () => [
    200,
    abilityRows()
      .sort((a, b) => a.theta - b.theta)
      .map((row) => ({ ...row, level_label: levelFromTheta(row.theta), updated_at: null })),
  ],

  // ── 개발자 모드 (R7-03 계약 — /dev/*) ──────────────────────────────────────
  // DEV_MODE(=VITE_MOCK_DEV!=='0')가 꺼지면 실서버(FastAPI 라우터 미등록)와
  // 동일하게 전 경로 404 {"detail":"Not Found"} — 프론트 노출 게이트.
  'GET /dev/state': () => {
    if (!DEV_MODE) return DEV_404;
    return [200, devStatePayload()];
  },
  // POST /dev/reset-me {reset:true} — 계정 진행 전체 초기화(신규 가입 직후 상태로)
  'POST /dev/reset-me': (body) => {
    if (!DEV_MODE) return DEV_404;
    if (body?.reset !== true) {
      return [422, { detail: 'reset:true 가 필요합니다', code: 'VALIDATION_ERROR' }];
    }
    Object.assign(state, {
      xp: 0,
      level: 1,
      streak: 0,
      streakFreeze: 0,
      answeredToday: false,
      answeredTodayCount: 0,
      dailyGoalItems: null,
      predicted: false,
      tier: 'stratus',
      quest: { xpToday: 0, weakCorrect: 0, liveAnswered: 0 },
      duel: { submitted: false, userPred: null, aiPred: null, evidence: null },
      clouds: CLOUD_MAX,
      cloudsUpdatedAt: Date.now(),
      placementDone: false,
    });
    devAbilities = seedAbilities();
    unitProgress.clear();
    preUnlockedUnits.clear();
    sessions.clear();
    clearedBoardPuzzles.clear();
    return [200, devStatePayload()];
  },
  // POST /dev/theta {abilities:[{concept_tag, theta, num_responses?}]}
  'POST /dev/theta': (body) => {
    if (!DEV_MODE) return DEV_404;
    const abilities = Array.isArray(body?.abilities) ? body.abilities : [];
    if (!abilities.length) {
      return [422, { detail: 'abilities 배열이 필요합니다', code: 'VALIDATION_ERROR' }];
    }
    for (const a of abilities) {
      const theta = Number(a?.theta);
      if (!a?.concept_tag || Number.isNaN(theta)) {
        return [422, { detail: 'concept_tag·theta(숫자)가 필요합니다', code: 'VALIDATION_ERROR' }];
      }
      const prev = devAbilities.get(a.concept_tag) ?? { theta: 0, num_responses: 0 };
      const numResponses =
        a.num_responses != null ? Math.max(0, Number(a.num_responses) || 0) : prev.num_responses;
      devAbilities.set(a.concept_tag, { theta, num_responses: numResponses });
    }
    return [200, devStatePayload()];
  },
  // POST /dev/placement {action:"reset"|"complete"}
  'POST /dev/placement': (body) => {
    if (!DEV_MODE) return DEV_404;
    if (body?.action === 'reset') {
      state.placementDone = false;
      sessions.delete(PLACEMENT_SESSION_ID);
      preUnlockedUnits.clear(); // 배치 θ 선해제도 함께 철회
    } else if (body?.action === 'complete') {
      state.placementDone = true;
    } else {
      return [422, { detail: 'action은 reset|complete 입니다', code: 'VALIDATION_ERROR' }];
    }
    return [200, devStatePayload()];
  },
  // POST /dev/clouds {clouds} — 0..CLOUD_MAX clamp, 회복 타이머 anchor 재설정
  'POST /dev/clouds': (body) => {
    if (!DEV_MODE) return DEV_404;
    const clouds = Number(body?.clouds);
    if (Number.isNaN(clouds)) {
      return [422, { detail: 'clouds(숫자)가 필요합니다', code: 'VALIDATION_ERROR' }];
    }
    state.clouds = Math.max(0, Math.min(CLOUD_MAX, Math.round(clouds)));
    state.cloudsUpdatedAt = Date.now();
    return [200, devStatePayload()];
  },
  // POST /dev/curriculum {action:"unlock_all"|"crown"|"reset", unit_slug?, crowns?}
  'POST /dev/curriculum': (body) => {
    if (!DEV_MODE) return DEV_404;
    if (body?.action === 'unlock_all') {
      for (const u of UNITS) preUnlockedUnits.add(u.id);
    } else if (body?.action === 'reset') {
      unitProgress.clear();
      preUnlockedUnits.clear();
    } else if (body?.action === 'crown') {
      // unit_slug는 slug 또는 목 내부 id 둘 다 허용(getUnit — 백엔드는 slug)
      const unit = getUnit(body?.unit_slug);
      if (!unit) return [404, { detail: '유닛을 찾을 수 없습니다', code: 'UNIT_NOT_FOUND' }];
      const prog = getUnitProgress(unit.id);
      prog.crowns = Math.max(0, Number(body?.crowns ?? 1) || 0);
      prog.cleared_at = prog.crowns >= unit.crown_target ? new Date().toISOString() : null;
    } else {
      return [422, { detail: 'action은 unlock_all|crown|reset 입니다', code: 'VALIDATION_ERROR' }];
    }
    return [200, devStatePayload()];
  },
  // POST /dev/streak {streak_count, last_login_days_ago?}
  'POST /dev/streak': (body) => {
    if (!DEV_MODE) return DEV_404;
    const streakCount = Number(body?.streak_count);
    if (Number.isNaN(streakCount) || streakCount < 0) {
      return [422, { detail: 'streak_count(0 이상 숫자)가 필요합니다', code: 'VALIDATION_ERROR' }];
    }
    state.streak = Math.round(streakCount);
    // last_login_days_ago: 실서버는 last_login_date를 오늘-N일로 설정(출석 판정용).
    // 목은 출석 시뮬레이션이 없어 저장만 한다.
    state.devLastLoginDaysAgo = body?.last_login_days_ago ?? null;
    return [200, devStatePayload()];
  },

  'GET /league/current': () => [
    200,
    {
      week_start: weekStartISO(),
      region: '서울',
      mid_forecast: { '3일 후': '맑음, 최고 31℃', '4일 후': '구름많음, 최고 29℃', '5일 후': '흐리고 비, 최고 26℃' },
    },
  ],
  'POST /league/predict': () => {
    if (state.predicted) return [409, { detail: '이번 주에는 이미 제출했어요', code: 'ALREADY_SUBMITTED' }];
    state.predicted = true;
    return [200, { submitted: true }];
  },
  'GET /league/leaderboard': () => [
    200,
    Array.from({ length: 10 }, (_, i) => {
      const elo = 1400 - i * 22;
      return {
        rank: i + 1,
        nickname: ['하늘지기', '비요미', '구름사냥꾼', '태풍의눈', '무지개탐정', '요미', '맑음이', '천둥벌거숭이', '이슬비', '바람돌이'][i],
        accuracy_score: Math.round((97 - i * 4.3) * 10) / 10,
        elo_rating: elo,
        tier: tierFromElo(elo), // 리더보드 행 티어 (§3.2)
      };
    }),
  ],
  'GET /league/me/results': () => [
    200,
    state.predicted
      ? [
          {
            id: '4a1c8b1e-0000-4000-8000-000000000001',
            week_start: weekStartISO(),
            predicted_value: { temp_max: 31, temp_min: 24, rain_prob: 40 },
            actual_value: null,
            accuracy_score: null,
            elo_rating_after: null,
          },
        ]
      : [],
  ],

  // ── 예보 대결 (R4-01 §3.4 /duel + R9-01 §3.1 브리핑·근거) ──
  'GET /duel/today': () => [200, duelTodayPayload()],
  'GET /duel/briefing': () => [200, duelBriefingPayload()],
  'POST /duel/today': (body) => {
    if (state.duel.submitted) {
      return [409, { detail: '오늘은 이미 예보를 제출했어요', code: 'ALREADY_SUBMITTED' }];
    }
    const tempMax = Number(body?.temp_max);
    const rainProb = Number(body?.rain_prob);
    if (Number.isNaN(tempMax) || Number.isNaN(rainProb)) {
      return [422, { detail: '최고기온·강수확률을 숫자로 입력해주세요', code: 'INVALID_PREDICTION' }];
    }
    // 근거 선택(R9-01 §3.1 additive): 배열이 아니거나 미지 코드가 있으면 422
    let evidence = null;
    if (body?.evidence != null) {
      if (
        !Array.isArray(body.evidence) ||
        body.evidence.some((code) => !EVIDENCE_CODES.includes(code))
      ) {
        return [422, { detail: '알 수 없는 근거 코드가 있어요', code: 'INVALID_EVIDENCE' }];
      }
      evidence = [...new Set(body.evidence)];
    }
    state.duel.submitted = true;
    state.duel.userPred = { temp_max: tempMax, rain_prob: rainProb };
    state.duel.aiPred = DUEL_AI_PRED; // 제출 시점 결정적 생성·고정 (§3.4)
    state.duel.evidence = evidence; // user_pred JSONB 동봉 저장 흉내 (§3.1)
    return [200, duelTodayPayload()];
  },
  // 정산 완료분은 evidence_review(근거 적중 해설)·caster_grade 포함 (R9-01 §3.1·§3.2)
  'GET /duel/history': () => [
    200,
    [
      {
        id: 'd0000001-0000-4000-8000-000000000001',
        duel_date: '2026-07-20',
        user_pred: { temp_max: 29, rain_prob: 60 },
        ai_pred: { temp_max: 31, rain_prob: 40, noise_scale: 0.7 },
        actual: { temp_max: 28.5, rain_prob: 70 },
        user_score: 92.1,
        ai_score: 78.3,
        result: 'win',
        caster_grade: 'nimbostratus',
        evidence: ['pop_trend', 'recent_rain'],
        evidence_review: [
          { code: 'pop_trend', hit: true, note: '강수확률이 오후로 갈수록 상승했고 실측에서도 비가 관측됐어요.' },
          { code: 'recent_rain', hit: true, note: '최근 7일 중 강수 이력이 있었고 실제로도 비가 이어졌어요.' },
        ],
      },
      {
        id: 'd0000002-0000-4000-8000-000000000002',
        duel_date: '2026-07-19',
        user_pred: { temp_max: 33, rain_prob: 20 },
        ai_pred: { temp_max: 31, rain_prob: 30, noise_scale: 0.7 },
        actual: { temp_max: 30.8, rain_prob: 35 },
        user_score: 74.0,
        ai_score: 88.5,
        result: 'lose',
        caster_grade: 'nimbostratus',
        evidence: ['sky_overcast'],
        evidence_review: [
          { code: 'sky_overcast', hit: false, note: '흐림을 근거로 골랐지만 실측 하늘은 구름많음에 그쳤어요.' },
        ],
      },
    ],
  ],
};

function matchRoute(method, path) {
  for (const key of Object.keys(routes)) {
    const [m, pattern] = key.split(' ');
    if (m !== method) continue;
    const paramNames = [];
    const re = new RegExp(
      '^' +
        pattern.replace(/:[^/]+/g, (seg) => {
          paramNames.push(seg.slice(1));
          return '([^/]+)';
        }) +
        '$',
    );
    const matched = path.match(re);
    if (matched) {
      const params = Object.fromEntries(paramNames.map((name, i) => [name, matched[i + 1]]));
      return (body) => routes[key](body, params);
    }
  }
  return null;
}

export default function apiMockPlugin() {
  return {
    name: 'weathermind-api-mock',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url.startsWith('/api/v1/')) return next();
        const path = req.url.slice('/api/v1'.length).split('?')[0];
        const handler = matchRoute(req.method, path);
        if (!handler) return next();

        let raw = '';
        req.on('data', (c) => (raw += c));
        req.on('end', () => {
          let body = null;
          try {
            body = raw ? JSON.parse(raw) : null;
          } catch {
            /* ignore */
          }
          const [status, payload] = handler(body);
          // 실제 네트워크처럼 살짝 지연을 줘 로딩 상태도 디자인할 수 있게 한다
          setTimeout(() => {
            res.statusCode = status;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify(payload));
          }, 250);
        });
      });
    },
  };
}
