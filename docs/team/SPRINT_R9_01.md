# 스프린트 R9-01 — 본선 대비: 보드 2.0 · 브리핑 룸 · 적응형 캐스터 · 탐구 모듈

> 클라이언트 구상(2026-07-30) + 주최측 예시 6종 대응. 본선 8.21 역산 1차 스프린트.
> R3 "시뮬레이터 폐지" 원칙과의 정합: 수치 모델이 아니라 **결정적 규칙·교육 모델 위의
> 체험 레이어** — 판정 권위·재현성 불변.

## 0. 클라이언트 확정 (2026-07-30)

| 항목 | 결정 |
|---|---|
| 보드 2.0 범위 | **애니메이션 + 드래그 둘 다 풀** (타 항목은 v1 경량으로 배분) |
| 브리핑 "판단 근거 선택" | 포함 (학습 장치) |
| AI 캐스터 난이도 연동 | **티어(ELO) 기준** 5계단 |

## 1. 탐색 확정 사실 (2026-07-30, 2기)

- 보드: 인라인 SVG+절대배치 하이브리드(좌표계 2원화·stretch 왜곡), 표현은 전부
  이모지, 터치 드래그 자산 0, **로컬 미리보기 엔진이 존별 {현상·구름·rule_id·
  explain}을 즉시 산출 → 서버 계약 불변으로 애니메이션 구동 가능**. 규칙 8종 →
  rule_id→애니메이션 프리셋 하드 매핑. 세션 내 보드엔 phenomena 미배선(프론트만).
  reduced-motion 대응 0. 자체 제작 원칙(외부 에셋 금지) 명문화돼 있음.
- 듀얼: 캐스터 = base(KMA 단기예보)+균등노이즈(±2℃/±15%p), 시드=(user,date) 결정적.
  주입 지점 1곳(순수 함수). ELO 조달 함수(get_current_rating) 구현돼 있으나 미사용.
  **DuelForm의 base_forecast 배너가 백엔드 미응답으로 죽어 있음(드리프트)**.
  recharts 설치됨. KMA 단기예보로 3시간별 TMP/POP/PCP/REH/WSD/SKY/PTY 시계열 확보
  가능(기압은 불가 — 신규 KMA API 필요, 이번 범위 외). Redis 1h 캐시+실패 마커로
  브리핑 GET 비용 낮음. 강수 실측이 0/100 이진화(확률 채점 불일치).

## 2. 스토리와 담당

| # | 스토리 | 담당 |
|---|---|---|
| S1 | 브리핑 API + base_forecast 드리프트 해소 + 근거 저장·해설 | 백엔드 SA-1 |
| S2 | 적응형 AI 캐스터 (티어 5계단·결정성·밸런스 계약) | 백엔드 SA-2 |
| S3 | 보드 2.0 — 좌표 통일·표준 표기 SVG·드래그·현상 애니메이션·세션 배선·탐구 모드 | 프론트 FE-1 (메인 트리) |
| S4 | 브리핑 룸 UI (차트·근거 선택·캐스터 등급·AI 판단 공개) | 프론트 FE-2 (워크트리) |
| S5 | 탐구 시뮬 v1 2종 (태풍·기후변화) — 결정적 교육 모델 | 프론트 FE-3 (워크트리) |
| S6 | 통합·회귀·스모크·회고 | QA+DevOps |

## 3. 계약 (고정)

### 3.1 브리핑 API (S1)
- `GET /api/v1/duel/today` 응답에 `base_forecast: {temp_max, rain_prob} | null`
  additive — 프론트·mock이 기대하는 기존 훅 충족. KMA 실패·키 부재 시 null
  (폴백 base로 캐스터는 동작하되 브리핑엔 비노출).
- **`GET /api/v1/duel/briefing`** 신설: `{region: "서울", target_date,
  hourly: [{datetime, tmp, pop, pcp, reh, wsd, sky, pty}], today_observed:
  {max_ta, min_ta, sum_rn} | null, recent_days: [{date, max_ta, sum_rn}] (≤7)}`.
  전부 기존 weather_api 재사용(Redis 캐시 뒤), 실패 필드는 null/빈 배열.
  레이트리밋 LIMIT_TODAY급. LeaguePage의 mid_forecast raw JSON 노출도 이
  briefing 재사용으로 대체(리그 라우터의 mid_forecast는 유지 — 하위 호환).
- **근거 선택 저장**: `POST /duel/today` body에 `evidence: list[str] | None`
  additive (화이트리스트 코드 5종: `pop_trend`(강수확률 추세), `humidity_high`,
  `temp_drop`(전일 대비 하강), `sky_overcast`, `recent_rain`(최근 강수 이력) —
  미지 코드 422). `duels.user_pred` JSONB에 동봉 저장(마이그레이션 0). 응답·
  history에 `evidence` 노출. **근거 적중 판정**(정산 후 조회 시 계산, 결정적
  순수 함수): 각 근거 코드에 대해 실측과의 정합(예: recent_rain 선택 & 실측
  강수>0 → 적중)을 `evidence_review: [{code, hit: bool, note}]`로 반환.
- 강수 이진 채점 문제는 **이번 범위 외** — §5 부채 기록(Brier 전환은 공식 변경).

### 3.2 적응형 캐스터 (S2)
- `caster_noise_scale(elo: int | None) -> float` 순수 함수, **티어 5계단 매핑**
  (계약 수치): stratus 1.00 / cumulus 0.85 / nimbostratus 0.70 / cumulonimbus
  0.55 / typhoon_eye 0.40. elo None(첫 참가)=1.00.
- `ai_caster_prediction(..., *, noise_scale: float = 1.0)` — 기본값 하위 호환,
  **시드는 (user,date) 불변·실력값은 진폭에만 적용**(결정성 보존).
- POST /duel/today에서 `get_current_rating`(기존 미사용 함수) 조달 → scale 적용.
  `DuelToday`·history에 `caster_grade: str`(티어명) additive — 프론트 "🤖 {티어}급
  캐스터" 표시. ai_pred JSONB에 `noise_scale` 스냅샷 동봉(감사 가능).
- **밸런스 계약 테스트**: 결정적 시드 배치 시뮬(유저 오차 가정 3구간 × 티어 5)로
  기대 승률이 단조(티어↑→유저 승률↓)이고 극단(<20%·>85%) 없음 고정.

### 3.3 보드 2.0 (S3 — 서버 계약 불변, 프론트 전면)
- **선행 리팩터**: 지도 aspect-ratio 고정 + 존 노드를 SVG userSpace 단일
  좌표계로(`<g transform>`), board_regions 좌표 SSOT 일치(시드↔폴백 불일치 해소,
  미사용 label_anchor 활용).
- **표준 표기 SVG 자체 제작**: 한랭전선(파란 삼각 톱니 밴드)·온난전선(빨간 반원
  밴드)·정체전선(교대)·기단 심볼(원+한랭/온난 색상+약어 라벨)·현상 아이콘(비·
  소나기·눈·안개·뇌우) — boardDisplay.js의 이모지 매핑을 SVG 컴포넌트 레지스트리로
  교체(교체 지점 단일). 이모지는 폴백 유지.
- **드래그 배치**: Pointer Events 자체 구현(마우스+터치), 존 스냅·드래그 중
  고스트·유효 존 하이라이트. 기존 탭-탭 경로 병행 유지(접근성).
- **현상 애니메이션**: rule_id→프리셋 8종(cold_front_shower=전선 쐐기+적란운
  상승+소나기 입자, radiation_fog=안개 층 등) — 로컬 미리보기 엔진 결과로 즉시
  재생, 캡션=규칙 explain. 서버 판정 후 확정 리플레이. **prefers-reduced-motion
  시 정적 결과 표시로 대체**(기존 무한 애니메이션 포함 일괄 대응).
- **세션 배선**: SessionRunner→QuestionCard→AtmosphereBoard로 AnswerResult.
  phenomena 전달(서버 계약 불변) — 세션 내 보드도 판정 애니메이션.
- **탐구 모드**: 보드 탭에 "자유 실험" 진입 — 퍼즐 목표 없이 배치·즉시 반응
  (로컬 엔진), 구름 미소모, 채점·로그 없음(순수 클라이언트).
- Tailwind keyframes+인라인 SVG만(외부 라이브러리·에셋 금지), 번들 증가 최소.

### 3.4 브리핑 룸 UI (S4)
- DuelPage 개편: ① 브리핑 화면(차트 3종 — 시간별 기온 라인+TMX/TMN 기준선,
  POP 바+PCP, SKY/PTY 아이콘 타임라인; 보조로 REH/WSD·최근 7일 실측 추이) —
  recharts 기존 관례 답습, 색+텍스트 병기(색약 대응)·축 라벨 필수 ② 근거 선택
  (§3.1 코드 5종, 복수 선택) ③ 예측 입력 ④ 결과 화면에 근거 적중 해설
  (evidence_review) + **"AI 캐스터의 판단" 카드**(base 예보→오차 모델→최종값
  단계 공개 — 주최측 예시 ⑥ 수치예보 입문 충족) + 캐스터 등급 표시.
- KMA 키 부재(briefing 필드 null) 시 "실황 자료 수신 대기" 상태 + 예측 입력은
  그대로 가능(degraded 모드).
- mock 픽스처 동기화(briefing·evidence·caster_grade).

### 3.5 탐구 시뮬 v1 (S5 — 순수 클라이언트, 채점·서버 무관)
- **태풍 시뮬**: 슬라이더(해수면온도 24~32℃·중심기압 —·연직시어 약/중/강) →
  결정적 교육 모델(발생 임계 SST 26.5℃, 강도 = SST·시어의 단조 함수, 카테고리
  TD~슈퍼태풍) → 강도 게이지+발달 곡선 SVG + 개념 설명(왜 그런가). 과학적
  단순화 명시 문구.
- **기후변화 체험**: CO2 농도 슬라이더(280~560ppm) → 온도 아노말리 곡선(로그
  감도 교육 모델)+해수면·폭염일수 파생 지표 → co2_climate 개념 연결.
- 각 시뮬 하단 "관련 퀴즈 풀기" CTA(해당 concept_tag 유닛으로) — θ 루프 연결.
- 모델은 순수 함수 lib(단위 테스트)·문구 자체 제작·라우트 /explore 하위.
- 수치 모델 아님(교육용 결정적 근사) 명시 — R3 폐지 원칙과 충돌 없음.

## 4. 웨이브

- 웨이브 1 (병렬 5): SA-1 `feat/r9-02-briefing-api` · SA-2 `feat/r9-03-adaptive-caster`
  · FE-1 `feat/r9-04-board-v2`(메인 트리) · FE-2 `feat/r9-05-briefing-ui`(워크트리,
  npm install 필요) · FE-3 `feat/r9-06-explore-sims`(워크트리, 동일).
  프론트 파일 소유: FE-1=modules/board·lib/boardEngine 주변·QuestionCard(board
  분기만) / FE-2=modules/duel·league / FE-3=modules/explore(신규)·App 라우트는
  통합에서 조정. mock은 FE-2가 duel 계열만, FE-3는 신규 키만 — 충돌 최소화.
- 웨이브 2: `chore/r9-07-integration` — 병합·회귀·스모크(도커 기동 필요 — 종료
  상태이므로 통합 시 기동 후 재정지)·회고.
- KMA 키: 사용자 발급 대기 — 개발은 mock·폴백으로 진행, 키 도착 시 실통합 검증.

## 5. 리뷰 노트·회고

(웨이브 2 종료 시. 부채 후보: 강수 Brier 채점 전환, duel 지역 선택, history
페이지네이션, 기압 차트용 ASOS 시간자료 API)
