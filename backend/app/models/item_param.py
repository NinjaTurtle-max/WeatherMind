"""item_params — WeatherBrain 문항 IRT 파라미터(난이도 b) 영속화. R6 §5.

뱅크 문항(content_items)별 보정된 난이도 b·변별도 a를 저장한다. 전역 자산(RLS 없음)
으로, celery 재학습이 누적 quiz_logs를 ai-worker /weatherbrain/calibrate로 보내
b를 재추정한 뒤 여기에 upsert한다. 보정 이력이 없는 문항은 이 테이블에 행이 없으며,
그 경우 소비자는 level_group 기반 사전 난이도(priors.prior_item_b)로 폴백한다.

생성(generated) 문항은 content_item_id가 없어 개별 보정 대상이 아니다(사전값 사용).
"""

import uuid
from datetime import datetime

from sqlalchemy import (
    DateTime,
    Float,
    ForeignKey,
    Integer,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class ItemParam(Base):
    __tablename__ = "item_params"
    __table_args__ = (
        UniqueConstraint("content_item_id", name="uq_item_params_content_item"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    content_item_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("content_items.id"), nullable=False
    )
    # 문항 난이도 b (로짓 스케일). 변별도 a는 v1에서 1.0 고정(희소데이터 안정성).
    b: Mapped[float] = mapped_column(Float, nullable=False, server_default=text("0"))
    a: Mapped[float] = mapped_column(Float, nullable=False, server_default=text("1"))
    calibrated_n: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )
