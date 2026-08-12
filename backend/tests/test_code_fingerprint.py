"""코드 지문 계약 — 세 벌이 같은 값을 내야 쓸모가 있다 (CO-Y-13).

지문은 **실행 중인 이미지와 워크트리를 대조**하기 위한 것이다. 컨테이너 안에서
계산한 값과 밖에서 계산한 값이 다르면 대조 자체가 성립하지 않으므로,
알고리즘이 갈리는 순간 이 기능은 조용히 죽는다.

⚠️ 세 벌인 이유: backend·ai-worker가 **빌드 컨텍스트를 공유하지 않아** 물리적으로
합칠 수 없다. 저장소 관례대로 단일 소유자(`scripts/code_fingerprint.py`)를 두고
**계약 테스트로** 묶는다(`test_ci_workflow_contract`·`test_prompt_spec_parity`와
같은 형태 — 파이썬 밖 파일을 파싱해 대조하는 선례가 이미 있다).
"""
import hashlib
import importlib.util
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]


def _load(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def owner():
    """알고리즘 소유자 — 나머지는 이것과 같아야 한다."""
    return _load(REPO / "scripts" / "code_fingerprint.py", "wm_fp_owner")


def test_backend_구현이_소유자와_같다(owner):
    from app.core.fingerprint import code_fingerprint

    assert code_fingerprint() == owner.fingerprint(REPO / "backend" / "app")


def test_ai_worker_구현이_소유자와_같다(owner):
    """ai-worker는 별도 빌드 컨텍스트라 임포트하지 않고 **파일로** 실행해 비교한다.

    ⚠️ backend와 ai-worker가 최상위 패키지명 `app`을 공유하므로, 여기서 그냥
    `import app.fingerprint`를 하면 **backend의 `app`을 뒤진다.**
    """
    module = _load(REPO / "ai-worker" / "app" / "fingerprint.py", "wm_fp_aiworker")
    assert module.code_fingerprint() == owner.fingerprint(REPO / "ai-worker" / "app")


class TestAlgorithm:
    def test_내용이_바뀌면_지문도_바뀐다(self, owner, tmp_path):
        (tmp_path / "a.py").write_text("x = 1", encoding="utf-8")
        before = owner.fingerprint(tmp_path)
        (tmp_path / "a.py").write_text("x = 2", encoding="utf-8")
        assert owner.fingerprint(tmp_path) != before

    def test_파일이_이동해도_지문이_바뀐다(self, owner, tmp_path):
        """내용 해시만 먹이면 **이름만 바뀐 이동**을 못 잡는다 — 경로도 함께 먹인다."""
        (tmp_path / "a.py").write_text("x = 1", encoding="utf-8")
        before = owner.fingerprint(tmp_path)
        (tmp_path / "a.py").rename(tmp_path / "b.py")
        assert owner.fingerprint(tmp_path) != before

    def test_pycache는_세지_않는다(self, owner, tmp_path):
        """빌드 산물을 세면 **같은 소스가 컨테이너 안팎에서 다른 값**을 내 못 쓴다."""
        (tmp_path / "a.py").write_text("x = 1", encoding="utf-8")
        before = owner.fingerprint(tmp_path)
        cache = tmp_path / "__pycache__"
        cache.mkdir()
        (cache / "a.cpython-313.py").write_text("junk", encoding="utf-8")
        assert owner.fingerprint(tmp_path) == before

    def test_순회_순서에_흔들리지_않는다(self, owner, tmp_path):
        """정렬을 빼면 파일시스템마다 값이 달라진다 — 대조가 성립하지 않는다."""
        for name in ("z.py", "a.py", "m.py"):
            (tmp_path / name).write_text("x = 1", encoding="utf-8")
        expected = hashlib.sha256()
        for name in ("a.py", "m.py", "z.py"):
            expected.update(name.encode())
            expected.update(b"x = 1")
        assert owner.fingerprint(tmp_path) == expected.hexdigest()[:12]


def test_health이_지문을_싣는다():
    """대조 창구가 실제로 열려 있는가 — 이게 없으면 지문을 만들어도 못 본다."""
    from app.main import app

    routes = {r.path for r in app.routes}
    assert "/health" in routes
    from app.core.fingerprint import code_fingerprint

    assert len(code_fingerprint()) == 12
