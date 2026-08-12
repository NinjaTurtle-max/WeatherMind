# 제출물 ② 소스 zip — 제외 목록

**작성 2026-08-13.** 소유자는 이 파일이고, zip을 만드는 사람이 여기를 본다.

## 왜 목록이 필요한가

대회 규정이 **API 키 노출 = 실격**이고, 소스 zip은 저장소를 통째로 압축하기
쉬운 형태다. 아래는 **넣으면 안 되는 것**과 **왜**다.

## 🔴 반드시 빼야 하는 것

| 대상 | 왜 |
|---|---|
| `.env` · `.env.local` · `*.env` (단 `.env.example`은 **포함**) | **실제 키**. 규정상 실격 사유 |
| `.git/` | ⚠️ **주최측 사전교육 PDF 3종의 블롭이 히스토리에 남아 있다**(이월 CO-E-0). `.git`을 넣으면 그 3종이 함께 나간다. 근본 제거는 `scripts/remove_pdf_history.sh` |
| `ai_OT자료/` | 주최측 배포 자료 — 우리 산출물이 아니다. 이미 `.gitignore` 대상이라 추적본에는 없지만, **워킹트리를 그대로 압축하면 들어간다** |
| `.claude/` | 세션 로그·워크트리 사본. 제출물 ③은 여기서 **선별해서** 만드는 것이지 통째로 내는 것이 아니다 |
| `node_modules/` · `__pycache__/` · `.venv/` | 용량. 재현은 `package.json`·`requirements.txt`로 한다 |
| `backup-*` | 이 저장소 밖에 있어야 정상이지만, 안에 만든 적이 있으면 확인할 것 |

## ✅ 안전한 zip 만들기 — 권장 방법

`git archive`를 쓰면 **추적 파일만** 들어가므로 `.git`·`.env`·`ai_OT자료/`·
`node_modules`가 **구조적으로 제외**된다. 사람이 목록을 빠뜨릴 여지가 없다.

```bash
git archive --format=zip --output=../weathermind-source.zip HEAD
```

만든 뒤 **반드시 확인**한다:

```bash
unzip -l ../weathermind-source.zip | grep -iE "\.env$|ai_OT|\.git/|node_modules" || echo "✅ 위험 항목 없음"
```

## ⚠️ 하지 말 것

```bash
zip -r source.zip .        # ← .git·.env·ai_OT자료·node_modules 전부 들어간다
```

## 남은 확인 사항

- **커밋 시점 시크릿 자동 스캔이 없다**(`gitleaks`·`trufflehog` grep 0건).
  사람이 `.env`를 실수로 추적에 올리면 지금은 아무도 못 막는다 — 이월 CO-N-3e.
- `.env.example`은 **넣는다**. 플레이스홀더뿐이고, 없으면 심사위원이 기동을
  못 한다. `backend/app/core/config.py`의 `SECRET_PLACEHOLDER_MARKERS` 가드가
  플레이스홀더 값으로는 런타임이 안 뜨게 막는다.
