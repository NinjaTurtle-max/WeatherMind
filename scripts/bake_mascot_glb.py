"""weathermind-bot.glb → frontend/public/guidebot.mesh (런타임이 그대로 GPU에 올리는 바이너리).

사용: python3 scripts/bake_mascot_glb.py [출력경로]
의존: numpy만 (개발 도구라 서비스 requirements에 넣지 않는다 — render_mascot_glb.py와 같은 규약)

── 왜 glb를 그대로 안 쓰나 ────────────────────────────────────────────────────
원본은 2.3MB이고, 브라우저에서 쓰려면 glTF 파서(=three.js 급 의존)가 필요하다.
이 저장소는 i18n을 60KB 아끼려고 직접 구현한 곳이라 **의존을 늘리지 않는다**.
대신 런타임이 할 일을 전부 빌드타임으로 옮긴다:

  ⓐ TEXCOORD_0 제거      — 텍스처가 0장이라 UV는 쓰이지 않는다(원본 정점의 1/3)
  ⓑ 월드 변환 선적용     — 노드 51개 트리를 여기서 접는다(런타임 행렬 계산 0)
  ⓒ 재질별 병합          — 드로우콜 44(프리미티브) → **5**(재질 5종 전부.
                          한때 얼굴판을 빼 4였던 경위는 아래 SKIP_MATERIALS가 소유한다)
  ⓓ 양자화               — 위치 int16 · 법선 int8 (정점당 10바이트)
  ⓔ 정점 클러스터링      — 아래 「예산」 참조
  ⓕ 재질 색을 헤더에     — 런타임이 JSON을 따로 안 받는다(요청 1회로 끝)

── 예산 ──────────────────────────────────────────────────────────────────────
원본은 삼각형 91,932개 · 정점 54,245개다. 정점당 10B + 삼각형당 6B(uint16 인덱스)
이므로 **손대지 않으면 약 1.1MB** — 56px 버튼 안에 그리는 캐릭터로는 터무니없다.
그래서 격자 클러스터링으로 줄이는데, **재질마다 격자를 다르게 준다**:

  · cloudblue / cloudblue_deep = 몸통(구름 덩어리). 전체 삼각형의 90%인데 매끈한
    블롭이라 거칠게 뭉쳐도 실루엣이 안 상한다 → 굵은 격자
  · face_panel / glyph_ink / sun_yellow = **얼굴이 곧 캐릭터의 정체성**이고 다
    합쳐도 9천 삼각형뿐이다 → 격자를 아주 곱게(사실상 정점 용접만)

`GRID`가 그 판단의 소유자다. 값은 「최대 축을 몇 칸으로 나누나」이고, 키우면
품질이, 줄이면 용량이 좋아진다. 눈으로 고르지 말고 **예산(≤300KB)으로** 고를 것 —
표시 크기가 44~64px라 몸통은 1만 삼각형만 돼도 이미 과잉이다.

── 총 정점 ≤ 65,535 ──────────────────────────────────────────────────────────
인덱스를 uint16으로 쓰고 정점 블록 하나를 5개 그룹이 나눠 쓰기 때문에(WebGL2에는
baseVertex가 없다) **전 재질 합계**가 65,535를 넘으면 안 된다. 넘으면 여기서
죽는다 — 런타임에서 조용히 깨지는 것보다 빌드에서 우는 편이 낫다.

── 결정성 ────────────────────────────────────────────────────────────────────
같은 입력 → 같은 출력 바이트여야 한다(스모크가 두 번 돌려 대조한다). 그래서:
  · 파이썬 set·dict 순회를 쓰지 않는다 — 전부 np.unique의 사전식 정렬 순서
  · 타임스탬프·경로·버전 문자열을 파일에 넣지 않는다
  · 법선 행렬에 np.linalg.inv를 쓰지 않는다(LAPACK 경로가 플랫폼마다 미세하게
    갈릴 수 있다) — 3×3 여인수(adjugate)를 손으로 적는다. 이게 곧 inv의 전치이므로
    법선 변환에 필요한 것과 정확히 같고, 스케일 상수는 정규화로 사라진다.
"""
import json
import struct
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'design/mascot/weathermind-bot.glb'
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'frontend/public/guidebot.mesh'

MAGIC = b'WMSH'
VERSION = 1

# 재질 이름 → 클러스터 격자 분할 수(최대 축 기준). 위 「예산」 참조.
# (2026-08-13 **재실측**) 몸통 48 · 얼굴 620에서 삼각형 94,708 → **28,683** ·
# 파일 **291,430 B**(284.6 KB). ⚠️ 이 줄은 하루에 두 번 낡았다: 처음 "28,683 ·
# 291,430 B"였다가 SKIP_MATERIALS로 얼굴판을 빼면서 "27,011 · 272,998 B"가 됐고,
# 그 제외를 **다시 비우면서**(PNG에 얼굴판이 생겼으므로) 원래 값으로 돌아왔다.
# 값을 바꾸면 반드시 다시 재서 여기 적을 것(CLAUDE.md §0-1) — 코드 리뷰가 이
# 드리프트를 잡았다.
# 몸통을 52까지만 올려도 예산을 넘는다 — 늘리고 싶으면 얼굴이 아니라 몸통을
# 만지되 반드시 크기를 다시 재고 그 값을 여기 적을 것.
GRID = {
    'cloudblue': 48,
    'cloudblue_deep': 48,
    'face_panel': 620,
    'glyph_ink': 620,
    'sun_yellow': 620,
}
DEFAULT_GRID = 200

MAX_VERTS = 65535  # uint16 인덱스 상한(단일 정점 블록)

# ⚠️ **일부러 빼는 재질** — 실수가 아니라 근거가 있는 제외다.
#
# `face_panel`(흰 얼굴판 1,676 삼각형)은 원본 모델에 실재하고, 얼굴 글리프 바로 뒤
# z=0.149~0.206에 **몸통(최대 0.184)보다 앞서** 놓여 있다(감기 방향도 정상, 바깥
# 향함 100%). 그런데 지금 화면에 쓰는 2D 폴백 `frontend/public/guidebot.png`에는 그
# 판이 **없다**: `render_mascot_glb.py`의 walk()에 `if 'indices' not in pr: continue`가
# 있고 이 모델에서 인덱스 없는 프리미티브는 정확히 face_panel 하나뿐이라 그림에서
# 통째로 빠진다. 삼각형 수가 증거다 — 그 스크립트는 93,032을 세고 노드 트리 실제
# 합은 94,708이며 **차이 1,676이 face_panel의 삼각형 수와 정확히 같다.**
#
# 3D는 그 PNG **위에 겹쳐 페이드인**한다. 3D만 흰 판을 그리면 뜰 때마다 얼굴에 흰
# 판이 튀어나오는 것으로 보인다 — 폴백 교체가 눈에 띄지 않는 것이 이 기능의 1순위
# 요구라 **그림에 없는 것은 여기서도 뺀다.**
# 되돌리는 법: PNG를 얼굴판까지 넣어 다시 렌더한 뒤 이 집합을 비우면 된다(그게 전부).
# 이 제외는 스모크의 그룹 색 대조가 계약으로 못박는다 — 몰래 되돌아오면 붉어진다.
# ✅ **비웠다**(2026-08-13). 위에 적힌 「되돌리는 법」을 그대로 수행했다:
# `render_mascot_glb.py`의 무인덱스 프리미티브 건너뛰기를 고쳐 PNG를 다시 렌더했고
# (삼각형 93,032 → 94,708, 차이가 정확히 face_panel의 1,676), 이제 **2D에도 흰
# 얼굴판이 있다.** 그래서 3D에서 뺄 이유가 사라졌다 — 오히려 지금 빼면 교체 순간
# 얼굴이 사라진다. 위 문단은 지우지 않고 남긴다: 왜 한때 뺐는지를 모르면 다음 사람이
# 같은 자리에서 다시 뺀다.
SKIP_MATERIALS = set()

COMP = {5120: 'i1', 5121: 'u1', 5122: 'i2', 5123: 'u2', 5125: 'u4', 5126: 'f4'}
NUM = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


# ── GLB 파싱 (render_mascot_glb.py와 같은 방식) ──────────────────────────────
def load_glb(path):
    d = path.read_bytes()
    off = 12
    chunks = {}
    while off < len(d):
        ln, ty = struct.unpack_from('<I4s', d, off)
        chunks[ty.decode().strip('\x00')] = (off + 8, ln)
        off += 8 + ln
    jo, jl = chunks['JSON']
    gltf = json.loads(d[jo:jo + jl].decode('utf-8'))
    bo, _ = chunks['BIN']
    return d, gltf, bo


def make_accessor(d, gltf, bo):
    def accessor(i):
        a = gltf['accessors'][i]
        bv = gltf['bufferViews'][a['bufferView']]
        start = bo + bv.get('byteOffset', 0) + a.get('byteOffset', 0)
        n = NUM[a['type']]
        arr = np.frombuffer(d, dtype=np.dtype('<' + COMP[a['componentType']]),
                            count=a['count'] * n, offset=start)
        return arr.reshape(a['count'], n) if n > 1 else arr
    return accessor


def node_matrix(nd):
    if 'matrix' in nd:
        return np.array(nd['matrix'], dtype=np.float64).reshape(4, 4).T
    m = np.eye(4)
    if 'scale' in nd:
        m = np.diag([*nd['scale'], 1.0]) @ m
    if 'rotation' in nd:
        x, y, z, w = nd['rotation']
        r = np.array([
            [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), 0],
            [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), 0],
            [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y), 0],
            [0, 0, 0, 1]])
        m = r @ m
    if 'translation' in nd:
        t = np.eye(4)
        t[:3, 3] = nd['translation']
        m = t @ m
    return m


def normal_matrix(m3):
    """inv(M)^T 와 상수배만 다른 여인수 행렬 — 법선은 정규화하므로 그 상수는 사라진다.

    np.linalg.inv를 피하는 이유는 파일 상단 「결정성」 참조.
    """
    a, b, c = m3[0]
    d, e, f = m3[1]
    g, h, i = m3[2]
    return np.array([
        [e * i - f * h, f * g - d * i, d * h - e * g],
        [c * h - b * i, a * i - c * g, b * g - a * h],
        [b * f - c * e, c * d - a * f, a * e - b * d],
    ], dtype=np.float64)


def collect(gltf, accessor):
    """노드 트리를 접어 재질별 (정점, 법선, 삼각형) 을 모은다."""
    per_mat = {}  # material index → [ (pos, nor, tri) ... ]

    def walk(idx, parent):
        nd = gltf['nodes'][idx]
        m = parent @ node_matrix(nd)
        if 'mesh' in nd:
            for pr in gltf['meshes'][nd['mesh']]['primitives']:
                if pr.get('mode', 4) != 4:
                    continue  # TRIANGLES 외는 이 캐릭터에 없다
                pos = accessor(pr['attributes']['POSITION']).astype(np.float64)
                if 'NORMAL' in pr['attributes']:
                    nor = accessor(pr['attributes']['NORMAL']).astype(np.float64)
                else:
                    nor = np.zeros_like(pos)
                if 'indices' in pr:
                    tri = accessor(pr['indices']).astype(np.int64).reshape(-1, 3)
                else:
                    tri = np.arange(len(pos), dtype=np.int64).reshape(-1, 3)
                wp = (m[:3, :3] @ pos.T).T + m[:3, 3]
                wn = (normal_matrix(m[:3, :3]) @ nor.T).T
                per_mat.setdefault(pr.get('material', 0), []).append((wp, wn, tri))
        for ch in nd.get('children', []):
            walk(ch, m)

    scene = gltf['scenes'][gltf.get('scene', 0)]
    for r in scene['nodes']:
        walk(r, np.eye(4))
    return per_mat


def merge(parts):
    """한 재질에 속한 프리미티브들을 정점 배열 하나 + 삼각형 배열 하나로."""
    pos, nor, tri, base = [], [], [], 0
    for wp, wn, t in parts:
        pos.append(wp)
        nor.append(wn)
        tri.append(t + base)
        base += len(wp)
    return np.concatenate(pos), np.concatenate(nor), np.concatenate(tri)


def cluster(pos, nor, tri, lo, cell):
    """격자 클러스터링 — 같은 칸의 정점을 하나로 접고 퇴화·중복 삼각형을 버린다.

    대표 정점은 칸 안 정점들의 **평균**이다(칸 중심이 아니라). 중심을 쓰면 표면이
    계단처럼 각지는데, 평균은 원래 표면 위에 남아 실루엣이 훨씬 덜 상한다.
    """
    key = np.floor((pos - lo) / cell).astype(np.int64)
    uniq, inv = np.unique(key, axis=0, return_inverse=True)
    inv = inv.reshape(-1)
    n = len(uniq)

    cnt = np.bincount(inv, minlength=n).astype(np.float64)[:, None]
    p = np.stack([np.bincount(inv, weights=pos[:, k], minlength=n) for k in range(3)], 1) / cnt
    v = np.stack([np.bincount(inv, weights=nor[:, k], minlength=n) for k in range(3)], 1)
    ln = np.linalg.norm(v, axis=1, keepdims=True)
    # 법선이 서로 상쇄돼 0이 된 칸(앞뒤 면이 한 칸에 들어온 경우)은 위쪽을 준다.
    v = np.where(ln > 1e-9, v / np.where(ln > 1e-9, ln, 1.0), np.array([0.0, 1.0, 0.0]))

    t = inv[tri]
    t = t[(t[:, 0] != t[:, 1]) & (t[:, 1] != t[:, 2]) & (t[:, 0] != t[:, 2])]  # 퇴화 제거
    if len(t):
        # 같은 세 정점을 쓰는 삼각형 중복 제거. np.unique는 정렬 순서를 돌려주므로
        # 원래 등장 순서로 되돌려 결정성과 캐시 지역성을 함께 지킨다.
        _, first = np.unique(np.sort(t, axis=1), axis=0, return_index=True)
        t = t[np.sort(first)]
    return p, v, t


def main():
    if not SRC.exists():
        sys.exit(f'원본이 없다: {SRC}')
    d, gltf, bo = load_glb(SRC)
    accessor = make_accessor(d, gltf, bo)
    per_mat = collect(gltf, accessor)

    mats = gltf.get('materials', [])
    names = [m.get('name', f'mat{i}') for i, m in enumerate(mats)]
    colors = [np.array(m.get('pbrMetallicRoughness', {}).get('baseColorFactor', [1, 1, 1, 1])[:3],
                       dtype=np.float64) for m in mats]

    all_merged = {mi: merge(parts) for mi, parts in per_mat.items()}
    raw_tris = sum(len(t) for _, _, t in all_merged.values())
    raw_verts = sum(len(p) for p, _, _ in all_merged.values())
    # 제외 재질은 바운딩 박스 계산에서도 빠진다 — 박스는 런타임 카메라 프레이밍
    # 기준이기도 해서, 안 그리는 것이 화면 배치를 밀면 안 된다.
    merged = {mi: g for mi, g in all_merged.items()
              if (names[mi] if mi < len(names) else '') not in SKIP_MATERIALS}
    if not merged:
        sys.exit('그릴 재질이 하나도 없다 — SKIP_MATERIALS를 확인할 것')

    # 남은 재질 공통 바운딩 박스 — 양자화 기준이자 런타임 카메라 프레이밍 기준.
    allp = np.concatenate([p for p, _, _ in merged.values()])
    lo, hi = allp.min(0), allp.max(0)
    span = float((hi - lo).max())

    groups = []  # (재질 index, 정점, 법선, 삼각형)
    for mi in sorted(merged):  # 재질 순서 고정 = 출력 결정성
        p, v, t = merged[mi]
        cell = span / GRID.get(names[mi] if mi < len(names) else '', DEFAULT_GRID)
        p, v, t = cluster(p, v, t, lo, cell)
        if len(t) == 0:
            continue
        used, remap = np.unique(t.reshape(-1), return_inverse=True)  # 안 쓰인 정점 제거
        groups.append((mi, p[used], v[used], remap.reshape(-1, 3).astype(np.int64)))

    total_verts = sum(len(g[1]) for g in groups)
    if total_verts > MAX_VERTS:
        sys.exit(f'정점 {total_verts:,}개 > uint16 상한 {MAX_VERTS:,} — GRID를 낮출 것')

    # ── 양자화 ────────────────────────────────────────────────────────────────
    # 위치: 축마다 [center-half, center+half] → int16. 디코드는 p = q*scale + offset.
    center = (lo + hi) / 2
    half = np.maximum((hi - lo) / 2, 1e-6)
    scale = half / 32767.0

    vbuf = bytearray()
    ibuf = bytearray()
    header_groups = []
    base = 0
    for mi, p, v, t in groups:
        q = np.rint((p - center) / scale).astype(np.int64)
        q = np.clip(q, -32767, 32767).astype('<i2')
        n8 = np.clip(np.rint(v * 127.0), -127, 127).astype('<i1')
        # 정점 스트라이드 10B: pos int16×3(6) + normal int8×3(3) + 패딩 1
        block = np.zeros((len(p), 10), dtype=np.uint8)
        block[:, 0:6] = q.view(np.uint8).reshape(-1, 6)
        block[:, 6:9] = n8.view(np.uint8).reshape(-1, 3)
        vbuf += block.tobytes()

        idx = (t + base).astype('<u2')
        header_groups.append((mi, len(ibuf) // 2, idx.size))
        ibuf += idx.tobytes()
        base += len(p)

    # ── 헤더 ──────────────────────────────────────────────────────────────────
    head = bytearray()
    head += MAGIC
    head += struct.pack('<HHII', VERSION, len(header_groups), total_verts, len(ibuf) // 2)
    head += struct.pack('<3f', *center)          # offset
    head += struct.pack('<3f', *scale)           # scale (축별)
    head += struct.pack('<3f', *(hi - lo))       # 바운딩 박스 크기(런타임 프레이밍)
    for mi, ioff, icnt in header_groups:
        c = colors[mi] if mi < len(colors) else np.array([0.8, 0.8, 0.8])
        head += struct.pack('<3fII', float(c[0]), float(c[1]), float(c[2]), ioff, icnt)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_bytes(bytes(head) + bytes(vbuf) + bytes(ibuf))

    kept = sum(g // 3 for _, _, g in header_groups)
    size = OUT.stat().st_size
    print(f'원본 삼각형 {raw_tris:,} · 정점 {raw_verts:,}', file=sys.stderr)
    print(f'베이킹 삼각형 {kept:,} · 정점 {total_verts:,} · 드로우콜 {len(header_groups)}',
          file=sys.stderr)
    for (mi, _, icnt) in header_groups:
        print(f'  {names[mi] if mi < len(names) else mi:<16} {icnt // 3:>6,} 삼각형',
              file=sys.stderr)
    print(f'{OUT} 저장 · {size:,} B ({size / 1024:.1f} KB)'
          + ('' if size <= 300 * 1024 else '  ⚠️ 300KB 초과'), file=sys.stderr)


if __name__ == '__main__':
    main()
