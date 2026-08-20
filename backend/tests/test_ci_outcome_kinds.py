"""`scripts/lib/test_outcome.sh` — 종목 종료의 **갈래 판정** 계약.

🔴 왜 이 파일이 있나(2026-08-20 FU-18, 클라이언트 지시
*"점검 도구가 「틀렸다」와 「안 돌았다」를 갈라 보고하게 고쳐"*).

`ci.sh`의 frontend 단계가 종목 **이름만** 모아 「테스트 실패: home guest-convert」로
적었다. 그래서 성격이 다른 셋이 한 문장으로 뭉개졌다 — 단정이 틀렸다 /
**파일이 아예 안 돌았다** / 돌다가 죽었다.

실제 사고: 닫는 중괄호가 하나 빠져 `learnPath`가 **로드조차 안 됐는데** `FAIL` 줄이
없어서 「알려진 흔들림」으로 오진할 뻔했다. 흔들림으로 읽었으면 그 파일의 계약을
통째로 잃은 채 배포했다.

⚠️ **이 파일은 갈래 판정 자체를 문다.** 판정이 사라지거나 뭉개지면 여기서 운다.
   종목 목록(`FRONT_TESTS`)이나 단계 구성은 `test_ci_workflow_contract.py` 몫이다 —
   같은 것을 두 곳에서 물지 않는다.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
LIB = ROOT / "scripts" / "lib" / "test_outcome.sh"
CI_SH = ROOT / "scripts" / "ci.sh"


def _run(snippet: str) -> str:
    """라이브러리를 소스한 뒤 한 줄을 실행하고 표준출력을 돌려준다."""
    out = subprocess.run(
        ["bash", "-c", f'set -e; . "{LIB}"; {snippet}'],
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert out.returncode == 0, f"스크립트가 죽었다:\n{out.stdout}\n{out.stderr}"
    return out.stdout.strip()


def _log(tmp_path: Path, name: str, body: str) -> Path:
    p = tmp_path / name
    p.write_text(body, encoding="utf-8")
    return p


# ── 세 갈래를 **다르게** 적는가 ────────────────────────────────────────────
# 종목 셋을 흉내낸다: 단정 실패 / 일부러 깨진 구문 / 중간 예외.
FAKE_FAIL = "PASS 첫 단정\nFAIL 둘째 단정이 틀렸다\nPASS 셋째\n실패 1건\n"
FAKE_NOSTART = (
    "file:///x/tests/learnPath.smoke.test.mjs:120\n"
    "        }\n"
    "        ^\n"
    "SyntaxError: Unexpected token '}'\n"
)
FAKE_DEAD = (
    "PASS 첫 단정\nPASS 둘째 단정\n"
    "TypeError: Cannot read properties of null (reading 'useEffect')\n"
    "    at Object.<anonymous> (/x/y.js:1:1)\n"
)


class TestClassifyThreeKinds:
    def test_단정_실패는_fail로_센다(self, tmp_path):
        log = _log(tmp_path, "a.log", FAKE_FAIL)
        assert _run(f'classify_test_outcome 1 "{log}"') == "fail:1"

    def test_안_돌은_것은_nostart다(self, tmp_path):
        log = _log(tmp_path, "b.log", FAKE_NOSTART)
        assert _run(f'classify_test_outcome 1 "{log}"') == "nostart"

    def test_돌다_죽은_것은_dead다(self, tmp_path):
        log = _log(tmp_path, "c.log", FAKE_DEAD)
        assert _run(f'classify_test_outcome 1 "{log}"') == "dead:2"

    def test_정상_종료는_ok다(self, tmp_path):
        log = _log(tmp_path, "d.log", "PASS 하나\nOK: 통과\n")
        assert _run(f'classify_test_outcome 0 "{log}"') == "ok"

    def test_세_갈래가_서로_다르다(self, tmp_path):
        """🔴 **이 검사가 본론이다.** 셋이 같은 문자열로 뭉개지는 것이 결함이었다."""
        kinds = {
            _run(f'classify_test_outcome 1 "{_log(tmp_path, n, b)}"')
            for n, b in (
                ("f.log", FAKE_FAIL),
                ("n.log", FAKE_NOSTART),
                ("d2.log", FAKE_DEAD),
            )
        }
        assert len(kinds) == 3, f"갈래가 뭉개졌다: {sorted(kinds)}"


class TestDescribeSaysWhich:
    """요약 문장에서도 갈라져야 한다 — 사람이 읽는 것은 갈래 토큰이 아니라 이 줄이다."""

    def test_안_돌은_종목은_그렇게_적힌다(self, tmp_path):
        log = _log(tmp_path, "n.log", FAKE_NOSTART)
        line = _run(f'describe_test_outcome learnPath nostart "{log}"')
        assert "안 돌았다" in line, line
        assert "SyntaxError" in line, f"원인 낱말이 빠졌다: {line}"

    def test_죽은_종목은_몇_건_뒤인지_적는다(self, tmp_path):
        log = _log(tmp_path, "d.log", FAKE_DEAD)
        line = _run(f'describe_test_outcome home dead:2 "{log}"')
        assert "죽었다" in line and "2" in line, line

    def test_단정_실패는_건수를_적는다(self, tmp_path):
        log = _log(tmp_path, "f.log", FAKE_FAIL)
        line = _run(f'describe_test_outcome home fail:1 "{log}"')
        assert "단정" in line and "1" in line, line
        assert "안 돌았다" not in line, f"단정 실패를 안 돌았다로 적었다: {line}"

    def test_세_문장이_서로_다르다(self, tmp_path):
        log = _log(tmp_path, "x.log", FAKE_NOSTART)
        lines = {
            _run(f'describe_test_outcome s {k} "{log}"')
            for k in ("fail:1", "dead:2", "nostart")
        }
        assert len(lines) == 3, f"요약 문장이 뭉개졌다: {sorted(lines)}"


class TestColorDoesNotBlindIt:
    """⚠️ ANSI 색상코드가 줄 앞에 끼면 판정 줄을 못 읽는다 — A조가 실제로 겪었다.

    호출부가 `NO_COLOR=1`을 주는 것이 1차 방어이고, 이 라이브러리가 ESC를 벗기는
    것이 2차 방어다. **둘 다** 있어야 한다: 호출부는 다른 사람이 고칠 수 있다.
    """

    def test_색이_남아_있어도_센다(self, tmp_path):
        colored = "\x1b[32mPASS\x1b[39m 하나\n\x1b[31mFAIL\x1b[39m 둘\n"
        log = _log(tmp_path, "c.log", colored)
        assert _run(f'classify_test_outcome 1 "{log}"') == "fail:1"

    def test_실행부가_NO_COLOR를_준다(self):
        """종목을 **돌리는 자리**가 준다 — 지금은 `run_suite_outcome`이 그 자리다.

        🔴 처음엔 `"NO_COLOR=1" in text`로 썼다가 **되돌림에서 안 울었다** —
        같은 낱말이 **머리글 주석**에도 있어서 실행 줄에서 지워도 참이었다.
        주석이 계약을 통과시키는 그 형태다. **명령 줄 자체**를 문다.
        """
        text = LIB.read_text(encoding="utf-8")
        run_lines = [
            ln for ln in text.splitlines()
            if not ln.lstrip().startswith("#") and '"$@"' in ln
        ]
        assert run_lines, "종목을 실행하는 줄을 못 찾았다 — 선별식이 낡았다"
        assert all("NO_COLOR=1" in ln for ln in run_lines), (
            f"종목을 NO_COLOR 없이 돌린다 — 색이 끼면 판정 줄을 못 읽는다: {run_lines}"
        )


class TestWiredIntoCi:
    """판정이 **연결돼 있는가**. 라이브러리만 초록이고 `ci.sh`가 안 쓰면 헛돈다."""

    def test_ci_sh가_라이브러리를_소스한다(self):
        text = CI_SH.read_text(encoding="utf-8")
        assert "scripts/lib/test_outcome.sh" in text, "ci.sh가 판정 라이브러리를 안 읽는다"

    def test_요약에_갈래를_싣는다(self):
        """⚠️ 낱말이 아니라 **연결**을 문다. 판정은 라이브러리가 하고 `ci.sh`는
        `run_suite_outcome`으로 부른 뒤 `OUTCOME_LINE`을 요약에 싣는다 —
        그 둘 중 하나라도 빠지면 이름만 모으던 형태로 돌아간 것이다."""
        text = CI_SH.read_text(encoding="utf-8")
        assert "run_suite_outcome" in text, "ci.sh가 종목을 갈래 판정으로 안 돌린다"
        assert "$OUTCOME_LINE" in text, "판정 결과를 요약에 안 싣는다"
        assert "$OUTCOME_KIND" in text, "「안 돌았다」를 따로 다루지 않는다"

    def test_안_돌은_것을_머리로_올린다(self):
        """단정 실패에 섞여 눈에 안 들어오면 갈래를 만든 뜻이 없다."""
        text = CI_SH.read_text(encoding="utf-8")
        assert "안 돌은 종목 있음" in text, "「안 돌았다」가 요약 머리로 안 올라간다"


class TestRunSuiteOutcomeEndToEnd:
    """🔴 **실제로 돌려서** 갈래가 나오는가 — 판정 함수만 초록인 것으로는 부족하다.

    파이프라인 종료코드를 `PIPESTATUS[0]`으로 집는 자리가 조용히 틀리면
    **전부 「ok」**가 되고, 위 단위 검사는 전부 통과한 채 CI가 눈이 먼다.
    그래서 `ci.sh`의 `for` 루프에 두지 않고 함수로 꺼내 여기서 진짜로 돌린다.
    """

    def _run_suite(self, tmp_path: Path, script_body: str) -> tuple[str, str]:
        fake = tmp_path / "fake.sh"
        fake.write_text("#!/usr/bin/env bash\n" + script_body, encoding="utf-8")
        fake.chmod(0o755)
        logdir = tmp_path / "logs"
        logdir.mkdir(exist_ok=True)
        out = subprocess.run(
            [
                "bash",
                "-c",
                f'. "{LIB}"; run_suite_outcome s "{logdir}" bash "{fake}" >/dev/null; '
                f'echo "KIND=$OUTCOME_KIND"; echo "LINE=$OUTCOME_LINE"',
            ],
            capture_output=True,
            text=True,
            timeout=30,
        )
        kind = line = ""
        for row in out.stdout.splitlines():
            if row.startswith("KIND="):
                kind = row[5:]
            elif row.startswith("LINE="):
                line = row[5:]
        assert kind, f"갈래가 안 나왔다:\n{out.stdout}\n{out.stderr}"
        return kind, line

    def test_통과하면_ok다(self, tmp_path):
        kind, _ = self._run_suite(tmp_path, 'echo "PASS 하나"; echo "OK: 통과"; exit 0\n')
        assert kind == "ok"

    def test_단정이_틀리면_fail이다(self, tmp_path):
        kind, line = self._run_suite(
            tmp_path, 'echo "PASS 하나"; echo "FAIL 둘"; echo "실패 1건"; exit 1\n'
        )
        assert kind == "fail:1", kind
        assert "안 돌았다" not in line, line

    def test_로드조차_안_되면_nostart다(self, tmp_path):
        kind, line = self._run_suite(
            tmp_path, 'echo "SyntaxError: Unexpected token \'}\'" >&2; exit 1\n'
        )
        assert kind == "nostart", kind
        assert "안 돌았다" in line and "SyntaxError" in line, line

    def test_돌다_죽으면_dead다(self, tmp_path):
        kind, line = self._run_suite(
            tmp_path,
            'echo "PASS 하나"; echo "PASS 둘"; echo "TypeError: boom" >&2; exit 1\n',
        )
        assert kind == "dead:2", kind
        assert "죽었다" in line, line

    def test_비0인데_전부_ok로_뭉개지지_않는다(self, tmp_path):
        """🔴 `PIPESTATUS` 자리가 틀리면 이것부터 깨진다."""
        kinds = {
            self._run_suite(tmp_path / f"c{i}", body)[0]
            for i, body in enumerate(
                (
                    'echo "PASS 하나"; echo "FAIL 둘"; exit 1\n',
                    'echo "SyntaxError: x" >&2; exit 1\n',
                    'echo "PASS 하나"; echo "TypeError: x" >&2; exit 1\n',
                )
            )
            if (tmp_path / f"c{i}").mkdir(exist_ok=True) or True
        }
        assert "ok" not in kinds, f"비0 종료를 ok로 읽었다: {sorted(kinds)}"
        assert len(kinds) == 3, f"갈래가 뭉개졌다: {sorted(kinds)}"


class TestLibraryIsReadable:
    def test_라이브러리가_있다(self):
        assert LIB.exists(), f"{LIB} 없음"

    @pytest.mark.parametrize("fn", ["classify_test_outcome", "describe_test_outcome"])
    def test_함수가_정의돼_있다(self, fn):
        assert f"{fn}()" in LIB.read_text(encoding="utf-8")
