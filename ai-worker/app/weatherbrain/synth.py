"""WeatherBrain 합성 학생 생성기 — 지식 추적(BKT) 복원 검증용 데이터.

복원 검증의 정의(irt.py·test_weatherbrain_irt.py 관례): **알려진 잠재 상태**
(개념별 진짜 숙련 여부)로 응답 시퀀스를 합성하고, 모델이 그 상태·파라미터를
사전 선언한 임계 이상으로 복원하면 그 모델은 스텁이 아니라 실제로 동작하는
지식 추적기다. 이 모듈은 그 "알려진 잠재 상태" 쪽 — 정답 시퀀스와 함께 각
시점의 진짜 숙련 상태(ground truth)를 그대로 반환한다.

생성 모형 — BKT(Bayesian Knowledge Tracing) 생성 과정 그대로:
  1) 학생×개념마다 초기 숙련 여부 ~ Bernoulli(p_init).
  2) 매 응답: 숙련이면 정답확률 1-p_slip, 미숙련이면 p_guess.
  3) 응답 직후 미숙련 상태는 확률 p_learn 로 숙련으로 전이(한번 숙련되면 유지
     — 망각 없음, 표준 BKT 가정).

한계(정직 고지): knowledge_tracing.fit_bkt 가 같은 생성 과정을 가정하므로 이
검증은 "모형이 옳을 때 추정이 그것을 복원하는가"(내적 정합)를 증명할 뿐,
실제 학습자가 BKT를 따르는지는 증명하지 않는다 — 후자는 실 응답 데이터가
쌓인 뒤의 교차검증 과제다. irt.py의 2PL 합성 복원 검증과 같은 수준의 계약.

무상태·무의존 원칙: 순수 파이썬, random.Random(seed) 로 재현성 고정.
"""

from __future__ import annotations

import random
from dataclasses import dataclass


@dataclass(frozen=True)
class ConceptSpec:
    """개념 하나의 진짜 BKT 파라미터 — 합성의 ground truth.

    p_init: 첫 응답 이전에 이미 숙련일 확률 (L0).
    p_learn: 응답 1회마다 미숙련→숙련 전이 확률 (T).
    p_guess: 미숙련인데 정답일 확률 (G).
    p_slip: 숙련인데 오답일 확률 (S).
    """

    p_init: float
    p_learn: float
    p_guess: float
    p_slip: float


@dataclass(frozen=True)
class SynthSequence:
    """학생 1명 × 개념 1개의 합성 결과.

    corrects: 응답 시퀀스(정오답). mastered: 각 응답 **직전**의 진짜 숙련 상태 —
    corrects 와 같은 길이라 시점별 복원 품질(AUC/상관)을 직접 채점할 수 있다.
    """

    student_id: str
    concept_tag: str
    corrects: tuple[bool, ...]
    mastered: tuple[bool, ...]


def generate_sequence(
    spec: ConceptSpec, n_steps: int, rng: random.Random
) -> tuple[tuple[bool, ...], tuple[bool, ...]]:
    """학생 1명의 응답 시퀀스와 잠재 숙련 궤적을 BKT 생성 과정으로 합성한다.

    Returns:
        (corrects, mastered) — 각각 길이 n_steps. mastered[t]는 t번째 응답
        직전의 진짜 상태(응답 후 전이는 t+1에 반영).
    """
    corrects: list[bool] = []
    mastered: list[bool] = []
    m = rng.random() < spec.p_init
    for _ in range(n_steps):
        mastered.append(m)
        p_correct = (1.0 - spec.p_slip) if m else spec.p_guess
        corrects.append(rng.random() < p_correct)
        if not m:
            m = rng.random() < spec.p_learn
    return tuple(corrects), tuple(mastered)


def generate_dataset(
    specs: dict[str, ConceptSpec],
    n_students: int,
    n_steps: int,
    seed: int,
) -> list[SynthSequence]:
    """개념별 진짜 파라미터로 학생 코호트의 응답 데이터셋을 합성한다.

    Args:
        specs: {concept_tag: ConceptSpec} — 개념별 ground truth 파라미터.
        n_students: 학생 수(모든 학생이 모든 개념을 n_steps회 연습).
        n_steps: 개념당 응답 수.
        seed: 난수 시드 — 같은 인자면 항상 같은 데이터셋(재현성 계약).

    Returns:
        SynthSequence 리스트 (학생×개념, 개념 태그 정렬 순회로 순서도 결정적).
    """
    rng = random.Random(seed)
    out: list[SynthSequence] = []
    for s in range(n_students):
        student_id = f"synth-{s}"
        for tag in sorted(specs):
            corrects, mastered = generate_sequence(specs[tag], n_steps, rng)
            out.append(
                SynthSequence(
                    student_id=student_id,
                    concept_tag=tag,
                    corrects=corrects,
                    mastered=mastered,
                )
            )
    return out
