"""목(apiMockPlugin.js) ↔ 서버 스키마 필드 전수 대조 — 목록만 만든다(고치지 않는다).

## 두 가지 모드

    python3 scripts/mock_parity.py .                      # 정적 추출(아래 ⑶)
    python3 scripts/mock_parity.py . /tmp/live.json       # 🟢 **실행 수집** 모드

**실행 수집 모드를 쓸 것.** `frontend/scripts/mock_capture.mjs`가 목을 실제로
띄워 받아 온 응답의 최상위 키를 그대로 쓴다. 정적 추출은 목 핸들러 과반이
`return [200, devStatePayload()]`처럼 **함수 호출**을 돌려주므로 절반을 못 본다 —
그 한계를 남겨 두려고 지우지 않았을 뿐, 판정의 근거로 쓰지 않는다.

⚠️ 실행 수집 모드의 **대조 가능 판정**(못 본 것을 「차이 없음」으로 적지 않기 위한 규칙):
   · 2xx 아님            → 대조 불가(HTTP 코드를 사유로 적는다)
   · `keys` 가 `null`    → **빈 배열 = 표본 없음**. 필드가 없는 게 아니다
   · `keys` 가 `[]`      → 객체가 아닌 응답(스칼라·문자열) — 대조 불가
   · 서버 `response_model` 없음 → 대조 **불가**(서버 라우터 쪽 사정, 여기 범위 밖)

방법:
  ⑴ backend/app/routers/*.py 의 `@router.<verb>("<path>", ..., response_model=X)`
     → 경로별 응답 스키마
  ⑵ backend/app/schemas/*.py 의 pydantic 클래스 → 필드 집합(상속 추적)
  ⑶ frontend/mock/apiMockPlugin.js 의 `routes` 표 → 'VERB /path' 별 반환 객체의
     **최상위 키**(중괄호 짝맞춤으로 긁는다)
  ⑷ 양방향 차집합 + 그 필드를 읽는 화면(frontend/src grep)

⚠️ 한계를 먼저 적는다: 목 핸들러는 분기가 많아 **반환 객체가 여럿**일 수 있다.
   여기서는 핸들러 본문에 나타난 **모든** 최상위 객체 키의 합집합을 쓴다 —
   ⇒ 그래서 **반환 표현식만** 본다. 못 읽는 경로는 「추출 불가」로 따로 적는다 —
   못 본 것을 「차이 없음」으로 적지 않는다. 결함 판정은 사람이 한다.
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve()
LIVE = Path(sys.argv[2]).resolve() if len(sys.argv) > 2 else None
ROUTERS = sorted((ROOT / "backend/app/routers").glob("*.py"))
# 🔴 스키마가 `schemas/`에만 있다는 전제가 틀렸다. `MeResponse`는 **라우터 파일 안**
#    (`routers/auth.py:273`)에 있어서 필드 집합이 빈 채로 나왔고, 그 바람에
#    `GET /auth/me`·`PATCH /auth/me` 두 경로가 「스키마 MeResponse 파싱 0」으로
#    대조 못 함에 남았다 — **목이 아니라 이 도구의 결함**이었다.
SCHEMAS = sorted((ROOT / "backend/app/schemas").glob("*.py")) + ROUTERS
MOCK = ROOT / "frontend/mock/apiMockPlugin.js"
SRC = ROOT / "frontend/src"

def norm(verb: str, path: str) -> str:
    """경로를 대조 가능한 꼴로 — `/api/v1` 접두 제거 · 경로 변수는 `*`."""
    p = path
    if p.startswith("/api/v1"):
        p = p[len("/api/v1"):]
    parts = []
    for seg in p.strip("/").split("/"):
        if seg.startswith("{") or seg.startswith(":") or re.fullmatch(r"[0-9a-f-]{8,}", seg):
            parts.append("*")
        else:
            parts.append(seg)
    return f"{verb} /" + "/".join(parts)


# ── ⑵ 스키마 클래스 → 필드 ───────────────────────────────────────────────────
CLASS_RE = re.compile(r"^class\s+(\w+)\s*\(([^)]*)\)\s*:", re.M)
FIELD_RE = re.compile(r"^\s{4}(\w+)\s*:\s*[^=\n]+", re.M)

classes: dict[str, tuple[list[str], set[str]]] = {}
for f in SCHEMAS:
    text = f.read_text(encoding="utf-8")
    marks = list(CLASS_RE.finditer(text))
    for i, m in enumerate(marks):
        end = marks[i + 1].start() if i + 1 < len(marks) else len(text)
        body = text[m.end():end]
        # ⚠️ 라우터 파일에는 클래스 뒤에 **함수**가 온다. 다음 클래스까지를 통째로
        #    본문으로 잡으면 `async def me(\n    user: User = ...` 같은 4칸 들여쓴
        #    인자가 필드로 섞인다 — 첫 최상위 구문(열 0의 `def`·`@`·`if` 등)에서 끊는다.
        cut = re.search(r"^\S", body, re.M)
        if cut:
            body = body[:cut.start()]
        bases = [b.strip() for b in m.group(2).split(",") if b.strip()]
        fields = {
            n for n in FIELD_RE.findall(body)
            if not n.startswith("_") and n != "model_config"
        }
        classes[m.group(1)] = (bases, fields)


def fields_of(name: str, seen: set[str] | None = None) -> set[str]:
    seen = seen or set()
    if name in seen or name not in classes:
        return set()
    seen.add(name)
    bases, own = classes[name]
    out = set(own)
    for b in bases:
        out |= fields_of(b, seen)
    return out


# ── ⑴ 라우터 → 경로별 응답 스키마 ────────────────────────────────────────────
# 🔴 `@router.`만 보던 판은 **한 파일을 통째로 놓쳤다.** `routers/curriculum.py`는
#    라우터를 셋(`router`·`curriculum_router`·`courses_router`) 두는데, 데코레이터가
#    `@curriculum_router.get(...)`이라 정규식에 안 걸렸다. 그래서 첫 판이
#    `GET /courses`·`GET /curriculum`·`POST /curriculum/units/*/session`을
#    **「response_model 없음」으로 적었는데 그건 틀렸다** — 셋 다 선언돼 있다
#    (`CoursesOut`·`CurriculumOut`·`SessionToday`). 도구가 못 본 것을 서버 탓으로
#    돌린 셈이다. ⇒ 이름 붙은 라우터와 **그 라우터의 prefix**를 따로 읽는다.
ROUTER_RE = re.compile(r'^(\w+)\s*=\s*APIRouter\((.*?)\)\s*$', re.S | re.M)
DEC_RE = re.compile(
    # 경로가 **빈 문자열**인 데코레이터가 있다(`@curriculum_router.get("")` — prefix가
    # 곧 경로다). `[^"]+`는 그걸 못 잡아 `GET /curriculum`·`GET /courses`가 통째로
    # 사라졌다 ⇒ `*`여야 한다.
    r'@(\w+)\.(get|post|patch|put|delete)\(\s*"([^"]*)"(.*?)\)\s*\n\s*(?:async\s+)?def',
    re.S,
)
server: dict[str, str] = {}   # 'VERB /path' → 스키마명
# 🔴 `response_model`을 **선언 안 한** 서버 경로. 대조의 기준이 없으므로 목이 옳은지
#    그른지 **말할 수 없다.** 「차이 없음」이 아니라 「잴 수 없음」이다 — 목록으로 남긴다.
no_model: set[str] = set()
for f in ROUTERS:
    text = f.read_text(encoding="utf-8")
    prefixes: dict[str, str] = {}
    for rm2 in ROUTER_RE.finditer(text):
        pm = re.search(r'prefix="([^"]*)"', rm2.group(2))
        prefixes[rm2.group(1)] = pm.group(1) if pm else ""
    for m in DEC_RE.finditer(text):
        rname, verb, path, rest = m.group(1), m.group(2).upper(), m.group(3), m.group(4)
        if rname not in prefixes:
            continue
        full = (prefixes[rname] + path) or "/"
        rm = re.search(r"response_model=([\w\[\]\. |]+)", rest)
        if not rm:
            no_model.add(norm(verb, full))
            continue
        model = rm.group(1).strip().rstrip(",")
        inner = re.sub(r"^list\[|\]$", "", model).strip()
        server[norm(verb, full)] = inner
no_model -= set(server)

# ── ⑶ 목 → 경로별 **반환 객체**의 최상위 키 ─────────────────────────────────
# ⚠️ 핸들러 본문의 **모든** 객체 리터럴을 긁으면(첫 판) 「목에만 있는 필드」가
#    쓰레기로 가득 차고, 더 나쁘게는 서버 필드가 어딘가에 우연히 나타나
#    **「목에없음」이 0으로 나온다.** 실제로 첫 판이 0을 냈다 — 공허한 초록이다.
#    ⇒ `return [<code>, <표현식>]`의 **표현식만** 본다. 표현식이 객체 리터럴이
#      아니면(변수·함수호출) **「추출 불가」로 따로 적는다** — 못 본 것을
#      「차이 없음」으로 적지 않는다.
mock_text = MOCK.read_text(encoding="utf-8")
start_i = mock_text.index("const routes = {")
KEY_RE = re.compile(r"^  '([A-Z]+ [^']+)':", re.M)
keys = list(KEY_RE.finditer(mock_text, start_i))


def _strip_strings(t: str) -> str:
    """문자열 리터럴을 같은 길이의 공백으로 — 안의 `{`·`:`가 깊이를 흔들지 않게."""
    out, i, n = [], 0, len(t)
    while i < n:
        c = t[i]
        if c in "'\"`":
            q, j = c, i + 1
            while j < n and t[j] != q:
                j += 2 if t[j] == "\\" else 1
            out.append(" " * (min(j, n - 1) - i + 1))
            i = min(j, n - 1) + 1
            continue
        out.append(c)
        i += 1
    return "".join(out)


def top_keys(obj: str) -> set[str]:
    """객체 리터럴의 **최상위** 키.

    🔴 첫 판은 `([{}\[\]])|(?:^|[,{])...` 한 정규식으로 깊이와 키를 함께 봤는데,
       여는 `{`를 깊이 쪽이 **먹어 버려** 그 뒤 첫 키가 통째로 안 잡혔다.
       그래서 `POST /auth/login`의 `access_token`이 「목에없음」으로 나왔다 —
       목은 멀쩡히 주고 있었다. **도구가 만든 거짓 결함**이다.
       ⇒ 깊이는 문자를 훑어 세고, 키는 lookbehind로 따로 찾는다.
    """
    t = _strip_strings(obj)
    depth = [0] * (len(t) + 1)
    d = 0
    for i, c in enumerate(t):
        if c in "{[":
            d += 1
        depth[i] = d
        if c in "}]":
            d -= 1
            depth[i] = d
    out = set()
    for km in re.finditer(r"(?<=[{,])\s*(?:\.\.\.)?([A-Za-z_]\w*)\s*:", t):
        if depth[km.start(1)] == 1:
            out.add(km.group(1))
    # 🔴 **축약 프로퍼티** `{ region }` — 첫 판이 못 봐서 `PUT /progress/region`의
    #    `region`이 「목에없음」으로 나왔다. 목은 멀쩡히 주고 있었다.
    for km in re.finditer(r"(?<=[{,])\s*([A-Za-z_]\w*)\s*(?=[,}])", t):
        if depth[km.start(1)] == 1:
            out.add(km.group(1))
    return out


def brace_span(text: str, i: int) -> int:
    d = 0
    while i < len(text):
        if text[i] == "{":
            d += 1
        elif text[i] == "}":
            d -= 1
            if d == 0:
                return i
        i += 1
    return -1


mock: dict[str, set[str]] = {}
unresolved: dict[str, str] = {}
for i, m in enumerate(keys):
    endk = keys[i + 1].start() if i + 1 < len(keys) else len(mock_text)
    body = re.sub(r"//[^\n]*", "", mock_text[m.end():endk])
    vk = m.group(1).split(" ", 1)
    key = norm(vk[0], vk[1])
    found: set[str] = set()
    resolved = False
    # 🔴 **2xx만 본다.** 첫 판은 코드를 안 봐서 `POST /dev/clouds`의 **422 분기**가
    #    경로를 「해결됨」으로 만들고, 정작 성공 반환은 못 본 채 422 객체의 키로
    #    대조해 **가짜 결함 무더기**를 냈다.
    for rm in re.finditer(r"return\s*\[\s*(2\d\d)\s*,\s*", body):
        j = rm.end()
        if j < len(body) and body[j] == "{":
            k = brace_span(body, j)
            if k > 0:
                found |= top_keys(body[j:k + 1])
                resolved = True
        else:
            expr = body[j:j + 60].split("]")[0].strip()
            unresolved.setdefault(key, expr)
    if resolved:
        mock[key] = found
    elif key not in unresolved:
        unresolved[key] = "(return [code, {...}] 형태 아님)"

# ── ⑶′ 실행 수집(mock_capture.mjs) 결과가 있으면 **그것으로 갈아 끼운다** ──────
# 정적 추출은 위 ⑶에서 이미 돌았지만, `live`가 있으면 그쪽이 이긴다. 실제로 목이
# 돌려준 JSON의 최상위 키라서 함수 호출·분기·확산 연산자를 전부 통과한 값이다.
live_reason: dict[str, str] = {}   # 'VERB /path' → 대조 불가 사유
if LIVE:
    captured = json.loads(LIVE.read_text(encoding="utf-8"))
    mock, unresolved = {}, {}
    for raw, rec in captured.items():
        vk = raw.split(" ", 1)
        key = norm(vk[0], vk[1])
        status, ks = rec.get("status"), rec.get("keys")
        if not (200 <= (status or 0) < 300):
            live_reason[key] = f"HTTP {status}"
        elif ks is None:
            # ⚠️ 목이 `[]`를 줬다. **필드가 없는 게 아니라 표본이 없는 것**이다.
            #    이걸 빈 필드집합으로 읽으면 스키마 전 필드가 「목에없음」으로 뒤집힌다
            #    (첫 판에서 `GET /progress/weak-tags`가 실제로 그렇게 나왔다).
            live_reason[key] = "빈 배열 — 표본 없음"
        elif not ks:
            live_reason[key] = "객체가 아닌 응답 — 최상위 키 없음"
        else:
            mock[key] = set(ks)

# ── ⑷ 대조 ───────────────────────────────────────────────────────────────────
src_blob = ""
for p in SRC.rglob("*"):
    if p.suffix in (".js", ".jsx") and p.is_file():
        src_blob += p.read_text(encoding="utf-8", errors="ignore")


def readers(field: str) -> int:
    return len(re.findall(rf"[.\['\"]{re.escape(field)}\b", src_blob))


rows = []
matched: list[str] = []
unmatched: dict[str, str] = {}
for key, model in sorted(server.items()):
    if key not in mock:
        unmatched[key] = live_reason.get(key) or unresolved.get(key) or "목에 그 경로 없음"
        continue
    sf = fields_of(model)
    mf = mock[key]
    if not sf:
        # 스키마 이름은 찾았는데 필드를 못 읽었다 — **대조 성사가 아니다.**
        unmatched[key] = f"스키마 {model} 파싱 0"
        continue
    matched.append(key)
    for miss in sorted(sf - mf):
        rows.append((key, "목에없음", miss, model, readers(miss)))
    for extra in sorted(mf - sf):
        if extra in ("detail", "code", "message"):
            continue
        rows.append((key, "목에만", extra, model, readers(extra)))

src_label = f"실행 수집 {LIVE}" if LIVE else "정적 추출(한계 있음)"
print(f"# 대조 성사 **{len(matched)}** / 서버 응답모델 {len(server)} "
      f"· 목 응답 {len(mock)} · 수집원: {src_label}")
print()
print("| 경로 | 갈래 | 필드 | 스키마 | src 참조수 |")
print("|---|---|---|---|---|")
for r in sorted(rows, key=lambda x: (x[1], -x[4], x[0])):
    print(f"| `{r[0]}` | {r[1]} | `{r[2]}` | {r[3]} | {r[4]} |")
print()
print(f"합계: 목에없음 {sum(1 for r in rows if r[1]=='목에없음')} "
      f"(그중 src가 읽는 것 {sum(1 for r in rows if r[1]=='목에없음' and r[4]>0)}) · "
      f"목에만 {sum(1 for r in rows if r[1]=='목에만')}")
print()
print(f"## 대조가 성사된 서버 경로 {len(matched)}개 — 이 목록 밖은 **안 본 것**이다")
for k in matched:
    print(f"  - {k}  ({server[k]})")
print()
print("## 🔴 대조 못 한 서버 경로 — 「차이 없음」이 아니라 「안 봤다」")
print(f"(응답모델 있는 {len(server)}개 중 {len(unmatched)}개)")
for k in sorted(unmatched):
    print(f"  - {k}  ({server[k]}) — {unmatched[k]}")
print()
print("## 🔴 `response_model`을 선언 안 한 서버 경로 — **잴 수 없다**")
print(f"({len(no_model)}개. 대조의 기준이 서버에 없다 — 목을 탓할 수도 편들 수도 없다.")
print(" 고치려면 서버 라우터가 응답 모델을 선언해야 한다 — 이번 범위 밖이다.)")
for k in sorted(no_model):
    print(f"  - {k}")
print()
print(f"## 목이 응답을 준 경로 {len(mock)}개 중 서버 응답모델과 짝이 없는 것")
for k in sorted(set(mock) - set(server)):
    tag = " (response_model 없음)" if k in no_model else ""
    print(f"  - {k}{tag}")
