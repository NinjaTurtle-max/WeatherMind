// board·explore 모듈 전용 리소스(en) — R11-01 §6.3 FE-D1 소유.
// D2가 소유한 en.js와 파일을 갈라 페이즈 B 병렬 충돌을 없앤다(PM 선배선).
// index.js가 스프레드로 병합하므로 키 충돌 시 이 파일이 이긴다 — 최상위
// 네임스페이스는 board.*·explore.*만 쓸 것.
//
// 이력(2026-08-04): 초판은 21키를 ko 동일값(KO-PLACEHOLDER)으로 저작했다 —
// assist·board-entry 스모크가 jsdom(navigator.language=en-US)에서 detectLocale()로
// en을 고르면서 한국어 문구·aria로 버튼을 단정했기 때문. 스모크 하네스에 로케일
// ko 고정이 들어간 뒤(jsdom 7종 + SSR 3종) 전건 실제 영문으로 교체 완료.
// 스모크는 이제 "ko 화면 무회귀"를 검증하고, en 품질은 이 파일이 소유한다.
export default {
  board: {
    // MT-28: board display dictionary (see boardDisplay.js).
    meta: {
      airMass: {
        siberian: { label: 'Siberian air mass', hint: 'cold & dry' },
        north_pacific: { label: 'North Pacific air mass', hint: 'hot & humid' },
        yangtze: { label: 'Yangtze air mass', hint: 'warm & dry' },
        okhotsk: { label: 'Okhotsk air mass', hint: 'cold & humid' },
      },
      front: {
        cold: { label: 'Cold front', hint: 'cold air wedges in' },
        warm: { label: 'Warm front', hint: 'warm air rides over' },
        stationary: { label: 'Stationary front', hint: 'two air masses stall (monsoon rains)' },
      },
      phenomenon: {
        shower: { label: 'Shower' },
        rain: { label: 'Rain' },
        persistent_rain: { label: 'Persistent rain (monsoon)' },
        snow: { label: 'Snow' },
        fog: { label: 'Fog' },
        heatwave: { label: 'Heat wave' },
        clear: { label: 'Clear' },
        cloudy: { label: 'Cloudy' },
        wildfire_risk: { label: 'Wildfire risk' },
        flood_risk: { label: 'Flood risk' },
        // ㉣ warning tier (2026-08-18) — only when all four conditions hold.
        severe_storm: { label: 'Organised thunderstorm' },
        wildfire_warning: { label: 'Wildfire warning' },
        flood_warning: { label: 'Flood warning' },
        // MT-18 expert boards (2026-08-18) — typhoon · greenhouse effect.
        // Keys must match board.ko.js exactly (i18n parity smoke asserts the key sets).
        typhoon: { label: 'Typhoon' },
        tropical_night: { label: 'Tropical night' },
      },
      cloud: {
        cumulonimbus: { label: 'Cumulonimbus' },
        nimbostratus: { label: 'Nimbostratus' },
        stratus: { label: 'Stratus' },
        cumulus: { label: 'Cumulus' },
        none: { label: 'No cloud' },
      },
      element: { moisture: 'Moisture', sun: 'Sunlight', wind: 'Wind', aerosol: 'Aerosol (particulates)' },
    },
    common: {
      outOfClouds: '☁️ Your clouds have all drifted away',
    },
    hero: {
      title: 'What weather shall we build today?',
    },
    page: {
      // ⚠️ **The five difficulty-badge keys were deleted on 2026-08-20**
      //    (difficulty1~3 · difficultyAria · difficultyText). Recorded rather
      //    than silently dropped, because those words were cited from three
      //    places: `lockedBannerBody` below, the boardEntryGate smoke contract,
      //    and BoardPage's badge-row comment.
      //      · Old values: 'Elementary' · 'Mid & high' · 'Adult'
      //        + 'Difficulty: {label}' · 'Difficulty {label}'
      //      · Why: the badge axis moved from school-derived `difficulty`
      //        (1~3) to **knowledge level** (`knowledge_level`, 1~10). The ten
      //        names have exactly one owner, `ability.knowledgeLevel.name` in
      //        `{ko,en}.js`, and the badge frame is shared with the session
      //        badge (`session.knowledgeLevel` / `...Aria`). A second copy here
      //        would let the two badges drift apart.
      //      · Only consumer was BoardPage's badge (repo-wide grep, 2026-08-20).
      //    The 2026-08-18 width measurement that lived here (158px badge-row
      //    basis, per-label pixel table, the unapplied 'Secondary'/'Mid-high'
      //    shortlist) is **archived in git history** and its still-live part
      //    (the 158px basis and the ellipsis arithmetic) was copied into the
      //    badge-row comment in BoardPage.jsx, which now owns it.
      sandboxQuestion: 'Sandbox — place elements freely and observe what weather emerges',
      toastCrown: '👑 Crown earned — {title}',
      toastFirstClear: '🧩 First clear! +{xp} XP',
      outOfCloudsRetry: 'Your clouds have all scattered — please try again in a moment.',
      submitFailed: 'Submission failed. Please try again in a moment.',
      rulesUnavailable: 'Could not load the board scoring rules. Please try again in a moment.',
      entryFailed: 'Could not open the puzzle. Please try again in a moment.',
      backToList: '← Back to list',
      sandboxFooter: 'Sandbox play is not graded — and it never costs clouds ☁️',
      loading: 'Loading atmosphere board puzzles...',
      loadErrorTitle: 'Could not load the puzzle',
      loadErrorBody: 'Please try again in a moment.',
      retry: 'Try again',
      retryChallenge: 'Challenge again',
      nextPuzzle: 'Next puzzle →',
      lastPuzzleDone: '🎉 You finished the last puzzle!',
      // Deliberately not the completion line — nothing is finished, the next
      // cell just is not open yet.
      nextNotOpenYet: 'Pick your next puzzle from the list',
      title: '🧩 Atmosphere Board',
      subtitle: 'Place weather elements across 4 regions of the Korean Peninsula to create the target weather.',
      depletedBody1: 'Clouds only shrink by',
      depletedBodyBold: '1 per wrong attempt',
      depletedBody2: '— they are spent on mistakes, not on effort. In about',
      depletedMinutes: '{min} min',
      depletedBody3: 'one cloud will recover and you can open a new puzzle. The ungraded free experiment is still open in Explore.',
      empty: 'No puzzles registered yet.',
      modeGuided: 'Guided mode',
      modeGoal: 'Goal mode',
      cardRecovery: '☁️ Clouds recover in about {min} min',
      puzzleFallback: 'Puzzle',
      lockedSuffix: ' (locked)',
      lockedTitle: 'Raise your learning level in Profile to unlock',
      // Shortened 2026-08-18 from 'Above your level' (measured 92px) — that
      // width is the **common term** of all three badge cards, so cutting it
      // buys margin on every one of them (see the measurement block above).
      // Chosen by width, not by taste: this is a strict deletion of 'your '
      // from the measured string, so it is **provably** narrower than 92px.
      // Predicted ≈ 64px (4 letters + 1 space ≈ 28px off, at the 6.14px/letter
      // rate implied by the 92px measurement) → ≈ 24px margin on the worst
      // card (Elementary: 158 − 64 − 6 = 88px available).
      // Terseness is safe here because the full wording lives where it is
      // read out and hovered: `lockedTitle` (button `title`) and
      // `lockedSuffix` (aria-label). Only the 11px visual hint shrinks.
      // ⚠️ Predicted, **not** certified — the margin table is the measurement
      // role's to produce, on the same 158px basis.
      cardLocked: 'Above level',
      lockedBannerTitle: '🔒 You see the difficulties your learning level opens',
      // Same words as difficulty1~3 above — the badge and this banner must not
      // name the same tier two different ways.
      lockedBannerBody: 'Elementary students open Elementary, middle/high students up to Mid & high, adults open all tiers up to Adult.',
      lockedBannerCta: 'Change learning level',
      blockedSuffix: ' (out of clouds)',
      blockedTitle: 'Opens when a cloud recovers — in about {min} min',
      // MT-24 sequential lock. Deliberately worded apart from the energy block:
      // waiting fixes one, solving fixes the other. Also a **distinct key** from
      // the level lock above — they had briefly collided after the merge and the
      // later definition silently shadowed the earlier one (2026-08-12).
      // Shortened 2026-08-18 from '🔒 Earlier puzzles first'. This is the
      // **real worst case**, not the level lock: a sequentially locked puzzle
      // sits at any difficulty, so it routinely faces the widest badge
      // (Elementary 64px → only 88px left), and it carried a 🔒 the level-lock
      // string had already dropped — the lock is already drawn at the card's
      // top-right (BoardPage.jsx:674), so the emoji was duplicate width.
      // Old string ≈ 121px + emoji ≈ 14px, far past 88px.
      // 🔴 **This is the tighter of the two and it is NOT certified.**
      // Predicted ≈ 77–80px (12 letters + 1 space at 6.14–6.4px/letter) →
      // predicted worst-card margin only ≈ 8–11px, and the prediction itself
      // carries a few px of error. If re-measurement on the 158px basis gives
      // under ~10px, fall back to **'In order'** (≈ 46px predicted, ≈ 42px
      // margin) — pre-cleared for meaning because the 🔒 icon and
      // `seqLockedTitle` ('Clear the puzzles before this one to open it')
      // already carry the explanation on hover and to screen readers.
      // ko is deliberately unchanged: its row has wide headroom
      // (중·고등 32 + 6 + ~93 = ~131 of 158) and ko values are byte-identical
      // to the authored source. So en drops the 🔒 while ko keeps it.
      lockedHint: 'Earlier first',
      seqLockedTitle: 'Clear the puzzles before this one to open it',
      opening: 'Opening…',
      cleared: '✓ Cleared',
      challenge: 'Challenge',
      progressLabel: 'Overall progress',
      progressCount: '{done} / {total} puzzles cleared',
      comingSoon: 'A slot still being authored',
      serverVerdict: 'Server verdict',
    },
    atmosphere: {
      kind: {
        front: 'Fronts',
        airMass: 'Air masses',
        moisture: 'Moisture',
        sun: 'Insolation',
        wind: 'Wind',
        aerosol: 'Aerosol family',
      },
      missionEyebrow: '🎯 This mission',
      missionSandbox: '🧪 Free experiment',
      timerTitle: 'Time limit',
      basedOn: 'Based on a real event ·',
      guidePanelTitle: 'Guide',
      guideClose: 'Close guide',
      guidePrefix: 'Guide {step}/{total}:',
      guideNext: 'Next guide →',
      paletteHeader: 'Element palette (tap to pick, then tap a zone — or drag and drop)',
      paletteHowTo: 'Pick an element, then tap a region on the map to place it.',
      focusControls: '{zone} controls',
      focusEmpty: 'Nothing placed here yet',
      goalProgressLabel: 'Target phenomena',
      goalMet: '✓ All goal conditions met — try submitting!',
      goalPending: 'Preview: the goal has not been reached yet',
      hintStep1: 'Focus on {zone} first. The target phenomenon forms from the atmospheric state of this region.',
      hintJoiner: ' or — ',
      hintFallbackStep2: 'Try each element type above, one at a time. When the conditions line up, the phenomenon in that region changes immediately.',
      hintHere: '💡 Start here',
      hintPrefix: '💡 Hint {n}:',
      hintNeedsLabel: 'Piece types needed:',
      hintCta: '💡 Show hint ({n}/{total})',
      hintNoAnswer: 'Hints never reveal the answer placement — take the last step yourself.',
      // ①안 3단 (N-3) label. No digits — see the BoardHintPanel comment.
      explainLabel: '📖 Stuck a few times — here is how this weather forms',
      moisture: '💧 Moisture',
      sun: '☀️ Insolation',
      wind: '🌬️ Wind',
      aerosol: '🟤 Aerosol (particulates)',
      // R13 disaster axis (CO-A3 / CO-K4) — banner shown only when the verdict is a hazard
      disasterWildfireTitle: '🔥 Wildfire risk',
      disasterWildfireBody: 'The air is parched so fuel ignites easily, and strong wind carries embers.',
      disasterFloodTitle: '🌊 Flood risk',
      disasterFloodBody: 'Water vapour keeps streaming in, so the rain never stops and the ground can no longer absorb it.',
      disasterWildfireWarningTitle: '🚨 Wildfire warning',
      disasterWildfireWarningBody: 'Parched air and gale-force wind together — once a fire starts it spreads faster than anyone can stop it.',
      disasterFloodWarningTitle: '🚨 Flood warning',
      disasterFloodWarningBody: 'Fronts converge and rain pours down with nowhere to drain — the city can go under.',
      resultSuccess: '🎉 Success! You created the target atmospheric phenomenon',
      resultFail: 'Not yet — change your placement and try again',
      timeoutTitle: '⏱ Time is up! The board was not completed within the limit',
      timeoutRetry: 'Try again ({sec}s)',
      undoTitle: 'Undo the last placement (no cloud cost)',
      undo: 'Undo',
      removeAria: 'Remove {label}',
      submitting: 'Judging...',
      submit: 'Submit',
    },
    panel: {
      // MT-28: in-scene labels shared by the SVG and WebGL cross-sections.
      viz: {
        altitude: 'Altitude',
        surface: 'Surface',
        strongSun: 'Strong sunlight',
        clearSkyWildfire: 'Cloudless sky · wildfire risk',
        cloudCannotGrow: 'Clouds cannot grow',
        nimbostratusWide: 'Nimbostratus (broad, thick layer cloud)',
        descendCompressWarm: 'Compressed and warmed on the way down',
        foehnClear: 'Foehn wind — clear',
        snowCloudDevelop: 'Snow clouds develop (air mass transformed)',
        convectiveRise: 'Convective rise',
        heatAccumulates: 'Hot air builds up — temperature ↑',
        hotHumid: 'Hot & humid',
        warmedAirRises: 'The warmed air rises',
        warmDry: 'Warm & dry',
        warmDryAirMass: 'A warm, dry body of air',
        warmHumidAir: 'Warm, humid air',
        warmAir: 'Warm air',
        warmYellowSea: 'Warm Yellow Sea',
        groundCannotAbsorb: 'The ground can absorb no more water',
        groundRadiatesCools: 'The ground radiates heat and cools',
        clearCalmNight: 'Clear night, light wind',
        dryWarmWind: 'Dry, warm wind',
        condenseByWater: 'Vapour condenses by the water',
        driedLeavesTwigs: 'Leaves and twigs drained of moisture',
        lowVapourNoSea: 'Little vapour — it never crossed the sea',
        radiativeCooling: 'Radiative cooling — heat released',
        northPacificMt: 'North Pacific air mass (mT)',
        embersRideWind: 'Embers ride the wind',
        rainCloudRefills: 'Rain clouds keep refilling',
        monsoonCloudBand: 'Nimbostratus (monsoon cloud band)',
        mountainRange: 'Mountain range',
        westCoastSnow: 'Heavy west-coast snow',
        strongWind: 'Strong wind',
        vapourShortNoCloud: 'Too little vapour — no cloud can form',
        condenseToSeaFog: 'Vapour condenses → sea fog',
        condenseToFogLayer: 'Vapour condenses → fog layer',
        vapourKeepsArriving: 'Vapour keeps streaming in',
        humidAirSupply: 'Humid air supplied',
        siberianCp: 'Siberian air mass (cP)',
        coolsFromBelow: 'Cools from below',
        yangtzeAirMass: 'Yangtze air mass',
        heatVapourSupply: 'Heat & vapour supplied',
        clearDespiteChurn: 'It churns, yet the sky stays clear',
        rainOnRiseLosesWater: 'Rain on the climb — moisture lost',
        okhotskAirMass: 'Okhotsk air mass',
        noVapourToCondense: 'No vapour left to condense',
        denseFogEarlyMorning: 'Early morning, dense fog',
        cumulonimbus: 'Cumulonimbus',
        stationaryFront: 'Stationary front',
        groundHeating: 'Surface heating',
        nearSurfaceCooling: 'Air near the surface cools',
        coldDry: 'Cold & dry',
        coldHumidAir: 'Cold, humid air',
        coldHumid: 'Cold & humid',
        coldAir: 'Cold air',
        coldAirRetreating: 'Cold air (retreating)',
        coldSea: 'Cold sea',
        coldClearWinterSky: 'Cold, clear winter sky',
        mildClearSky: 'Mild, clear spring/autumn sky',
        heatwave: 'Heat wave',
        liftsAfterSunrise: 'Lifts soon after sunrise',
        fogLowCloudToShore: 'Fog and low cloud reaching the shore',
        upglide: 'Upglide',
        daysOfDrying: 'Days of dry air — dry all the way through',
        fireFrontHead: 'Fire head — fastest on the downwind side',
        spotFireAhead: 'Flying embers start a new fire ahead',
        newCellsUpwind: 'New rain cells keep forming upwind',
        soilAlreadyFull: 'The gaps in the soil are already full of water',
        runoffGathersLow: 'Water that cannot soak in gathers in low ground',
        forestedRidge: 'Forested ridge — fire runs faster up a slope',
        cityImpervious: 'City — paved ground cannot soak water up',
        fireRunsUphill: 'Fire runs faster up a slope',
        crownFireInTrees: 'It has climbed into the treetops',
        drainOverwhelmed: 'The storm drain cannot keep up and backs up',
        basementFloods: 'Water fills the basement first',
        greenGroundSoaks: 'Green ground still soaks water in',
        windShear: 'Wind shear (upper vs lower)',
        organizedStorm: 'Storm organised into one system',
        cloudBlocksSun: 'Thick cloud blocks the sun',
        latentHeatFuel: 'Heat released as vapour condenses — the fuel',
        lowShearColumn: 'Little shear, so it builds one column',
        eyewallStrongest: 'Eyewall — the strongest winds',
        longwaveTrapped: 'Vapour traps the longwave and sends it back',
        noWindNoMixing: 'Too little wind to mix the heat away',
        groundEmitsLongwave: 'The ground emits the heat as long-wave',
      },
      // MT-28: cross-section storyboards (see CrossSectionPanel STORYBOARDS).
      // Step counts must match ko — crossSectionWebgl.contract checks steps.length
      // against the WebGL SCENES stage count.
      story: {
        cold_front_shower: {
          title: 'Cold front — a narrow, intense shower',
          steps: [
            'Cold air drives in fast beneath the warm air like a wedge.',
            'The displaced warm, humid air is forced steeply up the frontal surface.',
            'Inside the strong updraft, vapour condenses and cumulonimbus towers upward.',
            'A brief, heavy shower falls over a narrow band near the front, sometimes with lightning.',
          ],
        },
        stationary_front_monsoon: {
          title: 'Stationary front — days of monsoon rain',
          steps: [
            'Cold and warm air of similar strength meet and hold their ground.',
            'Neither gives way, so the front lingers in one place — a stationary front.',
            'Humid air keeps feeding in from the south, building a thick nimbostratus band.',
            'Rain falls over the same region for days, as in the monsoon season.',
          ],
        },
        warm_front_steady_rain: {
          title: 'Warm front — light rain over a wide area',
          steps: [
            'Warm air advances toward the retreating cold air.',
            'The warm air glides up over the cold air along a gentle frontal surface.',
            'Cooling slowly, it forms a layered nimbostratus sheet across a wide area.',
            'Light rain falls steadily over that wide area for a long time.',
          ],
        },
        siberian_snow: {
          title: 'Siberian air mass transformed — heavy west-coast snow',
          steps: [
            'The cold, dry Siberian air mass (cP) moves southward.',
            'Crossing the warm Yellow Sea, it draws heat and vapour from the water.',
            'Its lower layer is transformed and snow clouds develop in rows.',
            'Heavy snow falls where those snow clouds reach the west coast.',
          ],
        },
        convective_shower: {
          title: 'Convection — a midsummer afternoon shower',
          steps: [
            'Strong midsummer sunlight heats the ground.',
            'The warmed, humid air becomes lighter and rises vigorously — convection.',
            'As it cools, vapour condenses and cumulonimbus grows tall.',
            'Even with no front, a shower pours over a small area for part of the afternoon.',
          ],
        },
        radiation_fog: {
          title: 'Radiation fog — mist on a clear dawn',
          steps: [
            'On a clear, cloudless night the ground radiates heat away and cools quickly.',
            'Air touching the chilled ground cools with it, from the bottom up.',
            'Vapour in that cooled air condenses into a fog layer blanketing the surface.',
            'Dense fog lies low until the early morning sunrise.',
          ],
        },
        north_pacific_heatwave: {
          title: 'North Pacific air mass — midsummer heat wave',
          steps: [
            'The hot, humid North Pacific air mass (mT) settles broadly over the country.',
            'Strong sunlight through the clear sky keeps heating the surface.',
            'Hot air cannot escape and builds up, so temperatures climb sharply.',
            'Midsummer swelter — the heat wave persists.',
          ],
        },
        siberian_clear: {
          title: 'Siberian air mass — a cold, clear winter',
          steps: [
            'The cold, dry Siberian air mass (cP) settles in.',
            'The air is dry and short of vapour, so clouds barely form.',
            'A cloudless sky — cold but clear winter weather.',
          ],
        },
        okhotsk_sea_fog: {
          title: 'Okhotsk air mass — fog born of a cold sea',
          steps: [
            'The cold, humid Okhotsk air mass pushes toward the East Sea.',
            'Passing over the cold water, the humid air cools from its lowest layer first.',
            'Vapour condenses in that cooled layer and fog spreads over the sea.',
            'Fog and low cloud reach the shore, leaving the early-summer east coast cool and overcast.',
          ],
        },
        okhotsk_foehn_clear: {
          title: 'Foehn wind — a sky cleared by crossing the mountains',
          steps: [
            'Cold, humid air from the east meets the range and climbs the slope.',
            'Cooling as it rises, it drops rain on the eastern side and loses nearly all its moisture.',
            'The dried air crosses the ridge and warms as it is compressed on the way down.',
            'West of the range a dry, warm wind blows under a cloudless sky — the foehn.',
          ],
        },
        yangtze_mild_clear: {
          title: 'Yangtze air mass — mild, clear spring and autumn',
          steps: [
            'The warm, dry Yangtze air mass moves our way in spring and autumn.',
            'It does not travel far over sea, so it carries little vapour.',
            'With too little vapour to condense, clouds cannot grow.',
            'Mild, clear spring and autumn weather continues.',
          ],
        },
        yangtze_morning_fog: {
          title: 'Yangtze air mass — dawn fog by the river',
          steps: [
            'Under a blanket of warm, dry air the night sky is clear and the wind light.',
            'With no cloud to cover it, the ground radiates heat away and cools quickly.',
            'Where moisture gathers — by rivers or in basins — vapour in the cooled air condenses.',
            'Low fog settles at dawn, then lifts soon after the sun warms the ground.',
          ],
        },
        dry_convection_clear: {
          title: 'Dry convection — a cloudless clear sky',
          steps: [
            'Strong sunlight heats the ground, and the warmed air lightens and rises.',
            'The rising air expands and cools, but holds almost no vapour.',
            'With no vapour to condense into droplets, no cloud forms.',
            'The air churns up and down, yet the sky stays clear.',
          ],
        },
        wildfire_risk_dry_gale: {
          title: 'Dry air + gale — a day wildfire spreads easily',
          steps: [
            'When the air is parched, moisture drains out of fallen leaves and twigs.',
            'A strong wind sweeps across the dry ground.',
            'The wind carries embers far and keeps feeding them oxygen.',
            'Not a cloud in the sky — yet the weather in which fire spreads the fastest.',
          ],
        },
        flood_risk_saturated_inflow: {
          title: 'Saturation + vapour inflow — a day of flooding',
          steps: [
            'A strong wind carries vapour in from the sea without pause.',
            'As soon as one rain band spends itself, the next fills its place.',
            'So the rain never stops and keeps falling on the same spot.',
            'It passes what the ground can absorb, and water begins to pool.',
          ],
        },
        cold_front_squall_storm: {
          title: 'Cold front + sun + wind — an organised squall',
          steps: [
            'Strong sunshine heats the air near the ground and the atmosphere turns unstable.',
            'A cold front shoves that humid air sharply upward.',
            'Upper and lower winds differ enough that rising and sinking air each get their own lane.',
            'So the cloud does not fall apart — it organises into one system and pours longer and harder.',
          ],
        },
        siberian_gale_wildfire: {
          title: 'Siberian air + gale — wildfire-warning weather',
          steps: [
            'Cold, bone-dry air settles in.',
            'Wind pouring down off the mountains strips the moisture from leaves and twigs.',
            'Strong sunshine heats that dry fuel further.',
            'One small ember rides the wind and spreads in moments.',
          ],
        },
        front_convergence_flood: {
          title: 'Stationary front + convergence — the water rises',
          steps: [
            'A stationary front parks in one place.',
            'Humid wind keeps flowing in from below, refilling the same spot with vapour.',
            'Thick cloud blocks the sun, so the ground never warms enough to break the rain cloud up.',
            'The rain stays over one place and the water piles up faster than it can drain.',
          ],
        },
        tropical_cyclone_genesis: {
          title: 'Warm sea + low shear — the seed of a typhoon',
          steps: [
            'Hot, humid air rises off a sea the sun has warmed.',
            'Vapour condenses and releases heat, and that heat pushes the air up again.',
            'Upper and lower winds differ little, so the column stays aligned and organises.',
            'Once grown, the strongest winds are not at the centre but in the wall of cloud around it.',
          ],
        },
        greenhouse_tropical_night: {
          title: 'Humid air + still wind — the night that will not cool',
          steps: [
            'Daytime sunlight is absorbed by the ground and stored as heat.',
            'The ground sends that heat back out as invisible long-wave radiation.',
            'Water vapour in the air catches it and returns it to the ground.',
            'With too little wind to mix the heat away, the temperature never drops overnight.',
          ],
        },
        nocturnal_inversion_haze: {
          title: 'Nocturnal stable layer + light wind — a night that traps dry particles',
          steps: [
            'After sunset the ground radiates its heat away and cools quickly (radiative cooling).',
            'Air touching the cooled ground becomes colder than the layer above, so the two cannot mix.',
            'What is trapped in that shallow layer is not water droplets but invisible dry particles — so this is haze, not fog.',
            'With too little wind to carry them away, visibility stays poor until early morning. Once the sun warms the ground, mixing resumes and the concentration falls.',
          ],
        },
      },
      badgeConfirmed: '✓ Server verdict',
      badgePreview: 'Preview',
      badgeStatic: 'Static view',
      badgeCaption: 'Cross-section · {title}',
      noRule: 'No rule holds yet — try combining air masses, fronts, moisture, and insolation.',
      stepCounter: 'Step {n}/{total}',
      prevStep: 'Previous step',
      pause: 'Pause',
      play: 'Play',
      pauseBtn: '❚❚ Pause',
      replayBtn: '↻ Replay',
      playBtn: '▷ Play',
      nextStep: 'Next step',
      jumpGroup: 'Jump to step',
      jumpTo: 'Go to step {n}',
    },
    map: {
      // MT-28: zone display names overriding the server's Korean values.
      // Keyed by zone index (ZONES is contractually fixed at 0..3).
      zone: { 0: 'West Sea', 1: 'Metro Seoul', 2: 'Yeongseo · Taebaek', 3: 'Yeongdong · East Sea' },
      // MT-28: rule annotations (see mapInfographic RULE_ANNOTATIONS).
      // The \n keeps the leader-line label on two lines.
      annotation: {
        cold_front_shower: 'Cold front passes,\nshowers & lightning',
        stationary_front_monsoon: 'Stationary front forms,\ntorrential rain',
        warm_front_steady_rain: 'Warm front approaches,\nwide light rain',
        siberian_snow: 'Air mass transforms,\nwest-coast snowfall',
        convective_shower: 'Strong insolation,\nafternoon convective shower',
        radiation_fog: 'Radiative cooling,\ndense dawn fog',
        north_pacific_heatwave: 'Hot humid air,\npersistent heat wave',
        siberian_clear: 'Cold dry air,\nclear and cold',
        tropical_cyclone_genesis: 'Hot humid ocean,\nseed of a typhoon',
        greenhouse_tropical_night: 'Heat trapped at night,\nthe city never cools',
        cold_front_squall_storm: 'Cold air shoves it up,\nthunderstorms in a line',
        siberian_gale_wildfire: 'Parched air and gale,\nwildfire warning',
        front_convergence_flood: 'Stationary front, strong wind,\nwater cannot drain',
        flood_risk_saturated_inflow: 'Vapour keeps flowing in,\nthe ground is full',
        wildfire_risk_dry_gale: 'Dry gale-force wind,\nembers fly',
        okhotsk_sea_fog: 'Damp air over cold sea,\nsea fog',
        okhotsk_foehn_clear: 'Dry air over the ridge,\nclear and warm',
        yangtze_mild_clear: 'Mild continental air,\nclear',
        yangtze_morning_fog: 'Weak sun, lingering damp,\nmorning fog',
        dry_convection_clear: 'Strong sun but dry,\nclouds cannot grow',
        nocturnal_inversion_haze: 'Particles trapped at night,\nhazy low visibility',
      },
      mapAria: 'Korean Peninsula atmosphere board map — place elements on the 4 region nodes',
      zoneAria: '{name} zone{goal} — currently {phenomenon}',
      goalSuffix: ' (goal zone)',
    },
  },
  explore: {
    schematic: {
      ariaLabel: 'Schematic',
      unsupported: 'This device cannot display the 3D schematic.',
    },
    // MT-21: satellite schematic (modules/explore/SatelliteView.jsx).
    // schematicBadge is a contract, not decoration — the panel must say it is not
    // real imagery (the re-scope from KMA photography is what made F3 feasible).
    satellite: {
      warming: 'Preparing satellite imagery…',
      play: 'Play',
      pause: 'Pause',
      timeAria: 'Typhoon life stage — from genesis to dissipation',
      stage: 'Strength {pct}%',
      title: '🛰️ Satellite cloud schematic',
      productLine: 'WEATHERMIND SIM · IR 10.5um · SIMULATED PRODUCT',
      noSystem: 'No developed system — only scattered low cloud',
      schematicBadge: 'Not real imagery · educational schematic',
      rampLow: 'Low cloud',
      rampHigh: 'High, cold cloud',
      ariaNone: 'Satellite schematic — no typhoon formed, only scattered low cloud',
      ariaEye: 'Satellite schematic — the cloud shield is symmetric with a clear eye at the centre',
      ariaSheared: 'Satellite schematic — the cloud shield is pushed to one side, exposing the centre',
      readNone: 'The sea is not warm enough for cloud to gather in one place. On satellite you would see only scattered low cloud.',
      readGrowing: 'A cloud shield is growing around the centre. A little stronger and the middle will open into an eye.',
      readEye: 'Cloud wraps the centre evenly and the middle has opened — that is the eye. It means shear is weak and the column stands upright, so the satellite view alone tells you this is a well-developed typhoon.',
      readSheared: 'The cloud shield is displaced to one side and the centre is exposed. Winds aloft and below are misaligned, tilting the column — in real satellite reading this shape is the first clue that shear is strong.',
    },
    common: {
      back: '← Explore',
      whyTitle: '🤔 Why does this happen?',
      modelBadge: 'Simplified educational model — not a real forecast',
    },
    // MT-24: explore goals (modules/explore/exploreGoals.js·GoalPanel.jsx).
    // The numbers in the task lines (26.5°C · 31°C · 40 · 1.40–1.50°C · 20 days)
    // are the **same values the conditions test** — change a condition, change these.
    goals: {
      title: '🎯 Exploration goals',
      progress: '{done} / {total} done',
      doneBadge: 'Done!',
      lessonLabel: 'What you found —',
      howto: 'Move the conditions and the goals update instantly. This is an exploration log, not grading — no clouds are spent.',
      allDone: '🎉 Every goal cleared! Keep moving the conditions and try other combinations.',
      typhoon: {
        calmTitle: 'Cool the ocean down',
        calmTask: 'Lower the sea surface temperature until no typhoon forms at all.',
        calmLesson: 'Below 26.5°C nothing grows, no matter how long you wait — the warm ocean is the typhoon’s fuel.',
        shearWallTitle: 'The shear wall',
        shearWallTask: 'Heat the ocean to 31°C or more and still keep the intensity at 40 or below.',
        shearWallLesson: 'With shear set to “strong”, even a hot ocean cannot grow a typhoon. Energy alone is not enough — the vertical column has to stand upright.',
        superTitle: 'Reach super typhoon',
        superTask: 'Develop the storm all the way to the super typhoon category.',
        superLesson: 'A sea at 31°C or warmer AND weak shear must line up at the same time. One favourable condition is never enough.',
      },
      climate: {
        line15Title: 'The 1.5°C line',
        line15Task: 'Land the global mean temperature rise between 1.40°C and 1.50°C.',
        line15Lesson: 'The 1.5°C line is crossed around 390 ppm of CO₂ — you reach it well before the doubling point (560 ppm).',
        heatFirstTitle: 'Heatwaves arrive first',
        heatFirstTask: 'Keep the temperature rise at 1.20°C or below while pushing heatwave days to 20 or more per year.',
        heatFirstLesson: 'While the mean warms by barely 1°C, heatwave days have already doubled. A small shift in the average shows up far larger in the extremes.',
      },
    },
    home: {
      sandboxTitle: 'Free experiment',
      sandboxDesc: 'No goal, no grading. Place air masses, fronts, moisture and sunlight freely and watch what weather appears.',
      sandboxInputs: '9 elements · no grading · no clouds spent',
      heroTitle: 'What shall we play with today?',
      title: '🔭 Explore',
      subtitle: 'A space to explore the principles of weather and climate by moving the conditions yourself.',
      typhoonTitle: 'Build a Typhoon',
      typhoonDesc: 'Adjust sea temperature and wind shear to see when — and how strongly — a typhoon develops.',
      typhoonInputs: 'SST 24–32°C · vertical shear weak/moderate/strong',
      climateTitle: 'Experience Climate Change',
      climateDesc: 'Move the CO₂ concentration and watch how global mean temperature, sea level, and heatwave days respond.',
      climateInputs: 'CO₂ 280–560 ppm',
    },
    typhoon: {
      catNone: 'No genesis',
      catTd: 'Tropical depression (TD)',
      catTs: 'Tropical storm (TS)',
      catSts: 'Severe tropical storm (STS)',
      catTy: 'Typhoon (TY)',
      catSuper: 'Super typhoon',
      shearWeak: 'Weak',
      shearModerate: 'Moderate',
      shearStrong: 'Strong',
      whyBelow: 'The sea surface temperature is {sst}°C, below the genesis threshold (26.5°C). A typhoon runs on the latent heat of condensation released by water vapour that a warm ocean supplies — if the sea is colder than this, the fuel supply falls short and the vortex cannot grow into a typhoon.',
      whyBelowCta: 'Raise the slider above 26.5°C and a typhoon will begin to form.',
      whyAbove: 'The ocean is {diff}°C warmer than the threshold (26.5°C). The warmer the sea, the more active the evaporation and the more water vapour is supplied — and the heat released as that vapour condenses drives the typhoon engine harder.',
      whyShearWeak: 'The vertical wind shear (change of wind with height) is weak, so the typhoon column (warm core) stands upright. With its structure undisturbed, all the energy the ocean provides goes into intensification.',
      whyShearModerate: 'With moderate vertical shear, the typhoon column tilts slightly. When upper and lower winds pull in different directions, heat cannot gather in one place — so at the same sea temperature it develops less than under weak shear.',
      whyShearStrong: 'Strong vertical shear tilts the typhoon column sharply and shears its top away. However warm the ocean is, a collapsed structure cannot intensify — that is why the development curve bends over in its later half.',
      whySuper: 'Both conditions are optimal, so it developed to the strongest stage in this model.',
      gaugeAria: 'Intensity {n} / 100',
      gaugeUnit: 'Intensity index / 100',
      curveAria: 'Development curve over time',
      eyeSpinning: 'Rotating typhoon eye',
      eyeCalm: 'Calm sea',
      title: '🌪️ Build a Typhoon',
      disclaimer1: 'This is a simplified educational model. It is not a real typhoon forecast (numerical model) — it captures only the',
      disclaimerBold: 'tendency',
      disclaimer2: ' of how sea temperature and wind shear affect typhoon development, as a deterministic approximation.',
      sstLabel: 'Sea surface temperature (SST)',
      sstCold: '{min}°C cold sea',
      sstThreshold: 'Threshold 26.5°C',
      sstHot: '{max}°C hot sea',
      shearLabel: 'Vertical shear (change of wind with height)',
      shearAria: 'Select vertical shear',
      curveTitle: 'Development curve',
      curveSub: 'How intensity changes over time (educational, dimensionless time)',
      timeAxis: 'Time →',
      caveat: 'Simplification: real typhoon genesis also needs atmospheric stratification, moisture content, Earth’s rotation (Coriolis), and more — and the intensity index is not actual wind speed or central pressure.',
      cta: '🌪️ Take the typhoon concept quiz — continue on your learning path',
    },
    climate: {
      why1: 'CO₂ is a greenhouse gas that absorbs the infrared (heat) Earth emits and sends it back. If the concentration rises from {baseline} ppm (pre-industrial) to {co2} ppm, global mean temperature in this model rises by about {anomaly}°C.',
      why2: 'The key point is that temperature responds logarithmically (per doubling), not in proportion to concentration. Each doubling of CO₂ (280→560 ppm) adds about {sens}°C. The same +10 ppm has a larger effect when the concentration is low.',
      whyBaseline: 'This is the pre-industrial level — the reference point (0°C anomaly).',
      whyPast: 'This range is the path humanity has already travelled. Since the Industrial Revolution, fossil-fuel burning has raised the concentration from {baseline} ppm to about {present} ppm today.',
      whyFuture: 'Beyond {present} ppm (today’s approximate level) lies a future decided by our choices. Warmer seawater expands (thermal expansion) and melting ice raises sea level — and even a small rise in mean temperature makes extreme heat far more frequent.',
      curveAria: 'Temperature anomaly {anomaly}°C at CO2 {co2} ppm',
      presentMark: 'now≈{n}',
      title: '🌡️ Experience Climate Change',
      // ⚠️ Do not hard-code S — it became an adjustable variable (2026-08-19), so a
      // fixed number would make the text contradict the graph the learner is moving.
      disclaimer: 'This is a simplified educational model. ΔT = S·log₂(C/C₀) with S = {sens}°C per doubling — a logarithmic-sensitivity approximation, not a real climate projection (numerical model) or a prediction for any specific year.',
      anomalyTitle: 'Global mean temperature anomaly',
      anomalySub: 'Rise relative to pre-industrial (280 ppm) — logarithmic sensitivity curve',
      co2Label: 'CO₂ concentration',
      scaleMin: '{min} ppm pre-industrial',
      scaleNow: 'now ≈ {n} ppm',
      scaleMax: '{max} ppm doubling',
      reset: 'Reset to current concentration',
      // ── ⑬ two adjustable variables added (2026-08-19). The ranges' evidence lives in
      //    the constant declarations in `lib/exploreSims.js` (IPCC AR6 quotes + URLs).
      varsTitle: 'Try changing',
      sensLabel: 'Climate sensitivity (per CO₂ doubling)',
      sensScaleMin: '{min}°C',
      sensScaleLikely: 'likely {lo}–{hi}°C',
      sensScaleMax: '{max}°C',
      sensSource: 'IPCC AR6 assessed a very likely range of 2–5°C. The best estimate is 3.0°C, and it is virtually certain to be above 1.5°C.',
      seaSlopeLabel: 'Sea-level response (per 1°C)',
      seaSlopeScaleMin: '{min} cm',
      seaSlopeScaleNow: 'default {n} cm',
      seaSlopeScaleMax: '{max} cm',
      // ⚠️ Keep "not an assessed confidence interval" — IPCC never assessed cm/°C
      //    itself; this envelope is derived by dividing 2100 sea-level by warming.
      seaSlopeSource: 'An exploratory range derived from the 2100 sea-level and warming figures in the IPCC AR6 Summary for Policymakers. It is not an assessed confidence interval, and over millennia the value is far larger.',
      whySens: 'Sensitivity is currently {sens}°C. IPCC judged {lo}–{hi}°C to be the likely range, so raising this warms the planet more at the same concentration.',
      whySea: 'With a sea-level response of {k} cm per 1°C, a {anomaly}°C rise gives about {sea} cm of sea-level rise.',
      seaTitle: 'Sea level rise',
      seaUnit: 'cm',
      // ⚠️ Do not hard-code the coefficient — it is now an adjustable variable.
      seaNote: 'Educational approximation condensing thermal expansion and glacier melt to about {k} cm per 1°C',
      heatTitle: 'Heatwave days per year',
      heatUnit: 'days',
      heatNote: 'Educational approximation: from a baseline of 10 days/year, roughly ×1.9 per 1°C',
      caveat: 'Simplification: real climate has large ocean thermal inertia (decades of lag), cloud feedbacks, and regional differences, so the same concentration responds differently by time and place. Values here are the global-mean tendency of the equilibrium response.',
      cta: '🌡️ Take the CO₂ & climate concept quiz — continue on your learning path',
    },
  },
};
