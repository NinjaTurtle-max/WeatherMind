"""ASOS 일자료 어댑터 계약 (R13 API허브 전환).

무엇을 지키나
-------------
출처를 공공데이터포털 → 기상청 API허브로 옮기면서 일자료만 **계열이 통째로**
바뀌었다. `AsosDalyInfoService`가 API허브에 없고, openApi 대체품
(`SfcMtlyInfoService/getDailyWthrData`)은 **월보라 당월을 주지 않는다** —
어제 날짜로 부르면 `resultCode=99 "발간되지 않은 기간입니다"`(2026-08-10 실측).
정산·브리핑이 쓰는 건 전부 당월이라 typ01 `kma_sfcdd.php`로 **교체**했다.

그래서 흡수해야 할 차이가 셋이다:

  ① 조회 단위: 기간(startDt~endDt) → **하루**(`tm`) — 주간 정산은 7콜
  ② 응답 형식: JSON 봉투 → **`#` 주석 + 콤마 구분 텍스트**
  ③ 결측 표기: 빈 문자열 → **`-9` / `-9.0` / `-9.00`**

③을 놓치면 **강수 -9mm·기온 -9℃가 정산에 들어간다**. 증상이 화면 오류가 아니라
"승패가 조용히 틀리는 것"이라 사람 눈에 안 띈다 — 그래서 여기서 못 박는다.

공개 시그니처와 반환 형태는 종전 그대로다(`get_past_observation(start, end, …)` →
`[{tm, avgTa, maxTa, minTa, sumRn}]`). 그래서 duel_service·league.py는 무변경이고,
이 파일이 그 "무변경"의 근거다.

backend ↔ celery는 교차 빌드 컨텍스트라 사본이 두 벌이다. 두 구현을 **함께 실행해**
결과를 대조한다(test_kma_contract.py와 같은 관례).

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
    """celery kma_client를 backend `app` 패키지와 충돌 없이 임포트한다."""
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

# 2026-08-10 서울(108) **실측 응답 1행**을 그대로 픽스처로 쓴다.
# 합성 행만 쓰면 인덱스를 우리가 믿는 대로만 검증하게 된다 — 실제 응답을 박아 둬야
# 기상청이 컬럼을 바꿨을 때 CI가 운다. RN_DAY가 `-9.0`(무강수)인 것도 실측값이다.
REAL_ROW = (
    "20260809,108,4.0,3445,5,6.0,1040,2,11.4,1048,27.6,31.6,1354,24.5,546,18.7,"
    "32.0,21.7,58.9,51.0,1352,21.7,7.3,5.1,-9.00,999.7,1009.3,1011.2,2328,1008.0,"
    "1541,6.4,6.5,13.8,-9.0,18.71,2.31,1300,-9.0,-9.0,-9.00,-9.0,-9,-9.0,-9,-9.0,"
    "-9,-9.0,-9,-9.0,-9,29.4,26.8,25.4,20.3,15.9,"
)
REAL_TEXT = "#START7777\n# TM, STN, ...\n" + REAL_ROW + "\n#7777END\n"


def _row(**over):
    """지정 인덱스만 채운 57컬럼 합성 행."""
    f = ["0"] * weather_api.ASOS_MIN_COLS
    col = weather_api.ASOS_COL
    f[col["tm"]] = over.get("tm", "20260809")
    f[col["avgTa"]] = over.get("avgTa", "27.6")
    f[col["maxTa"]] = over.get("maxTa", "31.6")
    f[col["minTa"]] = over.get("minTa", "24.5")
    f[col["sumRn"]] = over.get("sumRn", "3.5")
    return ",".join(f)


class TestAsosDays:
    """기간 → 날짜 열거. 여기가 틀리면 정산이 특정 날짜만 조용히 비운다."""

    @BOTH
    def test_하루짜리는_1콜(self, mod):
        assert mod.asos_days("20260809", "20260809") == ["20260809"]

    @BOTH
    def test_일주일은_7콜(self, mod):
        days = mod.asos_days("20260803", "20260809")
        assert len(days) == 7 and days[0] == "20260803" and days[-1] == "20260809"

    @BOTH
    def test_월_경계를_넘는다(self, mod):
        assert mod.asos_days("20260730", "20260802") == [
            "20260730", "20260731", "20260801", "20260802"
        ]

    @BOTH
    def test_연_경계를_넘는다(self, mod):
        assert mod.asos_days("20251231", "20260101") == ["20251231", "20260101"]

    @BOTH
    def test_역순_구간은_빈_목록(self, mod):
        """호출측 계산 실수로 end < start가 오면 API를 때리지 않는다."""
        assert mod.asos_days("20260809", "20260801") == []


class TestMissingSentinel:
    """`-9` 계열은 결측이다 — 숫자로 새면 -9℃·-9mm가 정산에 들어간다."""

    @BOTH
    @pytest.mark.parametrize("raw", ["-9", "-9.0", "-9.00", "-9.000"])
    def test_결측_표기는_0으로_흡수된다(self, mod, raw):
        assert mod.asos_value(raw) == 0.0

    @BOTH
    @pytest.mark.parametrize("raw,expected", [("27.6", 27.6), ("0", 0.0), ("-3.2", -3.2)])
    def test_정상값은_그대로(self, mod, raw, expected):
        assert mod.asos_value(raw) == expected

    @BOTH
    def test_영하_9도가_아닌_값은_안_지운다(self, mod):
        """`-90`·`-9.5`는 결측 표기가 아니다 — 정규식이 헐거우면 실측치를 지운다."""
        assert mod.asos_value("-90") == -90.0
        assert mod.asos_value("-9.5") == -9.5


class TestParseAsosText:
    @BOTH
    def test_실측_행이_그대로_파싱된다(self, mod):
        rows = mod.parse_asos_text(REAL_TEXT)
        assert len(rows) == 1
        assert rows[0] == {
            "tm": "2026-08-09",
            "avgTa": 27.6,
            "maxTa": 31.6,
            "minTa": 24.5,
            "sumRn": 0.0,  # 실측 RN_DAY=-9.0 (무강수) → 결측 흡수
        }

    @BOTH
    def test_주석_줄은_버린다(self, mod):
        assert mod.parse_asos_text("#START\n#TM,STN\n#7777END\n") == []

    @BOTH
    def test_컬럼이_모자란_행은_버린다(self, mod):
        """어긋난 인덱스로 엉뚱한 값을 정산에 넣는 것이 결측보다 나쁘다."""
        assert mod.parse_asos_text("20260809,108,1.0\n") == []

    @BOTH
    def test_날짜가_없으면_버린다(self, mod):
        assert mod.parse_asos_text(_row(tm="")) == []

    @BOTH
    def test_빈_응답도_안전하다(self, mod):
        assert mod.parse_asos_text("") == [] and mod.parse_asos_text(None) == []

    @BOTH
    def test_여러_행을_읽는다(self, mod):
        text = _row(tm="20260808") + "\n" + _row(tm="20260809")
        assert [r["tm"] for r in mod.parse_asos_text(text)] == ["2026-08-08", "2026-08-09"]

    @BOTH
    def test_출력_키_순서가_종전과_같다(self, mod):
        rows = mod.parse_asos_text(_row())
        assert list(rows[0]) == ["tm", "avgTa", "maxTa", "minTa", "sumRn"]


class TestEnvelopeGuard:
    """200이어도 **데이터 응답인지**를 따로 본다 (code-review 지적 #1).

    JSON 경로에는 `resultCode` 검사가 있는데 텍스트 경로에는 상태코드밖에 없었다.
    200으로 오는 에러 본문이 생기면 파서가 전부 버려 빈 리스트가 되고, 그게
    **성공으로 기록돼 스페어 폴백도 안 하고 1시간 캐시된다** — 정산이 조용히 빈손.

    2026-08-10 실측: 잘못된 키는 401, 미승인 API는 403으로 오므로 그 둘은 HTTP가
    잡는다. 그래도 마커를 요구하는 것은 **아직 못 본 실패 형태**를 위해서다.
    """

    @BOTH
    def test_정상_응답은_통과(self, mod):
        assert mod.is_typ01_body(REAL_TEXT) is True

    @BOTH
    def test_데이터_0행인_정상_응답도_통과(self, mod):
        """미래 날짜 조회 — 마커는 붙고 행만 없다(실측). 이건 오류가 아니다."""
        assert mod.is_typ01_body("#START7777\n#7777END\n") is True

    @BOTH
    @pytest.mark.parametrize(
        "body",
        ["", None, "error: unauthorized", "<html><body>502</body></html>", "# 다른 주석만"],
    )
    def test_데이터_응답이_아니면_거른다(self, mod, body):
        assert mod.is_typ01_body(body) is False


class TestMinColsGuard:
    """읽는 인덱스(최대 38)만큼만 요구한다 (code-review 지적 #3).

    실측 행은 57칸이지만(끝 콤마의 빈 칸 포함) 57을 요구하면 끝 콤마가 없는 응답이
    오는 날 **전 행이 버려지고**, 그 0행이 성공으로 기록된다.
    """

    @BOTH
    def test_39칸이면_읽는다(self, mod):
        assert mod.ASOS_MIN_COLS == 39
        assert len(mod.parse_asos_text(_row())) == 1

    @BOTH
    def test_끝_콤마가_없어도_읽는다(self, mod):
        assert len(mod.parse_asos_text(REAL_ROW.rstrip(","))) == 1

    @BOTH
    def test_읽을_인덱스가_없으면_버린다(self, mod):
        short = ",".join(["0"] * 38)  # 최대 인덱스 38에 못 미친다
        assert mod.parse_asos_text(short) == []


class TestNormalizeTm:
    @BOTH
    @pytest.mark.parametrize(
        "raw,expected",
        [("2026-08-09", "2026-08-09"), ("20260809", "2026-08-09"), ("2026.08.09", "2026-08-09")],
    )
    def test_어떤_표기든_ISO로_통일된다(self, mod, raw, expected):
        assert mod.normalize_asos_tm(raw) == expected

    @BOTH
    @pytest.mark.parametrize("raw", [None, "", "결측", "2026-08"])
    def test_날짜가_아니면_None(self, mod, raw):
        assert mod.normalize_asos_tm(raw) is None


class TestAsosInRange:
    ROWS = [
        {"tm": "2026-07-31", "avgTa": 1.0},
        {"tm": "2026-08-03", "avgTa": 2.0},
        {"tm": "2026-08-01", "avgTa": 3.0},
        {"tm": "2026-08-03", "avgTa": 9.9},  # 중복
        {"tm": None, "avgTa": 5.0},
    ]

    @BOTH
    def test_구간_밖은_잘린다(self, mod):
        out = mod.asos_in_range(list(self.ROWS), "20260801", "20260803")
        assert [r["tm"] for r in out] == ["2026-08-01", "2026-08-03"]

    @BOTH
    def test_중복_날짜는_한_번만(self, mod):
        """하루 1콜이라 재시도·중복 편입이 생기면 같은 날이 두 번 들어올 수 있다."""
        out = mod.asos_in_range(list(self.ROWS), "20260801", "20260803")
        assert out[1]["avgTa"] == 2.0  # 첫 행 유지

    @BOTH
    def test_날짜순으로_정렬된다(self, mod):
        out = mod.asos_in_range(list(self.ROWS), "20260701", "20260831")
        assert [r["tm"] for r in out] == sorted(r["tm"] for r in out)

    @BOTH
    def test_날짜_없는_행은_버린다(self, mod):
        out = mod.asos_in_range(list(self.ROWS), "20260101", "20261231")
        assert all(r["tm"] for r in out)


class TestRequestShape:
    """요청 인자가 typ01 계약을 따른다 — openApi 인자가 남으면 월보로 되돌아간다."""

    @pytest.mark.parametrize(
        "path",
        [
            REPO_ROOT / "backend" / "app" / "services" / "weather_api.py",
            REPO_ROOT / "celery" / "app" / "kma_client.py",
        ],
        ids=["backend", "celery"],
    )
    def test_일_단위_인자를_쓴다(self, path):
        src = path.read_text(encoding="utf-8")
        fetch = src.split("_fetch_daily_obs", 1)[1]
        head = fetch[: fetch.find("return rows")]
        for gone in ('"startDt"', '"stnIds"', '"dataCd"', '"year"', '"month"', '"station"'):
            assert gone not in head, f"{path.name}에 구 인자 {gone}가 남아 있다"
        for need in ('"tm"', '"stn"'):
            assert need in head, f"{path.name}에 {need} 인자가 없다"

    @pytest.mark.parametrize(
        "path",
        [
            REPO_ROOT / "backend" / "app" / "core" / "config.py",
            REPO_ROOT / "celery" / "app" / "config.py",
        ],
        ids=["backend", "celery"],
    )
    def test_ASOS_URL이_월보가_아니다(self, path):
        """getDailyWthrData로 되돌아가면 당월 정산이 통째로 빈손이 된다.

        **URL 형태로만** 본다 — 주석은 "왜 월보를 버렸는지" 설명하느라 그 이름을
        언급하므로, 이름만 훑으면 설명문이 오탐된다(실제로 그랬다).
        """
        src = path.read_text(encoding="utf-8")
        assert "typ01/url/kma_sfcdd.php" in src, f"{path.name}의 ASOS URL이 typ01이 아니다"
        assert "typ02/openApi/SfcMtlyInfoService" not in src, (
            f"{path.name}이 월보 URL을 다시 쓰고 있다 — 당월은 발간 전이라 안 온다"
        )


class TestCrossBuildParity:
    """backend ↔ celery 사본이 갈라지지 않는다 (결과로 본다)."""

    def test_컬럼_인덱스가_같다(self):
        assert weather_api.ASOS_COL == celery_kma.ASOS_COL
        assert weather_api.ASOS_MIN_COLS == celery_kma.ASOS_MIN_COLS

    @pytest.mark.parametrize(
        "start,end", [("20260803", "20260809"), ("20260730", "20260802"), ("20251231", "20260101")]
    )
    def test_날짜_열거가_같다(self, start, end):
        assert weather_api.asos_days(start, end) == celery_kma.asos_days(start, end)

    @pytest.mark.parametrize("raw", ["-9", "-9.0", "27.6", "-9.5", ""])
    def test_결측_판정이_같다(self, raw):
        assert weather_api.asos_value(raw) == celery_kma.asos_value(raw)

    def test_실측_행_파싱이_같다(self):
        assert weather_api.parse_asos_text(REAL_TEXT) == celery_kma.parse_asos_text(REAL_TEXT)


class TestConcurrentFetchDoesNotAmplifyFailure:
    """실패 시 남은 요청을 방치하지 않는다 — 코드 리뷰 지적(2026-08-10).

    `_fetch_daily_obs`가 그냥 `asyncio.gather`를 쓰면 **첫 실패가 즉시 올라가고
    나머지는 취소되지 않은 채 남는다**. 브리핑 GET은 8일치를 요청하므로(duel.py),
    KMA 장애 때 호출자는 `asos_fail_key` 마커를 찍고 돌아가는데 뒤에 남은 최대
    7개가 각자 `2키 × 2시도 × 10초` 예산을 마저 태운다 — **마커가 아끼려던 바로
    그 한도를 증폭해서 쓴다.** 덤으로 "Task exception was never retrieved" 경고가
    로그를 덮는다.

    "부분 결과로 정산하지 않는다"(함수 독스트링)는 그대로다: 전부 모은 뒤 첫
    예외를 올린다.
    """

    def _run(self, monkeypatch, fail_on):
        """실패가 **가장 먼저** 나고 나머지는 그보다 늦게 끝나도록 짠다.

        ⚠️ 이 시간차가 이 테스트의 전부다. 처음에 `asyncio.sleep(0)` 한 번만 주고
        짰더니 **옛 코드(gather 맨몸)에서도 전건 통과**했다 — 첫 실패가 올라올
        시점에 나머지가 이미 완료돼 있어서 두 구현의 차이가 드러나지 않았다.
        실패를 즉시(양보 1회) 내고 성공분은 여러 번 양보하게 해야, 맨몸 gather가
        **미완료 태스크를 남긴 채 반환하는 것**이 finished 개수로 보인다.
        """
        import asyncio

        started: list[str] = []
        finished: list[str] = []

        async def fake_request(url, params):
            day = params["tm"]
            started.append(day)
            if day == fail_on:
                await asyncio.sleep(0)  # 가장 먼저 깨어나 예외를 올린다
                raise weather_api.KMAApiError("boom")
            for _ in range(5):  # 실패보다 확실히 늦게 끝난다
                await asyncio.sleep(0)
            finished.append(day)
            return REAL_TEXT

        monkeypatch.setattr(weather_api, "_request_text", fake_request)
        with pytest.raises(weather_api.KMAApiError):
            asyncio.run(weather_api._fetch_daily_obs("20260803", "20260807", "108"))
        return started, finished

    def test_실패는_그대로_전파된다(self, monkeypatch):
        """부분 결과로 정산하지 않는다 — 승패가 조용히 틀리는 것을 막는 계약."""
        started, _ = self._run(monkeypatch, fail_on="20260805")
        assert started, "요청이 하나도 안 나갔다면 이 테스트가 아무것도 안 본다"

    def test_남은_요청이_고아로_남지_않는다(self, monkeypatch):
        """성공분이 **끝까지 실행**된다 = 중간에 버려진 태스크가 없다.

        `return_exceptions=True`가 없으면 gather가 첫 예외에서 바로 반환하므로,
        아직 await 중이던 나머지가 완료 표시를 남기지 못한다. 5일 중 실패 1건을
        뺀 4건이 전부 finished에 들어오는 것이 그 증거다.
        """
        started, finished = self._run(monkeypatch, fail_on="20260805")
        assert len(started) == 5, f"5일치가 동시에 시작돼야 한다 — 실제 {started}"
        assert len(finished) == 4, (
            "실패 1건을 뺀 나머지가 전부 완료돼야 한다 — 미완료가 있으면 그것이 "
            f"고아 태스크다. 실제 {finished}"
        )

    def test_전건_성공이면_평탄화해_돌려준다(self, monkeypatch):
        """예외 처리를 넣으면서 정상 경로가 깨지지 않았는지 — 회귀 방어."""
        import asyncio

        async def ok(url, params):
            return REAL_TEXT

        monkeypatch.setattr(weather_api, "_request_text", ok)
        rows = asyncio.run(weather_api._fetch_daily_obs("20260803", "20260805", "108"))
        assert len(rows) == 3 * len(weather_api.parse_asos_text(REAL_TEXT))
        assert all(isinstance(r, dict) for r in rows)
