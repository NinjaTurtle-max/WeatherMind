#!/usr/bin/env python3
"""마스코트 PNG를 '본체' 경계로 크롭한다 — 새 캐릭터를 넣기 전에 반드시 거칠 것.

왜 필요한가
-----------
캐릭터는 74x74 같은 **정사각 박스**에 object-contain으로 들어간다(Mascot.jsx).
그래서 그림 주변에 투명 여백이 있으면 그만큼 캐릭터가 작게 그려진다. 여섯 장의
여백이 제각각이면 캐릭터마다 크기가 달라 보인다 — 실제로 그랬다(2026-08-06).

단순히 알파 경계로 자르는 것으로는 부족하다. 캔버스 구석에 흩뿌려진 티끌(붓
자국·지우다 남은 점)이 경계 상자를 부풀린다. snow가 그랬다: 본체는 204x234인데
왼쪽 위 티끌 9개 때문에 상자가 487x560이 되어, 74px 박스 안에서 눈결정이
28x31px로만 그려졌다(크롭 후 65x74px).

그래서 **연결 성분**을 세어 가장 큰 덩어리(본체)를 찾고, 본체 면적의 일정 비율
이상인 덩어리만 함께 살린다. 그 아래는 티끌로 보고 버린다.

⚠️ 비율을 너무 높이면 캐릭터의 일부가 잘린다
--------------------------------------------
sun은 머리 위 열기 물결(ᔧᔧᔧ)이 본체와 떨어진 별개 덩어리다. 기본값으로 돌리면
세로가 411 -> 367로 줄어드는데, 그 44px이 바로 물결이다. **먼저 dry-run으로
"버림" 개수를 확인하고, 버려지는 게 티끌이 맞는지 눈으로 보라.** 애매하면
--keep-ratio를 낮춰(예: 0.001) 작은 덩어리도 살린다.

사용법
------
    python scripts/crop_mascot.py frontend/public/snow.png          # dry-run(기본)
    python scripts/crop_mascot.py frontend/public/snow.png --write  # 실제 적용
    python scripts/crop_mascot.py frontend/public/*.png             # 여러 장 점검

적용 후에는 계약 테스트로 확인한다:
    cd frontend && npm run test:mascot

의존: Pillow (`pip install pillow`).
"""
import argparse
import sys
from collections import deque
from pathlib import Path

try:
    from PIL import Image
except ImportError:  # 의존을 강제하지 않는다 — 이 스크립트는 저작 도구다
    sys.exit("Pillow가 필요합니다: pip install pillow")


def components(mask, w, h):
    """4-이웃 연결 성분 → [(면적, (l, t, r, b))] 면적 내림차순."""
    seen = bytearray(w * h)
    out = []
    for start in range(w * h):
        if seen[start] or not mask[start]:
            continue
        queue = deque([start])
        seen[start] = 1
        area = 0
        left = right = start % w
        top = bottom = start // w
        while queue:
            i = queue.popleft()
            area += 1
            x, y = i % w, i // w
            left = min(left, x)
            right = max(right, x)
            top = min(top, y)
            bottom = max(bottom, y)
            for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                if 0 <= nx < w and 0 <= ny < h:
                    j = ny * w + nx
                    if mask[j] and not seen[j]:
                        seen[j] = 1
                        queue.append(j)
        out.append((area, (left, top, right, bottom)))
    out.sort(key=lambda c: -c[0])
    return out


def crop_one(path: Path, alpha: int, keep_ratio: float, write: bool) -> bool:
    """한 장 처리. 크기가 바뀌면 True."""
    img = Image.open(path).convert("RGBA")
    w, h = img.size
    channel = img.getchannel("A").tobytes()
    mask = bytearray(1 if a >= alpha else 0 for a in channel)

    comps = components(mask, w, h)
    if not comps:
        print(f"  {path.name}: 불투명 픽셀이 없다 — 건너뜀")
        return False

    main_area = comps[0][0]
    kept = [c for c in comps if c[0] >= main_area * keep_ratio]
    dropped = comps[len(kept):]

    left = min(c[1][0] for c in kept)
    top = min(c[1][1] for c in kept)
    right = max(c[1][2] for c in kept)
    bottom = max(c[1][3] for c in kept)
    box = (left, top, right + 1, bottom + 1)
    new_size = (box[2] - box[0], box[3] - box[1])

    changed = new_size != (w, h)
    note = "" if changed else "  (이미 딱 맞음)"
    print(f"  {path.name}: {w}x{h} -> {new_size[0]}x{new_size[1]}{note}")
    if dropped:
        areas = ", ".join(str(a) for a, _ in dropped[:6])
        print(f"      버린 덩어리 {len(dropped)}개 (면적 {areas}{' …' if len(dropped) > 6 else ''})"
              f" · 본체 면적 {main_area}")
        print("      ↑ 이게 티끌이 아니라 캐릭터의 일부라면 --keep-ratio를 낮출 것")

    if write and changed:
        img.crop(box).save(path, optimize=True)
        print("      적용됨")
    return changed


def main() -> int:
    ap = argparse.ArgumentParser(description="마스코트 PNG를 본체 경계로 크롭")
    ap.add_argument("paths", nargs="+", type=Path, help="PNG 경로(여러 개 가능)")
    ap.add_argument("--write", action="store_true",
                    help="실제로 덮어쓴다. 없으면 dry-run(기본) — 먼저 이걸로 확인할 것")
    ap.add_argument("--alpha", type=int, default=24,
                    help="이 알파 미만은 배경 취급 (기본 24 — 안 보이는 잔털 제외)")
    ap.add_argument("--keep-ratio", type=float, default=0.02,
                    help="본체 면적의 이 비율 이상인 덩어리는 캐릭터로 본다 (기본 0.02)")
    args = ap.parse_args()

    print(f"{'적용' if args.write else 'dry-run'} · alpha>={args.alpha} · keep-ratio={args.keep_ratio}")
    changed = 0
    for path in args.paths:
        if not path.is_file():
            print(f"  {path}: 파일 없음")
            continue
        changed += crop_one(path, args.alpha, args.keep_ratio, args.write)

    if not args.write and changed:
        print("\n적용하려면 --write 를 붙여 다시 실행하세요.")
    if args.write:
        print("\n확인: cd frontend && npm run test:mascot")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
