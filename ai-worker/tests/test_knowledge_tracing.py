"""지식 추적(BKT) 테스트 — 모델이 "진짜"임을 합성 복원으로 증명 (계약 C1).

정의(test_weatherbrain_irt.py 관례): 알려진 잠재 숙련도·파라미터로 응답을
합성(synth.py)하고, 적합기(fit_bkt)와 필터(trace_mastery)가 그 값을
knowledge_tracing.py 에 **사전 선언된 임계**(RECOVERY_*) 이상으로 복원하면
통과. 적합은 train 시드, 복원 채점은 별도 시드의 fresh 데이터로 한다
(자기 데이터 암기가 아니라 일반화 검증).

LLM·DB·네트워크 불필요(순수 파이썬). 난수 시드 고정(재현성).
실행: ai-worker 디렉토리에서 `python -m pytest tests -q`.
"""

from __future__ import annotations

import pytest

from app.weatherbrain.knowledge_tracing import (
    DEFAULT_INIT,
    RECOVERY_MASTERY_AUC_MIN,
    RECOVERY_MASTERY_CORR_MIN,
    RECOVERY_NEXT_AUC_MIN,
    RECOVERY_PARAM_TOL,
    BKTParams,
    auc,
    fit_bkt,
    pearson,
    predict_p_correct,
    trace_mastery,
)
from app.weatherbrain.synth import ConceptSpec, generate_dataset

# 복원 검증용 ground truth — 개념별로 성격이 다른 파라미터(초기 숙련 낮음/높음,
# 학습 느림/빠름, 노이즈 소/대)를 섞어 특정 구간에서만 통과하는 우연을 배제한다.
SPECS = {
    "pressure": ConceptSpec(p_init=0.15, p_learn=0.12, p_guess=0.20, p_slip=0.08),
    "typhoon": ConceptSpec(p_init=0.40, p_learn=0.25, p_guess=0.25, p_slip=0.15),
    "humidity": ConceptSpec(p_init=0.10, p_learn=0.30, p_guess=0.15, p_slip=0.10),
}
N_STUDENTS = 200
N_STEPS = 15
TRAIN_SEED = 20260804  # 적합용
EVAL_SEED = 99887766  # 복원 채점용(적합에 안 쓴 fresh 코호트)


class TestSynth:
    def test_같은_시드면_같은_데이터셋(self):
        a = generate_dataset(SPECS, 5, 10, seed=7)
        b = generate_dataset(SPECS, 5, 10, seed=7)
        assert a == b

    def test_다른_시드면_다른_데이터셋(self):
        a = generate_dataset(SPECS, 5, 10, seed=7)
        b = generate_dataset(SPECS, 5, 10, seed=8)
        assert a != b

    def test_숙련은_한번_되면_유지(self):
        # 표준 BKT 가정(망각 없음) — 잠재 궤적이 단조 증가.
        for seq in generate_dataset(SPECS, 30, 12, seed=1):
            for prev, cur in zip(seq.mastered, seq.mastered[1:]):
                assert not (prev and not cur)

    def test_극단_파라미터_생성_정합(self):
        # 전원 초기 숙련 + 노이즈 0 → 전부 숙련·전부 정답.
        spec = {"x": ConceptSpec(p_init=1.0, p_learn=0.0, p_guess=0.0, p_slip=0.0)}
        for seq in generate_dataset(spec, 10, 5, seed=3):
            assert all(seq.mastered) and all(seq.corrects)


class TestTraceMastery:
    def test_길이는_응답수_더하기_1_첫값은_p_init(self):
        params = BKTParams(0.3, 0.2, 0.25, 0.1)
        tr = trace_mastery([True, False, True], params)
        assert len(tr) == 4
        assert tr[0] == pytest.approx(0.3)

    def test_정답이면_상승_오답이면_하락(self):
        # p_learn=0 으로 학습 전이를 끄면 관측 갱신만 남아 방향이 결정된다.
        params = BKTParams(p_init=0.5, p_learn=0.0, p_guess=0.2, p_slip=0.1)
        up = trace_mastery([True], params)
        down = trace_mastery([False], params)
        assert up[1] > 0.5 > down[1]

    def test_predict_p_correct_경계(self):
        params = BKTParams(0.5, 0.1, 0.2, 0.1)
        assert predict_p_correct(0.0, params) == pytest.approx(0.2)  # 미숙련=guess
        assert predict_p_correct(1.0, params) == pytest.approx(0.9)  # 숙련=1-slip


class TestFitBKT:
    def test_빈_입력이면_초기값_그대로(self):
        assert fit_bkt([]) == DEFAULT_INIT
        assert fit_bkt([[]]) == DEFAULT_INIT  # 빈 시퀀스만 있어도 동일

    def test_결정성_같은_입력_같은_출력(self):
        seqs = [s.corrects for s in generate_dataset(SPECS, 30, 10, seed=5)]
        assert fit_bkt(seqs) == fit_bkt(seqs)

    def test_guess_slip은_절반_상한_클램프(self):
        # 라벨 반전 퇴화 방지 — 전부 정답인 병리적 입력에서도 상한을 지킨다.
        fitted = fit_bkt([[True] * 10] * 20)
        assert fitted.p_guess <= 0.5 and fitted.p_slip <= 0.5

    @pytest.mark.parametrize("tag", sorted(SPECS))
    def test_파라미터_복원(self, tag: str):
        """진짜 4개 파라미터를 RECOVERY_PARAM_TOL 이내로 복원한다."""
        train = generate_dataset(SPECS, N_STUDENTS, N_STEPS, seed=TRAIN_SEED)
        fitted = fit_bkt([s.corrects for s in train if s.concept_tag == tag])
        spec = SPECS[tag]
        assert fitted.p_init == pytest.approx(spec.p_init, abs=RECOVERY_PARAM_TOL)
        assert fitted.p_learn == pytest.approx(spec.p_learn, abs=RECOVERY_PARAM_TOL)
        assert fitted.p_guess == pytest.approx(spec.p_guess, abs=RECOVERY_PARAM_TOL)
        assert fitted.p_slip == pytest.approx(spec.p_slip, abs=RECOVERY_PARAM_TOL)


class TestRecoveryPipeline:
    """계약 C1 완료 판정 — 원 숙련도 복원 품질이 사전 선언 임계 이상."""

    @pytest.fixture(scope="class")
    def fitted_by_concept(self) -> dict[str, BKTParams]:
        train = generate_dataset(SPECS, N_STUDENTS, N_STEPS, seed=TRAIN_SEED)
        return {
            tag: fit_bkt([s.corrects for s in train if s.concept_tag == tag])
            for tag in SPECS
        }

    @pytest.fixture(scope="class")
    def eval_dataset(self):
        # 적합에 쓰지 않은 fresh 코호트 — 일반화 복원을 채점한다.
        return generate_dataset(SPECS, N_STUDENTS, N_STEPS, seed=EVAL_SEED)

    @pytest.mark.parametrize("tag", sorted(SPECS))
    def test_숙련도_복원_AUC와_상관(self, tag, fitted_by_concept, eval_dataset):
        """필터한 P(숙련)이 진짜 잠재 상태를 임계 이상으로 판별·상관한다."""
        fitted = fitted_by_concept[tag]
        labels: list[bool] = []
        scores: list[float] = []
        for seq in (s for s in eval_dataset if s.concept_tag == tag):
            tr = trace_mastery(seq.corrects, fitted)
            labels.extend(seq.mastered)
            scores.extend(tr[: len(seq.corrects)])  # 시점 정합: 응답 직전값
        assert auc(labels, scores) >= RECOVERY_MASTERY_AUC_MIN
        corr = pearson(scores, [1.0 if y else 0.0 for y in labels])
        assert corr >= RECOVERY_MASTERY_CORR_MIN

    @pytest.mark.parametrize("tag", sorted(SPECS))
    def test_다음응답_예측_AUC(self, tag, fitted_by_concept, eval_dataset):
        """P(정답) 예측이 실제 정오답을 임계 이상으로 판별한다.

        관측 노이즈(guess/slip) 탓에 이론 상한이 낮은 지표 — 임계도 그에 맞다.
        """
        fitted = fitted_by_concept[tag]
        labels: list[bool] = []
        scores: list[float] = []
        for seq in (s for s in eval_dataset if s.concept_tag == tag):
            tr = trace_mastery(seq.corrects, fitted)
            for t, correct in enumerate(seq.corrects):
                labels.append(correct)
                scores.append(predict_p_correct(tr[t], fitted))
        assert auc(labels, scores) >= RECOVERY_NEXT_AUC_MIN


class TestMetrics:
    def test_auc_완전분리면_1(self):
        assert auc([False, False, True, True], [0.1, 0.2, 0.8, 0.9]) == 1.0

    def test_auc_상수점수면_절반(self):
        assert auc([False, True, True], [0.5, 0.5, 0.5]) == pytest.approx(0.5)

    def test_auc_단일클래스면_절반(self):
        assert auc([True, True], [0.1, 0.9]) == 0.5

    def test_pearson_완전상관과_역상관(self):
        assert pearson([1, 2, 3], [2, 4, 6]) == pytest.approx(1.0)
        assert pearson([1, 2, 3], [3, 2, 1]) == pytest.approx(-1.0)

    def test_pearson_분산0이면_0(self):
        assert pearson([1.0, 1.0], [0.0, 1.0]) == 0.0
