"""보드 시안 지도 검증 — `python3 docs/design/verify_board_mockup.py`

ci.sh에는 넣지 않았다(Playwright 의존). 시안이나 지형을 고치면 직접 돌린다.


  ① 시안의 반도 path가 앱(PeninsulaMap.jsx)과 **문자 단위로 같은가**
     — 다르면 시안이 앱을 대변하지 못한다.
  ② 렌더된 곡선의 최소 곡률반경(꺾임 없음의 근거)
  ③ 존 4개가 육지/바다 중 맞는 쪽에 있는가 (isPointInFill)
     — 좌표 치환이 이름과 어긋난 적이 있어 반드시 이름과 함께 확인한다.
  ④ 존 마커끼리 겹치지 않는가 / 페이지가 스크롤되지 않는가
"""
import pathlib, re
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[2]
MOCKUP = ROOT / "docs/design/board_mockup.html"
APP_PATH = "".join(re.findall(r"'([^']*)'",
    (ROOT/'frontend/src/modules/board/PeninsulaMap.jsx').read_text()
      .split("const PENINSULA_PATH =\n")[1].split("\n\n")[0]))
EXPECT = {'서해상': '바다', '수도권': '육지', '영서·태백': '육지', '영동·동해': '육지'}

JS = """(appPath) => {
  const svg = document.querySelector('.mapstage svg');
  const p = [...svg.querySelectorAll('path')].find(x => x.getAttribute('d') === appPath);
  if (!p) return {same:false};
  const L = p.getTotalLength(), N = 720, h = 12, pts = [];
  for (let i=0;i<N;i++){const q=p.getPointAtLength(i*L/N); pts.push([q.x,q.y]);}
  const d=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
  let worst=Infinity;
  for(let i=0;i<N;i++){
    const a=pts[(i-h+N)%N],b=pts[i],c=pts[(i+h)%N];
    const ar=Math.abs((b[0]-a[0])*(c[1]-a[1])-(c[0]-a[0])*(b[1]-a[1]))/2;
    if(ar<1e-9) continue;
    const r=d(a,b)*d(b,c)*d(a,c)/(4*ar); if(r<worst) worst=r;
  }
  const zones=[...document.querySelectorAll('.zone')].map(z=>{
    const st=z.getAttribute('style');
    const x=parseFloat(st.match(/left:([0-9.]+)%/)[1]);
    const y=parseFloat(st.match(/top:([0-9.]+)%/)[1]);
    return {nm:z.querySelector('.zname').textContent,
            where:p.isPointInFill({x,y}) ? '육지' : '바다',
            rect:z.getBoundingClientRect()};
  });
  const overlap=[];
  for(let i=0;i<zones.length;i++) for(let j=i+1;j<zones.length;j++){
    const a=zones[i].rect,b=zones[j].rect;
    const ox=Math.min(a.right,b.right)-Math.max(a.left,b.left);
    const oy=Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top);
    if(ox>0&&oy>0) overlap.push(`${zones[i].nm}↔${zones[j].nm}`);
  }
  const de=document.documentElement;
  return {same:true, minRadius:+worst.toFixed(1),
          zones:zones.map(z=>[z.nm,z.where]), overlap,
          pageY:de.scrollHeight-de.clientHeight, pageX:de.scrollWidth-de.clientWidth};
}"""

ok = True
with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path="/opt/pw-browsers/chromium")
    for w, h in [(1100,700),(1280,800),(1440,900),(1600,900),(1920,1080)]:
        pg = b.new_page(viewport={"width": w, "height": h})
        pg.goto(MOCKUP.as_uri()); pg.wait_for_timeout(350)
        r = pg.evaluate(JS, APP_PATH)
        bad = []
        if not r.get('same'): bad.append('앱과 path 불일치')
        else:
            for nm, where in r['zones']:
                if EXPECT[nm] != where: bad.append(f"{nm} {where}(기대 {EXPECT[nm]})")
            if r['minRadius'] < 6: bad.append(f"곡률반경 {r['minRadius']}")
            if r['overlap']: bad.append('겹침 ' + ','.join(r['overlap']))
            if r['pageY'] or r['pageX']: bad.append(f"페이지넘침 {r['pageY']},{r['pageX']}")
        ok &= not bad
        z = ' '.join(f"{n}:{v}" for n, v in r.get('zones', []))
        print(f"{w}x{h}  path일치={r.get('same')}  R={r.get('minRadius')}  {z}  "
              + ("← " + " / ".join(bad) if bad else "OK"))
        pg.close()
    b.close()
print("\n전체:", "통과" if ok else "실패")
raise SystemExit(0 if ok else 1)
