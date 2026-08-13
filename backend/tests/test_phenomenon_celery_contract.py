"""현상 판정의 backend↔celery 교차 컨텍스트 계약 — SPRINT_R13_02 §T3 ⑴.

§T3의 완료 판정이 「순수 함수 · **backend↔celery 계약 테스트**」다. 두 디렉토리는
서로 다른 빌드 컨텍스트라 import로 묶을 수 없고, CLAUDE.md 「기타 학습된 선호」가
그런 중복을 **단일 소유자 + 계약 테스트**로 해소하라고 정해 놓았다
(`test_kma_contract`·`test_xp_contract`·`test_league_tier`가 선례).

## 지금 상태를 정확히 적는다

celery에는 이 판정을 부르는 태스크가 **없다**. 그래서 이 파일이 감시하는 것은
"두 벌이 드리프트하지 않는가"(복제가 있을 때의 형태)가 아니라 **"celery가 이걸
쓸 수 있는 상태인가"**다. 그 성질이 세 계약으로 갈린다:

1. **순수성** — `weather_phenomenon`이 `app.*`를 import하지 않는다. AST로 확인한다.
   (`sys.modules`에 무엇이 있나로 단정하지 않는다 — CLAUDE.md가 명시적으로 금지하고,
   실제로 그 패턴이 PR #21·#22의 CI 실패를 냈다.)
2. **단독 로드 가능** — backend `app` 패키지가 sys.modules에서 빠진 상태에서 파일을
   경로로 직접 로드해도 임포트되고, **같은 입력에 같은 판정**을 낸다. 순수성이
   깨지면(예: `from app.core.config import settings` 한 줄) 여기서 ImportError로 죽는다.
3. **입력 모양 일치** — 판정이 읽는 카테고리가 backend `weather_api.KMA_CATEGORY`와
   celery `kma_client.KMA_CATEGORY`의 **교집합** 안에 있다. 한쪽에만 있는 키를
   읽으면 celery가 만든 예보 dict에서 그 신호가 통째로 비어 판정이 갈린다.
   덤으로, celery `parse_kma_value`가 만든 값으로 조립한 예보와 backend
   `group_forecast_items`가 만든 예보가 **같은 판정**을 내는지도 실제로 돌려 본다.

두 디렉토리가 최상위 패키지명 `app`을 공유하므로 celery 모듈은 sys.modules를 스왑해
임포트한다(`test_kma_contract._import_celery_kma_client`와 동일 패턴).

DB·네트워크 불필요. 실행: backend에서
`python -m pytest tests/test_phenomenon_celery_contract.py -q`.
"""
import ast
import importlib
import importlib.util
import sys
from pathlib import Path

import pytest

from app.services import weather_api
from app.services import weather_phenomenon as wp

REPO_ROOT = Path(__file__).resolve().parents[2]
CELERY_DIR = REPO_ROOT / "celery"
MODULE_PATH = Path(wp.__file__).resolve()

# 판정을 가르는 입력 배터리 — 사다리 전 단계를 최소 1회씩 지난다.
BATTERY = [
    {},
    {"region": "서울", "forecasts": []},
    {"region": "서울", "forecasts": [{"datetime": "1", "PTY": 3.0, "POP": 80.0}]},
    {"region": "서울", "forecasts": [
        {"datetime": "1", "REH": 92.0, "WSD": 9.0, "POP": 90.0, "TMP": 22.0},
    ]},
    {"region": "서울", "forecasts": [
        {"datetime": "1", "REH": 25.0, "WSD": 9.0, "POP": 0.0, "TMP": 18.0, "SKY": 1.0},
    ]},
    {"region": "서울", "forecasts": [
        {"datetime": "1", "TMX": 34.0, "POP": 10.0, "SKY": 1.0},
    ]},
    {"region": "서울", "forecasts": [
        {"datetime": str(i), "PTY": 1.0, "POP": 90.0, "TMP": 22.0} for i in range(6)
    ]},
    {"region": "서울", "forecasts": [
        {"datetime": "1", "REH": 95.0, "POP": 10.0, "SKY": 4.0, "TMP": 15.0},
    ]},
    {"region": "서울", "forecasts": [
        {"datetime": "1", "SKY": 3.0, "POP": 20.0, "REH": 65.0, "TMP": 24.0},
    ]},
]


def _import_celery_kma_client():
    """celery kma_client를 backend `app` 패키지와 충돌 없이 임포트한다.

    (`test_kma_contract._import_celery_kma_client`와 동일 패턴 — 두 디렉토리가
    최상위 패키지명 `app`을 공유.)
    """
    saved = {k: m for k, m in sys.modules.items() if k == "app" or k.startswith("app.")}
    for key in saved:
        del sys.modules[key]
    sys.path.insert(0, str(CELERY_DIR))
    try:
        module = importlib.import_module("app.kma_client")
    finally:
        sys.path.remove(str(CELERY_DIR))
        for key in [k for k in sys.modules if k == "app" or k.startswith("app.")]:
            del sys.modules[key]
        sys.modules.update(saved)
    return module


class _BlockBackendApp:
    """import 시스템에서 backend `app` 패키지를 **없는 것으로** 만든다.

    sys.modules에서 빼는 것만으로는 부족하다 — backend 루트가 sys.path에 남아
    있어서(conftest가 넣는다) `import app.core.config`가 그냥 다시 성공한다.
    실제로 그 구멍 때문에 이 테스트가 순수성 위반을 못 잡았다(2026-08-12, 되돌리기
    검증 M5에서 발견). meta_path 앞단에서 막으면 sys.path와 무관하게 재현된다 —
    celery 컨텍스트에는 backend `app`이 **정말로 없기** 때문에 그쪽이 실상에 가깝다.
    """

    def find_spec(self, fullname, path=None, target=None):
        if fullname == "app" or fullname.startswith("app."):
            raise ImportError(
                f"backend `app`은 celery 컨텍스트에 없다: {fullname} — "
                "weather_phenomenon이 backend 내부에 의존하고 있다"
            )
        return None


def _load_standalone():
    """backend `app`이 **없는** 상태에서 파일을 경로로 직접 로드한다 (= celery 컨텍스트).

    모듈이 `app.*`에 손을 대면 여기서 ImportError로 죽는다 — 그것이 이 함수가
    검사하는 것이고, 그때 celery는 이 파일을 그대로 쓸 수 없다는 뜻이다.
    """
    saved = {k: m for k, m in sys.modules.items() if k == "app" or k.startswith("app.")}
    for key in saved:
        del sys.modules[key]
    blocker = _BlockBackendApp()
    sys.meta_path.insert(0, blocker)
    try:
        spec = importlib.util.spec_from_file_location(
            "weather_phenomenon_standalone", MODULE_PATH
        )
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
    finally:
        sys.meta_path.remove(blocker)
        for key in [k for k in sys.modules if k == "app" or k.startswith("app.")]:
            del sys.modules[key]
        sys.modules.update(saved)
    return module


# ═══════════════════════════════════════════════════════════════
# 계약 1 — 순수성 (AST)
# ═══════════════════════════════════════════════════════════════


class TestPureModule:
    @pytest.fixture(scope="class")
    def imported(self):
        tree = ast.parse(MODULE_PATH.read_text(encoding="utf-8"))
        names = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                names.update(alias.name for alias in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module:
                names.add(node.module)
        return names

    def test_app_패키지를_import하지_않는다(self, imported):
        leaked = {n for n in imported if n == "app" or n.startswith("app.")}
        assert not leaked, (
            f"weather_phenomenon이 backend 내부를 import한다: {leaked} — "
            "celery는 별도 빌드 컨텍스트라 이 파일을 그대로 못 쓰게 된다"
        )

    def test_표준_라이브러리만_쓴다(self, imported):
        allowed = {"collections", "typing"}
        assert imported <= allowed, (
            f"허용 밖 import {imported - allowed} — 의존이 붙으면 "
            "celery가 이 판정을 쓰려면 그 의존도 함께 가져가야 한다"
        )

    def test_시계와_난수를_쓰지_않는다(self):
        """결정성 계약 — 판정이 호출 시각·난수에 흔들리면 같은 날 두 번 발급한 "
        세션이 다른 보드를 낸다."""
        source = MODULE_PATH.read_text(encoding="utf-8")
        tree = ast.parse(source)
        called = {
            node.func.attr
            for node in ast.walk(tree)
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
        }
        assert not ({"now", "today", "random", "shuffle", "choice"} & called)

    def test_파일을_읽지_않는다(self):
        """어휘 복제의 대가로 얻은 순수성 — 여기서 시드를 읽으면 celery가 시드 경로까지 져야 한다."""
        source = MODULE_PATH.read_text(encoding="utf-8")
        tree = ast.parse(source)
        names = {
            node.func.id
            for node in ast.walk(tree)
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
        }
        assert "open" not in names


# ═══════════════════════════════════════════════════════════════
# 계약 2 — celery 컨텍스트 단독 로드 + 판정 일치
# ═══════════════════════════════════════════════════════════════


class TestStandaloneLoad:
    def test_backend_없이_로드된다(self):
        module = _load_standalone()
        assert tuple(module.PHENOMENA) == tuple(wp.PHENOMENA)

    def test_판정이_backend와_전건_일치(self):
        module = _load_standalone()
        mine = [wp.classify_phenomenon(w) for w in BATTERY]
        theirs = [module.classify_phenomenon(w) for w in BATTERY]
        assert mine == theirs, (
            "같은 파일인데 컨텍스트에 따라 판정이 갈린다 — 모듈 수준에 "
            "환경 의존 상태가 생겼다는 뜻"
        )

    def test_보드_매칭도_전건_일치(self):
        module = _load_standalone()
        items = [
            {"template_json": {
                "goal_conditions": [{"phenomenon": p}], "board_order": i,
            }}
            for i, p in enumerate(wp.PHENOMENA)
        ]
        for phenomenon in (*wp.PHENOMENA, None):
            assert (
                wp.order_boards_for_today(items, phenomenon)
                == module.order_boards_for_today(items, phenomenon)
            )


# ═══════════════════════════════════════════════════════════════
# 계약 3 — 입력 모양(예보 dict)이 양쪽에서 같다
# ═══════════════════════════════════════════════════════════════


class TestForecastShape:
    @pytest.fixture(scope="class")
    def celery_kma(self):
        return _import_celery_kma_client()

    def test_읽는_카테고리가_양쪽_KMA_CATEGORY_교집합_안이다(self, celery_kma):
        shared = set(weather_api.KMA_CATEGORY) & set(celery_kma.KMA_CATEGORY)
        assert set(wp.READ_CATEGORIES) <= shared, (
            f"판정이 읽는 카테고리 {set(wp.READ_CATEGORIES) - shared}가 한쪽에만 "
            "있다 — celery가 만든 예보에서는 그 신호가 통째로 빈다"
        )

    def test_요약이_읽는_키가_READ_CATEGORIES와_일치(self):
        """상수만 고치고 코드를 안 고치는(또는 그 반대) 드리프트를 막는다."""
        tree = ast.parse(MODULE_PATH.read_text(encoding="utf-8"))
        literals = {
            node.value
            for node in ast.walk(tree)
            if isinstance(node, ast.Constant) and isinstance(node.value, str)
        }
        used = {c for c in weather_api.KMA_CATEGORY if c in literals}
        assert used == set(wp.READ_CATEGORIES)

    def test_양쪽_파서가_만든_예보가_같은_판정을_낸다(self, celery_kma):
        """celery parse_kma_value로 조립한 예보 ↔ backend group_forecast_items."""
        items = [
            {"fcstDate": "20260812", "fcstTime": "0900",
             "category": "TMP", "fcstValue": "29"},
            {"fcstDate": "20260812", "fcstTime": "0900",
             "category": "POP", "fcstValue": "90"},
            {"fcstDate": "20260812", "fcstTime": "0900",
             "category": "REH", "fcstValue": "92"},
            {"fcstDate": "20260812", "fcstTime": "0900",
             "category": "WSD", "fcstValue": "9"},
            {"fcstDate": "20260812", "fcstTime": "0900",
             "category": "PTY", "fcstValue": "1"},
            # 무강수 문자열 — 숫자가 아닌 값이 신호를 오염시키지 않는지 함께 본다
            {"fcstDate": "20260812", "fcstTime": "0900",
             "category": "PCP", "fcstValue": "강수없음"},
        ]
        backend_forecasts = weather_api.group_forecast_items(items)

        grouped: dict[tuple, dict] = {}
        for item in items:
            slot = grouped.setdefault((item["fcstDate"], item["fcstTime"]), {})
            if item["category"] in celery_kma.KMA_CATEGORY:
                slot[item["category"]] = celery_kma.parse_kma_value(item["fcstValue"])
        celery_forecasts = [
            {"datetime": f"{d}{t}", **values} for (d, t), values in sorted(grouped.items())
        ]

        assert backend_forecasts == celery_forecasts
        verdict = wp.classify_phenomenon({"region": "서울", "forecasts": backend_forecasts})
        assert verdict == wp.classify_phenomenon(
            {"region": "서울", "forecasts": celery_forecasts}
        )
        assert verdict == "flood_risk"
