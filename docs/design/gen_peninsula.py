#!/usr/bin/env python3
"""한반도 보드 지형 생성기 — PeninsulaMap.jsx의 path 문자열 SSOT.

**지리 정확도가 기준이 아니다.** 이 지도는 조작 보드다. 존 4개(서해상·수도권·
영서·태백·영동·동해)에 요소를 떨어뜨리는 게 본체이고, 지형은 그 배치가 어디인지
알아보게 해주는 배경이다. 그래서 해안선의 실제 굴곡(리아스식 서해안 등)은 전부
버리고 **뭉툭한 실루엣**만 남긴다.

설계 제약(사용자 피드백 누적):
  · 질감 텍스처 없이 단순하게
  · 해안선 단순화 + 둥글게
  · 북한을 살짝 포함 — 지도 맨 위가 바다가 아니라 육지에서 시작
  · 제주·독도 포함, 라벨 없음
  · 존 3개(수도권·영서·태백·영동·동해)가 위로 몰리지 않게 중앙~중앙 조금 위
  · 크고 뭉툭하게
  · **꺾이는 곳 없이 전부 곡선** ← 이 파일이 보장하는 것

꺾임이 없다는 보장은 **저주파 푸리에 재구성**에서 온다.
윤곽을 복소 신호 z[n]=x+iy로 보고 DFT를 걸어 낮은 K차 하모닉만 남긴다. 남은 것은
유한개 사인·코사인의 합이므로 **C∞** — 꺾이는 점이 존재할 수 없고, 곡률도 K가
정하는 상한 아래로 눌린다. K는 "얼마나 뭉툭한가"를 돌리는 유일한 손잡이다.

앞서 Chaikin(모서리 깎기)을 썼다가 갈아탄 이유는 실측이다. 같은 윤곽에서
**최소 곡률반경**(세 점 외접원 반지름의 최솟값)이
    원본 다각형 1.0 · Chaikin 4회 2.7 · 푸리에 K=5 **9.3** · K=4 11.3
였다. 100폭 지도에서 반경 2.7은 눈에 각으로 읽힌다. 다각형의 "최대 방향변화(도)"는
샘플 간격에 딸려 움직여서 이 판단에 못 쓴다 — 반경으로 재야 한다.

좌표계: 정규화 0~100. PeninsulaMap이 `scale(1, VIEW_H/100)`로 y만 0.8 사영한다
(boardLayout.js 계약). 그래서 여기 값은 **사영 전** 좌표다.

사용:  python3 docs/design/gen_peninsula.py
       → PENINSULA_PATH / JEJU / DOKDO / RIDGE / 존 좌표를 stdout에 출력.
       PeninsulaMap.jsx · boardLayout.js · database/seed/board_regions.json에
       **같이** 반영한다(셋 중 하나만 고치면 지도가 조용히 어긋난다).
"""

import cmath
import math

# ── 실루엣 원본 ────────────────────────────────────────────────────────────
# 시계방향. y<0은 프레임 위로 잘려나가는 북한 쪽 — 지도 맨 위를 육지로 만든다.
# 꼭짓점 15개뿐인 건 의도다(위 설계 노트 1번).
BASE_OUTLINE = [
    (26, -8), (76, -8),            # 북쪽 — 프레임 밖에서 잘린다
    (80, 12), (80, 28),            # 동해안 북부 — 거의 수직으로 내린다
    (78, 44), (72, 58),            # 동해안 남부
    (63, 71), (50, 79),            # 남해안 동
    (36, 78), (27, 68),            # 남해안 서
    (28, 56), (32, 44),            # 서해안 남부 — 만(灣)은 얕게. 깊게 파면
    (26, 32), (22, 18), (23, 2),   # 서해안 북부   푸리에가 큰 S자로 부풀린다
]

# 확대. "뭉툭하고 크게"가 요구지만 **가로로 키우면 반도로 안 읽힌다** — 사영이
# y를 0.8로 누르므로(VIEW_H/100) 정규화에서 정사각이면 화면에서는 납작해진다.
# 그래서 x는 그대로 두고 y만 늘려 세로로 세운다. 렌더 비 ≈ 58w × 78h.
# 좌우에 바다가 남는 것도 의도다 — 서해상 존이 바다 위에 놓여야 하고, 지도가
# 프레임을 꽉 채우면 기단·강수 오버레이가 걸릴 여백이 사라진다.
CX, CY = 50.0, 38.0
SX, SY = 1.00, 1.12


def grow(p):
    return (round(CX + (p[0] - CX) * SX, 1), round(CY + (p[1] - CY) * SY, 1))


OUTLINE = [grow(p) for p in BASE_OUTLINE]

# 섬 — 원형이라 그 자체로 곡선. 위치만 확대에 맞춰 따라간다.
# 제주 — y는 확대에 태우지 않는다. 태우면 프레임(정규화 100 = userSpace 80)
# 아래로 밀려 반쯤 잘린다. 본토 남해안과 겹치지 않는 선에서 직접 고정.
JEJU_C, JEJU_RX, JEJU_RY = (grow((41.0, 90.0))[0], 91.0), 5.0, 2.6
DOKDO = [((90.0, 45.0), 1.3), ((94.0, 46.6), 0.8)]

# 존 — 라벨이 아니라 드롭 타깃이다. 프레임 가장자리로 밀면 기단 유동 화살표가
# 오버레이 블리드 범위([-20,120])를 넘어 test:overlay가 깨진다(실제로 깨뜨렸다).
ZONES = {k: grow(v) for k, v in {
    "서해상": (14.0, 45.0),
    "수도권": (36.0, 33.0),
    "영서·태백": (58.0, 46.0),
    "영동·동해": (74.0, 39.0),
}.items()}


# 남길 하모닉 차수. 올리면 원본 굴곡을 따라가고(=각이 살아난다), 내리면
# 뭉툭해진다. 5는 "한반도로 읽히는 가장 둥근 지점"으로 고른 값이다.
HARMONICS = 5
FOURIER_N = 256


def fourier_smooth(pts, k=HARMONICS, n=FOURIER_N):
    """닫힌 윤곽의 저주파 재구성 — 결과는 유한 삼각급수라 C∞(꺾임 불가)."""
    dense = resample(pts, n)
    z = [complex(x, y) for x, y in dense]
    coef = [sum(z[i] * cmath.exp(-2j * math.pi * h * i / n) for i in range(n)) / n
            for h in range(n)]
    out = []
    for i in range(n):
        s = sum(coef[h % n] * cmath.exp(2j * math.pi * h * i / n)
                for h in range(-k, k + 1))
        out.append((s.real, s.imag))
    return out


def resample(pts, keep):
    """호길이 등간격 재샘플. 푸리에 재구성은 256점을 뱉는데 그대로 스플라인에
    태우면 path 문자열이 10KB에 달한다 — 스플라인이 점 사이를 곡선으로 메우므로
    44점이면 렌더 결과가 사실상 같다(아래 min_radius로 확인).

    **인덱스로 솎으면 안 된다.** 점 간격이 균일하지 않아서 n번째마다 집으면
    긴 변과 짧은 변이 섞이고, 짧은 변에서 방향이 급히 꺾인다. 호길이로 등간격
    재샘플해야 Catmull-Rom 입력이 매끈하다."""
    n = len(pts)
    seg = [math.dist(pts[i], pts[(i + 1) % n]) for i in range(n)]
    total = sum(seg)
    out, target, walked, i = [], 0.0, 0.0, 0
    for _ in range(keep):
        while walked + seg[i] < target:
            walked += seg[i]
            i = (i + 1) % n
        t = (target - walked) / seg[i] if seg[i] else 0.0
        (x0, y0), (x1, y1) = pts[i], pts[(i + 1) % n]
        out.append((x0 + (x1 - x0) * t, y0 + (y1 - y0) * t))
        target += total / keep
    return out


def catmull_rom_closed(pts, tension=0.5):
    """Catmull-Rom 스플라인 → 닫힌 3차 베지어 path.

    각 점의 접선을 앞뒤 세그먼트가 공유하므로 C1 연속 — 꺾이는 점이 없다."""
    n = len(pts)
    d = [f"M{pts[0][0]:.2f},{pts[0][1]:.2f}"]
    for i in range(n):
        p0, p1, p2, p3 = (pts[(i - 1) % n], pts[i], pts[(i + 1) % n], pts[(i + 2) % n])
        c1 = (p1[0] + (p2[0] - p0[0]) * tension / 3, p1[1] + (p2[1] - p0[1]) * tension / 3)
        c2 = (p2[0] - (p3[0] - p1[0]) * tension / 3, p2[1] - (p3[1] - p1[1]) * tension / 3)
        d.append(f"C{c1[0]:.2f},{c1[1]:.2f} {c2[0]:.2f},{c2[1]:.2f} {p2[0]:.2f},{p2[1]:.2f}")
    d.append("Z")
    return " ".join(d)


def min_radius(pts):
    """최소 곡률반경 = 이웃 세 점 외접원 반지름의 최솟값.

    "얼마나 각졌나"의 유일하게 믿을 만한 지표다. 방향변화(도)는 샘플 간격에
    비례해서 같은 곡선도 촘촘히 재면 작게, 성기게 재면 크게 나온다."""
    worst, where, n = float("inf"), None, len(pts)
    for i in range(n):
        a, b, c = pts[(i - 1) % n], pts[i], pts[(i + 1) % n]
        area = abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2
        if area < 1e-9:
            continue
        r = math.dist(a, b) * math.dist(b, c) * math.dist(a, c) / (4 * area)
        if r < worst:
            worst, where = r, b
    return round(worst, 1), (round(where[0], 1), round(where[1], 1))


SMOOTH = fourier_smooth(OUTLINE)
SPLINE_PTS = resample(SMOOTH, 44)
PATH = catmull_rom_closed(SPLINE_PTS)

# 태백 능선 — 동해안을 따라 흐르는 한 줄. 이것도 직선 세그먼트 없이 곡선으로.
RIDGE = " ".join([
    "M62.0,22.0",
    "C65.5,31.0 66.5,40.0 64.5,48.0",
    "C62.8,55.5 59.0,61.0 55.5,68.0",
])


def ellipse(c, rx, ry):
    """타원 — 두 개의 원호로. 섬 2종에 쓴다."""
    (x, y) = c
    return (f"M{x - rx:.1f},{y:.1f} A{rx:.1f},{ry:.1f} 0 1 1 {x + rx:.1f},{y:.1f} "
            f"A{rx:.1f},{ry:.1f} 0 1 1 {x - rx:.1f},{y:.1f} Z")


if __name__ == "__main__":
    print(f"// 꼭짓점 {len(OUTLINE)} → 푸리에 K={HARMONICS} {len(SMOOTH)}점 → 재샘플 {len(SPLINE_PTS)}점")
    print(f"// 최소 곡률반경: 원본 {min_radius(resample(OUTLINE, 256))[0]} → 평활 {min_radius(SMOOTH)[0]}"
          f" (최소 지점 {min_radius(SMOOTH)[1]})")
    print(f"// path {len(PATH)} bytes  bbox x[{min(p[0] for p in SMOOTH):.1f},{max(p[0] for p in SMOOTH):.1f}] y[{min(p[1] for p in SMOOTH):.1f},{max(p[1] for p in SMOOTH):.1f}]")
    print()
    print("const PENINSULA_PATH =")
    body = PATH.split(" ")
    line, lines = "", []
    for tok in body:
        if len(line) + len(tok) > 96:
            lines.append(line.strip())
            line = ""
        line += tok + " "
    lines.append(line.strip())
    for i, ln in enumerate(lines):
        tail = ";" if i == len(lines) - 1 else " +"
        print(f"  '{ln} '{tail}" if i < len(lines) - 1 else f"  '{ln}'{tail}")
    print()
    print(f"const JEJU = '{ellipse(*[JEJU_C, JEJU_RX, JEJU_RY])}';")
    print("const DOKDO = [")
    for c, r in DOKDO:
        print(f"  '{ellipse(c, r, r * 0.85)}',")
    print("];")
    print(f"const RIDGE = '{RIDGE}';")
    print()
    for name, (x, y) in ZONES.items():
        print(f"  {name}: svg_point [{x}, {y}]")
