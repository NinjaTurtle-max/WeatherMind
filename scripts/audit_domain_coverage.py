"""문항이 지식 단계 정의와 실제로 맞는지 재는 감사 도구 (CO-Z-1).

사용: python3 scripts/audit_domain_coverage.py
의존: 표준 라이브러리만.

**왜 만들었나.** 2026-08-13에 클라이언트가 *"문제들이 진짜 교육과정 수준에
일치하나 — 대기역학·경계층·기후학이 빠진 것 같다"*고 물었고, 손으로 세어 답한
결과가 판단을 바꿨다. 손으로 센 값은 다음에 또 세야 하고 그 사이 낡는다
(CLAUDE.md §0). 그래서 세는 방법을 코드로 남긴다.

**무엇을 재나.** 문항 본문·정답·해설·선지를 영역별 핵심어로 매칭해 **지식 단계별
분포**를 낸다. 태그(`concept_tag`)로는 이걸 못 본다 — 태그 14종에 대기역학·경계층·
수치예보 전용이 없어서 상위 문항이 전부 중등 태그에 얹혀 있기 때문이다(CO-Z-2).

**한계를 알고 쓸 것.** 핵심어 매칭이라 **말을 안 쓰고 개념을 묻는 문항은 못 본다.**
0건이 곧 부재는 아니고, 큰 편중을 드러내는 용도다. 실제로 그 편중이 나왔다:
kl10(정의: 기상청 현업 실무)에 대기역학·경계층이 0건이고 절반이 특보 기준 암기다.
"""
import collections
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
d = json.load(open(ROOT / 'database/seed/content_items.json', encoding='utf-8'))


def txt(i):
    t = i.get('template_json') or {}
    parts = [t.get('question_text') or '', str(t.get('correct_answer') or ''),
             t.get('explanation_hint') or '', str(t.get('options') or ''),
             str(t.get('pairs') or ''), str(t.get('items') or '')]
    return ' '.join(parts)


DOMAINS = {
    '대기역학': ['지균', '경도풍', '전향력', '코리올리', '와도', '발산', '수렴', '각운동량', '로스비', '정역학'],
    '경계층': ['경계층', '난류', '접지역전', '혼합층', '마찰', '플럭스', '거칠기', '현열', '잠열'],
    '열역학': ['단열', '상당온위', '온위', '감률', '에마그램', '안정도', '대류가용', '이슬점'],
    '기후학': ['기후변화', '기후대', '엘니뇨', '라니냐', '계절풍', '몬순', '편서풍', '제트', '순환', '평년'],
    '대기화학': ['오존', '에어로졸', '미세먼지', '광화학', '온실기체', '메탄', '황산화'],
    '수치예보': ['수치예보', '앙상블', '격자', '수치모델', '예보모델', '초기장', '동화'],
    '자료판독': ['라디오존데', '레이더', '위성', '일기도', '고층', '에코', '단열선도'],
}

lv = collections.defaultdict(collections.Counter)
tot = collections.Counter()
per_level_total = collections.Counter()
for i in d:
    s = txt(i)
    kl = i.get('knowledge_level')
    per_level_total[kl] += 1
    for dom, kws in DOMAINS.items():
        if any(k in s for k in kws):
            lv[dom][kl] += 1
            tot[dom] += 1

hdr = ' '.join(f'kl{k:<2d}' for k in range(1, 11))
print(f"{'영역':10s} {'총':>4s} | {hdr}")
print('-' * 68)
for dom in DOMAINS:
    row = ' '.join(f'{lv[dom][k]:>4d}' for k in range(1, 11))
    print(f'{dom:10s} {tot[dom]:>4d} | {row}')
print('-' * 68)
print(f"{'문항 수':10s} {len(d):>4d} | " + ' '.join(f'{per_level_total[k]:>4d}' for k in range(1, 11)))

# 상위 4칸(7~10)에서 어느 영역도 안 걸리는 문항
upper = [i for i in d if (i.get('knowledge_level') or 0) >= 7]
uncovered = [i for i in upper
             if not any(any(k in txt(i) for k in kws) for kws in DOMAINS.values())]
print(f'\n상위 4칸(kl7~10) {len(upper)}건 중 위 영역 어디에도 안 걸리는 문항: {len(uncovered)}건')
for i in uncovered[:8]:
    t = i.get('template_json') or {}
    print(f"  kl{i.get('knowledge_level')} [{i.get('concept_tag')}] {(t.get('question_text') or '')[:62]}")
