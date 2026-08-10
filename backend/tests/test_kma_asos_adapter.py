"""ASOS 일자료 어댑터 계약 (R13 API허브 전환).

무엇을 지키나
-------------
출처를 공공데이터포털 → 기상청 API허브로 옮기면서 일자료만 **서비스가 통째로**
바뀌었다. `AsosDalyInfoService`가 API허브에 없어서 `SfcMtlyInfoService/
getDailyWthrData`를 쓰는데, 둘은 두 군데가 다르다:

  ① 조회 단위: 기간(startDt~endDt) → **월**(year+month)
  ② 필드명:    avgTa/maxTa/minTa/sumRn → **ta/ta_max/ta_min/rn_day**

이 차이를 어댑터가 흡수해 **공개 시그니처와 반환 형태를 종전 그대로** 유지한다.
그래서 duel_service·league.py는 무변경이고, 이 파일이 그 "무변경"의 근거다.
어댑터가 조용히 어긋나면 증상이 화면 오류가 아니라 **정산이 빈손으로 도는 것**이라
사람 눈에 안 띈다 — 그래서 순수 함수 단위로 못 박는다.

backend ↔ celery는 교차 빌드 컨텍스트라 import로 묶을 수 없어 사본이 두 벌이다.
두 구현을 **함께 실행해** 결과를 대조한다(test_kma_contract.py와 같은 관례).

DB·네트워크 불필요. 실행: backend에서 `python -m pytest tests -q`.
"""
import importlib
import sys
from pathlib import Path

import pytest

from app.services import weather_api

REPO_ROOT = Path(__file__).resolve().parents[2]
CELERY_DIR = REPO_ROOT / "celery"


def _import_celery_kma_client():
    """celery kma_client를 backend `app` 패키지와 충돌 없이 임포트한다.

    (test_kma_contract._import_celery_kma_client와 동일 패턴 — 두 디렉토리가
    최상위 패키지명 `app`을 공유한다.)
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


celery_kma = _import_celery_kma_client()
BOTH = pytest.mark.parametrize(
    "mod", [weather_api, celery_kma], ids=["backend", "celery"]
)


class TestAsosMonths:
    """기간 → 월 열거. 여기가 틀리면 정산이 특정 날짜만 조용히 비운다."""

    @BOTH
    def test_같은_달이면_1콜(self, mod):
        assert mod.asos_months("20260803", "20260809") == [("2026", "08")]

    @BOTH
    def test_하루짜리도_1콜(self, mod):
        assert mod.asos_months("20260809", "20260809") == [("2026", "08")]

    @BOTH
    def test_월_경계를_걸치면_2콜(self, mod):
        """주간 리그 정산이 월말~월초에 걸리는 경우가 실제로 있다."""
        assert mod.asos_months("20260728", "20260803") == [("2026", "07"), ("2026", "08")]

    @BOTH
    def test_연_경계를_걸친다(self, mod):
        assert mod.asos_months("20251230", "20260102") == [("2025", "12"), ("2026", "01")]

    @BOTH
    def test_역순_구간은_빈_목록(self, mod):
        """호출측 계산 실수로 end < start가 오면 API를 때리지 않는다."""
        assert mod.asos_months("20260809", "20260801") == []


class TestNormalizeTm:
    """관측일자 표기 흡수 — 종전 출력이 'YYYY-MM-DD'였고 duel이 그걸로 오늘을 가른다."""

    @BOTH
    @pytest.mark.parametrize(
        "raw,expected",
        [
            ("2026-08-09", "2026-08-09"),
            ("20260809", "2026-08-09"),
            ("2026-08-09 00:00", "2026-08-09"),
            ("2026.08.09", "2026-08-09"),
        ],
    )
    def test_어떤_표기든_ISO로_통일된다(self, mod, raw, expected):
        assert mod.normalize_asos_tm(raw) == expected

    @BOTH
    @pytest.mark.parametrize("raw", [None, "", "결측", "2026-08"])
    def test_날짜가_아니면_None(self, mod, raw):
        assert mod.normalize_asos_tm(raw) is None


class TestAsosRow:
    """API허브 필드명 → 우리 출력 필드명."""

    @BOTH
    def test_네_필드가_매핑된다(self, mod):
        row = mod.asos_row(
            {"tm": "2026-08-09", "ta": "26.4", "ta_max": "30.1", "ta_min": "22.8", "rn_day": "5.5"}
        )
        assert row == {
            "tm": "2026-08-09",
            "avgTa": 26.4,
            "maxTa": 30.1,
            "minTa": 22.8,
            "sumRn": 5.5,
        }

    @BOTH
    def test_무강수_문자열은_0으로_흡수된다(self, mod):
        """rn_day가 빈 문자열로 오는 날이 있다 — 0.0이어야 정산이 성립한다."""
        row = mod.asos_row({"tm": "20260809", "ta": "26", "rn_day": ""})
        assert row["sumRn"] == 0.0

    @BOTH
    def test_구_필드명은_읽지_않는다(self, mod):
        """구 응답(avgTa)이 그대로 통과하면 출처 전환 실패를 못 알아챈다.

        결측 취급(parse_kma_value(None) → 0.0)은 종전 동작 그대로다 — 이 어댑터가
        새로 만든 것이 아니라, 구 코드도 키가 없으면 같은 값을 냈다.
        """
        row = mod.asos_row({"tm": "20260809", "avgTa": "26.4"})
        assert row["avgTa"] == 0.0, "구 필드명을 읽어버렸다"

    @BOTH
    def test_출력_키_순서가_종전과_같다(self, mod):
        row = mod.asos_row({"tm": "20260809"})
        assert list(row) == ["tm", "avgTa", "maxTa", "minTa", "sumRn"]


class TestAsosInRange:
    """월 단위로 받아온 행에서 요청 구간만 남는다."""

    ROWS = [
        {"tm": "2026-07-31", "avgTa": 1.0},
        {"tm": "2026-08-03", "avgTa": 2.0},
        {"tm": "2026-08-01", "avgTa": 3.0},
        {"tm": "2026-08-31", "avgTa": 4.0},
        {"tm": None, "avgTa": 5.0},
    ]

    @BOTH
    def test_구간_밖은_잘린다(self, mod):
        out = mod.asos_in_range(list(self.ROWS), "20260801", "20260803")
        assert [r["tm"] for r in out] == ["2026-08-01", "2026-08-03"]

    @BOTH
    def test_날짜순으로_정렬된다(self, mod):
        """월 2콜을 이어붙이면 순서가 섞인다 — 정렬은 어댑터 책임이다."""
        out = mod.asos_in_range(list(self.ROWS), "20260701", "20260831")
        assert [r["tm"] for r in out] == sorted(r["tm"] for r in out)

    @BOTH
    def test_날짜_없는_행은_버린다(self, mod):
        out = mod.asos_in_range(list(self.ROWS), "20260101", "20261231")
        assert all(r["tm"] for r in out)


class TestRequestShape:
    """요청 인자가 월 단위 API 계약을 따른다 — 구 인자가 남으면 400/빈 응답이다."""

    @pytest.mark.parametrize(
        "path",
        [
            REPO_ROOT / "backend" / "app" / "services" / "weather_api.py",
            REPO_ROOT / "celery" / "app" / "kma_client.py",
        ],
        ids=["backend", "celery"],
    )
    def test_구_기간_인자가_남아_있지_않다(self, path):
        src = path.read_text(encoding="utf-8")
        fetch = src.split("_fetch_daily_obs", 1)[1]
        head = fetch[: fetch.find("return items")]
        for gone in ('"startDt"', '"endDt"', '"stnIds"', '"dataCd"', '"dateCd"'):
            assert gone not in head, f"{path.name}에 구 인자 {gone}가 남아 있다"
        for need in ('"year"', '"month"', '"station"'):
            assert need in head, f"{path.name}에 {need} 인자가 없다"


class TestCrossBuildParity:
    """backend ↔ celery 사본이 갈라지지 않는다 (결과로 본다)."""

    def test_필드맵이_같다(self):
        assert weather_api.ASOS_FIELD_MAP == celery_kma.ASOS_FIELD_MAP

    @pytest.mark.parametrize(
        "start,end",
        [("20260803", "20260809"), ("20260728", "20260803"), ("20251230", "20260102")],
    )
    def test_월_열거가_같다(self, start, end):
        assert weather_api.asos_months(start, end) == celery_kma.asos_months(start, end)

    @pytest.mark.parametrize("raw", ["2026-08-09", "20260809", "결측", None])
    def test_날짜_정규화가_같다(self, raw):
        assert weather_api.normalize_asos_tm(raw) == celery_kma.normalize_asos_tm(raw)

    def test_행_변환이_같다(self):
        item = {"tm": "20260809", "ta": "26.4", "ta_max": "", "rn_day": "강수없음"}
        assert weather_api.asos_row(item) == celery_kma.asos_row(item)
