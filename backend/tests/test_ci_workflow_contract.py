"""CI 워크플로 계약 — ① `test` 잡의 교차 컨텍스트 의존 ② `ci.sh` 단계 ↔ `ci.yml` 잡 패리티.

## 왜 이 테스트가 있는가 (2026-08-03 실측)

이 저장소는 교차 빌드 컨텍스트 중복을 **물리적 병합이 아니라 "단일 소유자 + 계약
테스트"로 해소**한다(CLAUDE.md). 그 계약 테스트는 `sys.modules` 스왑으로 상대 컨텍스트의
모듈을 **실제로 불러** 값을 대조한다:

- `test_xp_contract` → celery `app.tasks.league` (`import celery` 필요)
- `test_kma_contract` → celery `app.core.kma_client`
- `test_gen_payload_contract` → ai-worker `app.chains.payload_contract`

즉 **backend 테스트를 돌리려면 celery·ai-worker 의존이 설치돼 있어야 한다.** 로컬 개발
환경에는 셋 다 깔려 있어 이 사실이 보이지 않는데, CI는 워크플로가 적어 준 것만 설치한다.

워크플로 신설(PR #20)은 `backend`·`ai-worker`만 설치하고 **celery를 빠뜨렸다.** 그래서
`test` 잡이 만들어진 순간부터 계약 7건이 `ModuleNotFoundError: No module named 'celery'`로
죽고 있었고, 같은 잡의 ai-worker 실패에 가려 두 스프린트 동안 원인이 오진됐다.

로컬 `pytest`로는 절대 잡히지 않는 종류다 — 검사 대상이 코드가 아니라 **CI 설정**이다.
그래서 워크플로 파일을 소스로 읽어 대조한다(`test_r10_mock_parity_contract`가 목 소스를
읽는 것과 같은 관례).

## 두 번째 계약 — 단계 패리티 (SN5, 2026-08-08)

같은 결함이 한 층 위에서 다시 났다. `scripts/ci.sh all`은 7단계를 도는데 `ci.yml`에는
잡이 6개였다 — **`seed` 단계가 GitHub에서 한 번도 돈 적이 없다**(CO-J-1). `step_seed`
주석은 *"저작 산출물이 CI에서 상시 검증되게 한다"*고 적었고 그 문장이 거짓이었다.
로컬 `ci.sh all`은 초록이라 아무도 몰랐다 — **로컬과 CI가 같은 단계 집합을 도는지 묻는
검사가 0건**이었기 때문이다.

그래서 `ci.sh`의 단계 정의(케이스 라벨·`step_*` 함수·`all` 목록·사용법 문안)와
`ci.yml`의 잡 키를 서로 대조한다. 의도적 예외는 `OPT_IN_STEPS`에 **사유와 함께** 적는다 —
검사를 끄는 게 아니라 끈 이유를 코드에 남기는 것이 이 계약의 본체다.

## 세 번째 계약 — `.env.example` ↔ `Settings` (CO-Q-9 / J-13, 2026-08-08)

같은 종류의 비대칭이 설정에도 있었다. `.env.example:60`의 `SESSION_RECIPE`는
**기재됐고 틀렸다** — 합 5(구버전)인데 실제 계약은 합 15다. 미기재보다 나쁜 형태다:
8/17 이후 "코드는 동결하고 env만 조정"하는 계획이 이 파일을 출발점으로 삼는데,
그대로 복사하면 세션이 15문항이 아니라 5문항이 된다. 조정 노브 3종
(`LEAGUE_DIVISION_SIZE`·`LEAGUE_NEIGHBOR_SPAN`·`GENERATED_ITEM_STATUS`)은 아예
없었다. 어느 쪽도 잡는 검사가 없었다 — 문서↔코드 계약 감시가 리포 전체에 2건뿐이다.

DB·네트워크 불필요. 실행: backend에서 `python -m pytest tests -q`.
"""
import json
import re
from pathlib import Path

import pytest

from app.core.config import Settings

REPO_ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = REPO_ROOT / ".github" / "workflows" / "ci.yml"
CI_SH = REPO_ROOT / "scripts" / "ci.sh"
ENV_EXAMPLE = REPO_ROOT / ".env.example"

# 파이썬 의존을 갖는 빌드 컨텍스트 — 새 컨텍스트가 생기면 여기 목록이 아니라
# 디렉토리 탐색이 알아서 잡는다(목록을 손으로 관리하면 그것부터 드리프트한다).
PY_CONTEXTS = sorted(
    p.parent.name for p in REPO_ROOT.glob("*/requirements.txt") if p.parent.is_dir()
)


@pytest.fixture(scope="module")
def workflow_text() -> str:
    if not WORKFLOW.exists():
        pytest.fail(f"{WORKFLOW}가 없다 — CI 상주화가 사라졌는지 확인")
    return WORKFLOW.read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def test_job(workflow_text: str) -> str:
    """`test:` 잡 블록만 잘라낸다 — 다른 잡의 설치 줄에 속지 않도록."""
    m = re.search(r"\n  test:\n(.*?)(?=\n  [a-z0-9_-]+:\n)", workflow_text, re.S)
    assert m, "워크플로에 `test:` 잡이 없다 — 잡 이름이 바뀌었으면 이 테스트도 고칠 것"
    return m.group(1)


class TestCiTestJobInstallsAllContexts:
    """`test` 잡이 모든 파이썬 컨텍스트의 requirements를 설치해야 한다."""

    def test_컨텍스트_탐색이_비어있지_않다(self):
        """탐색이 0건이면 아래 테스트가 조용히 통과한다 — 그것부터 막는다."""
        assert len(PY_CONTEXTS) >= 3, (
            f"파이썬 컨텍스트 탐색 결과가 {PY_CONTEXTS} — backend·ai-worker·celery가 "
            "모두 잡혀야 한다"
        )

    @pytest.mark.parametrize("context", PY_CONTEXTS)
    def test_requirements를_설치한다(self, context, test_job):
        """빠뜨리면 그 컨텍스트를 실임포트하는 계약 테스트가 CI에서만 죽는다."""
        needle = f"pip install -r {context}/requirements.txt"
        assert needle in test_job, (
            f"CI `test` 잡이 `{needle}`를 실행하지 않는다 — {context} 모듈을 "
            "실임포트하는 계약 테스트가 ModuleNotFoundError로 죽는다"
        )

    @pytest.mark.parametrize("context", PY_CONTEXTS)
    def test_pip_캐시_키에_포함한다(self, context, test_job):
        """캐시 키에서 빠지면 그 파일이 바뀌어도 낡은 캐시가 재사용된다."""
        assert f"{context}/requirements.txt" in test_job, (
            f"cache-dependency-path에 {context}/requirements.txt가 없다"
        )

    def test_pytest를_설치한다(self, test_job):
        assert "pip install pytest" in test_job, "CI가 pytest를 설치하지 않는다"

    def test_ci_sh를_재구현하지_않는다(self, test_job):
        """검사 명령은 `scripts/ci.sh`가 단일 소유자다 — 워크플로가 다시 적으면 드리프트한다."""
        assert "bash scripts/ci.sh test" in test_job, (
            "`test` 잡이 scripts/ci.sh를 호출하지 않는다 — pytest를 직접 실행하면 "
            "ci.sh의 단계 구성과 갈라진다"
        )
        assert "python -m pytest" not in test_job, (
            "워크플로가 pytest를 직접 실행한다 — 실행 방식은 ci.sh 소유다"
        )


# ─────────────────────────────────────────────────────────────────────────────
# SN5. `ci.sh` 단계 ↔ `ci.yml` 잡 패리티 (CO-J-1)
# ─────────────────────────────────────────────────────────────────────────────

# `all`에 들어가지 않고 CI 잡도 없어도 되는 단계 — **사유를 여기 적는 것이 계약**이다.
# 새 예외를 넣으려면 왜 CI에서 안 도는지를 함께 적어야 한다(빈 문자열 금지).
OPT_IN_STEPS = {
    "smoke": (
        "docker compose 기동·이미지 빌드까지 수행해 수 분이 걸린다 — 통합 브랜치·"
        "릴리스 전 `scripts/ci.sh smoke`로 단독 실행한다(ci.sh 머리 주석 · RUNBOOK)."
    ),
}

_CI_SH_TEXT = CI_SH.read_text(encoding="utf-8") if CI_SH.exists() else ""

# `all)` 케이스 한 줄이 전체 파이프라인의 단일 소유자다 — 이 줄의 `step_*` 호출을 읽는다.
_ALL_LINE = re.search(r"^\s*all\)(.*)$", _CI_SH_TEXT, re.M)
ALL_STEPS = re.findall(r"step_([a-z_]+)", _ALL_LINE.group(1)) if _ALL_LINE else []

# 단일 단계 인자: `  lint)     step_lint ;;` 형태 (all·`*)`는 제외).
CASE_LABELS = [
    label
    for label, _fn in re.findall(
        r"^\s+([a-z][a-z0-9_-]*)\)\s+step_([a-z_]+)", _CI_SH_TEXT, re.M
    )
    if label != "all"
]

# 실제로 정의된 `step_*` 함수.
STEP_FUNCS = set(re.findall(r"^step_([a-z_]+)\(\)", _CI_SH_TEXT, re.M))


def _split_usage(raw: str) -> list[str]:
    """`a|b|c` / `a | b | c` 어느 서식이든 단계 목록으로 쪼갠다."""
    return [tok.strip() for tok in raw.split("|") if tok.strip()]


def _workflow_jobs() -> set[str]:
    """`ci.yml`의 최상위 잡 키 집합.

    PyYAML은 backend/requirements.txt의 **직접** 의존은 아니지만
    `uvicorn[standard]`의 전이 의존이라 backend 환경에는 항상 있다(실측 확인).
    없는 환경에서 조용히 skip하면 이 계약이 무의미해지므로(CLAUDE.md: 환경 전역
    상태를 단정하지 말 것 · 조용한 skip 금지), 부재 시에는 정규식으로 최상위
    2칸 들여쓰기 키를 읽어 **계속 검사한다**.
    """
    text = WORKFLOW.read_text(encoding="utf-8")
    try:
        import yaml
    except ImportError:
        jobs_block = text.split("\njobs:\n", 1)[-1]
        return set(re.findall(r"^  ([a-z][a-z0-9_-]*):\s*$", jobs_block, re.M))
    return set(yaml.safe_load(text)["jobs"])


class TestCiStepJobParity:
    """`ci.sh`가 도는 단계와 GitHub가 도는 잡이 같은 집합인가."""

    def test_ci_sh_파싱이_비어있지_않다(self):
        """파싱이 0건이면 아래 검사가 전부 조용히 통과한다 — 그것부터 막는다."""
        assert CI_SH.exists(), f"{CI_SH}가 없다 — CI 파이프라인 단일 소유자가 사라졌다"
        assert len(ALL_STEPS) >= 5, f"`all)` 라인 파싱 결과가 {ALL_STEPS} — 서식이 바뀌었다"
        assert len(CASE_LABELS) >= 6, f"case 라벨 파싱 결과가 {CASE_LABELS} — 서식이 바뀌었다"

    @pytest.mark.parametrize("step", ALL_STEPS)
    def test_all_단계마다_ci_yml_잡이_있다(self, step):
        """`all`이 도는데 CI에 잡이 없으면 **로컬에서만 도는 게이트**가 된다(CO-J-1)."""
        jobs = _workflow_jobs()
        assert step in jobs, (
            f"`ci.sh all`이 도는 `{step}` 단계에 대응하는 잡이 ci.yml에 없다 — "
            f"GitHub에서 한 번도 돌지 않는다. 현재 잡: {sorted(jobs)}"
        )

    def test_ci_yml_잡마다_ci_sh_단계가_있다(self):
        """반대 방향 — 워크플로가 ci.sh에 없는 검사를 자체 구현하면 드리프트한다."""
        orphans = _workflow_jobs() - set(CASE_LABELS)
        assert not orphans, (
            f"ci.yml 잡 {sorted(orphans)}에 대응하는 `ci.sh` 단계가 없다 — 워크플로가 "
            "검사를 재구현했거나 단계 이름이 갈라졌다"
        )

    def test_all에서_빠진_단계는_사유가_적혀있다(self):
        """opt-in은 허용하되 **왜 빠졌는지**를 코드에 남기게 강제한다."""
        omitted = set(CASE_LABELS) - set(ALL_STEPS)
        assert omitted <= set(OPT_IN_STEPS), (
            f"단계 {sorted(omitted - set(OPT_IN_STEPS))}가 `all`에서 빠졌는데 사유가 "
            "없다 — OPT_IN_STEPS에 사유와 함께 적거나 `all`에 넣을 것"
        )
        for name, reason in OPT_IN_STEPS.items():
            assert reason.strip(), f"OPT_IN_STEPS['{name}'] 사유가 비어 있다"

    def test_case_라벨과_step_함수가_일치한다(self):
        """정의만 있고 부를 수 없는 단계 / 부르는데 없는 단계 양쪽을 막는다."""
        assert set(CASE_LABELS) == STEP_FUNCS, (
            f"case 라벨 {sorted(CASE_LABELS)} ≠ step_* 함수 {sorted(STEP_FUNCS)}"
        )

    def test_사용법_안내가_case_라벨과_일치한다(self):
        """인자 오류 시 출력하는 목록 — 실제와 다르면 사람이 없는 단계를 친다."""
        m = re.search(r"사용법: scripts/ci\.sh \[([^\]]+)\]", _CI_SH_TEXT)
        assert m, "`*)` 분기의 사용법 문자열을 찾지 못했다 — 서식이 바뀌었으면 이 테스트도 고칠 것"
        assert _split_usage(m.group(1)) == CASE_LABELS, (
            f"사용법 안내 {_split_usage(m.group(1))} ≠ 실제 case 라벨 {CASE_LABELS}"
        )

    def test_머리_주석_사용법이_case_라벨과_일치한다(self):
        """파일 머리 주석이 실제 단계와 갈라져 있었다(seed·authoring 누락)."""
        m = re.search(r"특정 단계만 실행: (.+)$", _CI_SH_TEXT, re.M)
        assert m, "머리 주석의 `특정 단계만 실행:` 줄을 찾지 못했다"
        listed = _split_usage(m.group(1))
        missing = [s for s in CASE_LABELS if s not in listed and s not in OPT_IN_STEPS]
        assert not missing, (
            f"머리 주석 사용법에 {missing} 단계가 빠졌다 (적힌 목록: {listed})"
        )


# ─────────────────────────────────────────────────────────────────────────────
# `.env.example` ↔ `Settings` 대조 (CO-Q-9 / J-13)
# ─────────────────────────────────────────────────────────────────────────────

# 값이 일부러 placeholder인 시크릿 — **이름 존재만** 본다. `.env.example`에 실값을
# 적는 순간 그것이 사고다(HACKATHON_RULES: API 키 노출 = 실격).
SECRET_FIELDS = frozenset(
    {"DATABASE_URL", "JWT_SECRET_KEY", "AI_WORKER_INTERNAL_API_KEY", "KMA_API_KEY"}
)

# J-13이 지목한 "조정 노브" — 8/17 이후 코드 동결 상태에서 env로만 만질 대상이다.
# 이름만 언급하고 값을 안 적으면 운영자가 계약값을 알 길이 없으므로, 이 목록만은
# **값까지 기재**돼 있어야 한다(SECRET_FIELDS의 이름-존재-만 규칙과 대비).
TUNING_KNOBS = (
    "SESSION_RECIPE",
    "UNIT_SESSION_SIZE",
    "CLOUD_MAX",
    "CLOUD_REGEN_MINUTES",
    "CLOUD_COST",
    "PLACEMENT_SIZE",
    "LEAGUE_DIVISION_SIZE",
    "LEAGUE_NEIGHBOR_SPAN",
    "GENERATED_ITEM_STATUS",
)

SETTINGS_FIELDS = sorted(Settings.model_fields)
_ENV_TEXT = ENV_EXAMPLE.read_text(encoding="utf-8") if ENV_EXAMPLE.exists() else ""


def _env_example_values() -> dict[str, str]:
    """`.env.example`의 `KEY=value` 표 — 주석 처리된 `# KEY=value`도 읽는다.

    조정 노브는 대부분 "주석 해제해 override" 관례라 주석 상태로 기재된다. 주석을
    건너뛰면 이 대조가 전부 무의미해진다.

    같은 키가 두 번 나오면(예: DATABASE_URL은 소유자 롤 줄 + 앱 롤 주석 줄) **주석
    아닌 줄을 우선**한다 — 실제로 적용되는 값이 그것이기 때문이다.
    """
    active: dict[str, str] = {}
    commented: dict[str, str] = {}
    for line in _ENV_TEXT.splitlines():
        m = re.match(r"^(#\s*)?([A-Z][A-Z0-9_]*)=(.*)$", line)
        if not m:
            continue
        target = commented if m.group(1) else active
        target.setdefault(m.group(2), m.group(3).strip())
    return {**commented, **active}


ENV_VALUES = _env_example_values()


def _coerce(name: str, raw: str):
    """`.env.example`의 문자열을 해당 필드 타입으로 — pydantic의 env 해석과 같은 규약."""
    ann = Settings.model_fields[name].annotation
    if ann is bool:
        return raw.strip().lower() in ("1", "true", "yes", "on")
    if ann is int:
        return int(raw)
    if ann is str:
        return raw
    # dict/list 계열은 env에서 JSON 문자열이다. 새로운 타입이 생기면 여기서 크게
    # 실패해야 한다 — 조용히 통과하면 대조가 무의미해진다.
    return json.loads(raw)


class TestEnvExampleContract:
    """`.env.example`을 그대로 복사한 운영자가 계약 수치를 얻는가."""

    def test_파싱이_비어있지_않다(self):
        assert ENV_EXAMPLE.exists(), f"{ENV_EXAMPLE}가 없다"
        assert len(ENV_VALUES) >= 15, f"`KEY=value` 파싱 결과가 {sorted(ENV_VALUES)} — 서식이 바뀌었다"
        assert len(SETTINGS_FIELDS) >= 15, "Settings 필드 탐색이 비었다"

    @pytest.mark.parametrize("name", SETTINGS_FIELDS)
    def test_모든_Settings_필드가_언급된다(self, name):
        """전 필드를 강제한다(J-13의 의도) — 노브 목록 없는 env 조정 계획을 막는다.

        `.env.example`에 값을 못 적는 필드(확정 전 · 계약값이 코드 소유)는 **이름만**
        주석으로 언급해도 통과한다. 그래야 다른 담당이 Settings에 필드를 추가할 때
        값 기재까지 강요당하지 않으면서도 "문서화 안 하고 지나가기"는 막힌다.
        """
        assert re.search(rf"\b{re.escape(name)}\b", _ENV_TEXT), (
            f"Settings.{name}이 .env.example에 한 번도 언급되지 않는다 — 8/17 이후 "
            "env만 조정하는 계획에서 이 노브는 존재하지 않는 것과 같다"
        )

    @pytest.mark.parametrize("name", [f for f in SETTINGS_FIELDS if f not in SECRET_FIELDS])
    def test_기재된_값이_Settings_기본값과_같다(self, name):
        """기재는 됐는데 틀린 것이 미기재보다 나쁘다 — SESSION_RECIPE 합 5가 그랬다."""
        if name not in ENV_VALUES:
            pytest.skip(f"{name}은 이름만 언급 — 값 대조 대상 아님")
        expected = Settings.model_fields[name].default
        assert _coerce(name, ENV_VALUES[name]) == expected, (
            f".env.example의 {name}={ENV_VALUES[name]!r} ≠ Settings 기본값 "
            f"{expected!r} — 이 파일을 복사한 운영자가 계약과 다른 값을 얻는다"
        )

    @pytest.mark.parametrize("name", TUNING_KNOBS)
    def test_조정_노브는_값까지_기재한다(self, name):
        assert name in Settings.model_fields, f"{name}은 Settings 필드가 아니다 — 목록을 고칠 것"
        assert name in ENV_VALUES, (
            f"조정 노브 {name}이 `.env.example`에 `KEY=value` 형태로 없다 — 이름만 "
            "언급해서는 운영자가 계약 기본값을 알 수 없다"
        )

    def test_시크릿은_실값이_아니다(self):
        """`.env.example`에 실키가 들어오면 그 자체가 사고다(제출 규정: 노출 = 실격)."""
        from app.core.config import SECRET_PLACEHOLDER_MARKERS

        for name in SECRET_FIELDS:
            value = ENV_VALUES.get(name, "")
            assert any(m in value for m in SECRET_PLACEHOLDER_MARKERS), (
                f".env.example의 {name} 값이 placeholder 마커"
                f"({SECRET_PLACEHOLDER_MARKERS})를 포함하지 않는다 — 실값이 커밋됐는지 확인"
            )
