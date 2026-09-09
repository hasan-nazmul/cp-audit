/**
 * ═══════════════════════════════════════════════════════════════════
 * AuditProgression.gs — Rating Progression & Weakness Coaching Engine
 *
 * RESPONSIBILITIES:
 * - Solves bucketing by 100-point rating tiers & mastery curve analysis
 * - Tag weakness, over-reliance, and hint crutch detection
 * - Integration with SuggestionEngine for MUST milestones & Foundational Debt
 * - Individual student coaching summary generation
 * ═══════════════════════════════════════════════════════════════════
 */

/* ═══════════════════════════════════════════════════════════════════
   RATING PROGRESSION & WEAKNESS COACHING ENGINE
   ═══════════════════════════════════════════════════════════════════ */

function _roundUp2Helper(val) {
  if (typeof roundUp2 === 'function') return roundUp2(val);
  if (val === null || val === undefined || val === '') return 0;
  var n = Number(val);
  if (isNaN(n)) return val;
  if (Math.floor(n) === n) return n;
  var factor = 100;
  var rounded = Math.ceil(n * factor) / factor;
  return Number(rounded.toFixed(2));
}

/**
 * Analyze student's rating progression across all historical solves.
 * Buckets solves by 100-point rating tiers, breaks each tier into groups of 10,
 * compares average solve times to detect mastery curves.
 *
 * @param {Sheet} sheet - Student's sheet.
 * @param {Object} studentInfo - Student info from roster.
 * @param {Object} cfIndex - CF authoritative index.
 * @param {Object} cohortSubmissionsMap - Cohort CF submissions.
 * @param {Object} cohortAtCoderMap - Cohort AtCoder submissions.
 * @returns {Object} Progression analysis result.
 */
function analyzeRatingProgression(sheet, studentInfo, cfIndex, cohortSubmissionsMap, cohortAtCoderMap, preloadedData, preloadedHasHint) {
  var result = {
    currentTier: 0,
    verdict: 'BUILDING',
    adviceText: '',
    tierBreakdown: [],
    forecastSolvesNeeded: 0
  };

  var hasHintCol = (preloadedHasHint !== undefined) ? preloadedHasHint : (sheet ? hasHintColumn(sheet) : false);
  var numCols = hasHintCol ? 8 : 7;
  var data = preloadedData;
  if (!data && sheet) {
    var lastRow = sheet.getLastRow();
    if (lastRow < 4) return result;
    data = sheet.getRange(4, 6, lastRow - 3, numCols).getValues();
  }
  if (!data || data.length === 0) return result;

  // Collect all AC solves with rating, time, and hint status, sorted by date
  var allSolves = [];
  for (var i = 0; i < data.length; i++) {
    var link = String(data[i][0] || '').trim();
    if (!link) continue;
    var verdict = String(data[i][1] || '').toUpperCase().trim();
    if (verdict !== 'AC') continue;
    var time = toNum(data[i][3]);
    var rowDate = parseDate(data[i][4]);
    var rating = toNum(data[i][6]);
    if (rating <= 0) continue;
    var hasHint = hasHintCol ? isHintPresent(data[i][7]) : false;

    allSolves.push({
      rating: rating,
      time: time,
      date: rowDate ? rowDate.getTime() : 0,
      hasHint: hasHint
    });
  }

  if (allSolves.length < 3) {
    result.adviceText = 'Keep solving! You need more rated solves to generate a progression analysis.';
    return result;
  }

  // Sort by date ascending
  allSolves.sort(function(a, b) { return a.date - b.date; });

  // Bucket by 100-point rating tiers (floor to nearest 100)
  var tierMap = {}; // tier -> [{ time, date, hasHint }]
  for (var s = 0; s < allSolves.length; s++) {
    var tier = Math.floor(allSolves[s].rating / 100) * 100;
    if (!tierMap[tier]) tierMap[tier] = [];
    tierMap[tier].push({ time: allSolves[s].time, date: allSolves[s].date, hasHint: allSolves[s].hasHint });
  }

  // Build tier breakdown with 10-solve group analysis
  var tiers = Object.keys(tierMap).map(Number).sort(function(a, b) { return a - b; });
  var tierBreakdown = [];

  for (var t = 0; t < tiers.length; t++) {
    var tierVal = tiers[t];
    var solves = tierMap[tierVal];
    var totalTime = 0, tierHints = 0, tierSolo = 0;
    for (var ts = 0; ts < solves.length; ts++) {
      totalTime += solves[ts].time;
      if (solves[ts].hasHint) tierHints++;
      else tierSolo++;
    }
    var avgTime = solves.length > 0 ? _roundUp2Helper(totalTime / solves.length) : 0;
    var tierHintRate = solves.length > 0 ? _roundUp2Helper((tierHints / solves.length) * 100) : 0;

    // Break into groups of 10 solves, sorted by date
    var groups = [];
    for (var g = 0; g < solves.length; g += 10) {
      var group = solves.slice(g, g + 10);
      var groupTime = 0, groupHints = 0, groupSolo = 0;
      for (var gi = 0; gi < group.length; gi++) {
        groupTime += group[gi].time;
        if (group[gi].hasHint) groupHints++;
        else groupSolo++;
      }
      var groupAvg = group.length > 0 ? _roundUp2Helper(groupTime / group.length) : 0;
      var groupHintRate = group.length > 0 ? _roundUp2Helper((groupHints / group.length) * 100) : 0;
      groups.push({
        groupIndex: Math.floor(g / 10) + 1,
        solveCount: group.length,
        soloCount: groupSolo,
        hintCount: groupHints,
        hintRate: groupHintRate,
        avgTime: groupAvg
      });
    }

    // Detect if solve time is declining across groups (mastery signal)
    var isTimeImproving = false;
    if (groups.length >= 2) {
      var firstGroupAvg = groups[0].avgTime;
      var lastGroupAvg = groups[groups.length - 1].avgTime;
      isTimeImproving = lastGroupAvg < firstGroupAvg * 0.85; // 15%+ improvement
    }

    tierBreakdown.push({
      tier: tierVal,
      solves: solves.length,
      soloSolves: tierSolo,
      hintSolves: tierHints,
      hintRate: tierHintRate,
      avgTime: avgTime,
      groups: groups,
      isTimeImproving: isTimeImproving
    });
  }

  result.tierBreakdown = tierBreakdown;

  // Determine current working tier: majority of last 20 AC solves
  var recentSolves = allSolves.slice(-20);
  var recentTierCounts = {};
  for (var rs = 0; rs < recentSolves.length; rs++) {
    var rsTier = Math.floor(recentSolves[rs].rating / 100) * 100;
    recentTierCounts[rsTier] = (recentTierCounts[rsTier] || 0) + 1;
  }
  var currentTier = 800;
  var maxCount = 0;
  for (var ct in recentTierCounts) {
    if (recentTierCounts[ct] > maxCount) {
      maxCount = recentTierCounts[ct];
      currentTier = Number(ct);
    }
  }
  result.currentTier = currentTier;

  // Find the current tier's breakdown
  var currentTierData = null;
  for (var tb = 0; tb < tierBreakdown.length; tb++) {
    if (tierBreakdown[tb].tier === currentTier) {
      currentTierData = tierBreakdown[tb];
      break;
    }
  }

  // Calculate hint reliance for recent solves specifically at currentTier
  var recentCurrentTierSolves = recentSolves.filter(function(s) {
    return Math.floor(s.rating / 100) * 100 === currentTier;
  });
  var recentHintsAtTier = recentCurrentTierSolves.filter(function(s) { return s.hasHint; }).length;
  var recentTierHintRate = recentCurrentTierSolves.length > 0 ? _roundUp2Helper((recentHintsAtTier / recentCurrentTierSolves.length) * 100) : (currentTierData ? currentTierData.hintRate : 0);

  // Generate verdict with pedagogical gating on hint reliance
  if (!currentTierData || currentTierData.solves < 10) {
    result.verdict = 'BUILDING';
    var needed = 10 - (currentTierData ? currentTierData.solves : 0);
    result.forecastSolvesNeeded = needed;
    result.adviceText = 'Keep practicing at ' + currentTier + '-rated problems. Target ' + needed + ' more diverse solves before evaluating readiness.';
  } else if (currentTierData.solves >= 20 && currentTierData.isTimeImproving) {
    // Check if student relies heavily on hints/editorials at this difficulty
    if (recentTierHintRate > 35 || currentTierData.hintRate > 35) {
      result.verdict = 'HINT_DEPENDENT';
      var neededSolo = Math.max(5, Math.ceil(currentTierData.hintSolves * 0.4));
      result.forecastSolvesNeeded = neededSolo;
      result.adviceText = 'You have strong volume at ' + currentTier + ' (' + currentTierData.solves + ' solves, improving speed), but ' + currentTierData.hintRate + '% relied on hints/editorials. To build genuine contest independence, solve at least ' + neededSolo + ' more ' + currentTier + '-rated problems 100% solo without hints before advancing to ' + (currentTier + 100) + '.';
    } else {
      result.verdict = 'READY_TO_ADVANCE';
      result.adviceText = 'You\'ve mastered ' + currentTier + '-rated problems with strong independence (' + currentTierData.soloSolves + '/' + currentTierData.solves + ' solo solves, improving speed). Time to challenge ' + (currentTier + 100) + '-rated problems!';
    }
  } else if (currentTierData.solves >= 10 && currentTierData.solves < 20 && currentTierData.isTimeImproving) {
    var remaining = 20 - currentTierData.solves;
    result.verdict = 'ALMOST_READY';
    result.forecastSolvesNeeded = remaining;
    if (currentTierData.hintRate > 35) {
      result.adviceText = 'Good pace progress at ' + currentTier + ', but note your ' + currentTierData.hintRate + '% hint reliance. Target ' + remaining + ' more solves, focusing strictly on solo unassisted solves before advancing.';
    } else {
      result.adviceText = 'Great progress at ' + currentTier + '! Solve ' + remaining + ' more to solidify mastery before advancing to ' + (currentTier + 100) + '.';
    }
  } else if (currentTierData.solves >= 20 && !currentTierData.isTimeImproving) {
    result.verdict = 'PLATEAU';
    if (currentTierData.hintRate > 35) {
      result.adviceText = 'You have volume at ' + currentTier + ' (' + currentTierData.solves + ' solves), but ' + currentTierData.hintRate + '% used hints and solve times have plateaued. Step back and solve problems independently without hints to build organic intuition.';
    } else {
      result.adviceText = 'You have volume at ' + currentTier + ' (' + currentTierData.solves + ' solves) but solve times aren\'t improving. Try varied problem tags at this difficulty to build flexibility.';
    }
  } else {
    var neededMore = Math.max(20 - currentTierData.solves, 0);
    result.verdict = 'BUILDING';
    result.forecastSolvesNeeded = neededMore;
    result.adviceText = 'Continue building at ' + currentTier + '. You have ' + currentTierData.solves + ' solves (' + (currentTierData.hintRate > 30 ? currentTierData.hintRate + '% with hints' : currentTierData.soloSolves + ' solo') + '). Target ' + (neededMore > 0 ? neededMore + ' more solo solves' : 'improving your solve times') + '.';
  }

  return result;
}

/**
 * Tier-aware curriculum map: defines which Codeforces problem tags are
 * expected at each 100-point rating tier. Based on actual CF problem
 * tag distributions across thousands of rated problems.
 *
 * Tags are CUMULATIVE — a student at 1200 is expected to know all tags
 * from 800 through 1200. Each tier's array lists the NEW topics introduced.
 *
 * Used by analyzeTagWeaknesses() to only flag tags the student should
 * already know at their current working tier, preventing premature
 * suggestions like "practice dp" to a student still at 800.
 */
// ─── TIER CURRICULUM & TAG TAXONOMY ───────────────────────────────
// Note: TIER_CURRICULUM, TAG_ALIASES, TOPIC_METADATA, getExpectedTagsForTier,
// and related curriculum helpers are authoritatively managed in SuggestionEngine.gs.
// They share the global Apps Script scope across all files.

/**
 * Analyze student's tag/topic distribution to identify weaknesses and over-focus.
 * Uses CF problem tags from the authoritative index and sheet logs.
 * Weakness detection is tier-aware and accounts for mandatory milestones,
 * foundational debt (consolidation needs), and hint crutches.
 *
 * @param {Sheet} sheet - Student's sheet.
 * @param {Object} studentInfo - Student info.
 * @param {Object} cfIndex - CF authoritative index.
 * @param {Object} cohortSubmissionsMap - Cohort CF submissions.
 * @param {Object} cohortAtCoderMap - Cohort AtCoder submissions.
 * @param {number} [currentTier=800] - Student's current working rating tier.
 * @returns {Object} Tag analysis result.
 */
function analyzeTagWeaknesses(sheet, studentInfo, cfIndex, cohortSubmissionsMap, cohortAtCoderMap, currentTier, preloadedData, preloadedHasHint) {
  var studentTier = currentTier || 800;
  var result = {
    weakTags: [],
    overFocusedTags: [],
    strongTags: [],
    hintHeavyTags: [],
    tagBreakdown: {},
    adviceLines: [],
    currentTier: studentTier,
    expectedTags: [],
    nextTierTags: []
  };

  if (!cfIndex || !cfIndex.index) return result;

  // Compute tier-aware expected tags
  var expectedTags = (typeof getExpectedTagsForTier === 'function') ? getExpectedTagsForTier(studentTier) : [];
  var nextTierTags = (typeof getNewTagsAtTier === 'function') ? getNewTagsAtTier(studentTier + 100) : [];
  result.expectedTags = expectedTags;
  result.nextTierTags = nextTierTags;

  // Build tag statistics from CF submissions
  var tagStats = {}; // tag -> { solves, acCount, totalAttempts, ratingSum, ratingCount, hintCount, soloCount }
  var totalCFSolves = 0;

  // Track which problem keys have already been counted from CF API data
  // to prevent double-counting when we also read from the sheet.
  var cfCountedKeys = {};

  // Get student's CF handles
  var studentHandles = cfIndex.handles || [];
  for (var h = 0; h < studentHandles.length; h++) {
    var handle = studentHandles[h];
    var handleLower = handle.toLowerCase();
    var subs = cohortSubmissionsMap[handleLower] || [];

    for (var s = 0; s < subs.length; s++) {
      var sub = subs[s];
      if (!sub || sub.v !== 'OK') continue;

      var key = String(sub.c) + String(sub.i).toUpperCase().trim();
      var indexEntry = cfIndex.index[key];
      if (!indexEntry) continue;
      if (cfCountedKeys[key]) continue; // deduplicate across handles
      cfCountedKeys[key] = true;

      // Get tags from the submission
      var tagsStr = sub.tags || '';
      var tags = tagsStr ? tagsStr.split(',').map(function(t) { return t.trim(); }).filter(function(t) { return t; }) : ['general'];

      totalCFSolves++;

      for (var ti = 0; ti < tags.length; ti++) {
        var rawTag = tags[ti].toLowerCase();
        var tag = (typeof mapCFTagToTopic === 'function') ? mapCFTagToTopic(rawTag) : ((typeof TAG_ALIASES !== 'undefined' && TAG_ALIASES[rawTag]) || rawTag);
        if (!tag) continue;
        if (!tagStats[tag]) {
          tagStats[tag] = { solves: 0, acCount: 0, totalAttempts: 0, ratingSum: 0, ratingCount: 0, hintCount: 0, soloCount: 0 };
        }
        tagStats[tag].solves++;
        tagStats[tag].acCount++;
        if (sub.r > 0) {
          tagStats[tag].ratingSum += sub.r;
          tagStats[tag].ratingCount++;
        }
      }
    }
  }

  // Read from sheet-level category data for hint tracking and non-CF platform coverage.
  // CF problems already counted above are skipped to prevent double-counting.
  var hasHintCol = (preloadedHasHint !== undefined) ? preloadedHasHint : (sheet ? hasHintColumn(sheet) : false);
  var numCols = hasHintCol ? 8 : 7;
  var sheetData = preloadedData;
  if (!sheetData && sheet) {
    var lastRow = sheet.getLastRow();
    if (lastRow >= 4) {
      sheetData = sheet.getRange(4, 6, lastRow - 3, numCols).getValues();
    }
  }
  if (sheetData && sheetData.length > 0) {
    for (var sd = 0; sd < sheetData.length; sd++) {
      var link = String(sheetData[sd][0] || '').trim();
      if (!link) continue;
      var verdict = String(sheetData[sd][1] || '').toUpperCase().trim();
      var rawCategory = String(sheetData[sd][5] || '').trim().toLowerCase();
      var category = (typeof mapCFTagToTopic === 'function') ? mapCFTagToTopic(rawCategory) : ((typeof TAG_ALIASES !== 'undefined' && TAG_ALIASES[rawCategory]) || rawCategory);
      var isHint = hasHintCol ? isHintPresent(sheetData[sd][7]) : false;

      if (verdict !== 'AC' || !category) continue;

      // Check if this row is a CF problem already counted from API data
      var parsed = parseProblemServerInput(link);
      if (parsed.platform === 'codeforces' && !parsed.isGym) {
        var cfKey = String(parsed.contestId) + String(parsed.problemIndex).toUpperCase().trim();
        if (cfCountedKeys[cfKey]) {
          // Only augment hint/solo counts from the sheet (since CF API doesn't have hint data)
          if (!tagStats[category]) {
            tagStats[category] = { solves: 0, acCount: 0, totalAttempts: 0, ratingSum: 0, ratingCount: 0, hintCount: 0, soloCount: 0 };
          }
          if (isHint) {
            tagStats[category].hintCount = (tagStats[category].hintCount || 0) + 1;
          } else {
            tagStats[category].soloCount = (tagStats[category].soloCount || 0) + 1;
          }
          continue; // Don't increment solves/totalCFSolves again
        }
      }

      // Non-CF row or CF row not found in API: count as new solve
      if (!tagStats[category]) {
        tagStats[category] = { solves: 0, acCount: 0, totalAttempts: 0, ratingSum: 0, ratingCount: 0, hintCount: 0, soloCount: 0 };
      }
      tagStats[category].solves++;
      tagStats[category].acCount++;
      totalCFSolves++;
      if (isHint) {
        tagStats[category].hintCount = (tagStats[category].hintCount || 0) + 1;
      } else {
        tagStats[category].soloCount = (tagStats[category].soloCount || 0) + 1;
      }
    }
  }

  result.tagBreakdown = tagStats;

  // Classify tags
  var allTags = Object.keys(tagStats);

  for (var at = 0; at < allTags.length; at++) {
    var tagName = allTags[at];
    var ts = tagStats[tagName];
    var avgRating = ts.ratingCount > 0 ? _roundUp2Helper(ts.ratingSum / ts.ratingCount) : 0;
    var solvePercent = totalCFSolves > 0 ? _roundUp2Helper((ts.solves / totalCFSolves) * 100) : 0;
    var hintCount = ts.hintCount || 0;
    var tagHintRate = ts.solves > 0 && hintCount > 0 ? _roundUp2Helper((hintCount / ts.solves) * 100) : 0;

    if (ts.solves >= 5 && avgRating >= 1000) {
      result.strongTags.push({ tag: tagName, solves: ts.solves, avgRating: avgRating, percent: solvePercent });
    }

    // Detect hint crutch topic (>=50% hint reliance on 3+ solves)
    if (ts.solves >= 3 && tagHintRate >= 50) {
      result.hintHeavyTags.push({ tag: tagName, solves: ts.solves, hintCount: hintCount, hintRate: tagHintRate });
      result.adviceLines.push('\u{1F9E9} Hint Crutch in \'' + tagName + '\': ' + tagHintRate + '% of your solves (' + hintCount + '/' + ts.solves + ') relied on hints. Re-solve these concepts from scratch without hints!');
    }

    if (solvePercent >= 40 && totalCFSolves >= 10) {
      result.overFocusedTags.push({ tag: tagName, solves: ts.solves, percent: solvePercent });
      result.adviceLines.push('\ud83d\udfe1 Over-focused: ' + solvePercent + '% of your solves are \'' + tagName + '\'. Diversify into other algorithmic topics.');
    }
  }

  // ── Tier-Aware Weakness & Foundational Debt Detection ──
  // Evaluates expected tags up to current tier, prioritizing MUST milestones
  // and foundational debt (consolidate tags from prior tiers).
  var candidateWeak = [];

  for (var et = 0; et < expectedTags.length; et++) {
    var expectedTag = expectedTags[et];
    var expectedStats = tagStats[expectedTag];
    var solves = expectedStats ? expectedStats.solves : 0;
    if (solves < 3) {
      var tierCurr = (typeof TIER_CURRICULUM !== 'undefined' && TIER_CURRICULUM[studentTier]) ? TIER_CURRICULUM[studentTier] : {};
      var prevCurr = (typeof TIER_CURRICULUM !== 'undefined' && TIER_CURRICULUM[studentTier - 100]) ? TIER_CURRICULUM[studentTier - 100] : {};

      var isCurrentMust = Boolean((tierCurr.must || []).indexOf(expectedTag) !== -1);
      var isConsolidate = Boolean((tierCurr.consolidate || []).indexOf(expectedTag) !== -1);
      var isPrevMust = Boolean((prevCurr.must || []).indexOf(expectedTag) !== -1);
      var isMust = isCurrentMust || isPrevMust;

      var meta = (typeof TOPIC_METADATA !== 'undefined' && TOPIC_METADATA[expectedTag]) ? TOPIC_METADATA[expectedTag] : {};

      var priority = 3;
      if (isCurrentMust) priority = 1;
      else if (isConsolidate || isPrevMust) priority = 2;

      candidateWeak.push({
        tag: expectedTag,
        solves: solves,
        tier: studentTier,
        isMust: isMust,
        isConsolidate: isConsolidate,
        priority: priority,
        desc: meta.desc || '',
        examples: meta.examples || '',
        prereqs: meta.prereqs || []
      });
    }
  }

  // Sort by priority (MUST tags first, then foundational debt), then by fewest solves
  candidateWeak.sort(function(a, b) {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.solves - b.solves;
  });

  result.weakTags = candidateWeak.slice(0, 4);

  // Generate clear, motivating advice lines with concrete archetypes
  for (var w = 0; w < result.weakTags.length; w++) {
    var item = result.weakTags[w];
    if (totalCFSolves >= 5) {
      var exText = item.examples ? ' Archetypes: ' + item.examples + '.' : '';
      if (item.isMust) {
        result.adviceLines.push('\u{1F3AF} Tier ' + studentTier + ' Milestone Requirement: \'' + item.tag + '\' is essential (only ' + item.solves + ' solve' + (item.solves === 1 ? '' : 's') + ').' + exText + ' Prioritize unassisted practice here!');
      } else if (item.isConsolidate) {
        result.adviceLines.push('\u{1F527} Foundational Debt in \'' + item.tag + '\': Prior tier topic with only ' + item.solves + ' solve' + (item.solves === 1 ? '' : 's') + '.' + exText + ' Solidify to eliminate contest gaps.');
      } else {
        result.adviceLines.push('\ud83d\udd34 Practice Gap in \'' + item.tag + '\' (' + studentTier + '-tier): Only ' + item.solves + ' solve' + (item.solves === 1 ? '' : 's') + '.' + exText);
      }
    }
  }

  // ── Next Tier Preview ──
  if (nextTierTags.length > 0 && totalCFSolves >= 10) {
    var nextTierIntro = nextTierTags.filter(function(nt) {
      var ns = tagStats[nt];
      return !ns || ns.solves < 2;
    });
    if (nextTierIntro.length > 0) {
      result.adviceLines.push('\ud83d\udd2e Next tier (' + (studentTier + 100) + ') introduces: ' + nextTierIntro.join(', ') + '. Start exploring these topics as warm-up for your next rating jump.');
    }
  }

  // Highlight strong tags
  for (var st = 0; st < result.strongTags.length && st < 3; st++) {
    var strong = result.strongTags[st];
    result.adviceLines.push('\ud83d\udfe2 Strong: Excellent coverage in \'' + strong.tag + '\' (' + strong.solves + ' solves, avg ' + strong.avgRating + ')');
  }

  return result;
}

/**
 * Generate combined coaching summary from progression and tag analysis.
 * @param {Object} progressionAnalysis - Rating progression result.
 * @param {Object} tagAnalysis - Tag weakness result.
 * @param {Object} stats - Current week stats.
 * @param {Object} prevWeekStats - Previous week stats.
 * @returns {Object} Coaching summary.
 */
function generateStudentCoachingSummary(progressionAnalysis, tagAnalysis, stats, prevWeekStats) {
  var summary = {
    progressionVerdict: progressionAnalysis.verdict,
    currentTier: progressionAnalysis.currentTier,
    progressionAdvice: progressionAnalysis.adviceText,
    forecastSolvesNeeded: progressionAnalysis.forecastSolvesNeeded,
    tierBreakdown: progressionAnalysis.tierBreakdown,
    weakTags: tagAnalysis.weakTags,
    overFocusedTags: tagAnalysis.overFocusedTags,
    strongTags: tagAnalysis.strongTags,
    hintHeavyTags: tagAnalysis.hintHeavyTags || [],
    tagAdvice: tagAnalysis.adviceLines,
    tagBreakdown: tagAnalysis.tagBreakdown,
    expectedTags: tagAnalysis.expectedTags || [],
    nextTierTags: tagAnalysis.nextTierTags || [],
    soloSolves: stats ? (stats.soloSolves || 0) : 0,
    hintCount: stats ? (stats.hintCount || 0) : 0,
    hintRate: stats ? (stats.hintRate || 0) : 0,
    overallRecommendation: '',
    advisedActions: []
  };

  // Build overall recommendation
  var actions = [];
  var currentTier = progressionAnalysis.currentTier || 800;

  // Progression action
  if (progressionAnalysis.verdict === 'READY_TO_ADVANCE') {
    var unfulfilledMust = (tagAnalysis.weakTags || []).filter(function(w) { return w.isMust && w.solves < 2; });
    if (unfulfilledMust.length > 0) {
      var mustNames = unfulfilledMust.map(function(w) { return '\'' + w.tag + '\''; }).join(', ');
      actions.push('Strong volume at ' + currentTier + ', but complete the milestone topic first: solve at least 2 problems in ' + mustNames + ' before advancing to ' + (currentTier + 100));
    } else {
      actions.push('Move up to ' + (currentTier + 100) + '-rated problems');
    }
  } else if (progressionAnalysis.verdict === 'HINT_DEPENDENT') {
    actions.push('Build unassisted mastery at ' + currentTier + ': complete ' + progressionAnalysis.forecastSolvesNeeded + ' more problems 100% solo without hints before advancing');
  } else if (progressionAnalysis.verdict === 'ALMOST_READY') {
    actions.push('Solve ' + progressionAnalysis.forecastSolvesNeeded + ' more at ' + currentTier + ' before advancing');
  } else if (progressionAnalysis.verdict === 'PLATEAU') {
    actions.push('Diversify problem tags at ' + currentTier + ' to break plateau');
  } else {
    actions.push('Continue building at ' + currentTier + '-rated problems');
  }

  // Hint Crutch action
  if (tagAnalysis.hintHeavyTags && tagAnalysis.hintHeavyTags.length > 0) {
    var topCrutch = tagAnalysis.hintHeavyTags[0];
    actions.push('Break hint crutch on \'' + topCrutch.tag + '\' (' + topCrutch.hintRate + '% hint solves) by attempting unassisted problems');
  }

  // Tag action (top weakness — tier-aware with MUST milestone priority)
  if (tagAnalysis.weakTags && tagAnalysis.weakTags.length > 0) {
    var mustGaps = tagAnalysis.weakTags.filter(function(w) { return w.isMust; });
    if (mustGaps.length > 0) {
      actions.push('Master Tier ' + currentTier + ' milestone topic: ' + mustGaps.map(function(w) { return '\'' + w.tag + '\''; }).join(', '));
    } else {
      var topWeak = tagAnalysis.weakTags.slice(0, 2).map(function(w) { return w.tag; }).join(', ');
      actions.push('Prioritize ' + currentTier + '-tier expected skills: ' + topWeak);
    }
  }

  // Over-focus action
  if (tagAnalysis.overFocusedTags.length > 0) {
    actions.push('Reduce over-focus on ' + tagAnalysis.overFocusedTags[0].tag + ' (' + tagAnalysis.overFocusedTags[0].percent + '% of solves)');
  }

  // Weekly hint reliance action
  if (stats && stats.hintRate >= 40 && stats.totalSolves >= 3) {
    actions.push('High weekly hint reliance (' + stats.hintRate + '%). Commit to a 25-minute unassisted timer before viewing hints');
  }

  // Next tier preview action
  if (tagAnalysis.nextTierTags && tagAnalysis.nextTierTags.length > 0) {
    var upcomingTopics = tagAnalysis.nextTierTags.slice(0, 3).join(', ');
    if (progressionAnalysis.verdict === 'READY_TO_ADVANCE' || progressionAnalysis.verdict === 'ALMOST_READY') {
      actions.push('Upcoming at ' + (currentTier + 100) + ': start exploring ' + upcomingTopics);
    }
  }

  summary.advisedActions = actions;
  summary.overallRecommendation = actions.join('. ') + '.';

  return summary;
}

