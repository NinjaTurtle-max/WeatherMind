"""mock ↔ 서버 정합 계약 (스프린트 R10-07 §2.3, S3).

프론트 mock(`frontend/mock/apiMockPlugin.js`)은 손으로 쓴 픽스처라 서버가 실제로
내보내는 것과 조용히 어긋났다. R10-01·R10-07에서 같은 실패가 3번 반복됐다:
mock·프론트 스모크는 전부 초록인데 실서버 경로가 끊겨 있었고, 관찰 보고서의 수치
서술("첫날 세션 9문항 중 4개 중복")조차 mock 값이었다(실서버는 5문항).

**교정 후(이 커밋)**: mock은 `database/seed/content_items.json`을 읽어 보드 퍼즐·
배치고사·유닛 문항·실황 슬롯 문항을 파생하고, 세션 문항 수는 배합에서 파생한다.
그래서 이 계약은 "숫자 두 개"를 보는 것이 아니라 **목이 실제로 내보내는 페이로드**를
서버 계약과 대조한다 — mock이 `__mockFixtures()`로 노출하는 실값을 node로 읽는다
(소스 텍스트 파서는 파생 로직을 읽을 수 없어 폐기했다).

node가 없는 환경에서는 실값 대조가 skip되므로, **python만으로 도는 구조 계약**을
함께 둔다(시드 파일을 실제로 읽는가 · 배합 상수가 settings와 같은가) — 파생 링크가
조용히 끊기는 경로를 막는다.
"""
import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

from app.core.config import settings
from app.routers.session import QUESTION_PAYLOAD_FIELDS

REPO_ROOT = Path(__file__).resolve().parents[2]
MOCK_PATH = REPO_ROOT / "frontend" / "mock" / "apiMockPlugin.js"
SEED_PATH = REPO_ROOT / "database" / "seed" / "content_items.json"

NODE = shutil.which("node")
needs_node = pytest.mark.skipif(
    NODE is None, reason="node 미설치 — 목 실값 대조 불가 (구조 계약은 계속 돈다)"
)

# 어떤 목 응답에도 값이 실려선 안 되는 필드 (서버 화이트리스트와 같은 방어)
SECRET_FIELDS = ("correct_answer", "explanation_hint")
# 목 전용 채점 정보 — stripMock이 응답 직전 제거한다
MOCK_ONLY_KEYS = ("_mock",)


@pytest.fixture(scope="module")
def mock_src() -> str:
    assert MOCK_PATH.exists(), "apiMockPlugin.js 경로 변경 시 이 계약을 갱신할 것"
    return MOCK_PATH.read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def seed_items() -> list[dict]:
    return [
        item
        for item in json.loads(SEED_PATH.read_text(encoding="utf-8"))
        if item.get("status") == "active"
    ]


@pytest.fixture(scope="module")
def fixtures() -> dict:
    """목 모듈을 node로 import해 실제 내보내는 페이로드를 읽는다 (읽기 전용)."""
    if NODE is None:  # pragma: no cover - skip 마커가 먼저 걸린다
        pytest.skip("node 미설치")
    code = (
        f"const m = await import({str(MOCK_PATH.as_uri())!r});"
        "process.stdout.write(JSON.stringify(m.__mockFixtures()));"
    )
    proc = subprocess.run(
        [NODE, "--input-type=module", "-e", code],
        capture_output=True,
        text=True,
        timeout=120,
        cwd=MOCK_PATH.parent,
    )
    assert proc.returncode == 0, (
        "목 모듈 import 실패 — __mockFixtures export가 사라졌거나 목이 깨졌다:\n"
        f"{proc.stderr[-2000:]}"
    )
    return json.loads(proc.stdout)


def _walk(value, path="$"):
    """(경로, 키, 값) 재귀 순회 — 정답성 필드 유출 전수 검사용."""
    if isinstance(value, dict):
        for key, child in value.items():
            yield f"{path}.{key}", key, child
            yield from _walk(child, f"{path}.{key}")
    elif isinstance(value, list):
        for i, child in enumerate(value):
            yield from _walk(child, f"{path}[{i}]")


def _visible(item: dict) -> set[str]:
    """프론트가 읽을 수 있는 필드 — `question.X ?? question.template_json?.X` 폴백 반영."""
    fields = {k for k, v in item.items() if v is not None}
    fields |= set(item.get("template_json") or {})
    return fields


def _server_exposed(seed_items: list[dict]) -> dict[str, set[str]]:
    """시드 실데이터 × QUESTION_PAYLOAD_FIELDS = 서버가 유형별로 노출하는 필드."""
    server: dict[str, set[str]] = {}
    for item in seed_items:
        qtype = item["question_type"]
        template = item.get("template_json") or {}
        exposed = {
            key for key in QUESTION_PAYLOAD_FIELDS.get(qtype, ()) if key in template
        }
        if "options" in template:
            exposed.add("options")
        server.setdefault(qtype, set()).update(exposed)
    return server


class TestMockDerivesFromSeed:
    """구조 계약(python 전용) — 파생 링크와 배합 상수가 살아 있는가."""

    def test_시드_파일을_실제로_읽는다(self, mock_src):
        """board_rules.json 선례대로 content_items.json을 readFileSync로 읽는다."""
        assert re.search(
            r"readFileSync\(\s*resolve\(here,\s*'\.\./\.\./database/seed/content_items\.json'\)",
            mock_src,
        ), "목이 content_items.json을 읽지 않는다 — 손으로 베낀 사본은 드리프트한다"

    def test_보드_퍼즐이_시드_board에서_파생된다(self, mock_src):
        """🔴 **한 번 느슨해졌다가 되돌렸다**(2026-08-20, 클라이언트 판정).

        정렬을 `orderPuzzlesForProgress(...)`로 감싸자 대입 뒤 글자가 달라져 이
        계약이 울었다(파생 자체는 그대로였다). 그때 **정규식을 `[^;]*`으로 넓혀**
        통과시켰고, 근거는 *「코드를 정규식에 맞춰 비트는 쪽이 더 나쁘다」*였다.

        🔴 **결말: 넓히지도 비틀지도 않았다.** 판정이 「되돌린다」→「넓힘 유지」로
        오갔는데, 되돌리기를 **실제로 손으로 해 보다가 셋째 형태**가 나왔다:
        비교 함수 `byBoardOrder`를 빼서 **프로덕션과 표본이 그것을 공유**한다.
        그러면 ⑴ 이 정규식이 요구하는 파생 형태가 그대로 지켜지고 ⑵ 표본이 무는
        `orderPuzzlesForProgress`와 프로덕션이 **한 규칙**이라 사본이 안 생긴다.
        **계약도 코드도 무르지 않는다.** 어드바이저가 앞 판정을 개정해 이 안을
        채택했다.

        ⚠️ 남길 원칙: **「계약 vs 코드」 갈림이 오면 판정 전에 「둘 다 안 무르는
           셋째 형태가 있는가」를 먼저 묻는다.** 이 건은 판정자 둘이 연속으로
           이분법을 그대로 받았고, 셋째를 찾은 것은 **되돌리기를 실제로 해 본 쪽**
           이었다.
        ⚠️ 그리고 계약을 느슨하게 하는 것은 세션이 스스로 결정하지 않는다
           (같은 날 생긴 규정 — 이 건이 그 파이프의 첫 사례다).
        """
        assert re.search(
            r"const BOARD_PUZZLES = SEED_ITEMS\.filter\(\(it\) => it\.question_type === 'board'\)",
            mock_src,
        ), "BOARD_PUZZLES가 시드 파생이 아니다 — 숫자를 손으로 맞추면 다시 갈라진다"

    def test_보드_퍼즐_정렬이_표본과_같은_규칙을_쓴다(self, mock_src):
        """🔴 **공유가 이 안의 요점이라 공유 자체를 문다**(2026-08-20).

        정렬 규칙을 `byBoardOrder` 한 곳에 두고 **프로덕션(`BOARD_PUZZLES`)과
        표본(`orderPuzzlesForProgress` → `board_order_samples`)이 함께 쓰는 것**이
        「계약도 코드도 안 무르는 셋째 형태」의 핵심이다. 프로덕션만 다른 인라인
        정렬로 갈라 놓으면 **표본은 여전히 초록인데 화면 순서만 갈린다.**

        ⚠️ 되돌림에서 실제로 그랬다 — 프로덕션을 인라인 비교식으로 바꿔도
           **53건 전부 통과**했다. 시드가 정수만 써서 오늘 산출이 같기 때문이고,
           **행동 대조로는 못 잡는다**(오늘 세 번 밟은 「입력이 갈래를 안 밟아서
           초록」이 여기서도 성립한다). 그래서 **링크를 직접** 문다.
        """
        m = re.search(
            r"const BOARD_PUZZLES = SEED_ITEMS\.filter\([^\n]*\)\s*\n\s*\.sort\((\w+)\)",
            mock_src,
        )
        assert m, (
            "BOARD_PUZZLES가 이름 붙은 비교 함수로 정렬되지 않는다 — 인라인 정렬로 갈라지면 "
            "표본이 무는 규칙과 화면이 쓰는 규칙이 달라진다"
        )
        comparator = m.group(1)
        assert re.search(
            rf"const orderPuzzlesForProgress = \(items\) => items\.slice\(\)\.sort\({comparator}\)",
            mock_src,
        ), (
            f"표본이 무는 `orderPuzzlesForProgress`가 프로덕션과 다른 비교 함수를 쓴다 "
            f"(프로덕션: {comparator}) — 규칙 사본이 둘로 갈렸다"
        )

    def test_해설_출처를_서버와_같은_우선순위로_낸다(self, mock_src):
        """🔴 **사람이 쓴 해설에 「AI」 배지가 붙고 있었다**(2026-08-20 전수 대조).

        목이 `feedback_source`를 **아예 안 보냈고**, 화면(`FeedbackPanel`)이 부재를
        `ai`로 폴백한다. 그 파일 주석이 스스로 적어 두었다 —
        *「배점 ⑤(생성형 AI 활용)에 직결되는 표기 오류」*.

        서버 소유자는 `answer_service.feedback_source()`이고 **우선순위가 규칙**이다:
        board → `board`, 사람 저작 해설 있으면 → `authored`, 없으면 → `ai`.
        ⚠️ 값이 아니라 **우선순위**를 문다 — board인데 hint도 있는 문항에서
           `authored`로 새면 「사람 글」과 「보드 판정」이 뒤바뀐다.
        """
        from app.services.answer_service import feedback_source

        cases = [
            {"question_type": "board", "explanation_hint": "사람이 쓴 해설"},
            {"question_type": "board"},
            {"question_type": "multiple_choice", "explanation_hint": "사람이 쓴 해설"},
            {"question_type": "multiple_choice", "explanation_hint": "   "},
            {"question_type": "multiple_choice"},
            {"question_type": "slider", "explanation_hint": "사람이 쓴 해설"},
        ]
        out = subprocess.run(
            [
                "node", "--input-type=module", "-e",
                "import { __feedbackSourceOf } from "
                f"'{MOCK_PATH}';"
                "const cs = JSON.parse(process.argv[1]);"
                "process.stdout.write(JSON.stringify("
                "cs.map((c) => __feedbackSourceOf(c.question_type, c))));",
                "--", __import__("json").dumps(cases),
            ],
            capture_output=True, text=True, timeout=60,
        )
        assert out.returncode == 0, f"목 함수 호출 실패:\n{out.stdout}\n{out.stderr}"
        got = __import__("json").loads(out.stdout)
        want = [feedback_source(c) for c in cases]
        assert got == want, (
            f"해설 출처 규칙이 갈렸다 — 목 {got} vs 서버 {want}\n"
            "  (부재를 화면이 `ai`로 폴백하므로, 갈리면 사람 글에 AI 배지가 붙는다)"
        )

    def test_해설_출처를_응답에_싣는다(self, mock_src):
        """🔴 **규칙이 맞아도 안 실으면 소용없다** — 원래 결함이 바로 그것이었다.

        앞 검사는 파생 **규칙**을 문다. 되돌림에서 확인했다: 규칙은 그대로 두고
        **호출부만** 상수로 바꿨더니 앞 검사가 **통과**했다. 목이 값을 안 실으면
        화면은 다시 `ai`로 폴백한다 — 고치기 전과 같은 상태다.
        ⇒ 답안 응답이 그 값을 **실제로 싣는지**, 그리고 그 값이 **파생분인지**를 문다.

        ⚠️ 한계: 소스 문자열 검사다. 실행 대조는 `frontend/scripts/mock_capture.mjs`가
           하고, 그쪽은 **분기 하나만** 밟는다(만회 분기·보드 분기는 표본 밖).
           그래서 여기서는 **답안 응답 자리 수만큼** 실렸는지를 센다.
        """
        # ⚠️ 선별식은 **답안 결과 객체**만 잡아야 한다. 처음엔 `is_correct: isCorrect,`로
        #    썼다가 배치 일괄채점 등 6자리를 잡아 **기준선에서 빨강**이 났다 —
        #    계약이 코드를 틀렸다고 한 것이 아니라 **선별식이 틀렸다.**
        #    답안 결과는 `feedback`을 `_mock`의 정·오답 문구로 고르는 자리다.
        results = re.findall(
            r"feedback: isCorrect \? item\._mock\.feedbackCorrect", mock_src
        )
        carried = re.findall(r"feedback_source: item\._mock\.feedbackSource", mock_src)
        assert results, "답안 응답 자리를 못 찾았다 — 선별식이 낡았다(공허 통과 방지)"
        assert len(carried) == len(results), (
            f"답안 응답 {len(results)}자리 중 {len(carried)}곳만 `feedback_source`를 싣는다 "
            "— 안 싣는 자리는 화면이 `ai`로 폴백해 사람 글에 AI 배지가 붙는다"
        )
        # 🔴 **파생 링크도 문다.** 되돌림에서 확인했다: 규칙 함수와 응답 적재를 그대로
        #    두고 **그 사이 호출부만** 상수로 바꿨더니 앞의 두 검사가 **둘 다 통과**했다.
        #    그러면 모든 문항이 `ai`가 되어 고치기 전과 같다 — 사슬은 **세 마디**다:
        #    규칙(`feedbackSourceOf`) → 파생(`seedGrading`) → 적재(응답).
        assert re.search(
            r"const feedbackSource = feedbackSourceOf\(", mock_src
        ), (
            "`seedGrading`이 `feedbackSourceOf`로 파생하지 않는다 — 규칙과 응답이 멀쩡해도 "
            "그 사이가 상수면 모든 문항이 같은 출처가 된다"
        )
        assert "feedback_source: 'ai'" not in mock_src, (
            "`feedback_source`를 상수로 박았다 — 파생이 아니면 서버 규칙이 바뀔 때 조용히 갈린다"
        )

    def test_목의_하루_경계가_KST다(self, mock_src):
        """목의 "오늘" == 서버의 "오늘" (KST). R10-01 D9 — 웨이브 2 확인 항목.

        서버는 `datetime.now(KST).date()`로 하루를 정의하는데(`kst_day_start_utc`)
        목은 R2부터 `new Date().toISOString()` = **UTC**를 썼다. UTC 15:00~24:00
        구간(= KST 익일 00:00~09:00)에서 서버가 하루 앞서므로, **목의 하루가
        09:00 KST에 넘어갔다** — 자정 리셋을 기대하는 화면이 목에서는 오전 9시에
        리셋되는 것으로 보였다(실서버는 정상, 목만 시프트).

        `session_date`·`quiz_id` 채번이 전부 `todayISO()` 하나에서 파생되므로
        경계는 이 함수 한 곳만 지키면 된다.
        """
        assert re.search(r"const KST_OFFSET_MS = 9 \* 60 \* 60 \* 1000", mock_src), (
            "KST 오프셋 상수가 없다 — 목의 하루가 다시 UTC로 돌아갔는지 확인"
        )
        assert re.search(
            r"const todayISO = \(\) => kstDate\(Date\.now\(\)\)\.toISOString\(\)",
            mock_src,
        ), "todayISO가 KST 기준이 아니다 — 목의 하루가 09:00 KST에 넘어간다"
        bare = re.findall(r"new Date\(\)\.toISOString\(\)\.slice\(0, 10\)", mock_src)
        assert bare == [], (
            f"UTC 기준 날짜 계산이 {len(bare)}곳 남아 있다 — kstDate()를 거쳐야 한다"
        )

    def test_배합_상수가_SESSION_RECIPE와_동일(self, mock_src):
        """목 배합 상수 == Settings.SESSION_RECIPE (env 기본값=계약값)."""
        m = re.search(r"const MOCK_SESSION_RECIPE = \{([^}]*)\}", mock_src)
        assert m, "MOCK_SESSION_RECIPE 상수를 못 찾음 — 파생 규칙이 바뀌었다"
        recipe = {
            key: int(value)
            for key, value in re.findall(r"(\w+):\s*(\d+)", m.group(1))
        }
        assert recipe == settings.SESSION_RECIPE, (
            f"목 배합 {recipe} vs 서버 배합 {settings.SESSION_RECIPE} — "
            "mock 기반 관찰이 실서버 규모를 왜곡한다(관찰 보고서 §1의 분모 9가 이것)"
        )

    def test_정답성_필드는_시드에서_읽지만_페이로드에_넣지_않는다(self, mock_src):
        """유형별 화이트리스트가 서버 QUESTION_PAYLOAD_FIELDS와 같은 집합인가."""
        m = re.search(
            r"const QUESTION_PAYLOAD_FIELDS = \{(.*?)\n\};", mock_src, re.S
        )
        assert m, "목 QUESTION_PAYLOAD_FIELDS 사본을 못 찾음"
        block = m.group(1)
        mock_map: dict[str, set[str]] = {}
        for qtype, body in re.findall(r"(\w+):\s*\[(.*?)\]", block, re.S):
            mock_map[qtype] = set(re.findall(r"'([^']+)'", body))
        server_map = {k: set(v) for k, v in QUESTION_PAYLOAD_FIELDS.items()}
        assert mock_map == server_map, (
            f"유형별 화이트리스트 드리프트 — mock {mock_map} vs server {server_map}"
        )
        for qtype, fields in mock_map.items():
            leaked = fields & set(SECRET_FIELDS)
            assert not leaked, f"{qtype} 화이트리스트에 정답성 필드: {leaked}"


@needs_node
class TestMockPureNodeImportable:
    """mock의 전이 import 그래프에 bare 지정자(패키지 import)가 없어야 한다.

    이 파일의 다른 테스트들이 mock을 **순수 node 서브프로세스**로 실행한다 — CI
    `test` 잡에는 node_modules가 없으므로, mock이 상대 경로 사슬 어딘가에서 패키지를
    끌면 CI에서만 `ERR_MODULE_NOT_FOUND`로 죽는다. 실제로 그랬다(2026-08-04, PR #25):
    lib 사전 getter화로 mock → tierMeta → i18n/index.js → **zustand** 사슬이 생겨
    로컬(node_modules 있음)은 통과하고 CI만 죽었다. 해소는 i18n을 순수 코어
    (core.js)와 스토어(index.js)로 분리 — 이 테스트는 그 사슬이 되살아나는 것을
    **로컬에서** 잡는다(서브프로세스 실행 없이 정적 그래프 순회라 항상 돈다).
    """

    def test_전이_import에_bare_지정자가_없다(self):
        import re

        frontend = REPO_ROOT / "frontend"
        seen: set = set()
        queue = [frontend / "mock" / "apiMockPlugin.js"]
        bare: list[str] = []
        pattern = re.compile(
            r"import\s+(?:[\w{},*\s]+\s+from\s+)?['\"]([^'\"]+)['\"]"
        )
        while queue:
            f = queue.pop()
            if f in seen or not f.exists():
                continue
            seen.add(f)
            for m in pattern.finditer(f.read_text(encoding="utf-8")):
                spec = m.group(1)
                if spec.startswith("."):
                    t = (f.parent / spec).resolve()
                    if t.is_dir():
                        t = t / "index.js"
                    if not t.suffix:
                        t = t.with_suffix(".js")
                    queue.append(t)
                elif not spec.startswith("node:"):
                    bare.append(f"{f.relative_to(frontend)} → {spec}")
        assert len(seen) > 1, "그래프 순회가 mock 한 파일에서 멈췄다 — 경로 확인"
        assert not bare, (
            "mock의 전이 import가 패키지를 끈다(CI 순수 node에서 죽는다): "
            + ", ".join(bare)
            + " — 순수 코어(i18n/core.js류)로 옮기거나 사슬을 끊을 것"
        )


class TestMockServerParity:
    """실값 대조 — 목이 내보내는 페이로드가 서버 계약과 같은가."""

    def test_시드를_실제로_읽었다(self, fixtures):
        """폴백 픽스처로 조용히 통과하는 경로 차단 (§2.2 공허 통과 방지)."""
        assert fixtures["seed_source"] == "seed", (
            "목이 폴백 픽스처를 썼다 — content_items.json 경로/파싱을 확인할 것"
        )

    def test_세션_문항수가_SESSION_RECIPE_총합(self, fixtures):
        recipe_total = sum(settings.SESSION_RECIPE.values())
        mock_count = len(fixtures["session_items"])
        assert mock_count == recipe_total, (
            f"mock 세션 items {mock_count}건 vs 서버 배합 총합 {recipe_total}건 — "
            "mock 기반 관찰이 실서버 규모를 왜곡한다"
        )
        assert fixtures["session_recipe"] == settings.SESSION_RECIPE

    def test_보드_퍼즐수가_시드_board_문항수(self, fixtures, seed_items):
        seed_boards = sum(1 for it in seed_items if it["question_type"] == "board")
        mock_count = len(fixtures["board_puzzles"])
        assert mock_count == seed_boards, (
            f"mock BOARD_PUZZLES {mock_count}건 vs 시드 board {seed_boards}건 — "
            "mock으로는 퍼즐 커버리지를 판단할 수 없다"
        )

    def test_실황_슬롯이_치환된다(self, fixtures):
        """`{today.*}` 원문이 남으면 유저에게 슬롯 문자열이 보인다(서버 폴백 규칙)."""
        live = [it for it in fixtures["session_items"] if it["slot_filled"]]
        assert live, "세션에 실황 슬롯 문항이 없다 — 배합의 live 슬롯이 비었다"
        for item in live:
            blob = json.dumps(item, ensure_ascii=False)
            assert "{today." not in blob, f"미치환 슬롯 노출: {item['quiz_id']}"

    def test_유형별_필드가_서버_이상(self, fixtures, seed_items):
        """mock 유형별 필드 집합 ⊇ 서버 노출 집합 (모든 목 문항 표면 합산).

        서버가 내보내기 시작한 필드를 mock이 안 갖고 있으면, mock에서만 초록인
        (또는 반대로 mock에서만 렌더되는) 드리프트가 다시 생긴다.
        """
        server = _server_exposed(seed_items)
        mock: dict[str, set[str]] = {}
        surfaces = [
            *fixtures["session_items"],
            *fixtures["placement_items"],
            *[it for unit in fixtures["unit_items"] for it in unit["items"]],
        ]
        for item in surfaces:
            mock.setdefault(item["question_type"], set()).update(_visible(item))
        # 보드 퍼즐 목록/상세도 board 유형의 목 표면이다 (GET /board/puzzles)
        for puzzle in fixtures["board_puzzles"]:
            mock.setdefault("board", set()).update(puzzle.get("template_json") or {})

        problems = []
        for qtype, exposed in server.items():
            if qtype not in mock:
                continue  # 목 커버리지 부족은 아래 유형 커버리지 계약이 다룬다
            missing = exposed - mock[qtype]
            if missing:
                problems.append(f"{qtype}: mock에 없는 서버 필드 {sorted(missing)}")
        assert not problems, "mock↔서버 유형별 필드 드리프트:\n  " + "\n  ".join(problems)

    def test_페이로드가_서버와_같은_자리에_있다(self, fixtures):
        """`pairs`·`items`·`shuffled`·`min/max/step/unit`은 **template_json 안**에 있다.

        서버 _question_payload가 그 자리에 넣으므로, 목이 최상위에 두면 최상위만 읽는
        컴포넌트가 새로 쓰여도 목에서만 초록이 된다(R10-07 결함의 재발 경로).
        """
        payload_keys = {
            key for keys in QUESTION_PAYLOAD_FIELDS.values() for key in keys
        } - {"question_text"}  # question_text는 SessionItem 최상위에도 있는 필드
        misplaced = []
        for item in [*fixtures["session_items"], *fixtures["placement_items"]]:
            for key in payload_keys & set(item):
                misplaced.append(f"{item['quiz_id']}({item['question_type']}): {key}")
        assert not misplaced, (
            "유형 페이로드가 최상위에 있다(서버는 template_json 안):\n  "
            + "\n  ".join(misplaced)
        )

    def test_유형_커버리지(self, fixtures):
        """목이 7유형을 전부 실제로 내보낸다 — 유형별 필드 계약이 헛돌지 않게."""
        types = {it["question_type"] for it in fixtures["session_items"]}
        types |= {it["question_type"] for it in fixtures["placement_items"]}
        types |= {
            it["question_type"]
            for unit in fixtures["unit_items"]
            for it in unit["items"]
        }
        missing = set(QUESTION_PAYLOAD_FIELDS) | {
            "multiple_choice",
            "short_answer",
            "cloze",
        }
        assert not (missing - types), f"목이 내보내지 않는 유형: {sorted(missing - types)}"

    def test_정답성_필드가_어떤_응답에도_없다(self, fixtures):
        """correct_answer·explanation_hint·_mock이 목 응답 페이로드에 없다.

        (채점 정보는 `_mock` 안에만 두고 stripMock이 제거하는 것이 목의 규약이다.)
        """
        leaks = []
        for surface in ("session_items", "placement_items", "board_puzzles", "unit_items"):
            for path, key, value in _walk(fixtures[surface], surface):
                if key in MOCK_ONLY_KEYS:
                    leaks.append(f"{path} (목 전용 채점 정보)")
                if key in SECRET_FIELDS and value not in (None, "", [], {}):
                    leaks.append(f"{path} = {str(value)[:40]!r}")
        assert not leaks, "목이 응답에 정답성/내부 필드를 노출:\n  " + "\n  ".join(leaks)

    def test_보드_퍼즐이_렌더_필수_필드를_갖는다(self, fixtures):
        """서버 board 화이트리스트의 렌더 필수 집합(test_session_board_item)과 동일."""
        required = ("question_text", "mode", "initial_state", "palette", "goal_conditions", "hints")
        broken = []
        for puzzle in fixtures["board_puzzles"]:
            template = puzzle.get("template_json") or {}
            for field in required:
                if field not in template:
                    broken.append(f"{puzzle['content_item_id']}: {field} 없음")
            if puzzle.get("difficulty") not in (1, 2, 3):
                broken.append(f"{puzzle['content_item_id']}: difficulty={puzzle.get('difficulty')}")
        assert not broken, "목 보드 퍼즐 렌더 필드 누락:\n  " + "\n  ".join(broken)

    def test_지도_좌표가_시드와_같다(self, fixtures):
        """board_regions.json 사본이 아니라 파일 파생인지 실값으로 확인."""
        seed_regions = json.loads(
            (REPO_ROOT / "database" / "seed" / "board_regions.json").read_text(
                encoding="utf-8"
            )
        )
        assert fixtures["board_regions"] == seed_regions, (
            "목 BOARD_REGIONS가 시드 board_regions.json과 다르다(사본 드리프트)"
        )
