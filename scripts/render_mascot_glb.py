"""weathermind-bot.glb → frontend/public/guidebot.png (투명 배경).

사용: python3 scripts/render_mascot_glb.py [출력경로]
의존: numpy · Pillow (개발 도구라 서비스 requirements에 넣지 않는다)

텍스처·애니메이션·스킨이 없고 재질이 단색 5종뿐이라 소프트웨어 래스터라이저로
충분하다. Blender 없이 여기서 끝낸다.

glTF는 Y-up · -Z front라 정면 뷰 = -Z를 바라보는 직교 투영이다.
셰이딩은 램버트 + 약한 림라이트 — 원본 PBR의 metallic 0.04 / rough 0.6에
가깝게 보이도록 한 근사이고, 캐릭터가 12종 마스코트 사이에서 튀지 않는 것이 목표다.
"""
import struct, json, sys
from pathlib import Path
import numpy as np
from PIL import Image

SRC = str(Path(__file__).resolve().parent.parent / 'design/mascot/weathermind-bot.glb')
OUT = sys.argv[1] if len(sys.argv) > 1 else str(Path(__file__).resolve().parent.parent / 'frontend/public/guidebot.png')
SS = 3          # 슈퍼샘플 배율 (안티에일리어싱)
SIZE = 512      # 최종 한 변
W = H = SIZE * SS

d = open(SRC, 'rb').read()
off = 12
chunks = {}
while off < len(d):
    ln, ty = struct.unpack_from('<I4s', d, off)
    chunks[ty.decode().strip('\x00')] = (off + 8, ln)
    off += 8 + ln
jo, jl = chunks['JSON']
G = json.loads(d[jo:jo + jl].decode('utf-8'))
bo, _ = chunks['BIN']

COMP = {5120: 'i1', 5121: 'u1', 5122: 'i2', 5123: 'u2', 5125: 'u4', 5126: 'f4'}
NUM = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


def accessor(i):
    a = G['accessors'][i]
    bv = G['bufferViews'][a['bufferView']]
    start = bo + bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    n = NUM[a['type']]
    arr = np.frombuffer(d, dtype=np.dtype('<' + COMP[a['componentType']]),
                        count=a['count'] * n, offset=start)
    return arr.reshape(a['count'], n) if n > 1 else arr


def node_matrix(nd):
    if 'matrix' in nd:
        return np.array(nd['matrix'], dtype=np.float64).reshape(4, 4).T
    M = np.eye(4)
    if 'scale' in nd:
        M = np.diag([*nd['scale'], 1.0]) @ M
    if 'rotation' in nd:
        x, y, z, w = nd['rotation']
        R = np.array([
            [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), 0],
            [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), 0],
            [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y), 0],
            [0, 0, 0, 1]])
        M = R @ M
    if 'translation' in nd:
        T = np.eye(4); T[:3, 3] = nd['translation']
        M = T @ M
    return M


# ── 노드 트리를 돌며 삼각형을 모은다 ─────────────────────────────────────────
tris_p, tris_n, tris_c = [], [], []
mats = []
for m in G.get('materials', []):
    mats.append(np.array(m.get('pbrMetallicRoughness', {}).get('baseColorFactor', [1, 1, 1, 1])[:3]))


def walk(idx, parent):
    nd = G['nodes'][idx]
    M = parent @ node_matrix(nd)
    if 'mesh' in nd:
        for pr in G['meshes'][nd['mesh']]['primitives']:
            if 'indices' not in pr:
                continue
            idxs = accessor(pr['indices']).astype(np.int64)
            if idxs.size == 0:
                continue
            pos = accessor(pr['attributes']['POSITION']).astype(np.float64)
            nor = accessor(pr['attributes']['NORMAL']).astype(np.float64)
            wp = (M[:3, :3] @ pos.T).T + M[:3, 3]
            wn = (np.linalg.inv(M[:3, :3]).T @ nor.T).T
            f = idxs.reshape(-1, 3)
            tris_p.append(wp[f])
            tris_n.append(wn[f])
            col = mats[pr['material']] if 'material' in pr else np.array([0.8, 0.8, 0.8])
            tris_c.append(np.repeat(col[None, :], len(f), axis=0))
    for c in nd.get('children', []):
        walk(c, M)


scene = G['scenes'][G.get('scene', 0)]
for r in scene['nodes']:
    walk(r, np.eye(4))

P = np.concatenate(tris_p)          # (T,3,3)
N = np.concatenate(tris_n)
C = np.concatenate(tris_c)
print(f'삼각형 {len(P):,}개 · 재질 {len(mats)}종', file=sys.stderr)

# ── 정면 직교 투영 (-Z를 본다) ──────────────────────────────────────────────
lo = P.reshape(-1, 3).min(0); hi = P.reshape(-1, 3).max(0)
ctr = (lo + hi) / 2
span = max(hi[0] - lo[0], hi[1] - lo[1]) * 1.06   # 여백 6%
sx = (P[..., 0] - ctr[0]) / span * W + W / 2
sy = H / 2 - (P[..., 1] - ctr[1]) / span * H
sz = P[..., 2]

rgb = np.zeros((H, W, 3), np.float64)
alpha = np.zeros((H, W), np.float64)
zbuf = np.full((H, W), -1e30)

LIGHT = np.array([-0.35, 0.55, 0.75]); LIGHT /= np.linalg.norm(LIGHT)

# 뒷면 제거 — 화면공간 부호로 판정한다(정면 뷰라 z축 외적 부호면 충분).
area2 = ((sx[:, 1] - sx[:, 0]) * (sy[:, 2] - sy[:, 0])
         - (sx[:, 2] - sx[:, 0]) * (sy[:, 1] - sy[:, 0]))
keep = area2 < 0                     # y가 아래로 뒤집혀 있어 CCW가 음수다
order = np.argsort(-sz.mean(1))      # 뒤에서 앞으로 (z버퍼가 있어도 안정적)

for t in order:
    if not keep[t]:
        continue
    x0, x1, y0, y1 = sx[t].min(), sx[t].max(), sy[t].min(), sy[t].max()
    ix0, ix1 = max(int(np.floor(x0)), 0), min(int(np.ceil(x1)) + 1, W)
    iy0, iy1 = max(int(np.floor(y0)), 0), min(int(np.ceil(y1)) + 1, H)
    if ix0 >= ix1 or iy0 >= iy1:
        continue
    xs = np.arange(ix0, ix1) + 0.5
    ys = np.arange(iy0, iy1) + 0.5
    gx, gy = np.meshgrid(xs, ys)
    ax, ay = sx[t, 0], sy[t, 0]; bx, by = sx[t, 1], sy[t, 1]; cx, cy = sx[t, 2], sy[t, 2]
    den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
    if abs(den) < 1e-12:
        continue
    w0 = ((by - cy) * (gx - cx) + (cx - bx) * (gy - cy)) / den
    w1 = ((cy - ay) * (gx - cx) + (ax - cx) * (gy - cy)) / den
    w2 = 1 - w0 - w1
    inside = (w0 >= 0) & (w1 >= 0) & (w2 >= 0)
    if not inside.any():
        continue
    z = w0 * sz[t, 0] + w1 * sz[t, 1] + w2 * sz[t, 2]
    sub = zbuf[iy0:iy1, ix0:ix1]
    win = inside & (z > sub)
    if not win.any():
        continue
    nrm = (w0[..., None] * N[t, 0] + w1[..., None] * N[t, 1] + w2[..., None] * N[t, 2])
    ln = np.linalg.norm(nrm, axis=-1, keepdims=True); ln[ln == 0] = 1
    nrm = nrm / ln
    lam = np.clip((nrm * LIGHT).sum(-1), 0, 1)
    rim = np.clip(1 - np.abs(nrm[..., 2]), 0, 1) ** 2.2
    shade = 0.42 + 0.58 * lam + 0.22 * rim          # 앰비언트 + 확산 + 림
    px = np.clip(C[t][None, None, :] * shade[..., None], 0, 1)
    tgt_rgb = rgb[iy0:iy1, ix0:ix1]
    tgt_rgb[win] = px[win]
    sub[win] = z[win]
    alpha[iy0:iy1, ix0:ix1][win] = 1.0

img = np.dstack([np.clip(rgb, 0, 1) ** (1 / 2.2), alpha])   # sRGB 근사
im = Image.fromarray((img * 255).astype(np.uint8), 'RGBA')
im = im.resize((SIZE, SIZE), Image.LANCZOS)

# 알파 내용 경계로 크롭 — Mascot.jsx가 "여백 = 0"을 요구한다.
# 알파 임계값 8 — frontend/tests/mascotAssets.contract.test.mjs의 ALPHA_THRESHOLD와
# **같은 값이어야 한다**. getbbox()는 알파>0으로 자르는데, LANCZOS 축소가 남기는
# 옅은 가장자리 때문에 그 기준으로는 여백 2px가 남아 계약이 붉어진다.
a = np.array(im)[:, :, 3]
ys, xs = np.where(a >= 8)
im = im.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))
im.save(OUT)
print(f'{OUT} 저장 · {im.size[0]}x{im.size[1]}', file=sys.stderr)
