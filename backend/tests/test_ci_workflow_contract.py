"""CI 워크플로 계약 — `test` 잡이 교차 컨텍스트 의존을 빠짐없이 설치하는가.

## 왜 이 테스트가 있는가 (2026-08-03 실측)

이 저장소는 교차 빌드 컨텍스트 중복을 **물리적 병합이 아니라 "단일 소유자 + 계약
테스트"로 해소**한다(CLAUDE.md). 그 계약 테스트는 `sys.modules` 스왑으로 상대 컨텍스트의
모듈을 **실제로 불러** 값을 대조한다:

- `test_xp_contract` → celery `app.tasks.league` (`import celery` 필요)
- `test_kma_contract` → celery `app.core.kma_client`
- `test_gen_payload_contract` → ai-worker `app.chains.payload_contract`

즉 **backend 테스트를 돌리려면 celery·ai-worker 의존이 설치돼 있어야 한다.** 로컬 개발
환경에는 셋 다 깔려 있어 이 사실이 보이지 않는데, CI는 워크플로가 적어 준 것만 설치한다.

워크플로 신설(PR #20)은 `backend`·`ai-worker`만 설치하고 **celery를 빠뜨렸다.** 그래서
`test` 잡이 만들어진 순간부터 계약 7건이 `ModuleNotFoundError: No module named 'celery'`로
죽고 있었고, 같은 잡의 ai-worker 실패에 가려 두 스프린트 동안 원인이 오진됐다.

로컬 `pytest`로는 절대 잡히지 않는 종류다 — 검사 대상이 코드가 아니라 **CI 설정**이다.
그래서 워크플로 파일을 소스로 읽어 대조한다(`test_r10_mock_parity_contract`가 목 소스를
읽는 것과 같은 관례).

DB·네트워크·YAML 파서 불필요. 실행: backend에서 `python -m pytest tests -q`.
"""
import re
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = REPO_ROOT / ".github" / "workflows" / "ci.yml"

# 파이썬 의존을 갖는 빌드 컨텍스트 — 새 컨텍스트가 생기면 여기 목록이 아니라
# 디렉토리 탐색이 알아서 잡는다(목록을 손으로 관리하면 그것부터 드리프트한다).
PY_CONTEXTS = sorted(
    p.parent.name for p in REPO_ROOT.glob("*/requirements.txt") if p.parent.is_dir()
)


@pytest.fixture(scope="module")
def workflow_text() -> str:
    if not WORKFLOW.exists():
        pytest.fail(f"{WORKFLOW}가 없다 — CI 상주화가 사라졌는지 확인")
    return WORKFLOW.read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def test_job(workflow_text: str) -> str:
    """`test:` 잡 블록만 잘라낸다 — 다른 잡의 설치 줄에 속지 않도록."""
    m = re.search(r"\n  test:\n(.*?)(?=\n  [a-z0-9_-]+:\n)", workflow_text, re.S)
    assert m, "워크플로에 `test:` 잡이 없다 — 잡 이름이 바뀌었으면 이 테스트도 고칠 것"
    return m.group(1)


class TestCiTestJobInstallsAllContexts:
    """`test` 잡이 모든 파이썬 컨텍스트의 requirements를 설치해야 한다."""

    def test_컨텍스트_탐색이_비어있지_않다(self):
        """탐색이 0건이면 아래 테스트가 조용히 통과한다 — 그것부터 막는다."""
        assert len(PY_CONTEXTS) >= 3, (
            f"파이썬 컨텍스트 탐색 결과가 {PY_CONTEXTS} — backend·ai-worker·celery가 "
            "모두 잡혀야 한다"
        )

    @pytest.mark.parametrize("context", PY_CONTEXTS)
    def test_requirements를_설치한다(self, context, test_job):
        """빠뜨리면 그 컨텍스트를 실임포트하는 계약 테스트가 CI에서만 죽는다."""
        needle = f"pip install -r {context}/requirements.txt"
        assert needle in test_job, (
            f"CI `test` 잡이 `{needle}`를 실행하지 않는다 — {context} 모듈을 "
            "실임포트하는 계약 테스트가 ModuleNotFoundError로 죽는다"
        )

    @pytest.mark.parametrize("context", PY_CONTEXTS)
    def test_pip_캐시_키에_포함한다(self, context, test_job):
        """캐시 키에서 빠지면 그 파일이 바뀌어도 낡은 캐시가 재사용된다."""
        assert f"{context}/requirements.txt" in test_job, (
            f"cache-dependency-path에 {context}/requirements.txt가 없다"
        )

    def test_pytest를_설치한다(self, test_job):
        assert "pip install pytest" in test_job, "CI가 pytest를 설치하지 않는다"

    def test_ci_sh를_재구현하지_않는다(self, test_job):
        """검사 명령은 `scripts/ci.sh`가 단일 소유자다 — 워크플로가 다시 적으면 드리프트한다."""
        assert "bash scripts/ci.sh test" in test_job, (
            "`test` 잡이 scripts/ci.sh를 호출하지 않는다 — pytest를 직접 실행하면 "
            "ci.sh의 단계 구성과 갈라진다"
        )
        assert "python -m pytest" not in test_job, (
            "워크플로가 pytest를 직접 실행한다 — 실행 방식은 ci.sh 소유다"
        )
