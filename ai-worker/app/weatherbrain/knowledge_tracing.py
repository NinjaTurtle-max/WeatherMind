"""WeatherBrain 지식 추적 — BKT(Bayesian Knowledge Tracing) 순수 파이썬 구현.

irt.py 가 정적 능력(θ)을 추정한다면, 이 모듈은 **연습에 따른 동적 숙련 전이**를
추적한다: 개념(concept_tag)별로 응답 시퀀스를 2상태 은닉 마르코프(미숙련/숙련)로
모델링하고, 매 응답 후 P(숙련)을 갱신한다. θ와는 다른 축이므로 irt.py 를 대체하지
않는다(IRT 콜드스타트 유지 — 마일스톤 4 명시 조건).

모델 선택 근거 — BKT vs 대안 (계약 C1은 선택을 AI-L 재량으로 둔다):
- 신경망 DKT(LSTM류): torch 등 신규 의존이 필수라 배제 — irt.py 가 세운
  "의존성 없는 순수 파이썬" 관례와 계약 C1의 신규 의존 금지에 저촉.
- logistic-DKT/PFA류: 시퀀스를 (시도수, 정답수) 카운트로 요약해 잠재 상태가
  없다 — 이번 계약의 완료 판정인 "원 숙련도 복원"을 직접 검증할 수 없다.
- BKT: 개념당 파라미터 4개(p_init·p_learn·p_guess·p_slip)로 해석 가능하고,
  잠재 숙련 상태가 명시적이라 합성 ground truth 대비 복원을 직접 채점할 수
  있으며, EM(Baum-Welch) 적합이 행렬 라이브러리 없이 수치 안정하게 구현된다.

한계(정직 고지):
- 표준 BKT 가정: 망각 없음(숙련→미숙련 전이 0), 개념 간 독립, 문항 난이도
  무시(난이도는 IRT 축이 담당). 다차원 상호작용은 로드맵으로 분리.
- p_guess/p_slip 은 0.5 상한으로 클램프한다(라벨 반전 퇴화 방지 — 표준 관행).
- EM 은 국소 최적이라 초기값에 의존한다. 기본 초기값(중립)과 시드 고정 합성
  데이터에서의 복원이 tests/test_knowledge_tracing.py 로 검증된 범위가 보증
  구간이다.

복원 품질 임계 — **사전 선언**(계약 C1: 테스트가 이 값 이상을 요구하고, 미달
시 임계를 낮추는 게 아니라 미달 사실을 보고한다):
- RECOVERY_PARAM_TOL: 합성 데이터(학생 200×15응답)에서 4개 파라미터 절대오차.
- RECOVERY_MASTERY_AUC_MIN / RECOVERY_MASTERY_CORR_MIN: 적합 파라미터로 필터한
  P(숙련)이 진짜 잠재 상태를 판별하는 AUC / 점이연 상관(피어슨).
- RECOVERY_NEXT_AUC_MIN: 다음 응답 정오답 예측 AUC — 관측 노이즈(guess/slip)
  때문에 이론 상한이 낮은 지표라 임계도 낮다.

검증 — tests/test_knowledge_tracing.py 가 synth.py 합성 데이터로 파라미터·
숙련 상태 복원이 위 임계를 넘음을 확인한다(irt.py 와 같은 "진짜임의 정의").
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Sequence

# ── 복원 품질 임계 (사전 선언 — 계약 테스트가 참조) ─────────────────────────
# 근거: 합성 3개념(학생 200×15응답, 시드 고정) 실측이 파라미터 오차 ≤0.017 ·
# 숙련 AUC ≥0.928 · 상관 ≥0.657 · 다음응답 AUC ≥0.696 — 임계는 그보다 낮되
# 무의미하게 느슨하지 않게 잡았다. 미달이 관측되면 임계를 낮추지 말고 보고한다.
RECOVERY_PARAM_TOL = 0.05
RECOVERY_MASTERY_AUC_MIN = 0.85
RECOVERY_MASTERY_CORR_MIN = 0.55
RECOVERY_NEXT_AUC_MIN = 0.65

# 확률 클램프 — 0/1 퇴화와 log(0) 방지. guess/slip 은 0.5 상한(라벨 반전 방지).
_P_LO = 1e-3
_P_HI = 1.0 - 1e-3
_GS_HI = 0.5


@dataclass(frozen=True)
class BKTParams:
    """BKT 파라미터 — synth.ConceptSpec 과 같은 의미(추정치 쪽 표현).

    p_init: 첫 응답 이전 숙련 확률. p_learn: 응답당 미숙련→숙련 전이 확률.
    p_guess: 미숙련 정답 확률. p_slip: 숙련 오답 확률.
    """

    p_init: float
    p_learn: float
    p_guess: float
    p_slip: float


# EM 기본 초기값 — 중립(정보 없음). 재현성을 위해 상수로 고정한다.
DEFAULT_INIT = BKTParams(p_init=0.3, p_learn=0.2, p_guess=0.25, p_slip=0.15)


def predict_p_correct(p_mastery: float, params: BKTParams) -> float:
    """현재 P(숙련)에서 다음 응답이 정답일 확률.

    P(정답) = P(숙련)·(1-slip) + P(미숙련)·guess.
    """
    return p_mastery * (1.0 - params.p_slip) + (1.0 - p_mastery) * params.p_guess


def trace_mastery(corrects: Sequence[bool], params: BKTParams) -> list[float]:
    """응답 시퀀스를 순서대로 필터링해 P(숙련) 궤적을 반환한다.

    Returns:
        길이 len(corrects)+1 — [t]는 t번째 응답 **직전**의 P(숙련)
        (synth.SynthSequence.mastered[t] 와 시점 정합), 마지막 원소는 전체
        이력 반영 후의 현재값(서빙 시 "지금 이 개념의 숙련 확률").

    갱신 = 베이즈 사후(관측 반영) → 학습 전이:
        정답: post = p(1-S) / (p(1-S) + (1-p)G)
        오답: post = pS / (pS + (1-p)(1-G))
        다음: p' = post + (1-post)·T
    분모는 파라미터 클램프(_P_LO) 덕에 0이 되지 않는다.
    """
    p = params.p_init
    out = [p]
    for correct in corrects:
        if correct:
            num = p * (1.0 - params.p_slip)
            den = num + (1.0 - p) * params.p_guess
        else:
            num = p * params.p_slip
            den = num + (1.0 - p) * (1.0 - params.p_guess)
        post = num / den
        p = post + (1.0 - post) * params.p_learn
        out.append(p)
    return out


def _clamp(params: BKTParams) -> BKTParams:
    """파라미터를 유효 구간으로 클램프 — guess/slip 은 0.5 상한(퇴화 방지)."""
    return BKTParams(
        p_init=min(_P_HI, max(_P_LO, params.p_init)),
        p_learn=min(_P_HI, max(_P_LO, params.p_learn)),
        p_guess=min(_GS_HI, max(_P_LO, params.p_guess)),
        p_slip=min(_GS_HI, max(_P_LO, params.p_slip)),
    )


def _forward_backward(
    corrects: Sequence[bool], params: BKTParams
) -> tuple[list[tuple[float, float]], list[float], float, float, float]:
    """단일 시퀀스의 E-step — 스케일드 forward-backward.

    상태 0=미숙련, 1=숙련. 전이 A=[[1-T, T], [0, 1]](망각 없음), 방출
    e0(y)=G/1-G, e1(y)=1-S/S.

    Returns:
        (gammas, xis01, xi00_sum, ll, gamma0_first) —
        gammas[t]=(γ_t(0), γ_t(1)) 시점별 상태 사후,
        xis01[t]=ξ_t(0→1) 전이 사후(t=0..n-2), xi00_sum=Σξ_t(0→0),
        ll=시퀀스 로그우도, gamma0_first=γ_0(1)(p_init 갱신용).
    """
    n = len(corrects)
    g, s, t = params.p_guess, params.p_slip, params.p_learn

    def emit(y: bool) -> tuple[float, float]:
        return (g if y else 1.0 - g), ((1.0 - s) if y else s)

    # forward (스케일링 c_t 저장 — 언더플로 방지, Σc 로그가 우도)
    alphas: list[tuple[float, float]] = []
    scales: list[float] = []
    e0, e1 = emit(corrects[0])
    a0 = (1.0 - params.p_init) * e0
    a1 = params.p_init * e1
    c = a0 + a1
    alphas.append((a0 / c, a1 / c))
    scales.append(c)
    for k in range(1, n):
        e0, e1 = emit(corrects[k])
        pa0, pa1 = alphas[-1]
        a0 = pa0 * (1.0 - t) * e0
        a1 = (pa0 * t + pa1) * e1
        c = a0 + a1
        alphas.append((a0 / c, a1 / c))
        scales.append(c)

    # backward (같은 스케일로 나눠 γ=α̂·β̂ 가 자동 정규화)
    betas: list[tuple[float, float]] = [(0.0, 0.0)] * n
    betas[n - 1] = (1.0, 1.0)
    for k in range(n - 2, -1, -1):
        e0, e1 = emit(corrects[k + 1])
        nb0, nb1 = betas[k + 1]
        b0 = ((1.0 - t) * e0 * nb0 + t * e1 * nb1) / scales[k + 1]
        b1 = (e1 * nb1) / scales[k + 1]
        betas[k] = (b0, b1)

    gammas = [(a[0] * b[0], a[1] * b[1]) for a, b in zip(alphas, betas)]
    xis01: list[float] = []
    xi00_sum = 0.0
    for k in range(n - 1):
        e0, e1 = emit(corrects[k + 1])
        a0, _ = alphas[k]
        b0n, b1n = betas[k + 1]
        xis01.append(a0 * t * e1 * b1n / scales[k + 1])
        xi00_sum += a0 * (1.0 - t) * e0 * b0n / scales[k + 1]

    ll = sum(math.log(c) for c in scales)
    return gammas, xis01, xi00_sum, ll, gammas[0][1]


def fit_bkt(
    sequences: list[Sequence[bool]],
    iterations: int = 100,
    init: BKTParams = DEFAULT_INIT,
    tol: float = 1e-6,
) -> BKTParams:
    """개념 하나의 응답 시퀀스들로 BKT 파라미터를 EM(Baum-Welch)으로 적합한다.

    Args:
        sequences: 학생별 정오답 시퀀스 리스트(빈 시퀀스는 무시). 비어 있으면
                   init 을 그대로 반환한다(휴면-정확 — calibrate_items 관례).
        iterations: EM 최대 반복.
        init: 초기 파라미터(기본 DEFAULT_INIT — 결정적 재현성).
        tol: 로그우도 개선이 이 미만이면 조기 종료.

    Returns:
        적합된 BKTParams. EM 은 난수 없이 결정적이다 — 같은 입력이면 같은 출력.

    M-step(닫힌형):
        p_init  = mean_seq γ_0(1)
        p_learn = Σ ξ(0→1) / Σ (ξ(0→0)+ξ(0→1))
        p_guess = Σ_t γ_t(0)·[정답] / Σ_t γ_t(0)
        p_slip  = Σ_t γ_t(1)·[오답] / Σ_t γ_t(1)
    """
    seqs = [s for s in sequences if len(s) > 0]
    if not seqs:
        return init

    params = _clamp(init)
    prev_ll = -math.inf
    for _ in range(iterations):
        sum_g0_first = 0.0
        sum_xi01 = 0.0
        sum_xi00 = 0.0
        sum_g0 = sum_g0_correct = 0.0
        sum_g1 = sum_g1_wrong = 0.0
        total_ll = 0.0
        for seq in seqs:
            gammas, xis01, xi00, ll, g1_first = _forward_backward(seq, params)
            total_ll += ll
            sum_g0_first += g1_first
            sum_xi01 += sum(xis01)
            sum_xi00 += xi00
            for (g0, g1), y in zip(gammas, seq):
                sum_g0 += g0
                sum_g1 += g1
                if y:
                    sum_g0_correct += g0
                else:
                    sum_g1_wrong += g1

        denom_t = sum_xi00 + sum_xi01
        params = _clamp(
            BKTParams(
                p_init=sum_g0_first / len(seqs),
                p_learn=(sum_xi01 / denom_t) if denom_t > 0 else params.p_learn,
                p_guess=(sum_g0_correct / sum_g0) if sum_g0 > 0 else params.p_guess,
                p_slip=(sum_g1_wrong / sum_g1) if sum_g1 > 0 else params.p_slip,
            )
        )
        if total_ll - prev_ll < tol:
            break
        prev_ll = total_ll

    return params


# ── 복원 품질 지표 (순수 파이썬 — 검증 파이프라인용) ─────────────────────────


def auc(labels: Sequence[bool], scores: Sequence[float]) -> float:
    """ROC AUC — Mann-Whitney U 의 순위 기반 계산(동점은 평균 순위).

    labels 가 한 클래스뿐이면 판별이 정의되지 않으므로 0.5 를 반환한다.
    """
    n_pos = sum(1 for y in labels if y)
    n_neg = len(labels) - n_pos
    if n_pos == 0 or n_neg == 0:
        return 0.5

    order = sorted(range(len(scores)), key=lambda i: scores[i])
    ranks = [0.0] * len(scores)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and scores[order[j + 1]] == scores[order[i]]:
            j += 1
        avg_rank = (i + j) / 2.0 + 1.0  # 1-기반 평균 순위
        for k in range(i, j + 1):
            ranks[order[k]] = avg_rank
        i = j + 1

    rank_sum_pos = sum(r for r, y in zip(ranks, labels) if y)
    u = rank_sum_pos - n_pos * (n_pos + 1) / 2.0
    return u / (n_pos * n_neg)


def pearson(xs: Sequence[float], ys: Sequence[float]) -> float:
    """피어슨 상관 — y 가 이진(진짜 숙련 상태)이면 점이연 상관과 동치.

    한쪽 분산이 0이면 상관이 정의되지 않으므로 0.0 을 반환한다.
    """
    n = len(xs)
    mx = sum(xs) / n
    my = sum(ys) / n
    cov = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    vx = sum((x - mx) ** 2 for x in xs)
    vy = sum((y - my) ** 2 for y in ys)
    if vx <= 0.0 or vy <= 0.0:
        return 0.0
    return cov / math.sqrt(vx * vy)
