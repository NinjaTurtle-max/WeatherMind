"""목(apiMockPlugin.js) ↔ 서버 스키마 필드 전수 대조 — 목록만 만든다(고치지 않는다).

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
ROUTERS = sorted((ROOT / "backend/app/routers").glob("*.py"))
SCHEMAS = sorted((ROOT / "backend/app/schemas").glob("*.py"))
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
DEC_RE = re.compile(
    r'@router\.(get|post|patch|put|delete)\(\s*"([^"]+)"(.*?)\)\s*\n\s*(?:async\s+)?def',
    re.S,
)
server: dict[str, str] = {}   # 'VERB /path' → 스키마명
for f in ROUTERS:
    text = f.read_text(encoding="utf-8")
    prefix = ""
    pm = re.search(r'APIRouter\([^)]*prefix="([^"]*)"', text, re.S)
    if pm:
        prefix = pm.group(1)
    for m in DEC_RE.finditer(text):
        verb, path, rest = m.group(1).upper(), m.group(2), m.group(3)
        rm = re.search(r"response_model=([\w\[\]\. |]+)", rest)
        if not rm:
            continue
        model = rm.group(1).strip().rstrip(",")
        inner = re.sub(r"^list\[|\]$", "", model).strip()
        full = (prefix + path) or "/"
        server[norm(verb, full)] = inner

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

# ── ⑷ 대조 ───────────────────────────────────────────────────────────────────
src_blob = ""
for p in SRC.rglob("*"):
    if p.suffix in (".js", ".jsx") and p.is_file():
        src_blob += p.read_text(encoding="utf-8", errors="ignore")


def readers(field: str) -> int:
    return len(re.findall(rf"[.\['\"]{re.escape(field)}\b", src_blob))


rows = []
matched = 0
for key, model in sorted(server.items()):
    if key not in mock:
        continue
    matched += 1
    sf = fields_of(model)
    mf = mock[key]
    if not sf:
        continue
    for miss in sorted(sf - mf):
        rows.append((key, "목에없음", miss, model, readers(miss)))
    for extra in sorted(mf - sf):
        if extra in ("detail", "code", "message"):
            continue
        rows.append((key, "목에만", extra, model, readers(extra)))

print(f"# 서버 응답모델 경로 {len(server)} · 목 경로 {len(mock)} · 이름이 겹친 경로 {matched}")
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
print("## 🔴 정적 추출로는 대조 못 한 서버 경로 — 「차이 없음」이 아니라 「안 봤다」")
for k in sorted(set(server) - set(mock)):
    why = unresolved.get(k, "목에 그 경로 없음")
    print(f"  - {k}  ({server[k]}) — {why}")
