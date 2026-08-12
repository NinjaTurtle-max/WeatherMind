"""G1 배치 인프라 계약 — MT-2 (2026-08-11 멘토링 피드백).

**왜 이것이 비용 문제인가.** API 키는 발급됐고 비용 때문에 의도적으로 미투입인
상태다(G0·G1·G2 게이트). 배치를 켜는 순간 손실 상한을 정하는 것이 이 절이다.
셋이 없으면 **비용만 쓰고 결과가 없다**:

⑴ 429·타임아웃에 물러섰다 다시 시도하지 않으면, 한 번 걸린 콜이 그냥 버려진다
⑵ 연속 실패에 멈추지 않으면 죽은 키로 남은 계획을 끝까지 태운다
⑶ 중단 지점을 기억하지 않으면 재실행이 **처음부터** 다시 과금한다

⚠️ 재시도해도 소용없는 실패(스키마 위반 등)를 재시도하면 비용만 늘어난다.
그래서 "물러설 실패"와 "그냥 실패"를 가르는 판정이 이 계약의 중심이다.
"""
import importlib.util
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
SCRIPT = REPO / "scripts" / "author_items.py"


@pytest.fixture(scope="module")
def author():
    """스크립트를 모듈로 적재한다 — CLI 왕복 없이 순수 함수를 직접 본다."""
    spec = importlib.util.spec_from_file_location("wm_author_items", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    sys.modules["wm_author_items"] = module
    spec.loader.exec_module(module)
    return module


class TestRetryClassification:
    """무엇에 물러설 것인가 — 잘못 가르면 비용이 늘거나 콜이 버려진다."""

    @pytest.mark.parametrize(
        "message",
        [
            "429 Too Many Requests",
            "Rate limit exceeded for model",
            "RESOURCE_HAS_BEEN_EXHAUSTED: quota",
            "Deadline Exceeded",
            "503 Service Unavailable",
            "The model is overloaded. Please try again",
            "Request timed out",
        ],
    )
    def test_일시적_실패는_다시_시도한다(self, author, message):
        assert author.is_retryable(RuntimeError(message)) is True

    @pytest.mark.parametrize(
        "message",
        [
            "QuizQuestion validation failed: options must have 4 entries",
            "concept_tag 'volcano' is not in the allowed set",
            "JSONDecodeError: Expecting value line 1",
        ],
    )
    def test_항구적_실패는_그냥_실패다(self, author, message):
        """몇 번을 불러도 같은 결과다 — 재시도는 비용만 늘린다."""
        assert author.is_retryable(ValueError(message)) is False

    def test_타입이_아니라_문구로_본다(self, author):
        """공급자마다 예외 타입이 다르다(google.api_core / openai / httpx).

        타입으로 잡으면 프로바이더를 바꾸는 순간 조용히 안 걸린다 — 우리 통로는
        프로바이더 교체가 전제라(CO-B7) 문구 판정이 그 설계와 맞는다.
        """

        class WeirdVendorError(Exception):
            pass

        assert author.is_retryable(WeirdVendorError("429 quota")) is True


class TestBackoff:
    def test_성공하면_한_번만_부른다(self, author):
        calls = []
        author.call_with_backoff(lambda: calls.append(1) or "ok", sleep=lambda _: None)
        assert len(calls) == 1

    def test_일시_실패_뒤_성공하면_결과를_돌려준다(self, author):
        calls = []

        def flaky():
            calls.append(1)
            if len(calls) < 3:
                raise RuntimeError("429 rate limit")
            return "ok"

        assert author.call_with_backoff(flaky, sleep=lambda _: None) == "ok"
        assert len(calls) == 3

    def test_대기가_지수로_늘어난다(self, author):
        """선형이면 한도 회복을 못 기다린다 — 같은 초에 몰려 429가 반복된다."""
        waits = []

        def always_429():
            raise RuntimeError("429")

        with pytest.raises(RuntimeError):
            author.call_with_backoff(always_429, attempts=4, sleep=waits.append)
        assert waits == sorted(waits) and len(set(waits)) == len(waits), waits
        assert waits[-1] >= waits[0] * 2, f"지수적으로 안 늘어난다: {waits}"

    def test_항구적_실패는_즉시_올린다(self, author):
        """재시도하면 안 되는 것에 물러서면 실패 하나가 4배 비용이 된다."""
        waits = []

        def bad_schema():
            raise ValueError("validation failed")

        with pytest.raises(ValueError):
            author.call_with_backoff(bad_schema, sleep=waits.append)
        assert waits == [], "항구적 실패에 대기했다"


class TestProgressFile:
    def test_기록한_것을_다시_읽는다(self, author, tmp_path):
        path = tmp_path / "progress.txt"
        author.record_progress(path, "0:air_mass:elementary")
        author.record_progress(path, "1:anomaly:adult")
        assert author.load_progress(path) == {"0:air_mass:elementary", "1:anomaly:adult"}

    def test_파일이_없으면_처음부터다(self, author, tmp_path):
        assert author.load_progress(tmp_path / "없다.txt") == set()
        assert author.load_progress(None) == set()

    def test_항목마다_즉시_쓴다(self, author, tmp_path):
        """배치가 중간에 죽는 것을 전제한 설계다 — 끝에 몰아 쓰면 전부 잃는다."""
        path = tmp_path / "progress.txt"
        author.record_progress(path, "0:a:b")
        assert path.read_text(encoding="utf-8").strip() == "0:a:b"  # 아직 배치 중인데 이미 있다

    def test_같은_태그_밴드가_여러_번_나와도_구분된다(self, author):
        """계획은 (태그·밴드)를 반복해서 담는다 — 키에 순번이 없으면 뭉개진다."""
        first = author.plan_key("air_mass", "adult", 0)
        second = author.plan_key("air_mass", "adult", 7)
        assert first != second


class TestCircuitBreaker:
    def test_임계가_재시도_횟수보다_크다(self, author):
        """한 항목의 재시도를 연속 실패로 오인하면 정상 배치가 조기 중단된다."""
        assert author.CIRCUIT_BREAK_AFTER > author.RETRY_ATTEMPTS

    def test_포기해도_만든_것은_잃지_않는다(self, author):
        """`aborted_remaining`은 보고용이고 `items`는 그대로 반환된다.

        중단이 곧 손실이면 사람이 배치를 못 멈춘다 — 멈출 수 있어야 상한이 뜻이 있다.
        """
        result = author.BatchResult()
        result.items.append({"concept_tag": "air_mass"})
        result.aborted_remaining = 40
        assert result.items, "포기 시 산출물이 버려지면 안 된다"
        assert result.aborted_remaining == 40
