# 제안서 대비 구현 델타 — 근거를 적고 교체한 4건

**작성 2026-08-20 · 대상 4건 · 저장소 내부 문서(제출물 아님)**

## 이 문서가 있는 이유

제안서가 약속한 것 중 **4건**을 우리는 하지 않고 **다른 것으로 교체**했다.
코드 판단으로는 옳고 근거가 저장소에 실재하지만, **심사위원이 보는 문서는 제안서**다.
질의에서 「제안서에 Chroma 3컬렉션이라고 적었는데 컨테이너가 없다」가 나오면
「안 했다」가 아니라 **「이 이유로 이렇게 했다」**를 좌표와 함께 답해야 한다.
이 문서가 그 답이다.

`docs/team/CARRYOVER_R13.md` §5.28(`:6337`)의 제안서 전수 감사가 이 표의 출처이고,
그 감사가 자기 결론으로 적은 문장이 이 문서의 요지다:

> **「없어진 것」과 「교체된 것」을 제안서는 구별하지 못한다.**
> 미충족 7건 중 **4건**이 근거를 적고 교체한 결과다.
> — `docs/team/CARRYOVER_R13.md:6699-6704`

⚠️ **이 4건은 제안서 조항 5행을 동시에 비운다**(§1·§2가 그 5행을 공유한다).
5행의 좌표는 `docs/team/PROPOSAL_REQUIREMENTS.md`의 **78·80·91·97·102행**이다.

## 수치를 다시 세는 법

이 문서의 숫자는 **2026-08-20 실측**이고 다시 낡는다. 세는 명령을 함께 남긴다.
저장소 루트에서 실행한다.

| 수치 | 세는 명령 |
|---|---|
| `climate_concepts.json` 항목·태그 수 | `python3 -c "import json;d=json.load(open('database/seed/climate_concepts.json'));print(len(d), len({i['concept_tag'] for i in d}))"` |
| Celery beat 태스크 수 · 월별 태스크 유무 | `grep -n "crontab(" celery/app/celery_app.py` |
| compose 서비스 수(`chroma` 유무) | `grep -cE "^  [a-z0-9_-]+:" docker-compose.yml` 뒤 `grep -n "chroma" docker-compose*.yml` |
| Chroma·임베딩 의존성 실사용 | `grep -rn -i "chroma" --include=requirements.txt . ; grep -rn "EMBEDDING_API_KEY" backend ai-worker celery` |
| Redis 키 접두 전수 | `grep -rn "setex(" backend/app celery/app \| grep -v __pycache__` |

---

## ① Chroma DB 3컬렉션 → `climate_concepts.json` 직접 조회

**⑴ 제안서가 약속한 것**

> `weather_daily`(매일 갱신), `climate_concepts`(교과 개념, 초기 적재),
> `anomaly_cases`(이상기후 사례 월별 갱신) **3개 컬렉션**
> — `docs/team/PROPOSAL_REQUIREMENTS.md:102`

같은 문서 `:78`이 DB 3종의 ③으로, `:79`가 7컨테이너의 하나로, `:97`이
Context Injection의 주입원으로 Chroma를 각각 적었다.

**⑵ 실제 구현한 것**

RAG 피드백 체인은 **벡터 검색을 하지 않는다.** 호출부가 넘긴 `concept_tag`로
`database/seed/climate_concepts.json`에서 해당 개념 문서를 **직접 조회**해
`[참고 지식 i]` 블록으로 프롬프트에 주입한다.

- 체인 본체 — `ai-worker/app/chains/rag_chain.py:1-6`(단계 3줄), `:81`(`CONCEPTS_FILENAME`), `:169`(시드 로드), `:182`(참고 지식 블록), `:204`(주입)
- 컬렉션 3종의 현재 상태: `weather_daily`는 **철거 기록**(`celery/app/tasks/weather.py:7`)에만 남았고, `anomaly_cases`는 저장소 전체 **0건**, `climate_concepts`는 컬렉션이 아니라 **시드 JSON 파일**이다.
- `chroma` 서비스는 `docker-compose.yml`·`docker-compose.prod.yml` 양쪽에 없다(서비스 8개 / prod 9개). `requirements.txt` 3종에 `chromadb` 의존성 **0건**.

**⑶ 왜 그렇게 했는지**

철거 근거가 코드 자신에 **번호 4개항**으로 적혀 있다(`rag_chain.py:11-33` — 항목 수는 `grep -c '^[0-9]\. \*\*' ai-worker/app/chains/rag_chain.py`로 센다). 성능 튜닝이
아니라 **검색이 성립하지 않는다는 실측**이다. 원문 인용:

> 1. **찾을 것이 이미 확정돼 있었다.** 쿼리의 `concept_tag`는 호출부(`/answer`)가
>    문항에서 그대로 넘겨준 값이다. 어느 문서를 넣을지 아는 상태에서 유사도로
>    그 문서를 다시 찾고 있었다.
> 2. **코퍼스가 한 자릿수 KB다.** … 태그당 2~6항목이라 그 태그 전부를 넣어도
>    top_k=3보다 크지 않다. 색인·근사이웃탐색이 푸는 문제(후보가 너무 많다)가
>    여기엔 없다.
> 3. **임베딩만 세 번째 제공자였다.** 생성은 Gemini인데 검색은 OpenAI
>    `text-embedding-3-small`(`EMBEDDING_API_KEY`)을 요구했다 — 발급 계획에 없는 키다.
> 4. **그래서 무키에서 이미 죽어 있었고, 그 죽는 방식이 나빴다.** 임베딩 실패 →
>    검색 전건 실패 → 컨텍스트 `"(검색된 참고 지식 없음)"`. 그런데 프롬프트 원칙은
>    "제공된 참고 지식에 있는 사실만 사용, 지어내지 말 것"이다. **"사실만 써라,
>    그런데 사실은 없다"**를 모델에게 주는 자기모순이었다.

2번의 코퍼스 크기는 **2026-08-20 실측 41항목 · 14태그**다(위 표의 명령으로 재측).

체인 자신이 적은 결론:

> 교체 후 품질은 내려가지 않고 올라간다 — 검색 실패라는 실패 양식이 소멸하고,
> 항상 정확히 그 개념의 문서가 들어간다.
> — `ai-worker/app/chains/rag_chain.py:31-32`

즉 제안서 `:97`이 약속한 **환각 방지의 실효는 유지되거나 강해진다.**
어긋나는 것은 「방지되는가」가 아니라 **「무엇으로 방지하는가」**다.
문서가 없는 태그일 때는 빈 컨텍스트를 넣지 않고 `SYSTEM_PROMPT_NO_CONTEXT`로
갈아타 위 4번의 자기모순을 되살리지 않는다(`rag_chain.py:100-108`).

**⑷ 좌표**

| 무엇 | 파일:줄 |
|---|---|
| 철거 근거 4개항(원문) | `ai-worker/app/chains/rag_chain.py:11-33` |
| 교체 후 주입 경로 | `ai-worker/app/chains/rag_chain.py:81`·`:169`·`:182`·`:204` |
| 컨텍스트 없을 때 프롬프트 교체 | `ai-worker/app/chains/rag_chain.py:100-108` |
| `weather_daily` 철거 기록 | `celery/app/tasks/weather.py:5-13` |
| 코퍼스 실체(41항목·14태그) | `database/seed/climate_concepts.json` |
| 제안서 원문 | `docs/team/PROPOSAL_REQUIREMENTS.md:78`·`:79`·`:97`·`:102` |
| 전수 감사 행 | `docs/team/CARRYOVER_R13.md:6514`·`:6527`·`:6530` |

---

## ② `text-embedding-3-small` → 임베딩 제공자 자체를 두지 않음

**⑴ 제안서가 약속한 것**

> **text-embedding-3-small**: 기상청 데이터, 교과 개념, 이상기후 사례 텍스트를
> 벡터로 임베딩하여 Chroma DB 적재
> — `docs/team/PROPOSAL_REQUIREMENTS.md:91`

같은 문서 `:80`이 AI 모델 3종의 ③으로 같은 모델을 적었다.

**⑵ 실제 구현한 것**

**임베딩 모델을 쓰지 않는다.** LLM 제공자는 Gemini(`gemini-3.1-flash-lite`)
하나이고, OpenAI 호환 통로는 **생성용 대체 제공자**(gpt-oss·OpenRouter·Ollama)
용도로만 남아 있다 — 임베딩용이 아니다(`ai-worker/app/llm_provider.py:44`·`:82`).

`ai-worker/app/config.py`의 `Settings`에는 임베딩·벡터스토어 설정 필드가 없고,
그 자리에 **삭제 사실이 주석으로 남아 있다**:

> 임베딩·벡터스토어 설정은 R13 3일차에 사라졌다 — 피드백 체인이 검색 대신
> `concept_tag` 직접 조회로 바뀌면서 세 번째 제공자(OpenAI) 키가 불필요해졌다.
> 근거: `docs/specs/03_ai_chains_spec.md` §3.
> — `ai-worker/app/config.py:24-26`

**⑶ 왜 그렇게 했는지**

①의 결과다 — **소비처가 사라진 키다.** 임베딩의 유일한 소비처가 RAG 벡터 검색이었고
그 검색이 철거되면서 이 모델이 하는 일이 0이 됐다. 남겨 두면 얻는 것 없이 비용만 는다:

1. **세 번째 제공자의 키 발급이 필요해진다.** `rag_chain.py:25`가 그 키를
   **「발급 계획에 없는 키」**로 적는다. 생성은 Gemini, 임베딩은 OpenAI —
   무키 상태에서 두 번째 실패 지점을 여는 것이다.
2. **무키에서 이미 죽어 있었다.** ①-⑶ 4번의 실측이 그것이다 — 임베딩 실패가
   검색 전건 실패로 이어져 프롬프트가 자기모순 상태로 나가고 있었다.
3. **죽은 키는 시크릿 스캔 대상만 늘린다.** 대장이 `.env`의 `CHROMA_*`·`EMBEDDING_*`
   잔존을 *"8/20 시크릿 스캔 대상만 늘린다"*로 적고 정리를 배정했다
   (`docs/team/CARRYOVER_R13.md:1323`). 규정상 **API 키 노출은 실격**이라
   쓰지 않는 키를 설정에 남기는 것은 순수한 위험이다.

⚠️ **정직하게 적을 것**: 제안서가 적은 **AI 모델 3종 중 1종이 통째로 빠졌다.**
①처럼 「다른 수단으로 같은 목적을 달성」한 것이 아니라, **①의 결과로 목적 자체가
사라진** 형태다. 이것이 4건 중 유일하게 「교체품이 없는」 항목이다.

**⑷ 좌표**

| 무엇 | 파일:줄 |
|---|---|
| 설정 필드 삭제 기록(원문) | `ai-worker/app/config.py:24-26` |
| 「발급 계획에 없는 키」 | `ai-worker/app/chains/rag_chain.py:24-26` |
| 남아 있는 제공자 통로(생성용) | `ai-worker/app/llm_provider.py:44`·`:82`·`:169-173` |
| 실제 쓰는 모델 | `ai-worker/app/config.py:21-23`(`gemini-3.1-flash-lite`) |
| 죽은 키 정리 배정 | `docs/team/CARRYOVER_R13.md:1323` |
| 제안서 원문 | `docs/team/PROPOSAL_REQUIREMENTS.md:80`·`:91` |
| 전수 감사 행 | `docs/team/CARRYOVER_R13.md:6516`·`:6523` |

---

## ③ 과거관측 API 월별 수집·아카이브 → 다른 엔드포인트로 **요청 시 실호출**

**⑴ 제안서가 약속한 것**

> 과거관측 API: **월별** 관측자료 수집, 이상기후 사례 아카이브를 Chroma DB에
> 임베딩하여 AI 검색(RAG) 활용
> — `docs/team/PROPOSAL_REQUIREMENTS.md:85`

같은 문서 `:60`이 활용 데이터 3종의 ③을 *"과거관측 API(`getAsosDalyInfoList`) —
이상기후 사례 데이터"*로 적었다.

**⑵ 실제 구현한 것**

세 갈래가 각각 다르게 갔다.

**ⓐ 엔드포인트가 교체됐다.** `getAsosDalyInfoList`가 아니라 API허브 typ01
`kma_sfcdd.php`를 부른다 — `backend/app/core/config.py:54`
(`KMA_ASOS_DALY_URL = "https://apihub.kma.go.kr/api/typ01/url/kma_sfcdd.php"`).
같은 파일 `:34`가 *"`KMA_ASOS_DALY_URL`만 계열이 다르다(typ01)"*로 예외를 명시한다.

**ⓑ 월별 배치가 아니라 요청 시 실호출이다.** `celery/app/celery_app.py:37-58`의
beat 스케줄은 **4건**이고 전부 일간·주간이다 — `crontab(hour=2)`(일 수집) ·
`crontab(hour=3, minute=30, day_of_week=1)`(주간 리그 정산) · `crontab(hour=3)`(재학습) ·
`crontab(hour=4)`(일 대결 정산). **월별 태스크 0건.**
과거관측은 호출 시점에 직접 부른다. **구현이 두 벌**이다:

- 백엔드 — `backend/app/services/weather_api.py:737`(`get_past_observation`).
  Redis 1시간 캐시 + 5분 실패 마커를 쓴다(`:762`·`:766`). 소비처는 브리핑
  (`backend/app/routers/duel.py:180-183`).
- Celery — `celery/app/kma_client.py:337`(같은 이름·같은 엔드포인트, **캐시 없음**).
  소비처는 정산(`celery/app/tasks/league.py:90`·`:251`).

**ⓒ 아카이브·임베딩은 없다.** 영속 테이블 0건 · Chroma 없음(①) · 임베딩 없음(②).

**⑶ 왜 그렇게 했는지**

**ⓐ 엔드포인트 교체 — 제안서가 적은 API가 API허브에 없다.**
스펙 문서가 실측으로 그것을 적고, 「폴백이 아니라 교체」라고 못박는다:

> ⚠️ **API허브에는 `AsosDalyInfoService`가 없다.** 그리고 openApi 대체품
> (`SfcMtlyInfoService/getDailyWthrData`)은 **월보(月報)라 당월을 주지 않는다** —
> 어제 날짜로 부르면 `resultCode=99 "발간되지 않은 기간입니다"`다(2026-08-10 실측).
> 우리가 필요한 건 전부 당월이므로(대결 정산=어제, 리그 정산=지난주, 브리핑=최근
> 며칠) 월보는 **쓸 수 없다.** 폴백이 아니라 **교체**인 이유다.
> — `docs/specs/06_kma_api_parsing_spec.md:113-121`

🔴 이 인용이 **「월별 수집」이 사라진 이유까지 같이 설명한다.** 우리 소비처는
전부 **당월·최근 며칠**이 필요한데, 월별 단위를 주는 API는 당월을 주지 않는다.
즉 월별 수집으로는 **우리가 실제로 쓰는 데이터를 못 얻는다.**

**ⓑ 아카이브 임베딩 — 트리거가 애초에 존재하지 않았다.**
수집 태스크 자신이 그 사실을 적어 두었다:

> 여기엔 수집 직후 `POST /internal/embed-weather`로 Chroma `weather_daily` 컬렉션
> 갱신을 트리거하는 블록이 있었다. 셋 다 문제였다:
> 1. **그 엔드포인트는 ai-worker에 존재한 적이 없다.** `main.py`가 선언한 내부 API에
>    `embed-weather`는 없다 — 이 호출은 매일 404를 받고 except로 삼켜졌다.
> 2. **같은 정보가 이미 다른 경로로 들어간다.** 오늘 날씨는 피드백 프롬프트에
>    `today_weather_json`으로 직접 주입된다. 벡터로 한 번 더 넣을 이유가 없었다.
> 3. **소비처가 사라졌다.** 피드백 체인이 벡터 검색을 쓰지 않는다(docs/specs/03 §3).
> — `celery/app/tasks/weather.py:5-14`

같은 주석이 **본체는 남겼다**고 적는다: *"수집·캐시(이 태스크의 본체)는 그대로다 —
브리핑·리그 정산이 Redis 캐시를 읽는다."*(`:18`)
즉 **지운 것은 아무도 받지 않던 404 호출**이지 데이터 수집이 아니다.

⚠️ **정직하게 적을 것**: 「이상기후 사례 아카이브」는 교체품 없이 비어 있다.
3건 중 ⓐ만 근거 있는 교체이고, ⓑⓒ는 **①②의 파급으로 목적이 사라진** 형태다.

**⑷ 좌표**

| 무엇 | 파일:줄 |
|---|---|
| 실제 엔드포인트(typ01) | `backend/app/core/config.py:54` (예외 명시 `:34`) |
| 교체 근거(원문·「폴백이 아니라 교체」) | `docs/specs/06_kma_api_parsing_spec.md:113-121` |
| 실호출 함수(요청 시·1h 캐시) | `backend/app/services/weather_api.py:737`·`:762`·`:766` |
| 같은 함수의 celery 사본(캐시 없음) | `celery/app/kma_client.py:337` |
| 소비처 — 브리핑 · 정산 | `backend/app/routers/duel.py:180-183` · `celery/app/tasks/league.py:90`·`:251` |
| beat 스케줄 4건(월별 0건) | `celery/app/celery_app.py:37-58` |
| 임베딩 트리거 철거 근거(원문) | `celery/app/tasks/weather.py:5-18` |
| 제안서 원문 | `docs/team/PROPOSAL_REQUIREMENTS.md:60`·`:85` |
| 전수 감사 행 | `docs/team/CARRYOVER_R13.md:6500`·`:6519` |

---

## ④ Redis 「일일 문제 캐시 TTL 24h」 → DB `sessions` 행 + `content_items` 영속

**⑴ 제안서가 약속한 것**

> **Redis**: 기상청 API 응답 캐싱(TTL 1시간), 세션 관리(TTL 7일),
> Celery 메시지 브로커, **일일 문제 캐시(TTL 24시간)** 운영
> — `docs/team/PROPOSAL_REQUIREMENTS.md:103`

**⑵ 실제 구현한 것**

Redis 4종 중 **3종은 수치까지 정확히 일치**하고, 4번째만 다른 곳으로 갔다.

| 제안서 | 실제 | 좌표 |
|---|---|---|
| API 캐싱 TTL 1시간 | ✅ 동일 | `backend/app/services/weather_api.py:64`(`60*60`) · `celery/app/config.py:69`(같은 값 사본) · `celery/app/tasks/weather.py:52-54`(`setex`) |
| 세션 관리 TTL 7일 | ✅ 동일 | `backend/app/routers/auth.py:55`(`JWT_REFRESH_EXPIRE_DAYS`) · `:81`(`setex`) · `:97`(슬라이딩 갱신) |
| Celery 브로커 | ✅ 동일 | `celery/app/celery_app.py:16-17`(`broker`·`backend` = `REDIS_URL`) |
| **일일 문제 캐시 24h** | ❌ Redis에 없음 | 아래 |

일일 문제는 **두 곳이 나눠 소유한다**:

- **그날 유저에게 발급된 문제 목록** → DB `sessions` 행 + `quiz_logs` 행.
  `backend/app/services/session_service.py:1752-1774`가 `Session`과 문항별
  `QuizLog`(`question_json` 포함)를 함께 적재한다. 하루 1회 멱등성은 캐시 TTL이
  아니라 **부분 유니크 인덱스**가 보장한다 —
  `backend/app/models/session.py:30-37`(`uq_sessions_daily`,
  `(user_id, session_date, mode)` unique `WHERE unit_id IS NULL`).
- **LLM이 생성한 문항 본체** → `content_items` 테이블에 영속.
  `backend/app/services/session_service.py:1210`(`persist_generated_items`).

Redis 키 접두는 실측 **6종**이고(`weather:` · `weather:fail:` · `asos:` ·
`asos:fail:` · `session:` · `user:`) 문제·퀴즈 계열 키는 **0건**이다.

**⑶ 왜 그렇게 했는지**

**ⓐ 하루짜리 캐시로는 목적을 이룰 수 없다 — 문항이 검수·집계 대상으로 남아야 한다.**
영속화 함수가 자기 근거를 적는다:

> **왜 필요한가**: 지금까지 생성 문항은 `content_item_id=None`으로 버려졌다.
> 그래서 θ·복습 큐·간격반복·문항 통계가 그 문항을 영원히 못 보고, 같은 문항이
> 세션마다·유저마다 다시 생성됐다 — G1 배치(~1,360건) 이후에는 이것이 영구
> 자산이 아니라 상시 트래픽 과금이 된다.
> — `backend/app/services/session_service.py:1225-1229`

TTL 24시간 캐시는 **정확히 이 문제를 고치지 못한다.** 24시간이 지나면 사라지므로
θ 추정·복습 큐·간격반복·문항 통계 — 즉 **적응형 학습의 상태 전부**가 그 문항을
못 본다. 하루 뒤에 다시 생성해야 하니 **비용도 반복된다.**

**ⓑ 그리고 검수 경로에 남아야 한다.** 영속은 시드와 **같은 품질 게이트**를 통과한
것만 받는다 — 사람 저작 시드가 통과하는 것과 같은 결정적 휴리스틱
(`seed_content.validate_entry`)이고, 탈락분은 **일회용 서빙**으로 내려간다
(`session_service.py:1231-1240`·`:1265-1272`). 캐시에는 이런 게이트를 걸 자리가 없다.
승격 정책은 `settings.GENERATED_ITEM_STATUS`(`backend/app/core/config.py:172`,
`'draft'|'active'`)로 한 줄에서 되돌릴 수 있게 뺐다.

**ⓒ 세션 자체는 캐시에 두면 안 되는 데이터다.** 세션 행은 XP·완료 시각·라우팅
결정을 갖고 학습 이력의 일부가 된다(`backend/app/models/session.py:50-59`).
Redis는 이 저장소에서 **인증 SPOF로 이미 지목돼 있다** — `appendonly no`이고
유실 시 게스트 전원 로그아웃이 나는 구성이다(`docs/team/CARRYOVER_R13.md:1322`).
하루치 학습 진도를 그 위에 얹으면 같은 사고에 학습 이력이 함께 사라진다.

**⑷ 좌표**

| 무엇 | 파일:줄 |
|---|---|
| 세션 발급·문항 적재 | `backend/app/services/session_service.py:1752-1774` |
| 하루 1회 멱등(부분 유니크 인덱스) | `backend/app/models/session.py:30-37` |
| 세션 행이 보유하는 학습 상태 | `backend/app/models/session.py:50-59` |
| 생성 문항 영속화 근거(원문) | `backend/app/services/session_service.py:1210-1246` |
| 품질 게이트·탈락 시 일회용 서빙 | `backend/app/services/session_service.py:1231-1240`·`:1265-1272` |
| 승격 정책 스위치 | `backend/app/core/config.py:172` (검증 `:245-251`) |
| 일치하는 Redis 3종 | `weather_api.py:64` · `celery/app/config.py:69` · `routers/auth.py:55`·`:81`·`:97` · `celery/app/celery_app.py:16-17` |
| Redis SPOF 근거 | `docs/team/CARRYOVER_R13.md:1322` |
| 제안서 원문 | `docs/team/PROPOSAL_REQUIREMENTS.md:103` |
| 전수 감사 행 | `docs/team/CARRYOVER_R13.md:6531` |

---

## 확인하지 못해 이 문서에서 뺀 것

🔴 **없는 것을 있다고 쓰지 않기 위해 적는다.**

- `docs/team/CARRYOVER_R13.md:6519`가 ③의 근거로 인용한 **`hindcast_service.py:13-15`
  (「영속 테이블에 넣는 코드가 없다」)는 지금 저장소에 없다.** 그 파일은 커밋
  `83c28da`(*revert(hindcast): 과거 예보(MT-30) 전면 삭제 — 클라이언트 지시 집행*)로
  삭제됐다. **낡은 좌표라 인용하지 않았고**, ③의 근거는 실재를 확인한
  `celery/app/celery_app.py:37-58`(월별 0건) · `weather_api.py:737`(요청 시 실호출)로
  대체했다. 질의에서 대장을 인용할 때 이 줄은 쓰지 말 것.
- **「이상기후 사례 아카이브」의 대체 수단**은 확인하지 못했다. 탐정 케이스가 그
  용도의 소비처라는 서술이 대장에 있으나(`:6500`) 그 케이스의 데이터가 가상인지
  실측인지는 이 작업에서 직접 검증하지 않았다 — ③-⑵ⓒ에 「없다」로만 적었다.
- **제안서 7컨테이너 대 실측 8/9**는 이 문서의 4건 범위 밖이라 다루지 않았다.
  좌표만 남긴다: `docker-compose.yml`(서비스 8) · `docker-compose.prod.yml`(9) ·
  `docs/team/CARRYOVER_R13.md:6515`·`:6532`.
