"""LLM 지출 상한과 서빙 모드 — 최대 손실을 확정한다 (2026-08-12 클라이언트 결정).

**왜 만들었나 — 평상시 비용이 아니라 꼬리 위험이다.**
실측 예상 런타임 비용은 대회 전 기간 $0.23이다(450콜). 아껴 쓸 이유가 없다.
문제는 **상한이 없다는 것**이다:
  · 재시도 루프가 잘못 돌면 하룻밤에 수만 콜
  · URL을 9월 셋째 주까지 유지해야 하는데 그 대부분이 **아무도 안 보는 시간**이다
  · 키가 새면 규정상 실격이지만, 상한이 있으면 최소한 금전 피해는 확정된다
"아껴 쓰기"가 아니라 **"최대 손실을 확정하기"**가 목적이다.

**서빙 모드 — 안전한 상태를 기본값으로.**
지금 서비스가 LLM을 안 부르는 이유는 "키가 없어서"이고, 그건 **의도가 아니라 우연**이다.
실측으로 확인했다: 저작 배치를 하려고 `GEMINI_API_KEY`를 넣으면 **런타임 피드백도
그 순간 같이 켜진다**(세 용도가 같은 키로 떨어지므로). 배포된 서비스가 조용히
과금을 시작하는 것이다.
그래서 `LLM_SERVING_MODE`를 두고 **기본을 `dummy`로** 한다. 켜는 것이 명시적 행위가
되고, 키를 넣는 것과 서빙에 쓰는 것이 분리된다(대장 G2 데모 게이트의 실현).

**왜 토큰이 아니라 달러로 세나**: 모델마다 단가가 달라서 토큰 상한은 뜻이 흐려진다.
"최대 $5"라고 말했으면 그게 곧이곧대로 참이어야 한다.

**왜 Redis인가**: backend·ai-worker·celery가 각자 프로세스다. 메모리 카운터는
컨테이너가 재시작하면 0으로 돌아가고, **그게 정확히 가장 위험한 순간**이다.
Redis가 없으면 **켜지 않는다**(fail-closed) — 상한을 셀 수 없는데 돈을 쓰는 것보다
안 쓰는 쪽이 낫다.
"""
from __future__ import annotations

import logging
import os
from dataclasses import dataclass

logger = logging.getLogger(__name__)

MODE_DUMMY = "dummy"
MODE_LIVE = "live"

# 강등 사다리 — 한도를 넘으면 아래로 한 칸씩 내려간다.
#   live(Gemini) → fallback(gpt-oss 등) → dummy(정적 문구)
LADDER = (MODE_LIVE, "fallback", MODE_DUMMY)


def _env(key: str, default: str = "") -> str:
    return os.environ.get(key, default)


def _float_env(key: str, default: float) -> float:
    try:
        return float(_env(key) or default)
    except ValueError:
        logger.warning("%s 값이 숫자가 아니다 — 기본값 %s 사용", key, default)
        return default


def serving_mode() -> str:
    """`dummy`(기본) | `live`.

    **기본이 dummy인 것이 이 모듈의 핵심**이다. 켜는 쪽이 명시적 행위여야 한다.
    """
    mode = (_env("LLM_SERVING_MODE", MODE_DUMMY) or MODE_DUMMY).strip().lower()
    return MODE_LIVE if mode == MODE_LIVE else MODE_DUMMY


# ── 단가표 ($/1M 토큰) ────────────────────────────────────────────────────
# 실측 시장가(2026-08-11 조회). 모델명은 부분 일치로 찾는다 — 공급자마다
# `openai/gpt-oss-120b`처럼 접두가 붙기 때문이다.
# ⚠️ 여기 없는 모델은 **가장 비싼 값**으로 친다. 모르는 모델을 싸게 세면 상한이
#    뚫린다 — 모를 때는 보수적으로 세는 쪽이 상한의 뜻을 지킨다.
PRICES: dict[str, tuple[float, float]] = {
    "gpt-oss-20b": (0.08, 0.35),
    "gpt-oss-120b": (0.15, 0.69),
    "flash-lite": (0.10, 0.40),
    "gemini-3.1-flash-lite": (0.10, 0.40),
    "gemini-2.5-flash": (0.30, 2.50),
    "gemini-3-flash": (0.25, 1.50),
    "gemini-3.5-flash": (0.75, 4.50),
}
_MOST_EXPENSIVE = max(PRICES.values(), key=lambda p: p[1])


def price_of(model: str) -> tuple[float, float]:
    """모델명 → (입력, 출력) $/1M. 모르는 모델은 최고가로 친다(보수적)."""
    name = (model or "").lower()
    best: tuple[float, float] | None = None
    best_len = -1
    for key, price in PRICES.items():
        if key in name and len(key) > best_len:
            best, best_len = price, len(key)
    return best or _MOST_EXPENSIVE


def cost_usd(model: str, input_tokens: int, output_tokens: int) -> float:
    pin, pout = price_of(model)
    return (input_tokens * pin + output_tokens * pout) / 1_000_000


# ── 누적 카운터 ───────────────────────────────────────────────────────────
_KEY_TOTAL = "wm:llm:spend:total"
_KEY_DAY = "wm:llm:spend:day:{day}"


@dataclass(frozen=True)
class BudgetState:
    total_usd: float
    day_usd: float
    total_cap: float
    day_cap: float
    available: bool
    reason: str


def _redis():
    """지연 연결 — redis가 없거나 못 붙으면 None. 임포트만으로 죽지 않는다."""
    try:
        import redis  # noqa: PLC0415

        url = _env("REDIS_URL", "redis://redis:6379/0")
        client = redis.Redis.from_url(url, socket_timeout=1, socket_connect_timeout=1)
        client.ping()
        return client
    except Exception as exc:  # 연결 실패·미설치 모두 같은 처리
        logger.warning("LLM 예산 카운터에 붙지 못했다: %s", type(exc).__name__)
        return None


def _today_key() -> str:
    from datetime import datetime, timedelta, timezone

    kst = timezone(timedelta(hours=9))  # 하루 경계는 KST — 저장소 전역 관례
    return _KEY_DAY.format(day=datetime.now(kst).strftime("%Y%m%d"))


def state() -> BudgetState:
    """지금 쓸 수 있는가 — 강등 판정의 단일 근거."""
    total_cap = _float_env("LLM_BUDGET_TOTAL_USD", 5.0)
    day_cap = _float_env("LLM_BUDGET_DAY_USD", 1.0)
    client = _redis()
    if client is None:
        # **fail-closed**: 셀 수 없으면 쓰지 않는다. 상한 없는 지출보다 낫다.
        return BudgetState(0.0, 0.0, total_cap, day_cap, False, "카운터 불가")
    try:
        total = float(client.get(_KEY_TOTAL) or 0.0)
        day = float(client.get(_today_key()) or 0.0)
    except Exception:
        return BudgetState(0.0, 0.0, total_cap, day_cap, False, "카운터 읽기 실패")

    if total >= total_cap:
        return BudgetState(total, day, total_cap, day_cap, False, "총 한도 소진")
    if day >= day_cap:
        return BudgetState(total, day, total_cap, day_cap, False, "일일 한도 소진")
    return BudgetState(total, day, total_cap, day_cap, True, "여유")


def record(model: str, input_tokens: int, output_tokens: int) -> float:
    """호출 1건의 비용을 누적한다. 반환: 이번 호출 비용.

    ⚠️ **호출 후에 기록한다.** 사전 예약(reserve) 방식이 더 엄밀하지만, 실제 토큰 수는
    응답을 받아야 알 수 있어 예약값이 항상 추정이 된다. 상한을 조금 넘길 수 있는
    대신(마지막 1콜분) 회계가 실측이 된다 — 상한이 $5인데 $5.001을 쓰는 것은
    문제가 아니고, **얼마 썼는지 모르는 것이 문제**다.
    """
    spent = cost_usd(model, input_tokens, output_tokens)
    client = _redis()
    if client is None:
        return spent
    try:
        client.incrbyfloat(_KEY_TOTAL, spent)
        day_key = _today_key()
        client.incrbyfloat(day_key, spent)
        client.expire(day_key, 60 * 60 * 24 * 3)  # 사흘 뒤 자동 정리
    except Exception as exc:
        logger.warning("LLM 지출 기록 실패: %s", type(exc).__name__)
    return spent


def health_snapshot() -> dict:
    """`/health`용 요약 — **강등이 조용히 일어나면 아무도 모른다.**

    한도를 넘겨 정적 문구로 내려가도 화면은 정상으로 보인다. 심사 기간에
    "AI 티가 사라진 것"을 사람이 알아챌 유일한 창구가 여기다.

    ⚠️ 금액과 모드는 싣되 **키·모델 자격은 절대 싣지 않는다**(규정: 키 노출 = 실격).
    """
    st = state()
    return {
        "serving_mode": serving_mode(),
        "budget_available": st.available,
        "reason": st.reason,
        "spend_total_usd": round(st.total_usd, 4),
        "spend_day_usd": round(st.day_usd, 4),
        "cap_total_usd": st.total_cap,
        "cap_day_usd": st.day_cap,
    }


def usage_from_response(response) -> tuple[int, int]:
    """LangChain 응답에서 (입력, 출력) 토큰을 꺼낸다. 없으면 (0, 0).

    공급자마다 키 이름이 달라 세 곳을 본다 — 못 읽어도 예외를 내지 않는다.
    토큰을 못 읽는 것이 서비스를 멈출 이유는 아니고, 그때는 0으로 세어
    **상한이 느슨해질 뿐** 화면은 정상 동작한다.
    """
    meta = getattr(response, "usage_metadata", None) or {}
    if meta:
        return int(meta.get("input_tokens", 0)), int(meta.get("output_tokens", 0))
    rm = getattr(response, "response_metadata", None) or {}
    usage = rm.get("usage") or rm.get("token_usage") or {}
    return (
        int(usage.get("prompt_tokens", usage.get("input_tokens", 0)) or 0),
        int(usage.get("completion_tokens", usage.get("output_tokens", 0)) or 0),
    )
