"""레이트리밋 계약 — 기본값 드리프트 감시 + 프록시 신뢰 노브 (R13 P-2/P-7).

PLACEMENT_SIZE·DEV_MODE·LEAGUE_DIVISION_SIZE 전례를 따른다: env로 조정 가능한
노브를 만들되 **기본값 = 계약값**을 테스트가 고정한다.

### 왜 5/minute이 아니라 30/minute인가 (P-2)
`LIMIT_AUTH`는 IP 기준이다. 심사장·교실은 NAT 뒤 **단일 공인 IP**라 같은
와이파이의 6번째 사람부터 게스트 시작이 429였다(실측 `[201×5, 429×3]`).
화면에는 카운트다운도 자동 재시도도 없어서 "서비스가 죽었다"로 보이고,
`ENERGY_ENABLED`·`DEV_MODE` 어느 레버로도 열 수 없었다.

### 왜 TRUST_PROXY_HEADERS 기본값을 바꾸지 않는가 (P-7)
XFF 첫 홉 신뢰는 위조 가능하다(실측: XFF를 바꾸면 8/8 전부 통과). 그러나
기본값을 false로 뒤집으면 Caddy 뒤의 **전 유저가 한 버킷**에 묶여 P-2보다
나쁜 상태가 된다. 그래서 노브만 열고 기본은 현행 유지 — 이 테스트가 그
결정을 고정한다.
"""
import re
from types import SimpleNamespace

import pytest

from app.core import rate_limit
from app.core.config import Settings
from app.core.rate_limit import LIMIT_AUTH, client_ip_key

RATE_LIMIT_SRC_PATH = "app/core/rate_limit.py"


def make_request(headers: dict | None = None, host: str | None = "172.18.0.2"):
    client = SimpleNamespace(host=host) if host is not None else None
    return SimpleNamespace(headers=headers or {}, client=client)


# ═══════════════════════════════════════════════════════════════
# 기본값 드리프트 감시
# ═══════════════════════════════════════════════════════════════


class TestLimitAuthDefault:
    def test_기본값은_30_per_minute(self):
        """계약값 — 낮추려면 NAT 뒤 다중 사용자 시나리오를 먼저 해결해야 한다."""
        assert Settings.model_fields["LIMIT_AUTH"].default == "30/minute"

    def test_모듈_상수가_Settings에서_온다(self):
        """하드코딩 복귀 감시 — auth.py가 import하는 이름은 LIMIT_AUTH 그대로 유지."""
        assert LIMIT_AUTH == Settings().LIMIT_AUTH

    def test_env로_조정_가능(self):
        assert Settings(LIMIT_AUTH="7/minute").LIMIT_AUTH == "7/minute"

    def test_한_교실_30인이_1분에_전원_진입_가능(self):
        """계약의 의미를 수치로 고정한다 — 분당 허용 건수가 30 미만이면 회귀."""
        count, _, window = LIMIT_AUTH.partition("/")
        assert window == "minute"
        assert int(count) >= 30


# ═══════════════════════════════════════════════════════════════
# 프록시 헤더 신뢰 노브 (P-7)
# ═══════════════════════════════════════════════════════════════


class TestTrustProxyHeaders:
    def test_기본값은_true_현행_유지(self):
        """프록시(Caddy) 뒤 배포 전제. false로 뒤집으면 전 유저가 한 버킷."""
        assert Settings.model_fields["TRUST_PROXY_HEADERS"].default is True

    def test_true면_XFF_첫_홉을_쓴다(self, monkeypatch):
        monkeypatch.setattr(rate_limit.settings, "TRUST_PROXY_HEADERS", True)
        req = make_request({"X-Forwarded-For": "203.0.113.7, 172.18.0.2"})
        assert client_ip_key(req) == "203.0.113.7"

    def test_false면_XFF를_무시하고_소켓_IP(self, monkeypatch):
        """헤더 위조로 한도를 무력화하는 경로를 닫는다(프록시 없는 배포용)."""
        monkeypatch.setattr(rate_limit.settings, "TRUST_PROXY_HEADERS", False)
        req = make_request(
            {"X-Forwarded-For": "1.2.3.4"}, host="203.0.113.99"
        )
        assert client_ip_key(req) == "203.0.113.99"

    def test_false여도_클라이언트_없으면_루프백(self, monkeypatch):
        monkeypatch.setattr(rate_limit.settings, "TRUST_PROXY_HEADERS", False)
        assert client_ip_key(make_request({"X-Forwarded-For": "1.2.3.4"}, host=None)) == (
            "127.0.0.1"
        )


# ═══════════════════════════════════════════════════════════════
# 소스 계약 — 주석이 사실과 어긋나지 않는가 (P-7: "nginx" 오기)
# ═══════════════════════════════════════════════════════════════


class TestProxyDocAccuracy:
    @pytest.fixture()
    def src(self):
        from pathlib import Path

        return (
            Path(__file__).resolve().parents[1] / RATE_LIMIT_SRC_PATH
        ).read_text(encoding="utf-8")

    def test_prod에_없는_nginx를_사실인_양_적지_않는다(self, src):
        """prod 경로는 Caddy 직결이다(compose에 nginx 없음). 주석이 'nginx가 전달하는'
        이라고 단정하던 것이 P-7 오판의 출발점이었다 — nginx 언급은 '아니다'라는
        정정 맥락에서만 허용한다."""
        for line in src.splitlines():
            if "nginx" in line:
                assert "아니다" in line, f"nginx 오기가 되살아났다: {line.strip()}"

    def test_위조_가능성이_문서화돼_있다(self, src):
        assert "위조" in src, "XFF가 클라이언트 위조 가능하다는 경고가 사라졌다"
        assert "TRUST_PROXY_HEADERS" in src

    def test_compose에_nginx가_없다(self):
        """위 주석 정정의 근거를 실제 구성으로 확인한다."""
        from pathlib import Path

        root = Path(__file__).resolve().parents[2]
        for name in ("docker-compose.yml", "docker-compose.prod.yml"):
            path = root / name
            if path.exists():
                assert not re.search(
                    r"^\s*nginx:", path.read_text(encoding="utf-8"), re.M
                ), f"{name}에 nginx 서비스가 생겼다 — 주석 정정을 재검토할 것"
