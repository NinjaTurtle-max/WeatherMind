# 게이미피케이션 계산 규칙 (XP · 레벨 · 스트릭 · ELO)

> "XP 획득"만으로는 구현 불가. 실제 숫자 공식을 정의한다.

## 1. XP 획득 규칙

| 행동 | XP |
|---|---|
| 퀴즈 정답 | +10 |
| 퀴즈 오답 (참여만) | +2 |
| 첫 시도 정답 (한 번에 맞춤) | +5 보너스 |
| 일일 출석 | +5 |
| 스트릭 7일 달성 | +50 보너스 |
| 기후 탐정 사건 해결 | +30 |
| 기상 리그 예측 정확도 상위 10% | +40 |

**약점 개념 정답 보너스**: `accuracy_rate < 60`인 concept_tag 문제를 맞히면 XP 1.5배 (약점 극복 유도)

> 반올림 규정(R2 QA 지적으로 명문화): XP 배수 적용 후 소수는 파이썬 내장 `round()`
> (은행가 반올림) 기준이다. 예: (10+5)×1.5 = 22.5 → **22**.

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

## 3. 스트릭 계산

```python
# 출석 시점(POST /progress/attendance):
if last_login_date == today:
    pass  # 이미 출석, 변화 없음
elif last_login_date == yesterday:
    streak_count += 1  # 연속
else:
    streak_count = 1   # 끊김, 리셋
last_login_date = today
```

스트릭 마일스톤: 7일/30일/100일 달성 시 배지 + 보너스 XP.

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

## 바이브 코딩 지시사항

```
backend/app/services/xp_service.py에 level_from_xp, next_level_xp, add_xp,
update_streak 함수를, league 관련은 backend/app/services/league_service.py에
accuracy_score, update_elo를 위 공식 그대로 구현해줘.
add_xp는 약점 개념 1.5배 보너스 로직을 포함하고, weak_tags 테이블도 함께 업데이트해줘.
```
