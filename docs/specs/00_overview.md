# WeatherMind 스펙 개요 및 개발 우선순위

> 이 폴더(docs/specs/)의 문서 5개는 Claude Code 같은 AI 코딩 도구에 순서대로 입력해서
> 바이브 코딩을 진행하기 위한 상세 스펙이다. 사람이 매번 설계를 다시 설명할 필요 없이
> 이 문서를 참조시키면 일관된 구현이 나온다.

## 문서 목록

| 파일 | 내용 |
|---|---|
| 01_database_schema.md | PostgreSQL 5테이블 + Redis 키 규칙 (벡터 저장소는 R13에 철거) |
| 02_api_spec.md | FastAPI 4개 라우터 엔드포인트 전체 |
| 03_ai_chains_spec.md | LangChain 3체인 실제 프롬프트 텍스트 |
| 04_frontend_modules_spec.md | React 4개 모듈 상태머신·컴포넌트 구조 |
| 05_env_deploy_spec.md | 환경변수, docker-compose, 배포 체크리스트 |
| 06_kma_api_parsing_spec.md | **기상청 API 응답 구조·격자좌표·카테고리 코드 파싱** |
| 07_gamification_spec.md | **XP·레벨·스트릭·ELO 실제 계산 공식** |
| 08_auth_rls_spec.md | **JWT → PostgreSQL RLS 주입 실제 코드 흐름** |
| 09_seed_data_spec.md | **피드백 체인이 직접 읽는 교과 개념 시드 데이터** |
| 10_versions_run_guide.md | **패키지 버전 고정 + 로컬 실행 순서 + 트러블슈팅** |

---

## 개발 우선순위 (7주 현실 반영 — 지난 리스크 진단 반영)

**절대 원칙: MVP는 4개 모듈 중 "오늘의 퀴즈"만 완성도 있게, 나머지 3개는 축소 버전으로.**

### Phase 1 (~7.22, 교육 기간) — 기반 구축
```
1. docker-compose.yml + 전체 컨테이너 기동 확인 (05번 문서)
2. PostgreSQL 스키마 + Alembic 마이그레이션 (01번 문서)
3. 기상청 API 연동 테스트 (실제 키 발급, 응답 파싱 확인)
4. FastAPI 기본 골격 + /health (05번 문서)
```

### Phase 2 (7.23~8.7, 중간점검 목표) — 핵심 루프 완성
```
1. Auth API + JWT (02번 문서 섹션 1)
2. Quiz API + Quiz Gen Chain (02, 03번 문서) — 실제 Gemini 연동
3. 오늘의 퀴즈 프론트 화면 (04번 문서 섹션 1)
4. 피드백 Chain 최소 버전 (climate_concepts 직접 조회 — 벡터 검색 없음)

→ 이 시점 목표: "퀴즈 풀고 AI 피드백 받기"가 실제로 URL에서 작동
```

### Phase 3 (8.8~8.20) — 나머지 모듈 (축소 버전 허용)
```
우선순위 순서:
1. Router Chain (순수 로직, LLM 호출 없음 — 구현 부담 적음)
2. 기후 시뮬레이터 (AI 체인 불필요, 클라이언트 계산만 — 가장 빠르게 완성 가능)
3. 기상 리그 (백엔드 로직 단순, 배치 처리만)
4. 기후 탐정 (가장 복잡 — 시간 남으면 진행, 안 되면 3개 모듈로 발표)
```

### Phase 4 (8.21~22, 본선) — 배포 및 시연
```
05번 문서 배포 체크리스트 그대로 실행
```

---

## 콜드스타트 문제 명시적 대응 (지난 리스크 진단 반영)

WeatherBrain의 IRT Fine-tuning은 **실제 사용자 데이터가 필요**하므로 대회 기간엔 학습 불가능.
→ **개발계획서와 발표에서 다음과 같이 명시적으로 설명할 것**:
```
"WeatherBrain은 현재 콜드스타트 단계로, weak_tags 테이블의 단순 정답률 기반
Router Chain이 우선 동작합니다. 사용자 데이터가 누적되면 IRT 모델 재학습으로
자동 전환되는 구조이며, 이는 로드맵 2단계입니다."
```
이 설명 자체가 03번 문서 섹션 5에 이미 반영되어 있음.

---

## 각 스펙 문서 사용법

Claude Code 세션 시작 시:
```
1. docs/specs/00_overview.md 를 먼저 읽게 해서 전체 우선순위 인지시키기
2. Phase 1부터 순서대로 "01_database_schema.md 참고해서 backend/app/models/ 구현해줘" 식으로 요청
3. 각 문서 하단의 "바이브 코딩 지시사항" 문장을 거의 그대로 복붙해서 사용 가능
```
