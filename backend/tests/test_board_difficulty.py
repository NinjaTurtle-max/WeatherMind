"""보드 시드·θ 정렬 테스트 — 스프린트 R7-02 §3.5의 잔존분.

🔴 **2026-08-20: 파생 난이도 축(`board_difficulty` 1~3)이 철거됐다.** 잠금·표기
축이 **학령 파생 난이도에서 지식 단계(1~10)**로 갈아탔고(클라이언트 판정 — 유닛과
같은 축), 파생 함수와 그것을 무는 계약이 함께 죽었다. 이 파일이 잃은 것과 그 사유는
아래 각 자리에 남긴다 — **지운 계약의 경위를 지우면 왜 안 지키게 됐는지 추적이
끊긴다**(CLAUDE.md §0-5).

남은 것은 셋이다:
  · **시드 board 실측** — 파생 분포가 아니라 **개수와 상위 단계 존재**를 문다
  · **θ 근접 정렬**(`order_puzzles_for_theta`) — 세션 문항 풀이 계속 쓴다
  · **응답 스키마** — `difficulty`가 정말 사라졌는지(좀비 필드 감시)

⚠️ 이 머리말은 개수를 갖지 않는다 — 아래 단정이 이미 갖고 있고, 두 곳에 적으면
한쪽만 갱신된다(CLAUDE.md §0-2). 이 자리에 적혀 있던 「board 12건」이 R12 시절
값으로 거짓이 된 전례가 그것이다.

실행: backend 디렉토리에서 `python -m pytest tests/test_board_difficulty.py -q`.
"""
import json
from collections import Counter
from pathlib import Path
from types import SimpleNamespace

from app.routers.board import order_puzzles_for_theta
from app.services import weatherbrain_service as wb

SEED_PATH = (
    Path(__file__).resolve().parents[2] / "database" / "seed" / "content_items.json"
)


# ═══════════════════════════════════════════════════════════════
# 🔴 철거: `TestBoardDifficultyAxes` (파생 규칙 표 전건, 2026-08-20)
# ═══════════════════════════════════════════════════════════════
#
# 무엇을 물었나: `board_difficulty`의 가중 표 — guided 1 / goal_only 2 기본 ·
# `time_limit_sec` +1 · `palette`≥3 +1 · 사전 b가 adult 이상 +1 · 1~3 클램프.
#
# 왜 지켤 것이 없어졌나: **그 함수가 없다.** 파생축은 잠금에서도 표기에서도 빠졌고
# (응답 필드가 `knowledge_level`로 교체됨) 퍼즐의 층은 파생이 아니라 **저작값**이다
# (`board_tier` = `content_items.knowledge_level`). 가중이 드리프트해도 사용자가 보는
# 것이 하나도 안 바뀌므로 이 표는 **아무것도 안 지키는 계약**이 된다.
#
# 🔴 ⚠️ **그러나 표 안의 「저작 규율」은 성질로 살아 있다 — 버린 것이 아니다.**
# 「팔레트가 많으면 어렵다」·「시간제한이 있으면 어렵다」는 축과 무관하게 참이고
# (조작 가지 수가 실제 난이도다), 지금은 **저작자가 `knowledge_level`을 손으로 정할 때
# 지켜야 하는 규율**이 됐다. 그 규율을 무는 자리는 이 파일이 아니라 시드 계약이다.
# ⇒ **감시자가 없다는 것이 이 철거의 비용**이고, 보고에 그렇게 적었다(리드 판정 대기).
#
# ⚠️ 파급 하나 더: 이 함수의 `palette>=3` 가산이 **CARRYOVER Z-1의 유일한 차단 사유**
# 였다(산불 규칙 `sun>=70` 3조건 → 팔레트 3 → 난이도 1→2 → 단조 증가 계약 위반).
# 함수가 죽었으니 **그 차단이 풀린다** — 되돌릴지는 데이터·커리큘럼 소관이라 여기서
# 판단하지 않고 보고했다.


class TestBoardSeedShape:
    """실 시드 board **전건**의 형태 — 개수와 상위 단계 존재.

    🔴 **2026-08-20: 클래스 이름과 뜻이 바뀌었다.** 종전 이름은
    `TestBoardDifficultySeedDistribution`이고 물던 것은 **파생 난이도 분포**였다.
    파생축이 철거되면서 분포 단정은 지킬 것이 없어졌고(위 철거 블록), 남은 것은
    **파생과 무관한 시드 실측**뿐이라 이름을 그렇게 고쳤다.

    ⚠️ 개수를 여기 한 곳에만 적는다 — `test_seed_contract`는 **전체 1030건**만 못박고
    board 64판을 따로 세지 않는다(2026-08-20 확인). 그래서 board 개수의 감시자는
    이 파일이 유일하고, 파생 분포와 함께 지우면 **보드가 조용히 사라져도 안 운다.**
    """

    def _seed_boards(self):
        entries = json.loads(SEED_PATH.read_text(encoding="utf-8"))
        return [e for e in entries if e["question_type"] == "board"]

    def test_시드_board_개수_고정(self):
        """🔴 종전 `test_분포_1_2_3_모두_존재`의 **살아남은 절반**이다.

        지운 절반: `Counter(board_difficulty(...))`가 1·2·3을 다 갖는가 — 파생축이
        없으니 지킬 것이 없다.
        남긴 절반: **개수**. 이것은 파생과 무관하고, 위 클래스 독스트링대로 이 파일이
        유일한 감시자다.
        """
        # R12 §9 13건 → R13 2일차 통합에서 +21(2일차 저작 7 + 규칙 확장 10 + 재난 4)
        # staging 승격(2026-08-14): 46 → **49**
        # 경계층·대기역학·대기물리 6판(2026-08-20): 55 → **61**
        # 🔴 병합(2026-08-20): 위 6판 + 연무 1판 + 통합 브랜치 2판 = **64**
        assert len(self._seed_boards()) == 64

    # ═══════════════════════════════════════════════════════════════
    # 🔴 철거: `test_현_시드_분포_고정` (2026-08-20)
    # ═══════════════════════════════════════════════════════════════
    #
    # 무엇을 물었나: `Counter(board_difficulty(...)) == {1: 23, 2: 16, 3: 25}`.
    # 스스로 *"난이도 가중 드리프트를 잡는 **유일한** 계측기"*라 적었고 실제로 두 번
    # 설계대로 울었다(2026-08-18·08-19 — 보드를 늘리고 개수 핀만 고쳤을 때 빨강).
    #
    # 왜 지킬 것이 없어졌나: **감시 대상인 가중이 없다.** 파생 함수가 철거됐으므로
    # 「어느 난이도 칸으로 늘었는가」라는 질문 자체가 성립하지 않는다. 개수만 보는
    # 절반은 위 `test_시드_board_개수_고정`이 이어받았다.
    #
    # 🔴 ⚠️ **잃은 성질이 하나 있다 — 정직하게 남긴다.** 이 단정이 지키던 실질은
    # 「보드가 **한 칸에 몰리지 않는다**」였다(재분류 때 12/13건이 한 단계에 뭉친 것을
    # 이것이 드러냈다). 새 축에서 그 성질의 짝은 **지식 단계 1~10 분포**이고, 그 감시자는
    # 이 파일이 아니라 CLAUDE.md 「지식 단계 10칸」 실측·`test_seed_contract` 소관이다.
    # ⇒ ✅ **승계자가 생겼다**(2026-08-20, 리드 집행 · 어드바이저 판정):
    #    바로 아래 `test_시드_board_지식_단계_분포_고정`. 확인 요청의 답은
    #    「없었다」였다 — board × `knowledge_level` 분포를 무는 계약이 저장소에
    #    **0건**이었다(실측). 그래서 지운 자리에 새 축 짝을 세웠다.

    def test_시드_board_지식_단계_분포_고정(self):
        """🔴 위 철거 블록이 잃었다고 적은 성질의 **새 축 짝**이다(2026-08-20 신설).

        지워진 `test_현_시드_분포_고정`이 지키던 실질은 *「보드가 **한 칸에 몰리지
        않는다**」*였고, 그것이 설계대로 울어 결함을 잡은 실적이 두 번 있었다.
        새 축에서 그 질문은 **「어느 지식 단계로 늘었는가」**다.

        ⚠️ **이 분포는 장식이 아니라 밴드별 노출량의 실질 소유자다**(대장 §5.27-b).
        천장이 층 단위이므로 학습자가 보는 판 수는 **천장 이하 칸들의 인구 합**이다 —
        같은 천장 1칸 차이가 kl 4의 26판 때문에 **41판 ↔ 15판**을 가른다.
        ⇒ 저작자가 kl을 옮기면 **화면의 노출량이 조용히 바뀐다.** 여기가 그 감시자다.

        ⚠️ 개수 핀(형제 테스트)과 중복이 아니다 — 개수만 보면 「늘었다」는 알지만
        **어느 칸으로 늘었는지**를 못 본다. 그것이 종전 계약의 값이었고 실제로
        작동했다(보드를 늘리고 개수 핀만 고쳤을 때 여기가 빨강이 났다).

        갱신할 때: 의도한 변경인지 확인한 뒤 값을 고치고 **경위를 한 줄 남길 것.**
        """
        dist = Counter(e.get("knowledge_level") for e in self._seed_boards())
        # 🔴 2026-08-20 실측(축 교체 직후 첫 판). 소유자는
        # `database/seed/content_items.json`이고 이 값은 그 실측의 사본이다.
        assert dict(dist) == {
            1: 4, 2: 4, 3: 7, 4: 26, 5: 5, 6: 2, 7: 4, 8: 4, 9: 5, 10: 3
        }, f"board 지식 단계 분포가 바뀌었다: {dict(sorted(dist.items(), key=lambda kv: (kv[0] is None, kv[0])))}"

    def test_board_전건이_지식_단계를_갖는다(self):
        """미분류(None) 0건 — **잠금이 무력해지는 갈래를 데이터 쪽에서 막는다.**

        층이 `None`이면 `locked_tiers`가 그 문항을 **잠그지 않는다**(의도 — 「못 여는
        것이 열리는 것보다 나쁘다」). 그 방어가 옳은 대신, 미분류가 늘면 **잠금이
        조용히 헐거워진다.** 그래서 시드 쪽에서 0건을 못박는다.

        🔴 그리고 null 층은 **목과 서버의 판정이 갈리는 갈래**다(대장 §5.27-e —
        JS에서 `null < 6`이 true라 목은 열고 서버는 403). 오늘 그 결함이 발현하지
        않는 **유일한 이유**가 이 0건이다 ⇒ 이 단정이 빨강이 되는 순간
        §5.27-e가 실화가 된다. 그때 고칠 곳은 시드가 아니라 목·서버다.
        """
        missing = [
            e["template_json"].get("board_order")
            for e in self._seed_boards()
            if not isinstance(e.get("knowledge_level"), int)
        ]
        assert missing == [], (
            f"지식 단계가 없는 board {len(missing)}건(board_order {missing}) — "
            "잠기지 않고 열리며, 목과 서버의 판정이 갈린다(대장 §5.27-e)"
        )

    def test_상위_지식_단계에_expert_보드가_있다(self):
        """🔴 **개수가 아니라 요구로 쓴 계약이다**(2026-08-20 리드 지시 §7).

        형제 테스트가 「지금 몇 건인가」를 못박는 것과 축이 다르다 — 저작이 늘면
        저쪽은 갱신을 요구하지만 여기는 **저작이 늘어도 그대로 참이어야** 한다.

        지키는 것: 지식 단계 7~10에 **expert 밴드 보드가 존재**한다. 상위 단계
        학습자가 어느 칸으로 배정돼도 보드 자리가 비지 않는다 — 세션 배합의 board
        1건이 하위 단계 폴백으로 열화하는 것을 **데이터 쪽에서** 막는다.

        ═══════════════════════════════════════════════════════════
        🔴 **2026-08-20: 이 테스트는 둘을 물었고 하나만 남았다.**

        · **살아남은 ①** = 위 문단. 파생축과 **무관하다** — 읽는 값이
          `level_group`과 `knowledge_level`(저작값)뿐이고, 지키는 성질은
          「상위 단계에 보드 데이터가 있다」는 **데이터 커버리지**다.
          축이 갈아타도 이 성질은 그대로 살아 있으므로 **지우지 않았다.**

        · **철거된 ②** = *"그 보드는 전건 난이도 3으로 파생돼 초등·중고등에
          잠긴다"* + 밴드 표 단정(`3 in locked_difficulties("elementary")` 등).
          이름이 `…상위_밴드에만_열린다`였던 것이 ② 몫이라 이름도 바꿨다.

          그 성질이 지금 어디 있나: **잠금은 파생 난이도가 아니라 층 산술이 한다.**
          「초등에게 전문가 보드가 잠긴다」는 이제 `locked_tiers(ceiling)`가
          내는 결론이다 — 초등의 천장은 지식 단계 2(θ 경로)이고 이 보드들은
          단계 7~10이므로 **더 강하게** 잠긴다(3칸 축에서는 초등·중고등만
          갈렸지만 10칸 축에서는 단계마다 갈린다).
          ⇒ 성질은 **없어진 것이 아니라 리드의 새 계약으로 옮겨졌다.**

        ⚠️ ①을 「N건이다」로 쓰지 않는 이유는 종전 주석 그대로다: 개수로 쓰면
        전문가 보드를 **빼는** 변경에도 헛울고, 정작 단계가 비는 것은 못 본다.
        """
        expert = [
            e for e in self._seed_boards()
            if e["level_group"] == "expert" and (e.get("knowledge_level") or 0) >= 7
        ]
        levels = {e["knowledge_level"] for e in expert}
        assert levels == {7, 8, 9, 10}, (
            f"expert 보드가 없는 상위 단계: {sorted({7, 8, 9, 10} - levels)} — "
            "그 칸으로 배정된 학습자는 보드 자리를 하위 단계 폴백으로 받는다"
        )


def _puzzle(name: str, level_group: str):
    return SimpleNamespace(id=name, level_group=level_group)


class TestOrderPuzzlesForTheta:
    """§3.5 정렬: |사전 b(level_group) − θ| 오름차순, θ None이면 입력(created_at) 순."""

    def _items(self):
        # created_at 순 입력 가정 (쿼리가 보장)
        return [
            _puzzle("mh-1", "middle_high"),  # b=0.0
            _puzzle("mh-2", "middle_high"),
            _puzzle("adult-1", "adult"),  # b=1.0
            _puzzle("adult-2", "adult"),
        ]

    def test_θ_None_콜드스타트는_입력_순서_유지(self):
        items = self._items()
        assert order_puzzles_for_theta(items, None) == items

    def test_높은_θ는_adult_먼저(self):
        ordered = order_puzzles_for_theta(self._items(), 1.0)
        assert [p.id for p in ordered] == ["adult-1", "adult-2", "mh-1", "mh-2"]

    def test_낮은_θ는_middle_high_먼저(self):
        ordered = order_puzzles_for_theta(self._items(), -0.5)
        assert [p.id for p in ordered] == ["mh-1", "mh-2", "adult-1", "adult-2"]

    def test_동률은_입력_순서_안정_유지(self):
        # θ=0.5 → 두 그룹 모두 |b−θ|=0.5 동률 — created_at(입력) 순 그대로
        ordered = order_puzzles_for_theta(self._items(), 0.5)
        assert [p.id for p in ordered] == ["mh-1", "mh-2", "adult-1", "adult-2"]

    def test_미지_그룹은_DEFAULT_ITEM_B(self):
        items = [_puzzle("unknown", "mystery"), _puzzle("adult", "adult")]
        ordered = order_puzzles_for_theta(items, 1.0)
        assert [p.id for p in ordered] == ["adult", "unknown"]  # 0.0 vs 1.0 거리
        assert wb.DEFAULT_ITEM_B == 0.0  # 미지 그룹 폴백 상수(단일 소유) 전제

    def test_사전_b는_weatherbrain_단일_소유_재사용(self):
        """session_service 뱅크 풀 정렬과 동일 상수(LEVEL_GROUP_ITEM_B)를 쓴다 —
        값 자체의 드리프트 감시는 test_weatherbrain_contract 소유."""
        from app.routers import board

        assert board.weatherbrain_service.LEVEL_GROUP_ITEM_B is wb.LEVEL_GROUP_ITEM_B


class TestBoardPuzzleSchema:
    def test_knowledge_level_필드가_difficulty를_대체했다(self):
        """🔴 **축 교체**(2026-08-20): `difficulty`(파생 1~3)를 **제거**하고
        `knowledge_level`(유닛과 같은 축)로 바꿨다.

        여기서 무는 것은 두 가지다:
          ① 새 필드가 값을 받는다
          ② 🔴 **옛 필드가 정말 사라졌다** — 남아 있으면 「같은 축에 이름 둘」이 되고
            그것이 이 저장소가 `level_label`로 이미 치른 값이다. 어드바이저 판정 ⓒ의
            요점이 「좀비 필드를 남기지 않는다」였다.
        """
        import uuid

        from app.schemas.board import BoardPuzzle

        puzzle = BoardPuzzle(
            content_item_id=uuid.uuid4(),
            template_json={"mode": "guided"},
            cleared=False,
            knowledge_level=7,
        )
        assert puzzle.knowledge_level == 7
        assert "difficulty" not in BoardPuzzle.model_fields, (
            "옛 파생 축이 응답에 남아 있다 — 한 축에 이름이 둘이면 읽는 사람이 "
            "어느 뜻인지 알 방법이 없다"
        )
        # 값이 없는 문항도 실린다(그때는 잠그지 않는다 — locked_tiers).
        assert BoardPuzzle(
            content_item_id=uuid.uuid4(), template_json={}, cleared=False
        ).knowledge_level is None


# ═══════════════════════════════════════════════════════════════
# 🔴 철거: `TestMockParity` (2026-08-20) — B조 항목이 대체한다
# ═══════════════════════════════════════════════════════════════
#
# 무엇을 물었나(둘):
#   ⑴ `test_목이_문자열_비교로_되돌아가지_않았다` — 목이 `levelGroup === 'adult'`
#      문자열 비교로 회귀하지 않았는가. 실제로 갈렸던 결함이다(2026-08-07):
#      expert 문항이 서버에선 3인데 목에선 2로 떠 화면상 난이도가 되돌아갔다.
#   ⑵ `test_목의_사전_b_표가_서버와_같다` — 목 소스에 `LEVEL_GROUP_ITEM_B` 표가
#      서버와 같은 값으로 있고 임계가 `priorB >= LEVEL_GROUP_ITEM_B.adult`인가.
#
# 어디로 갔나 — **B조의 새 항목이 더 강하게 대체한다**
# (`chore/mock-server-parity-audit`, 이 브랜치에 병합됨):
#   · `test_r13_mock_policy_parity.py:762` `test_보드_난이도_규칙이_같은_답을_낸다`
#     — 소스 **문자열 대조**가 아니라 목이 내려보낸 표본 입력을 **서버 함수에 넣어
#     답을 대조**한다. 문자열 비교 회귀(⑴)도 사전 b 임계(⑵)도 답이 갈리는 순간
#     잡히므로 이쪽이 상위 집합이다. 게다가 **3개 이상인 객체 palette**를 표본에
#     요구해, 이 파일이 못 보던 「입력이 그 갈래를 안 밟아서 초록」까지 막는다.
#   · `test_r13_mock_policy_parity.py:748` `test_사전_b_표가_같다` — 표를 소스
#     substring이 아니라 **실값**으로 대조한다(⑵의 표 몫).
#
# 🔴 ⚠️ **브리핑의 전제 하나가 틀렸다 — 대체자도 함께 죽는다.**
# 브리핑은 *"B조가 `board_difficulty_samples`로 **새 축 규칙**을 대조하게 만들었다"*
# 고 적었으나, `:772`가 임포트한 것은 **`board_difficulty`(파생축)**였다. 즉 B조
# 항목은 새 축으로 갈아탄 것이 아니라 **같은 파생축을 더 강하게 문** 것이다.
# ⇒ 파생 함수를 지우면 B조 항목도 함께 무너진다. 그 파일은 내 소유가 아니라
# 고치지 않고 **보고했다.** 「대체자가 있다」와 「대체자가 산다」는 다르다.
#   ✅ **2026-08-20 후속: 리드가 `0b0b2e6`으로 그 죽은 대조를 걷고 경위를 남겼다.**
#   위 문단은 그래서 **과거형**으로 읽어야 한다 — 전제 정정 자체는 유효하고
#   (브리핑이 축을 잘못 적었다), 무너진 상태는 리드가 이미 닫았다.
#
# 🔴 ⚠️ ~~**더 큰 구멍: 목이 아직 새 축으로 갈아타지 않았다.**~~
# ✅ **2026-08-20 정정: 이 기술은 쓴 시점에 이미 거짓이었다.** 근거로 삼은 목 판독은
# 내 세션 앞부분 값이고, 리드의 `4cac129`가 목을 지식 단계로 갈아탄 뒤였다 —
# 그 커밋이 **이 커밋의 부모**다. 파리티도 `97baa20`·`0b0b2e6`으로 새 축에 다시
# 물렸다. ⇒ 「목↔서버가 지금 갈라져 있다」는 거짓이다.
# 지우지 않고 정정만 하는 이유(§0-5): 이 문장이 내 보고의 **최우선 에스컬레이션
# 근거로 이미 인용됐다.** 남는 교훈은 목 상태가 아니라 **읽은 시점과 쓴 시점 사이에
# 트리가 움직였다**는 것 — 공유 워크트리에서 남의 파일을 근거로 현재형을 쓰면 낡는다.
