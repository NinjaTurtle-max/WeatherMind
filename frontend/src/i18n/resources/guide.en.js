// GuideBot resources (en) — MT-26. Mirrors guide.ko.js key-for-key.
//
// ⚠️ Top-level namespace must be `guide` only — core.js merges with a shallow
// spread, so any other top-level key here would wipe that namespace from en.js.
//
// Parity with the ko file is enforced by tests/i18n.smoke.test.mjs, and the key
// set itself is owned by lib/guideRules.js (GUIDE_MESSAGE_KEYS).
//
// Register: the audience includes elementary-school learners, so keep the
// wording plain. Guidance is wayfinding, not instruction — jargon here is a
// barrier rather than help.
export default {
  guide: {
    state: {
      outOfClouds: "You're out of clouds. Take a short break and they'll build back up!",
      levelUp: 'Nice — you moved up a level! Let’s keep going.',
      sessionComplete: "That's today's set done! Same again tomorrow is plenty.",
      correctAnswer: 'Got it! Keep that instinct going.',
      wrongAnswer: "That's okay. Let's read the explanation together — it'll come around again!",
      firstVisit: "Hi! I'm Cloudy. Let's get to know the weather together.",
    },
    screen: {
      board: 'Place the pieces to build the weather. Sunny gives the hints.',
      learn: "Here's today's lesson. One step at a time is plenty.",
      duel: "Predict today's weather. Get it right and your score goes up!",
      league: 'Compete with a week of points and climb the cloud tiers.',
      explore: 'Change the values and watch how the weather shifts.',
      me: "Everything you've learned so far, gathered in one place.",
      default: 'Not sure where to start? Try Learn first.',
    },
    aria: {
      collapse: 'Collapse guide bot message',
      expand: 'Expand guide bot message',
    },
  },
};
