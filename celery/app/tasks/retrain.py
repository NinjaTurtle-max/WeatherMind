"""(d) 매일 새벽 3시 — WeatherBrain 재학습 (문항난이도 b 보정). R6 §5.

누적 quiz_logs에서 뱅크 문항(content_item_id 존재)의 응답을 모아 ai-worker
/internal/weatherbrain/calibrate로 보내 IRT 결합추정으로 난이도 b를 재보정하고,
그 결과를 item_params에 upsert한다. 수학은 ai-worker가 소유(무상태 계약)하며 celery는
데이터 조립·영속화만 담당한다.

휴면-정확 설계: 신규 서비스라 데이터가 희소하면 안정적 추정이 불가능하므로, 최소
표본 가드(문항당·전체 응답 수)를 통과할 때만 보정한다. 미달이면 스킵(현행 사전값 유지).
콜드스타트 동안에도 능력 θ 추정은 level_group 사전 난이도로 정상 동작한다.
"""
import logging

from celery import shared_task
from sqlalchemy import text

from app.db import get_engine
from app.internal_api import ai_worker_post

logger = logging.getLogger(__name__)

# 최소 표본 가드 — 이 미만이면 보정하지 않는다(과적합·불안정 방지).
MIN_TOTAL_RESPONSES = 200      # 전체 채점 응답 수
MIN_RESPONSES_PER_ITEM = 20    # 문항당 응답 수(이 미만 문항은 보정 대상에서 제외)


@shared_task(name="app.tasks.retrain.retrain_weatherbrain")
def retrain_weatherbrain():
    engine = get_engine()
    with engine.begin() as conn:
        # 뱅크 문항(content_item_id NOT NULL)의 채점 응답만 — 생성 문항은 개별 보정 불가.
        rows = conn.execute(
            text(
                "SELECT user_id::text AS user_id, content_item_id::text AS item_id, "
                "is_correct "
                "FROM quiz_logs "
                "WHERE content_item_id IS NOT NULL AND is_correct IS NOT NULL"
            )
        ).all()

        # 문항당 응답 수 가드 — 표본이 얇은 문항은 제외.
        per_item: dict[str, int] = {}
        for _, item_id, _c in rows:
            per_item[item_id] = per_item.get(item_id, 0) + 1
        eligible = {i for i, n in per_item.items() if n >= MIN_RESPONSES_PER_ITEM}

        responses = [
            {"user_id": u, "item_id": i, "correct": bool(c)}
            for u, i, c in rows
            if i in eligible
        ]

        if len(responses) < MIN_TOTAL_RESPONSES or not eligible:
            logger.info(
                "[retrain] 표본 부족 — 스킵 (응답=%d/%d, 보정대상 문항=%d)",
                len(responses),
                MIN_TOTAL_RESPONSES,
                len(eligible),
            )
            return {
                "status": "skipped",
                "reason": "insufficient-data",
                "responses": len(responses),
                "eligible_items": len(eligible),
            }

        # ai-worker에 IRT 결합추정 위임 → {item_b: {item_id: b}, ...}
        result = ai_worker_post(
            "/internal/weatherbrain/calibrate",
            {"responses": responses},
            timeout=120.0,
        )
        item_b: dict[str, float] = result.get("item_b", {})

        # item_params upsert (content_item_id 유니크). calibrated_n = 그 문항 응답 수.
        for item_id, b in item_b.items():
            conn.execute(
                text(
                    "INSERT INTO item_params "
                    "(content_item_id, b, a, calibrated_n, updated_at) "
                    "VALUES (:item_id, :b, 1.0, :n, now()) "
                    "ON CONFLICT ON CONSTRAINT uq_item_params_content_item "
                    "DO UPDATE SET b = EXCLUDED.b, calibrated_n = EXCLUDED.calibrated_n, "
                    "updated_at = now()"
                ),
                {"item_id": item_id, "b": float(b), "n": per_item.get(item_id, 0)},
            )

    logger.info("[retrain] WeatherBrain 문항난이도 보정 완료 — 문항 %d개", len(item_b))
    return {
        "status": "ok",
        "calibrated_items": len(item_b),
        "responses": len(responses),
    }
