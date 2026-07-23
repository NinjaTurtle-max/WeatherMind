"""WeatherBrain IRT 코어 — 문항반응이론 기반 능력(θ) 추정 · 문항난이도(b) 보정.

의존성 없는 **순수 파이썬**(numpy/scipy 불필요). 격자 기반 EAP(Expected A Posteriori)로
희소 응답에서도 수치적으로 안정하게 θ를 추정한다. 03_ai_chains_spec.md §0·§5의
"IRT 파라미터(문항 난이도 b, 학습자 능력 θ)" 설계를 실제 구현한 것.

모델 — 2모수 로지스틱(2PL):
    P(정답 | θ, a, b) = 1 / (1 + exp(-a·(θ - b)))
  a(변별도)=1 로 두면 1모수 라쉬(Rasch) 모형과 동치다. 콜드스타트 초기엔 a=1 고정,
  데이터가 쌓이면 calibrate_items가 문항난이도 b를 재추정한다(변별도 a는 v1에서 고정 —
  희소 데이터에서 a 동시추정은 불안정하므로 로드맵으로 분리).

스케일 — θ·b 모두 로짓 스케일(표준정규 사전분포 기준). θ > b 이면 정답확률 > 0.5.
검증 — tests/test_weatherbrain_irt.py 가 알려진 θ·b로 응답을 합성하고 추정기가 그
       값을 표준오차 이내로 복원함을 확인한다(모델이 "진짜"임을 증명하는 정의).
"""

from __future__ import annotations

import math
from dataclasses import dataclass

# ── 능력(θ) 적분 격자 ─────────────────────────────────────────────────────
# EAP는 사후분포의 기대값을 격자 이산합으로 근사한다. [-4, 4]는 표준정규 사전분포의
# 사실상 전 질량(±4σ)을 포괄하며, 81점(간격 0.1)이면 교육 평가 정밀도(θ 0.01 수준)에
# 충분하다. 모듈 로드 시 1회만 생성한다.
_GRID_LO = -4.0
_GRID_HI = 4.0
_GRID_N = 81
THETA_GRID: tuple[float, ...] = tuple(
    _GRID_LO + (_GRID_HI - _GRID_LO) * i / (_GRID_N - 1) for i in range(_GRID_N)
)

# irf 수치 하한/상한 — log(0) 방지(응답 다수 누적 시 우도 언더플로 회피와 별개로,
# 개별 확률이 정확히 0/1이 되지 않도록 클램프).
_EPS = 1e-9


def irf(theta: float, b: float, a: float = 1.0) -> float:
    """2PL 문항반응함수 — 능력 θ인 학습자가 (a, b) 문항을 맞힐 확률.

    P = 1 / (1 + exp(-a·(θ - b))). 오버플로 방지를 위해 지수 인자를 클램프하고,
    결과를 [_EPS, 1-_EPS]로 제한해 이후 log 계산의 안정성을 보장한다.
    """
    z = a * (theta - b)
    # exp 오버/언더플로 가드: z가 극단이면 확률은 사실상 0 또는 1.
    if z >= 0:
        p = 1.0 / (1.0 + math.exp(-min(z, 700.0)))
    else:
        e = math.exp(max(z, -700.0))
        p = e / (1.0 + e)
    return min(1.0 - _EPS, max(_EPS, p))


def _log_normal_pdf(x: float, mean: float, sd: float) -> float:
    """정규 로그밀도 — 사후 격자 가중의 사전(prior) 항."""
    var = sd * sd
    return -0.5 * math.log(2.0 * math.pi * var) - (x - mean) ** 2 / (2.0 * var)


@dataclass(frozen=True)
class EstimatedAbility:
    """EAP 추정 결과.

    theta: 사후평균(능력 점 추정치). se: 사후표준편차(불확실성 — 응답이 적을수록 큼).
    n: 추정에 사용된 응답 수(0이면 theta·se는 사전분포 그대로).
    """

    theta: float
    se: float
    n: int


def estimate_ability(
    responses: list[tuple[float, float, bool]],
    prior_mean: float = 0.0,
    prior_sd: float = 1.0,
) -> EstimatedAbility:
    """EAP로 능력 θ를 추정한다.

    Args:
        responses: [(b, a, correct), ...] — 문항난이도 b, 변별도 a, 정오답 bool.
                   응답이 없으면(콜드스타트) 사전분포를 그대로 반환한다.
        prior_mean, prior_sd: θ 사전분포(정규). level_group으로 결정(priors.py).

    Returns:
        EstimatedAbility(theta=사후평균, se=사후표준편차, n=응답수).

    로그공간에서 사후 가중을 계산하고 최댓값을 빼(exp 언더플로 회피) 정규화한다.
    응답 수가 많아도 수치적으로 안정하다.
    """
    if not responses:
        return EstimatedAbility(theta=prior_mean, se=prior_sd, n=0)

    log_w: list[float] = []
    for theta in THETA_GRID:
        lp = _log_normal_pdf(theta, prior_mean, prior_sd)
        for b, a, correct in responses:
            p = irf(theta, b, a)
            lp += math.log(p) if correct else math.log(1.0 - p)
        log_w.append(lp)

    m = max(log_w)
    weights = [math.exp(lw - m) for lw in log_w]
    total = sum(weights)

    theta_hat = sum(t * w for t, w in zip(THETA_GRID, weights)) / total
    var = sum((t - theta_hat) ** 2 * w for t, w in zip(THETA_GRID, weights)) / total
    return EstimatedAbility(theta=theta_hat, se=math.sqrt(var), n=len(responses))


def _estimate_b(
    outcomes: list[tuple[float, bool]],
    grid_lo: float = _GRID_LO,
    grid_hi: float = _GRID_HI,
    a: float = 1.0,
) -> float:
    """단일 문항 난이도 b의 최대우도 추정(1D 격자 탐색).

    outcomes: 이 문항을 푼 학습자들의 [(theta, correct), ...]. θ는 고정(현재 추정치).
    b가 클수록 어려워 정답확률이 낮아진다. 우도가 최대인 b를 반환한다.
    """
    grid = [grid_lo + (grid_hi - grid_lo) * i / (_GRID_N - 1) for i in range(_GRID_N)]
    best_b, best_ll = grid[0], -math.inf
    for b in grid:
        ll = 0.0
        for theta, correct in outcomes:
            p = irf(theta, b, a)
            ll += math.log(p) if correct else math.log(1.0 - p)
        if ll > best_ll:
            best_ll, best_b = ll, b
    return best_b


def calibrate_items(
    responses: list[tuple[str, str, bool]],
    iterations: int = 20,
    prior_sd: float = 1.0,
) -> dict[str, float]:
    """누적 응답에서 문항난이도 b를 결합추정(JML)한다 — 재학습(celery)이 호출.

    Args:
        responses: [(user_id, item_id, correct), ...] 전역 응답 로그.
        iterations: θ↔b 교대추정 반복 횟수.
        prior_sd: θ EAP의 사전 표준편차(스케일 고정).

    Returns:
        {item_id: b} — 보정된 문항난이도.

    결합최대우도(Joint MLE): θ(사람)와 b(문항)를 번갈아 추정한다.
      1) b 고정 → 각 사람 θ를 EAP로 추정.
      2) θ 고정 → 각 문항 b를 최대우도(_estimate_b)로 추정.
      3) 스케일 불확정성 해소 — b 평균을 0으로 센터링(사전분포 평균과 정렬).
    데이터가 없거나(신규 서비스) 응답이 희소하면 사전값 근방에 머문다(휴면-정확).
    tests가 합성 데이터로 b 복원을 검증한다.
    """
    if not responses:
        return {}

    users = sorted({r[0] for r in responses})
    items = sorted({r[1] for r in responses})
    by_user: dict[str, list[tuple[str, bool]]] = {u: [] for u in users}
    by_item: dict[str, list[tuple[str, bool]]] = {i: [] for i in items}
    for user_id, item_id, correct in responses:
        by_user[user_id].append((item_id, correct))
        by_item[item_id].append((user_id, correct))

    theta: dict[str, float] = {u: 0.0 for u in users}
    b: dict[str, float] = {i: 0.0 for i in items}

    for _ in range(iterations):
        # 1) b 고정 → θ 추정
        for user_id in users:
            resp = [(b[item_id], 1.0, correct) for item_id, correct in by_user[user_id]]
            theta[user_id] = estimate_ability(resp, 0.0, prior_sd).theta
        # 2) θ 고정 → b 추정
        for item_id in items:
            outcomes = [(theta[u], correct) for u, correct in by_item[item_id]]
            b[item_id] = _estimate_b(outcomes)
        # 3) 스케일 센터링(b 평균 0)
        mean_b = sum(b.values()) / len(b)
        for item_id in items:
            b[item_id] -= mean_b

    return b
