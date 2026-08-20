// Climate Detective module resources (en) — R13, carryover CO-N-2.
// Key parity with detective.ko.js is guarded by tests/i18n.smoke.test.mjs.
//
// ⚠️ Top-level namespace must stay `detective` only — core.js merges these files
// with a shallow spread, so any other top-level key would wipe that whole
// namespace from en.js.
//
// Case content (title, clues, hypotheses, solution) is NOT here — it is data the
// server sends from database/seed/detective_cases.json. Only chrome lives here.
export default {
  detective: {
    // Entry card on the Explore home (/explore) — we did not add an 8th nav tab.
    entry: {
      title: 'Climate Detective',
      desc: 'Find out why two observation sites diverged by collecting clues. Investigate before you answer.',
      inputs: 'Time series · 7 clue cards',
      badge: 'Fictional observations — not a real record',
    },
    list: {
      title: '🔎 Climate Detective',
      heroTitle: 'Why did the two stations disagree?',
      subtitle: 'Read a case file built from realistic observations, gather clues, and work out the cause.',
      empty: 'No open cases yet',
      emptyBody: 'Case files will show up here as they are prepared. Meanwhile you can change conditions in the explore sims.',
      emptyCta: 'Back to Explore',
      loading: 'Loading case files...',
      loadErrorTitle: 'Could not load the case files',
      loadErrorBody: 'Please try again in a moment.',
      retry: 'Try again',
      clueCount: '{count} clues',
      minClues: 'Investigate at least {count} clues',
      open: 'Open the case →',
      back: '← Explore',
    },
    play: {
      backToList: '← Case files',
      loading: 'Opening the case data...',
      notFoundTitle: 'Case not found',
      notFoundBody: 'The address may have changed, or the case was closed.',
      dataNoteLabel: 'About this data',
      fictional: 'Fictional data',
      region: 'Stations',
      period: 'Observation period',
      caseFileLabel: 'CASE FILE',
      evidenceNo: 'EVIDENCE {n}',
      chartsTitle: '1. Study the data',
      chartsHint: 'Opening a clue marks its moment on the chart.',
      chartAria: '{label} time series chart',
      cluesTitle: '2. Investigate the clues',
      cluesHint: 'Tap a card to open one clue at a time. You need at least {min} to reason.',
      clueLocked: 'Investigate',
      clueOpened: 'Investigated',
      clueMarker: '{metric} · {x}',
      progress: 'Clues investigated {opened} / {total}',
      progressAria: 'You have investigated {opened} clues. You need {min} to reason.',
      hypothesesTitle: '3. Make your case',
      hypothesesHint: 'Pick the one explanation that best fits the data and the clues.',
      lockedHint: 'Investigate {remaining} more clues to reason.',
      submit: 'Close the case with this',
      submitting: 'Reviewing...',
      pickFirst: 'Pick a hypothesis first.',
      resultCorrect: '✅ Case solved — this is where the data points.',
      resultPartial: '🟡 Right direction, but the evidence is not enough to conclude.',
      resultIncorrect: '❌ That does not fit the data. Want to look at the clues again?',
      verdictCorrect: 'Solved',
      verdictPartial: 'Partly right',
      verdictIncorrect: 'Incorrect',
      supportingTitle: 'Clues this judgement rests on',
      solutionTitle: 'Case summary',
      takeawayLabel: 'Remember',
      nextStepLabel: 'Try next',
      retry: 'Reason again',
      backAfterSolve: 'See other cases →',
      submitFailed: 'Submission failed. Please try again in a moment.',
      notEnoughClues: 'Investigate more clues before reasoning.',
    },
  },
};
