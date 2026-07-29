# WeatherMind 운영 런북 (RUNBOOK)

> 운영 절차의 SSOT. 로컬 실행 요약·아키텍처 표는 README.md, 배포 체크리스트는
> docs/specs/05_env_deploy_spec.md 참조 — 이 문서는 기동 순서·상태 확인·장애
> 대응·롤백만 다룬다. (스프린트 R2-01 S10 산출물, DevOps 소유 · R3~R5 갱신)

## 1. 최초 기동 순서

```bash
# 0. 환경변수 — README "로컬 실행 순서" 1번과 동일 (.env 준비)
#    R5 신규: ENERGY_ENABLED(기본 true, 구름 에너지 온/오프) — .env.example 참조.
# 1. 전체 기동
docker compose up -d --build

# 2. DB 마이그레이션 (0001 초기 → 0007 배치고사까지 순차 head)
docker compose exec backend alembic upgrade head
#    체인: 0001_initial → 0002_session_bank → 0003_question_type_7
#          → 0004_rewards_loop → 0005_curriculum_energy
#          → 0006_weatherbrain → 0007_placement
#    확인: alembic current → 0007_placement (head)

# 3. Chroma 기후 개념 시드 (멱등)
docker compose exec ai-worker python -m app.embeddings.seed_concepts

# 4. 시드 적재 — 모두 멱등 upsert(재실행 안전). 권장 순서: content → units → badges.
#    (units↔content는 concept_tag로 연결되는 논리 관계이며 FK가 아니라 순서를
#     바꿔도 크래시는 없다. badges는 독립. 다만 units 무결성 확인이 쉬우려면 content 먼저.)
docker compose exec backend python -m app.scripts.seed_content   # 문항 뱅크(세션 배합 1차 소스)
docker compose exec backend python -m app.scripts.seed_units     # 커리큘럼 유닛 트리(slug upsert, prereq 2-pass)
docker compose exec backend python -m app.scripts.seed_badges    # 뱃지 정의
#    compose가 ./database/seed 를 backend 컨테이너의 /database/seed(ro)로
#    마운트한다 — 위 스크립트·board 라우터·board_engine의 컨테이너 내 기본 경로
#    (content_items·units·badges·board_rules·board_regions·board_test_vectors 전부
#     같은 디렉토리 마운트로 커버). 문항 뱅크가 비면 세션이 전부 quiz-generate
#     폴백으로 발급되므로(ai-worker 의존↑) content는 반드시 적재.

# 5. 상태 확인 — §2
```

## 2. 상태 확인 (R2~R5 구성 요소 포함)

### 2.1 기본

```bash
curl -s http://localhost:8000/health        # backend
curl -s http://localhost:8001/health        # ai-worker
docker compose exec backend alembic current # → 0005_curriculum_energy (head)
docker compose exec postgres psql -U weathermind -d weathermind \
  -c "SELECT status, count(*) FROM content_items GROUP BY 1;"  # 뱅크 적재 확인
docker compose exec postgres psql -U weathermind -d weathermind \
  -c "SELECT count(*) FROM units;"          # 유닛 시드 적재 확인 (8~12건)
```

### 2.2 세션 API (§3.1)

```bash
TOKEN=$(curl -s -X POST http://localhost:8000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"test@example.com","password":"..."}' | jq -r .access_token)
curl -s http://localhost:8000/api/v1/session/today -H "Authorization: Bearer $TOKEN"
# 기대: session_id + items 5건(source: bank|generated). 재호출 시 동일
# session_id(당일 멱등). 뱅크 0건이어도 발급은 성공해야 한다(S2 AC).
```

### 2.3 품질 게이트 (ai-worker /internal/quiz-validate, §3.4)

```bash
curl -s -X POST http://localhost:8001/internal/quiz-validate \
  -H "X-Internal-API-Key: $AI_WORKER_INTERNAL_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"question":{"question_text":"태풍의 눈에서는 날씨가 어떠한가?","options":["맑고 고요하다","폭우가 내린다","강풍이 분다","우박이 내린다"],"correct_answer":"맑고 고요하다"},"concept_tag":"typhoon","level_group":"adult"}'
# 기대: {"passed": true, "checks": [...]}.
# GEMINI_API_KEY 부재 시 checks에 "llm_skipped" 포함 — 1단 휴리스틱만으로 정상.
```

### 2.4 레이트리밋 (§3.6)

```bash
for i in $(seq 6); do curl -s -o /dev/null -w '%{http_code} ' \
  -X POST http://localhost:8000/api/v1/auth/login \
  -H 'Content-Type: application/json' -d '{"email":"x@x.com","password":"x"}'; done
# 기대: 5회 이후 429 + {"detail": ..., "code": "RATE_LIMITED"}.
# 카운터는 backend 프로세스 메모리 — 컨테이너 재시작으로 리셋된다.
```

### 2.5 Redis weather 캐시

```bash
docker compose exec redis redis-cli --scan --pattern 'weather:*'
# celery-beat의 날씨 수집이 weather:{date}:{region}(TTL 1h)을 채운다.
```

### 2.6 지도 보드 (R5-01 §3.1)

```bash
# 두 라우트 모두 인증 필요 — TOKEN은 §2.2에서 발급.
curl -s http://localhost:8000/api/v1/board/regions -H "Authorization: Bearer $TOKEN"  # 존↔지역 매핑(4건, 렌더 전용)
curl -s http://localhost:8000/api/v1/board/rules -H "Authorization: Bearer $TOKEN"     # board_rules.json 원문(서버 캐시)
# regions는 board_regions.json 부재 시 빈 배열([]) — 판정에 미사용, 라우터는 동작.
# rules 파일 부재 시 board_engine은 폴백 동작(§3.4). 판정 로직은 R3 불변.
```

### 2.7 커리큘럼 · 구름 에너지 (R5-01 §3.2·§3.3)

```bash
# 커리큘럼 트리(섹션·유닛·유저 진도·잠금). TOKEN은 §2.2에서 발급.
curl -s http://localhost:8000/api/v1/curriculum -H "Authorization: Bearer $TOKEN"
# 기대: 첫 유닛 unlocked=true, prereq 미완료 유닛은 locked=true (잠금 체인 생존).

# 구름 에너지 잔량/회복 ETA
curl -s http://localhost:8000/api/v1/progress/energy -H "Authorization: Bearer $TOKEN"
# 기대: {clouds, max:5, next_regen_sec, updated_at}. /progress/me 응답에도 포함.
# ENERGY_ENABLED=false면 소모 없음(무제한) — 이 경우에도 엔드포인트는 200.
```

### 2.8 커리큘럼 품질 게이트 (ai-worker /internal/curriculum-validate, §3.6)

```bash
# units.json 무결성 검증. units·content_items 둘 다 요청 본문으로 전달(디스크
# 미읽음 — 마운트 무관). content_items를 빼면 board 유닛 퍼즐 존재 검사가
# 빈 목록과 대조돼 오탐하므로 반드시 함께 보낸다.
curl -s -X POST http://localhost:8001/internal/curriculum-validate \
  -H "X-Internal-API-Key: $AI_WORKER_INTERNAL_API_KEY" \
  -H 'Content-Type: application/json' \
  -d "{\"units\": $(cat database/seed/units.json), \"content_items\": $(cat database/seed/content_items.json)}"
# 기대: {"passed": true|false, "checks": [...]}. unit_order 유일·prereq 참조 무결성·
# concept_tag 6종·kind enum·board 유닛 퍼즐 존재(content_items 대조) 등을 결정적으로 검사.
```

## 3. 장애 대응

### 3.1 ai-worker 다운

- **증상**: `/api/v1/quiz/today` 503 `AI_WORKER_UNAVAILABLE`. 세션 발급은 아래 폴백.
- **설계된 폴백(§3.2)**: 세션은 뱅크(content_items active)가 5문항을 채우면
  ai-worker 없이도 발급된다. 뱅크 부족분만 quiz-generate 병렬 폴백 —
  일부 실패는 성공분으로 세션을 구성하고(부분 세션 가능, R3 검토 항목),
  **전부** 실패할 때만 503. 즉 시드 적재(§1-4)가 1차 방어선이다.
- **조치**: `docker compose logs --tail 100 ai-worker` → 원인 확인 →
  `docker compose restart ai-worker`. 뱅크 커버리지가 얇으면 시드 재적재.

### 3.2 Redis weather 캐시 공백 (live 문항)

- **설계된 폴백**: backend는 캐시 miss 시 KMA를 직접 호출해 재캐시한다.
  live 문항의 슬롯 치환은 **세션 최초 발급 시점에 확정 저장**되므로(§3.2
  PM 결정 — 채점 일관성) 하루 중 실황 변동·캐시 만료의 영향을 받지 않는다.
  슬롯 값을 끝내 못 구하면 해당 문항은 quiz-generate 폴백으로 대체되어
  미치환 원문(`{today.*}`)이 사용자에게 노출되지 않는다.
- **조치**: `docker compose logs celery-worker | grep weather`로 수집 태스크
  확인, §2.5로 키 존재 확인, KMA 키 유효기간 점검(만료 시 갱신).

### 3.3 레이트리밋 오동작 (전 유저 일괄 429)

- IP 키는 nginx가 전달하는 X-Forwarded-For 1홉을 신뢰한다(웨이브 1 리뷰 2번).
  프록시 계층을 바꾸면 XFF 전달을 유지해야 전역 버킷화가 재발하지 않는다.
- 임시 해제: 카운터가 프로세스 메모리이므로 `docker compose restart backend`.

### 3.4 구름 에너지 · 시드 파일 부재 (R5-01)

- **에너지 비활성 스위치**: 구름 소진(429 `OUT_OF_CLOUDS`)이 데모·장애 시 걸림돌이면
  `.env`에 `ENERGY_ENABLED=false` 후 `docker compose up -d backend`(재생성). false면
  소모 없이 무제한 — 기존 동작으로 복귀한다(레이트리밋과 별개 층). 스트릭 프리즈
  (구름 방패)와는 독립 자원이므로 방패에는 영향 없음.
- **회복 모델**: 크론 불필요. 읽기·소모 시점에 `elapsed=now-clouds_updated_at`으로
  지연 회복 계산(20분당 1개, MAX 5). 회복이 안 보이면 서버 시계(NTP)·`clouds_updated_at`
  값을 의심하되, 별도 워커/스케줄러 점검은 불필요하다.
- **board_rules.json 부재/손상**: board_engine이 폴백 동작(규칙 미적용 안내)하고
  판정을 거부하지 않는다. 규칙 파일을 database/seed에 두거나 `BOARD_RULES_PATH`
  환경변수로 대체 경로를 지정한다(§3.4 계약). 판정 로직 자체는 R3 불변.
- **board_regions.json 부재**: GET /api/v1/board/regions가 빈 배열 반환(렌더 전용,
  판정 미사용) — 지도 라벨만 비고, 보드 판정·채점은 정상. 데이터 저작 후 재배치.
- **units.json 부재/스키마 불일치**: `seed_units`가 파일 부재 시 안내 후 무적재(크래시
  없음). 유닛 slug·prereq(slug) 2-pass 해석이므로 slug 스키마가 아니면 prereq 미해석
  경고가 뜨고 잠금 체인이 소실될 수 있다 → 적재 로그의 "prereq 미해석 N" 수치를 확인,
  0이어야 정상(§3.2, R5 웨이브1 리뷰 확정 결함 이력).

## 4. 롤백 절차

코드가 최신 스키마(sessions·content_items·units·clouds 등)를 참조하므로 **코드
롤백을 먼저**, DB 다운그레이드는 그 후에 한다.

```bash
# 1. 코드 롤백 — 커밋은 웨이브 단위 (예: R2-01 웨이브1 = 675765e)
git revert <커밋 SHA>
docker compose up -d --build

# 2a. R5만 되돌리기 (단일 스텝, 0005 → 0004)
docker compose exec backend alembic downgrade 0004_rewards_loop
# 주의: units·user_unit_progress 테이블 드롭, users.clouds/clouds_updated_at·
# sessions.unit_id 컬럼 제거 — 커리큘럼 진도·구름 잔량이 소실된다.

# 2b. 전체 되돌리기 (0005 → 0001, 초기 스키마까지)
docker compose exec backend alembic downgrade 0001_initial
# 주의: 0002~0005가 만든 모든 것이 소실된다 —
#   0002 content_items·sessions, quiz_logs.session_id/content_item_id,
#        users.streak_freeze_count
#   0003 question_type 7종 확장
#   0004 rewards loop(뱃지·퀘스트·예보 대결 duels 등)
#   0005 units·user_unit_progress·users.clouds·sessions.unit_id
# 세션·뱅크·커리큘럼·게이미피케이션 데이터가 전부 소실된다.
```

## 5. 로컬 CI

커밋 전 `scripts/ci.sh` 실행 — lint(pyflakes) → test(backend·ai-worker pytest)
→ board(board_engine 공유 벡터, node) → config(docker compose config -q)
→ frontend build(선택). 단계별 요약을 출력하고 하나라도 실패하면 비0 종료한다.
단계 단위 실행: `scripts/ci.sh test` / `scripts/ci.sh board`. board 단계는
node_modules 없이 실행되며(순수 스크립트), 프론트/백엔드 board_engine 판정
의미론 일치(database/seed/board_test_vectors.json)를 지킨다.

## 6. DB 왕복 스모크 (scripts/smoke.sh — R7-01 §3.4)

pytest가 SQLite·mock으로 검증하지 못하는 **실 PostgreSQL 경로**(마이그레이션
체인·RLS 정책·θ 왕복·배치고사 온보딩)를 컨테이너 실기동으로 검증한다.

### 6.1 언제 돌리나

- 통합 브랜치(웨이브 병합) 완료 후, PR 올리기 전.
- 마이그레이션·RLS·시드·온보딩 경로를 건드린 변경 후.
- 릴리스 태깅 전 최종 게이트. 일상 커밋에는 `scripts/ci.sh`(스모크 미포함)면 충분.

### 6.2 실행

```bash
bash scripts/smoke.sh            # 전 단계 1~9 (스스로 compose up -d --build)
scripts/ci.sh smoke              # 동일 — CI 관용구로 위임 실행 (opt-in, all 미포함)
scripts/smoke.sh placement       # 특정 단계만: up|migrate|seed|register|theta|
                                 #   rls|roundtrip|fallback|placement
```

단계: 1 up(기동·/health) → 2 migrate(0007 head) → 3 seed(멱등 upsert) →
4 register → 5 theta(사전 θ 시드) → 6 rls(비특권 롤 3종) → 7 roundtrip
(세션 왕복·θ 전이) → 8 fallback(ai-worker 정지 폴백) → 9 placement
(배치고사 왕복 — 6문항·구름 미소모·초기 θ 배정·409·progress 노출).

### 6.3 운영 수칙

- **멱등**: 스모크 유저는 매 실행 고유 이메일, 시드는 upsert, RLS 롤은
  IF NOT EXISTS. 재실행 안전 — 실패 시 그냥 다시 돌린다.
- **비파괴**: 스크립트에 볼륨 파괴 명령(`down -v` 등)은 없다. 수동 정리 시에도
  `down -v`는 금지 절차(§4 롤백의 데이터 소실 경고와 동일 급).
- register 계열 단계는 5회/분 레이트리밋(§2.4)에 걸릴 수 있다 — 연속 재실행이
  429로 실패하면 1분 뒤 재시도.
- 8단계가 중간에 끊기면 ai-worker가 정지 상태로 남을 수 있다 —
  `docker compose start ai-worker`로 복구(스크립트는 검증 실패와 무관하게
  재기동을 시도한다).
- .env 값(자격증명·키)은 스크립트가 절대 출력하지 않는다 — 로그 공유 안전.
