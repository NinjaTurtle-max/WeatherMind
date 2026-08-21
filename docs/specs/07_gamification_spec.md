# 게이미피케이션 계산 규칙 (진척 모델 · XP · 레벨 · 스트릭 · ELO)

> "XP 획득"만으로는 구현 불가. 실제 숫자 공식을 정의한다.
> R8-01 §3.6 개정: §0 진척 모델 신설, §1 전수 카탈로그화(코드와 1:1),
> §3 스트릭 프리즈 실동작 반영. 코드와 이 문서가 어긋나면 결함이다.

## 0. 진척 모델 — 5축과 소유권

유저의 "진척"은 서로 다른 5축이며, 축마다 소유 테이블·갱신 트리거가 다르다.
홈 최상위 표시는 **스파인(유닛 진도) 1순위 + XP/레벨 병기**(R8-01 제품 결정).

| 축 | 역할 | 소유 테이블(컬럼) | 갱신 트리거 |
|---|---|---|---|
| **스파인 (유닛 트리)** | 학습 진도의 척추 — 커리큘럼 잠금·클리어 | `user_unit_progress`(crowns·cleared_at), `units`(crown_target·prereq) | 유닛 세션 만점 → `grant_unit_crown` +1; R8-01 §3.4 유입로: 보드 퍼즐 최초 클리어·데일리 만점도 조건부 +1. cleared 전환 시 +20 XP 1회 |
| **XP · 레벨** | 보상 표시축 — **소비·게이팅 없음**(순수 표시값) | `users`(xp) — 레벨은 `level_from_xp` 파생(비저장) | §1 카탈로그 11종 원천 |
| **θ (WeatherBrain)** | 개념별 능력 추정(IRT 2PL) — 출제 라우팅·선해제·약점 판정 | `user_concept_ability`(theta·num_responses), `item_params`(a·b) | 가입 시 배치고사 초기화, 세션 경계 재추정(EAP), celery 재학습(JML b 보정). 상세 03 §5 |
| **ELO · 티어** | 예측 리그 경쟁 | `league_results`(elo_rating_after·tier) | celery 주간 정산 `settle_weekly_league` (§5) |
| **구름 에너지** | 시도 게이트(소모 자원) | `users`(clouds·clouds_updated_at) | 시도당 −1, 20분당 +1 회복, 만렙 ~~5~~ → **10** (2026-08-20 실측 정정 — 코드가 참이다. 소유자는 `backend/app/core/config.py`의 `CLOUD_MAX`이고 2026-08-11 멘토링 피드백 MT-7로 5 → 10이 됐는데 이 표만 낡아 있었다. 세는 법 한 줄: `grep -n 'CLOUD_MAX' backend/app/core/config.py`) (`Settings.CLOUD_*`). 소진 시 429 `OUT_OF_CLOUDS`. 스트릭 프리즈(§3)와 별개 자원 |

- XP는 어떤 기능도 잠그지 않는다. 게이트는 구름 에너지(시도)와 스파인(유닛
  잠금)·θ(선해제)가 담당한다.
- 축 간 상호참조를 늘리는 작업(R8-01)은 이 표의 소유권을 바꾸지 않는다 —
  갱신 트리거만 늘어난다.

## 1. XP 획득 규칙 — 전수 카탈로그 (구현과 1:1)

유저 XP(`users.xp`)를 바꾸는 경로 전부. 상수 소유는 `xp_service`(예외: 11번은
`duel_service.DUEL_WIN_XP` 단일 소유).

| # | 행동 | XP | 지급 위치 | 출처 |
|---|---|---|---|---|
| 1 | 퀴즈 정답 | +10 | answer_service | 07 원안 |
| 2 | 퀴즈 오답 (참여만) | +2 | answer_service | 07 원안 |
| 3 | 첫 시도 정답 보너스 | +5 | answer_service | 07 원안 |
| 4 | 일일 출석 | +5 | POST /progress/attendance | 07 원안 |
| 5 | 스트릭 마일스톤(7/30/100일) 달성 — **전부 +50 동일 지급** | +50 | POST /progress/attendance | 07 원안(7일) + R4-01 §3.3(30/100 확장) |
| 6 | 보드 퍼즐 **최초** 클리어 (재도전 0) | +5 | POST /board/puzzles/{id}/attempt | R3-01 §3.5 |
| 7 | 유닛 cleared 전환 (왕관이 crown_target 첫 도달, 재클리어 0) | +20 | curriculum_service.grant_unit_crown | R5-01 §3.2 |
| 8 | 퀘스트 `daily_xp_30` 완료 (오늘 XP ≥ 30) | +10 | quest_service 재계산 | R4-01 §3.1 |
| 9 | 퀘스트 `weak_correct_1` 완료 (약점 정답 1회) | +10 | quest_service 재계산 | R4-01 §3.1 |
| 10 | 퀘스트 `live_answered` 완료 (실황 문항 응답 1회) | +5 | quest_service 재계산 | R4-01 §3.1 |
| 11 | 예보 대결 승리 | +15 | celery `settle_daily_duel` (생 SQL) | R4-01 §3.4 |

**약점 개념 정답 보너스**: `accuracy_rate < 60`인 concept_tag 문제를 맞히면
1·3의 합에 **1.5배** (약점 극복 유도). 독립 원천이 아니라 배율이다.

> 반올림 규정(R2 QA 지적으로 명문화): XP 배수 적용 후 소수는 파이썬 내장 `round()`
> (은행가 반올림) 기준이다. 예: (10+5)×1.5 = 22.5 → **22**.

- **진단(placement) 세션은 XP 미지급**(`grant_xp=False`) — 채점·weak_tags·뱅크
  통계는 그대로, 보상만 뗀다(R7-01).
- **듀얼 승리(11번)만 `xp_service.add_xp`를 거치지 않는다**: celery는 별도 빌드
  컨텍스트라 backend import이 불가능해 생 SQL(`UPDATE users SET xp = xp + :bonus`)
  로 지급한다. 상수 단일 소유는 backend `duel_service.DUEL_WIN_XP`이며, celery
  복제본의 드리프트는 `backend/tests/test_xp_contract.py` 교차 계약 테스트가
  CI 실패로 잡는다 (R8-01 §3.6).
- **`daily_xp_30`의 "오늘 XP" 의미(명문화)**: 이벤트 누적 카운터가 아니라 **당일
  quiz_logs를 `quiz_xp` 공식(첫 시도·기본 배율)으로 재집계한 하한값**이다. 약점
  1.5배 보너스는 유저 XP 잔액에는 반영되지만 퀘스트 임계 집계에는 넣지 않는다
  (약점 스냅샷이 비영속이라 재집계가 멱등이려면 quiz_logs만의 순수 함수여야 함).
  출석·보드·유닛·퀘스트 보상 XP도 이 집계에 포함되지 않는다. 임계 30은 첫 시도
  정답 2문항(15+15)으로 도달 가능.

### 로드맵 (미구현 — 코드에 상수 없음)

| 행동 | XP |
|---|---|
| 기후 탐정 사건 해결 | +30 |
| 기상 리그 예측 정확도 상위 10% | +40 |

> 07 원안에 있었으나 호출부가 0인 死상수(XP_DETECTIVE_SOLVE·XP_LEAGUE_TOP10)로만
> 존재해 R8-01 §3.6에서 코드에서 제거했다. 기능 구현 시 상수와 함께 부활시키고
> 위 본표로 옮긴다.

## 2. 레벨 계산

```python
def level_from_xp(xp: int) -> int:
    # 레벨 N에 필요한 누적 XP = 50 * N^2
    # Lv1: 0~49, Lv2: 50~199, Lv3: 200~449 ...
    import math
    return int(math.sqrt(xp / 50)) + 1

def next_level_xp(current_level: int) -> int:
    return 50 * (current_level ** 2)
```

## 3. 스트릭 계산 (프리즈 "구름 방패" 포함 — 실동작, R2-01 §3.5)

```python
# 출석 시점(POST /progress/attendance) — xp_service.update_streak:
if last_login_date == today:
    pass                             # 이미 출석, 변화 없음
elif last_login_date == yesterday:
    streak_count += 1                # 연속
elif last_login_date == 이틀_전 and streak_freeze_count >= 1:
    streak_freeze_count -= 1         # 프리즈 소모 — 하루 결손 방어, 연속 유지
    streak_count += 1
else:
    streak_count = 1                 # 이틀 이상 결손 — 프리즈 보유와 무관하게 리셋
last_login_date = today
```

- **스트릭 마일스톤 7/30/100일**: 달성 시 배지(`streak_7/30/100`) +
  `XP_STREAK_MILESTONE_BONUS`(+50, 3종 공통 — §1의 5번).
- **프리즈 지급**: 7일 마일스톤 달성 시 +1 (최대 보유 2, 초과분 미지급).
- 프리즈는 구름 에너지(§0)와 별개 자원이다.

## 4. 기상 리그 정확도 점수

```python
def accuracy_score(predicted: dict, actual: dict) -> float:
    # 각 항목 오차를 0~100 점수로 환산 후 평균
    temp_max_err = abs(predicted["temp_max"] - actual["temp_max"])
    temp_score = max(0, 100 - temp_max_err * 10)     # 1도당 -10점
    rain_err = abs(predicted["rain_prob"] - actual["rain_prob"])
    rain_score = max(0, 100 - rain_err)               # 1%당 -1점
    return round((temp_score + rain_score) / 2, 2)
```

## 5. ELO 레이팅 (리그 순위)

```python
def update_elo(rating: int, score: float, expected: float, k: int = 32) -> int:
    # score: 이번 주 정확도(0~1 정규화), expected: 리그 평균 대비 기대값
    return round(rating + k * (score - expected))
# 초기 레이팅 1200. 리그 미참여 주는 변동 없음.
```

---

## 바이브 코딩 지시사항 (원안 기록 — 현행 구현은 §0~§5 본문이 SSOT)

```
backend/app/services/xp_service.py에 level_from_xp, next_level_xp, add_xp,
update_streak 함수를, league 관련은 backend/app/services/league_service.py에
accuracy_score, update_elo를 위 공식 그대로 구현해줘.
add_xp는 약점 개념 1.5배 보너스 로직을 포함하고, weak_tags 테이블도 함께 업데이트해줘.
```

> 주: 실구현에서 약점 1.5배는 `add_xp`가 아니라 채점 경로(`quiz_xp`)에 있다.
