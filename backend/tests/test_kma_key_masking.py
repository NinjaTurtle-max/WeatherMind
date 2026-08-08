"""KMA `serviceKey` 로그 유출 차단 계약 (CO-Q-3 / CO-N-3d).

⚠️ **이 파일은 감사가 「유령 테스트」로 지목해 뒤늦게 실재화됐다.**
`weather_api.py:43`과 `celery/app/kma_client.py:23`이 *"드리프트는
tests/test_kma_key_masking.py가 양방향으로 감시한다"*고 **단정하는데 그 파일이
없었다**(2026-08-08 감사). 이 리포의 대표 실패 — 문서가 코드보다 앞서 단정하는 것 —
가 수리 커밋 안에서 재발한 자리다. 주석이 테스트를 지목하면 그 테스트가 실재해야 한다.

무엇을 지키나
-------------
대회 규정상 **API 키 노출 = 실격**이다. 그런데 실측 로그에서 `httpx` 로거가
**모든 요청의 전체 URL을 INFO로** 남기고 있었다 — 실패 시가 아니라 **매 콜**이다
(`GET ...?serviceKey=<키>... "HTTP/1.1 403"`). 그래서 방어가 두 겹이다.

  ① `logging.getLogger("httpx").setLevel(WARNING)` — 요청 라인 자체를 끈다
  ② `mask_service_key()` — 예외 문자열에 실려 나가는 URL을 마스킹한다

backend와 celery는 **교차 빌드 컨텍스트**라 import로 묶을 수 없어 같은 값을 양쪽에
둔다(CLAUDE.md "물리적 병합이 아니라 단일 소유자 + 계약 테스트" 관례). 그 사본이
갈라지지 않게 **두 파일을 함께 읽어** 대조한다.
"""

from __future__ import annotations

import logging
import re
from pathlib import Path

import pytest

from app.services import weather_api

REPO = Path(__file__).resolve().parents[2]
CELERY_CLIENT = REPO / "celery" / "app" / "kma_client.py"
BACKEND_CLIENT = REPO / "backend" / "app" / "services" / "weather_api.py"

LEAKY = [
    "https://apis.data.go.kr/x/y?serviceKey=REAL_SECRET_VALUE&numOfRows=10",
    "GET https://a/b?pageNo=1&serviceKey=abc%2Fdef%3D%3D&dataType=JSON",
    "error: request to ...&servicekey=lower_case_variant failed",
    "\"serviceKey=quoted_value\" 뒤에 따옴표",
    "serviceKey=trailing_at_end",
]


class TestMaskingBehaviour:
    @pytest.mark.parametrize("text", LEAKY)
    def test_실키가_문자열에서_사라진다(self, text):
        out = weather_api.mask_service_key(text)
        assert "serviceKey=" in out.replace("servicekey=", "serviceKey=")
        assert weather_api.SERVICE_KEY_MASK in out
        # 원문에서 키였던 자리의 값이 남아 있으면 안 된다
        for secret in re.findall(r"(?i)serviceKey=([^&\s'\"]+)", text):
            assert secret not in out, f"마스킹 후에도 키가 남았다: {secret!r}"

    def test_다른_쿼리_파라미터는_보존된다(self):
        out = weather_api.mask_service_key(
            "https://a/b?numOfRows=10&serviceKey=SECRET&dataType=JSON"
        )
        assert "numOfRows=10" in out and "dataType=JSON" in out

    def test_문자열이_아닌_입력도_받는다(self):
        """예외 객체를 그대로 넘기는 호출부가 있다 — str()로 흡수해야 한다."""
        exc = RuntimeError("boom ?serviceKey=SECRET")
        assert "SECRET" not in weather_api.mask_service_key(exc)

    def test_키가_없으면_원문_그대로(self):
        assert weather_api.mask_service_key("no key here") == "no key here"


class TestHttpxLoggerIsQuieted:
    """①번 방어 — 요청 라인 자체를 끈다.

    이게 없으면 정상 가동 중에도 매 콜 전체 URL이 INFO로 남는다. 즉
    "실패 시 로그를 공유하지 않는다"는 운영 규율로는 막을 수 없다.
    """

    def test_httpx_로거가_WARNING_이상이다(self):
        assert logging.getLogger("httpx").level >= logging.WARNING

    @pytest.mark.parametrize("path", [BACKEND_CLIENT, CELERY_CLIENT])
    def test_두_클라이언트_모두_레벨을_올린다(self, path):
        src = path.read_text(encoding="utf-8")
        assert 'getLogger("httpx").setLevel(logging.WARNING)' in src, path.name


class TestCrossBuildParity:
    """backend ↔ celery 사본이 갈라지지 않는다."""

    @staticmethod
    def _const(src: str, name: str) -> str:
        m = re.search(rf"^{name}\s*=\s*(.+)$", src, re.M)
        assert m, f"{name} 정의를 못 찾았다"
        return m.group(1).strip()

    def test_정규식과_마스크_문자열이_같다(self):
        b = BACKEND_CLIENT.read_text(encoding="utf-8")
        c = CELERY_CLIENT.read_text(encoding="utf-8")
        for name in ("_SERVICE_KEY_RE", "SERVICE_KEY_MASK"):
            assert self._const(b, name) == self._const(c, name), name

    def test_두_파일이_같은_동작을_낸다(self):
        """정규식 문자열이 같아도 적용 방식이 다르면 결과가 갈린다 — 실행으로 본다."""
        ns: dict = {}
        src = CELERY_CLIENT.read_text(encoding="utf-8")
        body = re.search(
            r"^_SERVICE_KEY_RE\s*=.*?^def mask_service_key.*?(?=^\S|\Z)",
            src,
            re.M | re.S,
        )
        assert body, "celery 쪽 mask_service_key를 못 찾았다"
        exec("import re\n" + body.group(0), ns)
        for text in LEAKY:
            assert ns["mask_service_key"](text) == weather_api.mask_service_key(text)
