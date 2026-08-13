import uuid
from datetime import date, datetime, timezone

from sqlalchemy import CheckConstraint, Date, DateTime, Integer, String, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.config import settings
from app.models.base import Base

# server_default는 클래스 정의 시점에 굳는 리터럴이라 함수를 못 쓴다.
_DEFAULT_CLOUDS = settings.CLOUD_MAX


class User(Base):
    __tablename__ = "users"
    # 값 목록은 weatherbrain_service.LEVEL_GROUP_BANDS·TONES와 같아야 한다
    # (모델이 서비스를 임포트하면 순환 — weatherbrain_service가 이 모델을 쓴다).
    # 이원 정의의 드리프트는 test_two_axis_levels가 감시한다. 마이그레이션 0012 참조.
    __table_args__ = (
        CheckConstraint(
            "level_group IN ('elementary', 'middle_high', 'adult', 'expert')",
            name="ck_users_level_group",
        ),
        CheckConstraint(
            "tone IS NULL OR tone IN ('child', 'teen', 'adult')",
            name="ck_users_tone",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    nickname: Mapped[str] = mapped_column(String(50), nullable=False)
    level_group: Mapped[str] = mapped_column(String(20), nullable=False)
    xp: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    streak_count: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )
    # 스트릭 프리즈("구름 방패") 보유 수 — R2-01 §3.5, 최대 2.
    # 파이썬측 default=0: flush 전 인스턴스의 None 산술 비교 방지 (리뷰 5번)
    streak_freeze_count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default=text("0")
    )
    last_login_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    # ── 구름 에너지 (R5-01 §3.3) — 스트릭 프리즈("구름 방패")와 독립 자원 ──
    # 파이썬측 default 포함: flush 전 인스턴스의 None 산술/시각 비교 방지 (R4 교훈)
    # ⚠️ 기본값은 **리터럴이 아니라 `settings.CLOUD_MAX`**여야 한다. MT-7로 만렙을
    # 5 → 10으로 올렸을 때 이 줄이 5로 남아, 신규·게스트 유저가 전부 **5/10으로**
    # 생성됐다 — 배지가 첫 화면부터 반쪽으로 보이고, 이미 다섯을 쓴 사람처럼
    # 시작한다. 정확히 MT-7이 겨냥한 인구다("5는 한 세션을 마치기 전에 바닥나서
    # 시작을 막는다"). 등록·게스트 경로 어디도 `clouds=`를 넘기지 않으므로 이
    # 기본값이 곧 신규 유저의 잔량이고, `dev.py`의 리셋은 이미 settings를 보고
    # 있어서 두 경로가 서로 다른 값을 쓰고 있었다(코드 리뷰 2026-08-12).
    clouds: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=lambda: settings.CLOUD_MAX,
        # server_default는 **기존 DB의 열 정의**라 마이그레이션 없이는 안 바뀐다.
        # 앱이 항상 값을 채우므로(위 default) 실효는 없지만, 새로 만드는 DB가
        # 앱과 같은 값을 갖도록 함께 올린다.
        server_default=text(str(_DEFAULT_CLOUDS)),
    )
    clouds_updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        default=lambda: datetime.now(timezone.utc),
        server_default=text("now()"),
    )
    # 배치고사(진단 퀴즈) 완료 시각 (R7-01 §3.1) — NULL이면 미완료(온보딩 진행 가능)
    placement_completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # 일일 목표 문항 수 (R10-01 §3.4·D4) — NULL이면 미설정(온보딩 커밋 스텝 노출).
    # 허용값 {3, 5, 9}는 API 계층에서 검증한다. SESSION_RECIPE(합 10)와 독립된
    # 표시용 타깃이라 세션 배합에 영향을 주지 않는다.
    daily_goal_items: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # 사용자 지역 (R11-01 §8.2) — NULL이면 서울(weather_api.user_region이 폴백의
    # 단일 소유자). courses의 NULL=weather와 같은 하위 호환 패턴: 기존 유저·게스트
    # 무변경, backfill 불필요. KMA_GRID 12도시 화이트리스트는 API 계층
    # (PUT /progress/region, 422)에서 검증한다 — daily_goal_items 선례(CHECK 제약
    # 없음: 도시 추가 시 마이그레이션 없이 KMA_GRID만 확장).
    region: Mapped[str | None] = mapped_column(String(20), nullable=True)
    # 표현 톤 (R13-0 §1 — 지식 수준과 분리된 두 번째 축). 가입 시 신고이고 거의
    # 안 바뀐다. NULL이면 level_group에서 파생(elementary→child·middle_high→teen·
    # adult/expert→adult) — 폴백의 단일 소유자는 weatherbrain_service.effective_tone.
    # region의 NULL=서울과 같은 하위 호환 패턴이라 기존 유저·게스트 무변경, backfill
    # 불필요. 설정 API는 이번 범위 밖(신고는 가입 시 — R13-0 §3.2).
    tone: Mapped[str | None] = mapped_column(String(16), nullable=True)
    # 학령을 **사용자가 직접 신고한 시각** (0015) — NULL이면 신고한 적이 없다,
    # 즉 `level_group`의 현재 값은 무정보 기본값(`GUEST_LEVEL_GROUP`)이다.
    #
    # ⚠️ 왜 필요한가: 온보딩의 「건너뛰기」(대회 규정상 로그인 없이 열려야 하므로
    # 필수)와 `/learn` 딥링크 진입은 학령을 묻지 않고 middle_high로 들어온다.
    # 그러면 실운영 로그에 **신고한 middle_high**와 **묻지 않은 middle_high**가
    # 같은 값으로 섞이고, 8/18 IRT b-재보정은 둘을 구분할 방법이 없다.
    # **로그는 되감을 수 없다** — 쌓인 뒤에는 "이 사람이 신고했었나"를 되살릴 수
    # 없으므로 DB가 비어 있는 지금이 유일하게 싼 시점이다.
    #
    # 왜 `declared|default` enum이 아니라 시각인가: enum의 상위집합이다. 건너뛴
    # 뒤 나중에 `PATCH /auth/me`로 신고한 사람의 로그는 **신고 시각 전후로 성격이
    # 갈리는데**, enum은 과거 로그까지 소급해서 declared로 물들인다. 시각이면
    # `answered_at < level_group_declared_at` 한 줄로 가른다.
    #
    # NULL=미신고는 region(0010)·tone(0012)과 같은 하위 호환 패턴이라 backfill이
    # 필요 없다 — 기존 행은 신고한 적이 없으므로 NULL이 곧 참값이다.
    # 기입 지점은 **명시 신고 경로 셋뿐**이고 그 경계는 auth.py의 `_declared_now`가
    # 단독으로 소유한다(기본값 경로에 도장이 찍히면 이 컬럼 전체가 무의미해진다).
    level_group_declared_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )

    quiz_logs: Mapped[list["QuizLog"]] = relationship(back_populates="user")  # noqa: F821
    weak_tags: Mapped[list["WeakTag"]] = relationship(back_populates="user")  # noqa: F821
    concept_abilities: Mapped[list["UserConceptAbility"]] = relationship(back_populates="user")  # noqa: F821
    attendances: Mapped[list["Attendance"]] = relationship(back_populates="user")  # noqa: F821
    league_results: Mapped[list["LeagueResult"]] = relationship(back_populates="user")  # noqa: F821
    sessions: Mapped[list["Session"]] = relationship(back_populates="user")  # noqa: F821
