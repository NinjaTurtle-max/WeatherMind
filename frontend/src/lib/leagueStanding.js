/**
 * 내 리그 성적 파생 — **단일 소유자**.
 *
 * 2026-08-09까지 이 규칙은 LeaguePage 안에만 있었다. 학습 화면 하단 3카드에
 * 리그 칸이 생기면서 읽는 곳이 둘이 됐고, 복사하면 "등급 카드와 사다리가 서로
 * 다른 등급을 가리키는" 사고가 화면 사이로 번진다(LeaguePage가 원래 한 곳에서만
 * 계산하기로 했던 이유가 그것이다). 그래서 컴포넌트 밖으로 꺼냈다.
 */

/** 리더보드 행이 나인가. 서버가 is_me를 주면 그것이 1순위. */
export function isMe(row, user) {
  return (
    row.is_me === true ||
    (user?.user_id && row.user_id === user.user_id) ||
    (user?.nickname && row.nickname === user.nickname)
  );
}

/**
 * 내 리그 성적 한 벌 — {elo, rank}.
 *
 * ELO는 **가장 최근에 정산된 주**의 값이다. 서버가 week_start 내림차순으로
 * 주지만(routers/league.py) 그 순서에 기대지 않고 여기서 최댓값을 고른다 —
 * 정렬이 바뀌면 조용히 옛 등급을 보여주게 되고, 화면만 봐서는 알아챌 수 없다.
 *
 * 정산 이력이 없으면 리더보드 행으로 넘어간다. 그것도 없으면 null이다 —
 * 0으로 채우지 않는다(0은 "0점"이라는 실제 성적처럼 읽힌다).
 */
export function deriveStanding(ranks, myResults, user) {
  const myRow = ranks.find((r) => isMe(r, user)) ?? null;
  const settled = myResults
    .filter((r) => r.elo_rating_after != null)
    .sort((a, b) => String(b.week_start ?? '').localeCompare(String(a.week_start ?? '')))[0];
  return {
    elo: settled?.elo_rating_after ?? myRow?.elo_rating ?? null,
    rank: myRow?.rank ?? null,
  };
}
