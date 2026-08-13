import { useT } from '../../i18n';

/**
 * RewardChips (R13 CO-T-4) — **방금 받은** 보상을 그 자리에서 알린다.
 *
 * 서버가 세션 완료·보드 통과 응답에 `quest_rewards`·`badges_earned`를 싣기 시작하면서
 * 생긴 자리다. 그전에는 퀘스트 3종 최대 +25 XP와 `perfect_session` 배지가 **지급만
 * 되고 획득 순간 어디에도 안 떴다** — `/progress`를 나중에 열어야 발견할 수 있었는데,
 * 그건 "받았다"는 피드백이 아니라 "받았었나 보다"라는 사후 확인이다.
 *
 * **서버가 보낸 것만 그린다.** 무엇이 새로 완료됐는지는 전적으로 서버 판정이고
 * (`newly_done` 전환만 실린다), 프론트는 목록이 비면 통째로 렌더하지 않는다.
 * 보유 목록을 여기서 다시 그리면 재요청마다 "방금 완료!"가 되살아난다.
 *
 * 라벨(title)은 **서버 원문**을 그대로 쓴다 — `QuestList`·`BadgeCollection`이 이미
 * 그렇게 하고 있어 같은 이름이 화면마다 달라지면 안 된다. 서버 원문의 번역은
 * 별건(i18n S-5)이라 여기서 사본을 만들지 않는다.
 */
export default function RewardChips({ quests = [], badges = [], className = '' }) {
  const t = useT();
  const questList = Array.isArray(quests) ? quests : [];
  const badgeList = Array.isArray(badges) ? badges : [];
  if (questList.length === 0 && badgeList.length === 0) return null;

  return (
    <div
      data-reward-chips={questList.length + badgeList.length}
      className={`flex flex-wrap justify-center gap-1.5 ${className}`}
    >
      {questList.map((q) => (
        <span
          key={`quest-${q.code}`}
          data-reward-quest={q.code}
          className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-3 py-1 text-xs font-extrabold text-violet-700"
        >
          <span aria-hidden="true">🎯</span>
          {t('rewards.questDone', { title: q.title })}
          <span className="font-black">+{q.reward_xp}</span>
        </span>
      ))}
      {badgeList.map((b) => (
        <span
          key={`badge-${b.code}`}
          data-reward-badge={b.code}
          className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-3 py-1 text-xs font-extrabold text-amber-800"
        >
          <span aria-hidden="true">🏅</span>
          {t('rewards.badgeEarned', { title: b.title })}
        </span>
      ))}
    </div>
  );
}
