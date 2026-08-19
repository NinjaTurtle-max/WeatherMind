"""과거 예보(hindcast) 시도 기록 — MT-30.

회차(case)는 코드 픽스처가 소유하므로 테이블에는 **유저의 시도만** 남는다
(`hindcast_service.HINDCAST_CASES`가 회차의 단일 진실원).

`duels`를 재사용하지 않은 이유(설계 결정): duel 정산 배치
(`celery settle_daily_duel`)가 `actual IS NULL AND duel_date <= 어제`인 행을
**7일 백필 창**으로 훑는다. 과거 날짜 행을 `duels`에 넣으면 그 배치가 남의
채점 결과를 KMA 실측으로 덮어쓰거나, UNIQUE(user_id, duel_date)가 실제 대결과
충돌한다. 축을 갈라 두는 것이 싸다.

채점은 **제출 시점에 서버가 동기로 확정**한다(실측이 이미 픽스처에 있으므로 정산
배치가 필요 없다) — 그래서 actual·user_score·ai_score·result가 NULL로 남는 상태가
없다. UNIQUE(user_id, case_id)로 회차당 1회를 DB가 보증한다(재제출 409):
없으면 정답이 고정된 회차를 반복 제출해 100점을 긁을 수 있다.

RLS user_isolation은 0001/0004 패턴 복제(마이그레이션 0016).
"""
import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Numeric,
    String,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class HindcastAttempt(Base):
    __tablename__ = "hindcast_attempts"
    __table_args__ = (
        UniqueConstraint("user_id", "case_id", name="uq_hindcast_attempts_user_case"),
        CheckConstraint(
            "result IN ('win', 'lose', 'draw')", name="ck_hindcast_attempts_result"
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    # 픽스처 회차 id(`hindcast_service.HINDCAST_CASES[*]["case_id"]`).
    # FK를 걸 대상 테이블이 없다 — 회차는 코드가 소유한다.
    case_id: Mapped[str] = mapped_column(String(64), nullable=False)
    user_pred: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    ai_pred: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    # 채점에 쓴 실측값 스냅샷(이진화된 rain_prob 포함) — 픽스처 값이 나중에 공식
    # 관측으로 교정돼도 과거 판정의 근거가 남는다.
    actual: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    user_score: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False)
    ai_score: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False)
    result: Mapped[str] = mapped_column(String(4), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
