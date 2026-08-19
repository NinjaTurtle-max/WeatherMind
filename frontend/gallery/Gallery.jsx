/**
 * 모식도 전수 갤러리 — **판정 도구**.
 *
 * 🔴 예쁜 데모가 아니다. 이 페이지가 존재하는 유일한 이유는 이 저장소에
 * **「스텁이 초록인데 실브라우저에서 한 번도 안 뜬」 전례**(R10-06)가 있기 때문이다.
 * 그래서 규약이 셋이다.
 *   ⑴ **진짜로 그린다.** 스크린샷도, 정적 HTML도 아니다. `src/**`의 실제 WebGL·SVG
 *      컴포넌트를 브라우저에서 마운트한다.
 *   ⑵ **꾸미지 않는다.** 크기를 키우지 않고(전 칸 260:150 — 앱과 같은 판형),
 *      배경을 갈지 않고, 잘 나온 것만 고르지 않는다. **목록은 손으로 적지 않고
 *      `SCENES`·`SCENE_BY_RULE`·`STORYBOARDS`에서 파생한다.**
 *   ⑶ **미완은 미완이라고 화면에 적는다.** 빈 칸을 그냥 두지 않는다.
 *
 * 🔴 `modules/board/**`·`modules/explore/**`는 **읽기만** 했다 — 이 갤러리는
 *    `src/` 밖(`frontend/gallery/`)에만 파일을 만든다.
 */
import { useEffect, useMemo, useState } from 'react';

// ── 보드 단면 (GL 쪽) ───────────────────────────────────────────────────────
import { SCENES } from '../src/modules/board/webgl/crossSection/scenes.js';
// ── 보드 단면 (SVG 폴백 + 단계 캡션의 단일 진실원) ───────────────────────────
import { SCENE_BY_RULE, STORYBOARDS } from '../src/modules/board/CrossSectionPanel.jsx';
// ── 탐구 모식도 3종 ─────────────────────────────────────────────────────────
import { TYPHOON_SECTION_SCENE, T1_STEPS } from '../src/modules/explore/schematic/typhoonSectionScene.js';
import { TYPHOON_LIFECYCLE_SCENE, T2_STEPS } from '../src/modules/explore/schematic/typhoonLifecycleScene.js';
import {
  RADIATION_SCENE,
  RADIATION_SCENE_SPECTRAL,
  RADIATION_STEPS,
} from '../src/modules/explore/schematic/radiationScene.js';
// ── 일기도 ──────────────────────────────────────────────────────────────────
import PeninsulaMap from '../src/modules/board/PeninsulaMap.jsx';
import { FALLBACK_REGIONS } from '../src/modules/board/boardLayout.js';
import { createBoard, placeElement, setLevel, evaluateBoard, checkGoals } from '../src/lib/boardEngine.js';
import { AirMassBloom, FrontCurve, FlowArrow, ZoneAnnotation } from '../src/modules/board/mapInfographic.jsx';

import { FLOOD_VARIANTS } from './floodVariants.js';
import { GLCell, SvgCell, Tag, Card, H2, Note, GLGauge, C } from './parts.jsx';
import { GL_CAP } from './glBudget.js';

// ════════════════════════════════════════════════════════════════════════════
//  ⑴ 보드 단면 — 목록을 **파생**한다
// ════════════════════════════════════════════════════════════════════════════
/**
 * 🔴 두 레지스트리의 **합집합**을 돈다. 한쪽만 돌면 「한쪽에만 있는 장면」이
 * 조용히 빠지고, 그 조용한 누락이 `displayLayerParity.contract`가 생긴 이유 그 자체다.
 * 한쪽에 없으면 그 칸에 붉은 글로 적힌다.
 */
const RULE_IDS = [...new Set([...Object.keys(SCENE_BY_RULE), ...Object.keys(SCENES)])];

const BOARD_ROWS = RULE_IDS.map((ruleId) => {
  const story = STORYBOARDS[ruleId] ?? null; // getter — 접근 시점 로케일로 풀린다
  return {
    ruleId,
    title: story?.title ?? '(스토리보드 없음)',
    steps: story?.steps ?? [],
    Scene: SCENE_BY_RULE[ruleId] ?? null,
    hasGl: Boolean(SCENES[ruleId]),
  };
});

const TOTAL_STEPS = BOARD_ROWS.reduce((n, r) => n + r.steps.length, 0);

function BoardRow({ row }) {
  return (
    <Card style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <b style={{ fontSize: 14, color: C.ink }}>{row.title}</b>
        <Tag>{row.ruleId}</Tag>
        <Tag bg="#e0f2fe" tone={C.accent}>/board — 판정 시 단면 패널</Tag>
        <Tag>{row.steps.length}단계</Tag>
        {!row.hasGl && <Tag bg="#fee2e2" tone={C.bad}>GL 장면 없음 (SCENES 미등재)</Tag>}
        {!row.Scene && <Tag bg="#fee2e2" tone={C.bad}>SVG 장면 없음 (SCENE_BY_RULE 미등재)</Tag>}
      </div>

      {row.steps.length === 0 ? (
        <Note tone={C.bad} bg="#fee2e2">
          단계 캡션이 0건이다 — `board.panel.story.{row.ruleId}.steps` 리소스가 비어 있다.
          그림을 펼칠 근거가 없으므로 자리를 비운다.
        </Note>
      ) : (
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(520px, 1fr))' }}>
          {row.steps.map((caption, i) => (
            <div key={`${row.ruleId}-${i}`} style={{ border: `1px solid ${C.line}`, borderRadius: 8, padding: 8 }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'baseline', marginBottom: 6 }}>
                <Tag bg="#0f172a" tone="#e2e8f0">{`${i + 1} / ${row.steps.length}`}</Tag>
                <span style={{ fontSize: 11, color: C.dim, lineHeight: 1.5 }}>{caption}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: C.faint, marginBottom: 2 }}>SVG 폴백</div>
                  <SvgCell Scene={row.Scene} step={i} />
                </div>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: C.faint, marginBottom: 2 }}>WebGL2</div>
                  {row.hasGl ? (
                    <GLCell ruleId={row.ruleId} step={i} />
                  ) : (
                    <div style={{ aspectRatio: '260 / 150', background: '#fee2e2', display: 'grid', placeItems: 'center', padding: 8 }}>
                      <span style={{ fontSize: 11, color: C.bad, textAlign: 'center' }}>
                        GL 장면 없음 — `SCENES`에 이 rule_id가 없다.
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ════════════════════════════════════════════════════════════════════════════
//  ⑵ 탐구 모식도 — 3종 + 복사수지 색 두 판
// ════════════════════════════════════════════════════════════════════════════
const EXPLORE = [
  {
    key: 't1',
    title: '태풍 단면 (T1) — 하층과 상층은 반대로 감긴다',
    route: '/explore/typhoon',
    steps: T1_STEPS,
    variants: [{ label: '단일 판', scene: TYPHOON_SECTION_SCENE }],
  },
  {
    key: 't2',
    title: '태풍 생애 (T2) — 발생에서 온대저기압까지',
    route: '/explore/typhoon',
    steps: T2_STEPS,
    variants: [{ label: '단일 판', scene: TYPHOON_LIFECYCLE_SCENE }],
  },
  {
    key: 'c1',
    title: '복사수지 (C1) — 받은 만큼 내보낸다',
    route: '/explore/climate',
    steps: RADIATION_STEPS,
    // 🔴 이 두 판의 대조가 이 갤러리의 핵심 산출 중 하나다.
    variants: [
      { label: 'ⓐ 보드 팔레트 — RADIATION_SCENE (현재 화면에 배선된 판)', scene: RADIATION_SCENE },
      { label: 'ⓑ 파장 관례 — RADIATION_SCENE_SPECTRAL (반사도 노랑, 미배선)', scene: RADIATION_SCENE_SPECTRAL },
    ],
  },
];

const EXPLORE_STEPS = EXPLORE.reduce((n, s) => n + s.steps.length * s.variants.length, 0);

function ExploreBlock({ block }) {
  return (
    <Card style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <b style={{ fontSize: 14, color: C.ink }}>{block.title}</b>
        <Tag bg="#e0f2fe" tone={C.accent}>{block.route}</Tag>
        <Tag>{block.steps.length}단계</Tag>
        {block.variants.length > 1 && <Tag bg="#fae8ff" tone="#86198f">{`색 ${block.variants.length}판 나란히`}</Tag>}
      </div>
      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: `repeat(auto-fill, minmax(${block.variants.length > 1 ? 520 : 280}px, 1fr))` }}>
        {block.steps.map((s, i) => (
          <div key={s.key ?? i} style={{ border: `1px solid ${C.line}`, borderRadius: 8, padding: 8 }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'baseline', marginBottom: 4 }}>
              <Tag bg="#0f172a" tone="#e2e8f0">{`${i + 1} / ${block.steps.length}`}</Tag>
              <span style={{ fontSize: 11, fontWeight: 700, color: C.ink }}>{s.title}</span>
            </div>
            {s.note ? <p style={{ fontSize: 10.5, color: C.dim, margin: '0 0 6px', lineHeight: 1.6 }}>{s.note}</p> : null}
            <div style={{ display: 'grid', gridTemplateColumns: block.variants.length > 1 ? '1fr 1fr' : '1fr', gap: 6 }}>
              {block.variants.map((v) => (
                <div key={v.label}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: C.faint, marginBottom: 2, minHeight: 26, lineHeight: 1.3 }}>{v.label}</div>
                  <GLCell scene={v.scene} step={i} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ════════════════════════════════════════════════════════════════════════════
//  ⑶ 일기도
// ════════════════════════════════════════════════════════════════════════════
/** 요소를 실제로 배치한 보드 — `boardEngine`의 공개 헬퍼만 쓴다. */
function demoBoard() {
  let b = createBoard();
  b = placeElement(b, 0, 'air_mass', 'north_pacific');
  b = placeElement(b, 1, 'front', 'cold');
  b = placeElement(b, 1, 'air_mass', 'siberian');
  b = placeElement(b, 2, 'front', 'stationary');
  b = placeElement(b, 3, 'air_mass', 'okhotsk');
  b = setLevel(b, 1, 'moisture', 85);
  b = setLevel(b, 1, 'wind', 65);
  b = setLevel(b, 0, 'moisture', 70);
  return b;
}

/** 규칙 파일을 못 읽었을 때 쓰는 **손으로 지정한** 표시 결과 — 반드시 그렇다고 적는다. */
const HAND_VISUALS = [
  { zone: 0, zone_name: '서해', phenomenon: 'shower', cloud: 'cumulonimbus', rule_id: 'cold_front_shower', explain: null },
  { zone: 1, zone_name: '수도권', phenomenon: 'persistent_rain', cloud: 'nimbostratus', rule_id: 'stationary_front_monsoon', explain: null },
  { zone: 2, zone_name: '태백산맥', phenomenon: 'snow', cloud: 'cumulus', rule_id: 'siberian_snow', explain: null },
  { zone: 3, zone_name: '동해안', phenomenon: 'fog', cloud: 'stratus', rule_id: 'okhotsk_sea_fog', explain: null },
];

function MapSection() {
  const [rules, setRules] = useState(null);
  const [rulesErr, setRulesErr] = useState(null);
  const board = useMemo(demoBoard, []);

  useEffect(() => {
    // 규칙 파일은 `frontend/` 밖(`database/seed/`)이라 vite dev의 `server.fs.allow`가
    // 막을 수 있다. 정적 import로 걸면 **페이지 전체가 죽으므로** 동적으로 시도하고,
    // 실패하면 사유를 화면에 적은 뒤 손으로 지정한 표시 결과로 내려간다.
    import('../../database/seed/board_rules.json')
      .then((m) => setRules(m.default ?? m))
      .catch((e) => setRulesErr(String(e?.message ?? e)));
  }, []);

  const live = rules ? evaluateBoard(board, rules) : null;
  const visuals = live ?? HAND_VISUALS;
  const goals = checkGoals(visuals, []);

  return (
    <>
      {rulesErr ? (
        <Note tone={C.warn}>
          {'규칙 파일(`database/seed/board_rules.json`)을 적재하지 못했다 — 판정은 **손으로 지정한 표시 결과**다.\n사유: '}
          {rulesErr}
        </Note>
      ) : null}
      {live ? (
        <Note tone={C.ok} bg="#ecfdf5">
          규칙 파일을 실제로 적재해 `evaluateBoard`로 판정했다 — 아래 존별 결과는 손으로 적은 값이 아니다.
        </Note>
      ) : null}
      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))' }}>
        <Card>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
            <b style={{ fontSize: 14 }}>일기도 — 기단·전선·유동 + 존별 판정 오버레이</b>
            <Tag bg="#e0f2fe" tone={C.accent}>/board</Tag>
            <Tag>PeninsulaMap.jsx</Tag>
          </div>
          <PeninsulaMap
            regions={FALLBACK_REGIONS}
            preview={visuals}
            board={board}
            goals={goals}
            goalConditions={[]}
            selected={null}
            interactive={false}
            onZoneTap={() => {}}
            zoneVisuals={visuals}
          />
          <ul style={{ margin: 0, paddingLeft: 16, fontSize: 11, color: C.dim, lineHeight: 1.7 }}>
            {visuals.map((v) => (
              <li key={v.zone}>{`${v.zone_name} — ${v.phenomenon} / ${v.cloud} (${v.rule_id ?? 'rule 없음'})`}</li>
            ))}
          </ul>
          <p style={{ fontSize: 10.5, color: C.faint, marginTop: 6, lineHeight: 1.6 }}>
            ⚠️ 이 지도는 자체 WebGL 오버레이(`webgl/mapOverlay`)를 **1개 더** 쓴다 — 위 GL 상한과 별도 예산이다.
            그래서 지도는 한 장만 놓는다.
          </p>
        </Card>

        <Card>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
            <b style={{ fontSize: 14 }}>일기도 프리미티브 — mapInfographic.jsx</b>
            <Tag bg="#e0f2fe" tone={C.accent}>/board (지도 위에 겹쳐 그려진다)</Tag>
          </div>
          <p style={{ fontSize: 11, color: C.dim, margin: '0 0 6px', lineHeight: 1.6 }}>
            지도 안에서는 다른 것과 겹쳐 보이므로 여기서만 낱개로 떼어 본다. 좌표계는 지도와 같은 userSpace 100×80.
          </p>
          <svg viewBox="0 0 100 80" style={{ display: 'block', width: '100%', height: 'auto', background: '#dfe9f3', borderRadius: 8 }}>
            <AirMassBloom subtype="siberian" x={18} y={20} animate={false} />
            <AirMassBloom subtype="north_pacific" x={48} y={20} animate={false} />
            <AirMassBloom subtype="yangtze" x={78} y={20} animate={false} />
            <AirMassBloom subtype="okhotsk" x={18} y={50} animate={false} />
            <FrontCurve subtype="cold" points={[{ x: 34, y: 44 }, { x: 52, y: 52 }, { x: 70, y: 46 }]} animate={false} />
            <FrontCurve subtype="warm" points={[{ x: 34, y: 60 }, { x: 52, y: 68 }, { x: 70, y: 62 }]} animate={false} />
            <FlowArrow subtype="siberian" x={86} y={52} animate={false} />
            <FlowArrow subtype="north_pacific" x={86} y={66} animate={false} />
            <ZoneAnnotation x={52} y={40} ruleId="cold_front_shower" animate={false} />
          </svg>
          <p style={{ fontSize: 10.5, color: C.faint, marginTop: 6, lineHeight: 1.6 }}>
            위: 기단 번짐 4종(시베리아·북태평양·양쯔강·오호츠크해) / 가운데: 전선 곡선 한랭·온난 /
            오른쪽: 유동 화살표 2종 / 맨 위 띠: 존 주석 상자(`ZoneAnnotation`은 상자를 지도 맨 위에 고정한다).
          </p>
        </Card>
      </div>
    </>
  );
}

// ════════════════════════════════════════════════════════════════════════════
//  ⑷ 홍수 — 전후
// ════════════════════════════════════════════════════════════════════════════
const FLOOD_RULE = 'flood_risk_saturated_inflow';
const FLOOD_STEPS = STORYBOARDS[FLOOD_RULE]?.steps ?? [];

function FloodSection() {
  return (
    <>
      <Note>
        {'🔴 **바뀌는 것은 「물 높이」가 아니다.** 수면은 앞줄 건물을 3~6층으로 읽으면 **실척 3.6~10 m**이고,\n' +
          '국내 내수침수위험지도의 최상위 위험 밴드(3.0 m 이상)를 이미 넘겼다 — 그래서 **수위는 올리지 않았다.**\n' +
          '바뀐 것은 ㉠ **깊이를 잴 자**(창문선까지 잠긴 차)와 ㉡ **뒷줄 지반**(고지대 단을 세워 뒷줄은 마른 채 남긴다),\n' +
          '그리고 ㉢ 유입 화살표를 3단계에서 끊은 것(살아 있으면 물이 바다에서 밀려오는 해일로 읽힌다)이다.'}
      </Note>
      {FLOOD_STEPS.map((caption, i) => (
        <Card key={i} style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'baseline', marginBottom: 6 }}>
            <Tag bg="#0f172a" tone="#e2e8f0">{`${i + 1} / ${FLOOD_STEPS.length}`}</Tag>
            <span style={{ fontSize: 11, color: C.dim }}>{caption}</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 8 }}>
            {FLOOD_VARIANTS.map((v) => (
              <div key={v.key}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.ink, marginBottom: 2 }}>{v.title}</div>
                <div style={{ fontSize: 10, color: C.faint, marginBottom: 4 }}>{v.src}</div>
                {v.scene ? <GLCell scene={v.scene} step={i} /> : <GLCell ruleId={FLOOD_RULE} step={i} />}
                <p style={{ fontSize: 10.5, color: C.dim, margin: '4px 0 0', lineHeight: 1.6 }}>{v.why}</p>
              </div>
            ))}
          </div>
        </Card>
      ))}
    </>
  );
}

// ════════════════════════════════════════════════════════════════════════════
//  ⑸ 「같은 화면에서 온 것인가」 — 직접 대조 행
// ════════════════════════════════════════════════════════════════════════════
/**
 * 🔴 **배치 자체가 판정 도구다.** 판정 기준이 「나란히 놓고 같은 화면에서 온 것으로
 * 보이는가」라, 보드 단면과 탐구 모식도를 **같은 크기·같은 행**에 둔다. 아래 전수
 * 섹션은 각각을 따로 펼치므로 이 대조는 여기서 한 번 명시적으로 해 둔다.
 */
const ADJACENCY = [
  { label: '보드 — 한랭전선 소나기 (최종 단계)', route: '/board', ruleId: 'cold_front_shower', step: (STORYBOARDS.cold_front_shower?.steps.length ?? 1) - 1 },
  { label: '보드 — 홍수 위험 (최종 단계)', route: '/board', ruleId: FLOOD_RULE, step: Math.max(0, FLOOD_STEPS.length - 1) },
  { label: '탐구 T1 — 태풍 단면 (최종 단계)', route: '/explore/typhoon', scene: TYPHOON_SECTION_SCENE, step: T1_STEPS.length - 1 },
  { label: '탐구 T2 — 태풍 생애 (최종 단계)', route: '/explore/typhoon', scene: TYPHOON_LIFECYCLE_SCENE, step: T2_STEPS.length - 1 },
  { label: '탐구 C1ⓐ — 복사수지 보드 팔레트', route: '/explore/climate', scene: RADIATION_SCENE, step: RADIATION_STEPS.length - 1 },
  { label: '탐구 C1ⓑ — 복사수지 파장 관례', route: '/explore/climate', scene: RADIATION_SCENE_SPECTRAL, step: RADIATION_STEPS.length - 1 },
];

// ════════════════════════════════════════════════════════════════════════════
export default function Gallery() {
  return (
    <div style={{ background: C.page, minHeight: '100vh', padding: '20px 16px 80px', color: C.ink, fontFamily: 'system-ui, -apple-system, "Apple SD Gothic Neo", sans-serif' }}>
      <GLGauge />
      <div style={{ maxWidth: 1560, margin: '0 auto' }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>WeatherMind — 모식도 전수 갤러리</h1>
        <p style={{ fontSize: 13, color: C.dim, lineHeight: 1.8, marginTop: 8 }}>
          이 페이지는 <b>판정 도구</b>다. 저장소의 모든 모식도를 <b>실제 컴포넌트로 브라우저에서 그려</b> 늘어놓는다 —
          스크린샷도, 정적 HTML도 아니다. 크기를 키우거나 배경을 갈거나 잘 나온 것만 고르지 않았고,
          장면 목록은 손으로 적지 않고 <code>SCENES</code>·<code>SCENE_BY_RULE</code>·<code>STORYBOARDS</code>에서 파생했다.
        </p>

        <Note tone={C.accent} bg="#eff6ff">
          {`🔴 **빈 칸은 「그림이 없다」가 아니다.** 브라우저의 동시 WebGL 컨텍스트 상한(≈8~16) 때문에 이 페이지의 GL 칸 ` +
            `전부를 동시에 살릴 수 없다. 그래서 갤러리가 마운트·언마운트를 직접 소유한다:\n` +
            `  ⑴ 뷰포트 근방(rootMargin 320px)에 들어오면 마운트, 벗어나면 **언마운트해 컨텍스트를 반납**한다.\n` +
            `     (CrossSectionGL 자신의 IntersectionObserver는 rAF만 멈추고 컨텍스트는 살려 두므로 그것만으로는 부족하다.)\n` +
            `  ⑵ 그래도 동시 ${GL_CAP}개를 상한으로 건다. 못 받은 칸은 「컨텍스트 대기」라고 **글로 적는다.**\n` +
            `오른쪽 아래 계기판이 지금 살아 있는 컨텍스트 수를 실시간으로 보인다. 천천히 스크롤할 것.`}
        </Note>

        <Note tone={C.dim} bg="#f8fafc">
          {`읽는 법 — 각 칸 위에 **이름 · 화면 경로 · 단계 번호**가 붙는다.\n` +
            `보드 단면은 **SVG 폴백(왼쪽)과 WebGL2(오른쪽)를 나란히** 놓는다. 두 렌더러는 같은 단계 시퀀스를 공유하지만\n` +
            `사람이 나란히 본 적이 한 번도 없었다(지금까지 테스트로만 봤다). GL이 실패한 칸은 **일부러 SVG로 내려가지 않는다** —\n` +
            `내려가면 비교가 거짓이 되고, 그것이 이 페이지가 없애려는 바로 그 간극이다.`}
        </Note>

        <H2 note={'판정 기준이 「나란히 놓고 같은 화면에서 온 것으로 보이는가」라 배치 자체를 판정 도구로 쓴다.\n전부 같은 260:150 판형이고 전부 같은 렌더러(board/webgl/crossSection)를 쓴다.'}>
          §0 「같은 화면에서 온 것인가」 — 보드 단면 ↔ 탐구 모식도 직접 대조
        </H2>
        <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))' }}>
          {ADJACENCY.map((a) => (
            <Card key={a.label}>
              <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 2 }}>{a.label}</div>
              <div style={{ marginBottom: 4 }}><Tag bg="#e0f2fe" tone={C.accent}>{a.route}</Tag></div>
              <GLCell ruleId={a.ruleId ?? null} scene={a.scene ?? null} step={a.step} />
            </Card>
          ))}
        </div>

        <H2
          note={`규칙 ${BOARD_ROWS.length}종 × 전 단계 ${TOTAL_STEPS}칸을 SVG·GL 두 벌로 그린다(그림 ${TOTAL_STEPS * 2}칸).\n` +
            '🔴 **단계를 전부 펼치는 것이 요점이다.** 한 단계만 보면 「말하는 현상이 화면에서 실제로 일어나는가」를 못 본다 —\n' +
            '홍수 장면이 「도시를 세워 놓고 물을 안 올린」 것도 3단계를 펼쳐서야 잡혔다.'}
        >
          §1 보드 단면 전수 — SVG ‖ WebGL2
        </H2>
        {BOARD_ROWS.map((row) => <BoardRow key={row.ruleId} row={row} />)}

        <H2
          note={`탐구 화면 모식도 3종. C1은 **색 두 판을 나란히** 놓는다 — 사용자가 「둘 다 만들어 갤러리에서 비교」로 판정한 건이다.\n` +
            'ⓑ(RADIATION_SCENE_SPECTRAL)는 아직 어느 화면에서도 import되지 않는다 — **이 갤러리가 물어 주지 않으면 트리셰이킹으로 사라진다.**'}
        >
          §2 탐구 모식도 3종 + 복사수지 색 두 판
        </H2>
        {EXPLORE.map((b) => <ExploreBlock key={b.key} block={b} />)}

        <H2 note={'클라이언트가 “일기도 등”이라 명시한 자리. 실제 `PeninsulaMap`에 요소를 배치한 보드를 물려 그린다.'}>
          §3 일기도
        </H2>
        <MapSection />

        <H2
          note={'`flood_risk_saturated_inflow`는 **클라이언트가 직접 반려한 유일한 장면**이라 판(版)을 나란히 놓는다.\n' +
            '① 옛 판(7a851da) · ② MT-23 판(c90e28b — 2차 반려) · ③ 현재 판. ①②는 히스토리에서 **읽기만** 해서 재구성했고,\n' +
            '③은 현재 소스(`SCENES`)가 그대로 그린다.'}
        >
          §4 홍수 — 판을 나란히
        </H2>
        <FloodSection />

        <H2 note="이 페이지가 담지 못한 것을 적는다 — 빈 자리를 말없이 두지 않는 것이 규약이다.">
          §5 이 갤러리에 없는 것 · 아는 한계
        </H2>
        <Card>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: C.dim, lineHeight: 1.9 }}>
            <li>
              <b>SVG 쪽은 정지 프레임이다</b>(<code>animate={'{false}'}</code>). 등장·반복 애니메이션이 화면 밖에서 흘러가 버리면
              단계별 대조가 어긋나기 때문이다. 움직임을 보려면 앱의 <code>/board</code>에서 볼 것.
            </li>
            <li>
              <b>탐구 모식도에는 SVG 폴백이 없다.</b> <code>SchematicPanel</code>은 GL이 실패하면 그림 대신 <b>단계 제목 목록</b>으로
              내려간다(설계). 그래서 이 섹션은 GL 한 벌뿐이고, 그것이 결함이 아니다.
            </li>
            <li>
              <b>일기도는 한 장뿐이다.</b> <code>PeninsulaMap</code>이 자체 WebGL 오버레이 컨텍스트를 1개 더 쓰기 때문에
              여러 장을 늘어놓으면 위 GL 예산을 갉아먹는다.
            </li>
            <li>
              <b>위성 구름 도식(<code>explore/satelliteField.js</code>·<code>SatelliteView.jsx</code>)은 넣지 않았다.</b>
              작업 지시의 목록(보드 단면·탐구 모식도 3종·일기도·홍수)에 없고, 이 갤러리 브랜치가 병합한 두 브랜치에도
              들어 있지 않다 — 다른 조가 지금 만지고 있는 미병합 작업이다.
            </li>
            <li>
              <b>보드 단면의 「현상 아이콘·강수 엔진」 계층은 없다.</b> 이 갤러리가 대상으로 삼은 것은 모식도(단면·모식·지도)이고,
              <code>boardSymbols</code>·<code>realisticEffects</code>의 낱개 심볼은 범위 밖이다.
            </li>
          </ul>
        </Card>
      </div>
    </div>
  );
}
