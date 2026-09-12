/**
 * ═══════════════════════════════════════════════════════════════════
 * AuditIntegrity.gs — Submission Verification & Anti-Cheat Auditing
 *
 * RESPONSIBILITIES:
 * - Multi-vector student submission verification against CF & AtCoder
 * - Anomaly detection: GHOST_AC, WRONG_VERDICT, DATE_MISMATCH,
 *   FUTURE_TIMESTAMP, HIGH_ATTEMPTS, SUSPICIOUS_SPEED_SPIKE, STUDY_ARENA_GAP
 * - Student weekly stats calculation & daily submission variance
 * ═══════════════════════════════════════════════════════════════════
 */

/* ═══════════════════════════════════════════════════════════════════
   STRICT INTEGRITY AUDIT ENGINE
   ═══════════════════════════════════════════════════════════════════ */


/**
 * Run authoritative multi-vector integrity audit on a student's weekly submissions.
 */
function runStudentAudit(studentInfo, logRows, cfIndex, rollingAvgRating, prevWeekStats, weekStart, weekEnd, acIndex, lcIndex, studentHistory) {
  var anomalies = [];
  var stats = initializeStudentStats(studentInfo);
  var acTimes = [];
  var seenAcProblems = {};

  var personalBurstThreshold = _roundUp2Helper(rollingAvgRating + AUDIT_PERSONAL_DELTA_BURST);
  var personalTimeThreshold = _roundUp2Helper(rollingAvgRating + AUDIT_PERSONAL_DELTA_TIME);

  // Determine verified handle availability for each platform
  // If handle is missing, null, empty, or whitespace, problems on that platform are treated as unverified manual solves without flags/warnings
  var studentCFHandles = (cfIndex && Array.isArray(cfIndex.handles))
    ? cfIndex.handles
    : sanitizeHandles(studentInfo ? studentInfo.cfHandle : '', 'codeforces');
  var hasCFHandle = studentCFHandles.length > 0;

  var studentACHandles = (acIndex && Array.isArray(acIndex.handles))
    ? acIndex.handles
    : sanitizeHandles(studentInfo ? studentInfo.atCoderHandle : '', 'atcoder');
  var hasACHandle = studentACHandles.length > 0 && !!acIndex;

  var studentLCHandles = (lcIndex && Array.isArray(lcIndex.handles))
    ? lcIndex.handles
    : sanitizeHandles(studentInfo ? studentInfo.leetCodeHandle : '', 'leetcode');
  var hasLCHandle = studentLCHandles.length > 0 && !!lcIndex;

  for (var i = 0; i < logRows.length; i++) {
    var row = logRows[i];

    // 0a. FUTURE_TIMESTAMP Check (Logged date is beyond the audit week window)
    if (row.date && weekEnd && row.date.getTime() > weekEnd.getTime()) {
      anomalies.push(createAnomalyObject(row, 'FUTURE_TIMESTAMP',
        'Logged date ' + formatDate(row.date) + ' is in the future (after week end ' + formatDate(weekEnd) + ').', 'FLAGGED'));
    }

    // 0b. TIME_MISSING & TIME_IMPLAUSIBLE Plausibility Guards
    if (row.verdict === 'AC') {
      if (!row.time || row.time <= 0) {
        anomalies.push(createAnomalyObject(row, 'TIME_MISSING',
          'AC claimed with no solve time recorded. Please log your practice time for accurate tracking.', 'INFO'));
      } else if (row.time > 480) {
        anomalies.push(createAnomalyObject(row, 'TIME_IMPLAUSIBLE',
          'Claimed ' + row.time + ' min (' + _roundUp2Helper(row.time / 60) + ' hours) on a single problem. If this was spread across sessions, consider splitting into separate log entries.', 'SUSPICIOUS'));
      }
    }

    // Generate unified problemKey for cross-platform duplicate detection
    var problemKey = '';
    var pKey = '';
    if (row.platform === 'codeforces') {
      pKey = String(row.contestId || '') + String(row.problemIndex || '').toUpperCase().trim();
      problemKey = pKey ? ('cf:' + pKey) : '';
    } else if (row.platform === 'leetcode') {
      var lcId = String(row.problemIndex || row.canonicalName || row.link || '').toLowerCase().trim();
      problemKey = lcId ? ('lc:' + lcId) : '';
    } else if (row.platform === 'atcoder') {
      var acId = String(row.problemId || row.canonicalName || row.link || '').toLowerCase().trim();
      problemKey = acId ? ('ac:' + acId) : '';
    } else {
      var manualId = String(row.canonicalName || row.link || row.problem || '').toLowerCase().trim();
      problemKey = manualId ? ('manual:' + manualId) : '';
    }

    // Check duplicate AC claims across all platforms (only when problemKey is identifiable)
    if (row.verdict === 'AC' && problemKey) {
      if (seenAcProblems[problemKey]) {
        var dupLinks = [];
        if (row.platform === 'codeforces' && cfIndex && cfIndex.index && cfIndex.index[pKey]) {
          dupLinks = extractSubmissionLinks(cfIndex.index[pKey], cfIndex.handles);
        }
        anomalies.push(createAnomalyObject(row, 'DUPLICATE_CLAIM',
          'Duplicate AC claim logged for ' + (row.canonicalName || row.link || row.problem || 'problem') + ' (already logged as solved this week)', 'FLAGGED', dupLinks));
        continue; // Disqualify duplicate solve: do not count toward solves or study time
      }
      seenAcProblems[problemKey] = true;
    }

    // ── AtCoder Problems: Verify against AtCoder API truth (only when student has registered handle) ──
    if (row.platform === 'atcoder' && hasACHandle && acIndex) {
      var acKey = String(row.problemId || '').toLowerCase().trim();
      var acTruth = acIndex.index ? acIndex.index[acKey] : acIndex[acKey];

      stats.totalTime += row.time;
      if (row.verdict === 'AC') {
        stats.totalSolves++;
        if (row.hasHint) {
          stats.hintCount++;
          if (row.category) {
            stats.tagHintCounts[row.category] = (stats.tagHintCounts[row.category] || 0) + 1;
          }
        } else {
          stats.soloSolves++;
        }
        if (row.rating > 0) { stats.ratingSum += row.rating; stats.ratingCount++; }
        if (row.category) {
          stats.tagCounts[row.category] = (stats.tagCounts[row.category] || 0) + 1;
        }
      }

      if (acTruth) {
        if (row.verdict === 'AC' && acTruth.v === 'AC') {
          stats.verifiedSolves++;
        }

        // WRONG_VERDICT check
        if (row.verdict === 'AC' && acTruth.v && acTruth.v !== 'AC') {
          anomalies.push(createAnomalyObject(row, 'WRONG_VERDICT',
            'Claimed AC but AtCoder best verdict is ' + acTruth.v + ' (checked handle' + (studentACHandles.length > 1 ? 's' : '') + ': ' + studentACHandles.join(', ') + ')', 'FLAGGED'));
          stats.unverifiedSolves++;
        }

        // DATE_MISMATCH check
        if (acTruth.t && row.verdict === 'AC') {
          var acDate = new Date(acTruth.t * 1000);
          var acDayDiff = Math.abs(Math.floor((acDate.getTime() - row.date.getTime()) / 86400000));
          if (acDayDiff > 1) {
            var acOutsideWeek = (acDate.getTime() < weekStart.getTime() || acDate.getTime() > weekEnd.getTime());
            var acMismatchMsg = acOutsideWeek
              ? 'AtCoder AC was achieved on ' + formatDate(acDate) + ' (outside current week). Recycled problem entry.'
              : 'Claimed date ' + formatDate(row.date) + ' differs from AtCoder AC date ' + formatDate(acDate);
            anomalies.push(createAnomalyObject(row, 'DATE_MISMATCH', acMismatchMsg, 'FLAGGED'));
          }

          // Collect AC time for burst & inter-solve speed plausibility within the audit week
          if (acTruth.v === 'AC' && acDate >= weekStart && acDate <= weekEnd) {
            acTimes.push({
              time: acTruth.t,
              rating: row.rating || 0,
              row: row,
              contestId: 'atcoder_' + (row.contestId || '')
            });
          }
        }
      } else {
        // Problem not found in AtCoder submission history
        if (row.verdict === 'AC') {
          anomalies.push(createAnomalyObject(row, 'GHOST_AC',
            'Claimed AC but zero submissions found on registered AtCoder handle' + (studentACHandles.length > 1 ? 's' : '') + ' (' + studentACHandles.join(', ') + ') for ' + acKey, 'FLAGGED'));
          stats.unverifiedSolves++;
        }
      }
      continue;
    }

    // ── LeetCode Problems: Verify against LeetCode GraphQL truth (only when student has registered handle) ──
    if (row.platform === 'leetcode' && hasLCHandle && lcIndex) {
      var lcSlug = (row.titleSlug || '').toLowerCase().trim();
      if (!lcSlug && row.link) {
        var lcMatch = String(row.link).match(/problems\/([a-zA-Z0-9-]+)/i);
        if (lcMatch) lcSlug = lcMatch[1].toLowerCase().replace(/\/+$/, '');
      }
      var lcTruth = lcIndex.index ? lcIndex.index[lcSlug] : (lcSlug ? lcIndex[lcSlug] : null);

      stats.totalTime += row.time;
      if (row.verdict === 'AC') {
        stats.totalSolves++;
        if (row.hasHint) {
          stats.hintCount++;
          if (row.category) {
            stats.tagHintCounts[row.category] = (stats.tagHintCounts[row.category] || 0) + 1;
          }
        } else {
          stats.soloSolves++;
        }
        if (row.rating > 0) { stats.ratingSum += row.rating; stats.ratingCount++; }
        if (row.category) {
          stats.tagCounts[row.category] = (stats.tagCounts[row.category] || 0) + 1;
        }
      }

      if (lcTruth) {
        if (row.verdict === 'AC' && lcTruth.v === 'AC') {
          stats.verifiedSolves++;
        }

        // WRONG_VERDICT check
        if (row.verdict === 'AC' && lcTruth.v && lcTruth.v !== 'AC') {
          anomalies.push(createAnomalyObject(row, 'WRONG_VERDICT',
            'Claimed AC but LeetCode verdict is ' + lcTruth.v + ' (checked handle' + (studentLCHandles.length > 1 ? 's' : '') + ': ' + studentLCHandles.join(', ') + ')', 'FLAGGED'));
          stats.unverifiedSolves++;
        }

        // DATE_MISMATCH check
        if (lcTruth.t && row.verdict === 'AC' && row.date) {
          var lcDate = new Date(lcTruth.t * 1000);
          var lcDayDiff = Math.abs(Math.floor((lcDate.getTime() - row.date.getTime()) / 86400000));
          if (lcDayDiff > 1) {
            var lcOutsideWeek = (lcDate.getTime() < weekStart.getTime() || lcDate.getTime() > weekEnd.getTime());
            var lcMismatchMsg = lcOutsideWeek
              ? 'LeetCode AC was achieved on ' + formatDate(lcDate) + ' (outside current week). Recycled problem entry.'
              : 'Claimed date ' + formatDate(row.date) + ' differs from LeetCode AC date ' + formatDate(lcDate);
            anomalies.push(createAnomalyObject(row, 'DATE_MISMATCH', lcMismatchMsg, 'FLAGGED'));
          }

          // Collect AC time for burst & inter-solve speed plausibility within the audit week
          if (lcTruth.v === 'AC' && lcDate >= weekStart && lcDate <= weekEnd) {
            acTimes.push({
              time: lcTruth.t,
              rating: row.rating || 0,
              row: row,
              contestId: 'leetcode_' + (lcSlug || '')
            });
          }
        }
      } else {
        // Problem not found in LeetCode submission history
        if (row.verdict === 'AC') {
          anomalies.push(createAnomalyObject(row, 'GHOST_AC',
            'Claimed AC but zero submissions found on registered LeetCode handle' + (studentLCHandles.length > 1 ? 's' : '') + ' (' + studentLCHandles.join(', ') + ') for ' + (lcSlug || row.link || 'problem'), 'FLAGGED'));
          stats.unverifiedSolves++;
        }
      }
      continue;
    }

    // ── Non-Codeforces / Non-AtCoder / Non-LeetCode / CF Gym & Non-Contest Problems (Manual / Gym / Other OJ / Missing Handles) ──
    var isGymProblem = row.isGym || (row.category === 'Gym') || (row.category === 'CF Gym') || (Number(row.contestId) >= 100000) || /gym/i.test(row.link || '');
    var isUnsupportedCf = row.platform === 'codeforces_unsupported' || row.isUnsupportedCf || /codeforces\.com\/(?:gym|group|edu|newcomer|acmsguru)\//i.test(row.link || '') || (!row.contestId && /codeforces\.com/i.test(row.link || ''));

    if (row.platform !== 'codeforces' || isGymProblem || isUnsupportedCf || !hasCFHandle) {
      stats.totalTime += row.time;
      if (row.verdict === 'AC') {
        stats.totalSolves++;
        if (row.hasHint) {
          stats.hintCount++;
          if (row.category) {
            stats.tagHintCounts[row.category] = (stats.tagHintCounts[row.category] || 0) + 1;
          }
        } else {
          stats.soloSolves++;
        }
        stats.manualSolves++;
        if (row.rating > 0) { stats.ratingSum += row.rating; stats.ratingCount++; }
        if (row.category) {
          stats.tagCounts[row.category] = (stats.tagCounts[row.category] || 0) + 1;
        }
      }

      if (row.verdict === 'AC' && row.time > 0 && row.time < AUDIT_TIME_ANOMALY_CAP_MIN && row.rating >= personalTimeThreshold) {
        anomalies.push(createAnomalyObject(row, 'TIME_ANOMALY',
          'Claimed ' + row.rating + '-rated solve in ' + row.time + ' min (your 4-week baseline: ' + Math.round(rollingAvgRating) + ')', 'SUSPICIOUS'));
      }
      continue;
    }

    // ── Codeforces Row Audit Against Authoritative OJ Truth ──
    var truth = cfIndex.index[pKey];
    var cid = String(row.contestId);

    stats.totalTime += row.time;
    if (row.verdict === 'AC') {
      stats.totalSolves++;
      if (row.hasHint) {
        stats.hintCount++;
        if (row.category) {
          stats.tagHintCounts[row.category] = (stats.tagHintCounts[row.category] || 0) + 1;
        }
      } else {
        stats.soloSolves++;
      }
      if (row.rating > 0) { stats.ratingSum += row.rating; stats.ratingCount++; }
      if (row.category) {
        stats.tagCounts[row.category] = (stats.tagCounts[row.category] || 0) + 1;
      }
    }

    if (truth) {
      if (row.verdict === 'AC' && truth.bestVerdict === 'OK') {
        stats.verifiedSolves++;
      }
      var submissionLinks = extractSubmissionLinks(truth, cfIndex.handles);
      var isRowFlagged = false;

      // 1. WRONG_VERDICT (Claimed AC but OJ record is WA/TLE/MLE/etc.)
      if (row.verdict === 'AC' && truth.bestVerdict && truth.bestVerdict !== 'OK' && truth.bestVerdict !== 'UNKNOWN') {
        anomalies.push(createAnomalyObject(row, 'WRONG_VERDICT',
          'Claimed AC but Codeforces best verdict is ' + truth.bestVerdict + ' (checked handle' + (studentCFHandles.length > 1 ? 's' : '') + ': ' + studentCFHandles.join(', ') + ')', 'FLAGGED', submissionLinks));
        stats.unverifiedSolves++;
        isRowFlagged = true;
      }

      // 2. DATE_MISMATCH / RECYCLED_PROBLEM (>1 day difference or previous week solve)
      if (truth.acTime && row.verdict === 'AC') {
        var cfDate = new Date(truth.acTime * 1000);
        var dayDiff = Math.abs(Math.floor((cfDate.getTime() - row.date.getTime()) / 86400000));
        if (dayDiff > 1) {
          var isOutsideWeek = (cfDate.getTime() < weekStart.getTime() || cfDate.getTime() > weekEnd.getTime());
          var mismatchMsg = isOutsideWeek
            ? 'CF AC was achieved on ' + formatDate(cfDate) + ' (outside current week audit window). Recycled problem entry.'
            : 'Claimed date ' + formatDate(row.date) + ' differs from CF AC date ' + formatDate(cfDate);
          anomalies.push(createAnomalyObject(row, 'DATE_MISMATCH', mismatchMsg, 'FLAGGED', submissionLinks));
          isRowFlagged = true;
        }
      }

      // 3. SUB_MISMATCH (Claimed attempt count differs from CF by >2)
      // If row is already FLAGGED with WRONG_VERDICT or DATE_MISMATCH, skip SUB_MISMATCH to keep flags clear and non-redundant
      if (!isRowFlagged && row.claimedSubs > 0 && Math.abs(row.claimedSubs - truth.attempts) > 2) {
        anomalies.push(createAnomalyObject(row, 'SUB_MISMATCH',
          'Claimed ' + row.claimedSubs + ' attempts, but CF record shows ' + truth.attempts + ' attempt' + (truth.attempts === 1 ? '' : 's'), 'SUSPICIOUS', submissionLinks));
      }

      // 4. MULTI_HANDLE (Conflicting handle submissions in the same contest)
      var contestHandlesMap = (cfIndex && cfIndex.contestHandles) ? cfIndex.contestHandles[cid] : null;
      if (contestHandlesMap && Object.keys(contestHandlesMap).length > 1) {
        anomalies.push(createAnomalyObject(row, 'MULTI_HANDLE',
          'Contest ' + cid + ' has submissions from multiple handles: ' + Object.keys(contestHandlesMap).join(', '), 'FLAGGED', submissionLinks));
      }

      // 5. SKIPPED_CHAIN (Suspicious SKIPPED verdict with multi-handle AC)
      var hasSkippedVerdict = (truth.subs && Array.isArray(truth.subs)) ? truth.subs.some(function(s) { return s.v === 'SKIPPED'; }) : false;
      if (hasSkippedVerdict && truth.bestVerdict === 'OK' && Object.keys(truth.handles).length > 1) {
        anomalies.push(createAnomalyObject(row, 'SKIPPED_CHAIN',
          'SKIPPED submissions detected alongside multi-handle AC pattern', 'FLAGGED', submissionLinks));
      }

      // 5b. TIME_INFLATION (Claimed practice time significantly exceeds OJ duration between first submission and AC)
      if (row.time > 0 && truth.acTime && truth.subs && truth.subs.length > 0) {
        var earliestSub = Infinity;
        for (var si = 0; si < truth.subs.length; si++) {
          if (truth.subs[si].t && truth.subs[si].t < earliestSub) {
            earliestSub = truth.subs[si].t;
          }
        }
        if (earliestSub < Infinity) {
          var ojDurationMin = Math.round((truth.acTime - earliestSub) / 60);
          if (ojDurationMin > 0 && row.time > ojDurationMin * 3 && (row.time - ojDurationMin) > 30) {
            anomalies.push(createAnomalyObject(row, 'TIME_INFLATION',
              'Claimed ' + row.time + ' min, but OJ records show first submission to AC was ~' +
              ojDurationMin + ' min', 'SUSPICIOUS', submissionLinks));
          }
        }
      }

      // Collect AC time for burst detection within the audit week
      if (row.verdict === 'AC' && truth.acTime) {
        var acDateObj = new Date(truth.acTime * 1000);
        if (acDateObj >= weekStart && acDateObj <= weekEnd) {
          acTimes.push({
            time: truth.acTime,
            rating: row.rating || (truth.ratings && truth.ratings.length > 0 ? Math.max.apply(null, truth.ratings) : 0),
            row: row,
            contestId: cid
          });
        }
      }
    } else {
      // Problem not found in any handle's submission history
      if (row.verdict === 'AC') {
        anomalies.push(createAnomalyObject(row, 'GHOST_AC',
          'Claimed AC but zero submissions found on registered Codeforces handle' + (studentCFHandles.length > 1 ? 's' : '') + ' (' + studentCFHandles.join(', ') + ') for ' + pKey, 'FLAGGED'));
        stats.unverifiedSolves++;
      } else {
        anomalies.push(createAnomalyObject(row, 'NO_SUB_CLAIMED',
          'Row claims "' + row.verdict + '" but no CF submission exists on handle' + (studentCFHandles.length > 1 ? 's' : '') + ' (' + studentCFHandles.join(', ') + ')', 'INFO'));
      }
    }

    // 6. RATING_SPIKE (Problem difficulty 500+ above rolling average)
    if (row.verdict === 'AC' && row.rating > 0 && row.rating > rollingAvgRating + AUDIT_RATING_SPIKE_DELTA) {
      anomalies.push(createAnomalyObject(row, 'RATING_SPIKE',
        'Solved ' + row.rating + '-rated problem (your 4-week baseline: ' + Math.round(rollingAvgRating) + ')', 'SUSPICIOUS'));
    }

    // 7. TIME_ANOMALY (Impossible solve speed on high-difficulty problem)
    if (row.verdict === 'AC' && row.time > 0 && row.time < AUDIT_TIME_ANOMALY_CAP_MIN && row.rating >= personalTimeThreshold) {
      anomalies.push(createAnomalyObject(row, 'TIME_ANOMALY',
        'Claimed ' + row.rating + '-rated solve in ' + row.time + ' min (your 4-week baseline: ' + Math.round(rollingAvgRating) + ')', 'SUSPICIOUS'));
    }
  }

  // 7b. SUSTAINED_SPIKE — Consistent difficulty jump across multiple problems
  // Count AC rows with rating >= rollingAvgRating + 300 (below single RATING_SPIKE_DELTA of 500)
  var elevatedCount = 0;
  for (var escI = 0; escI < logRows.length; escI++) {
    if (logRows[escI].verdict === 'AC' && logRows[escI].rating >= rollingAvgRating + 300) {
      elevatedCount++;
    }
  }
  if (elevatedCount >= 3) {
    anomalies.push(createAnomalyObject(logRows[0] || {}, 'SUSTAINED_SPIKE',
      elevatedCount + ' problems solved this week at 300+ above your baseline (' +
      Math.round(rollingAvgRating) + '). Consistent difficulty jump detected.', 'SUSPICIOUS'));
  }

  // 8. BURST_MODE DETECTION (3+ solves in 15 min across different contests)
  acTimes.sort(function(a, b) { return a.time - b.time; });
  for (var bIdx = 0; bIdx < acTimes.length; bIdx++) {
    var windowEnd = acTimes[bIdx].time + (AUDIT_BURST_WINDOW_MIN * 60);
    var count = 1;
    var abovePersonal = acTimes[bIdx].rating >= personalBurstThreshold ? 1 : 0;
    var contestIds = {};
    contestIds[acTimes[bIdx].contestId] = true;

    for (var nIdx = bIdx + 1; nIdx < acTimes.length && acTimes[nIdx].time <= windowEnd; nIdx++) {
      count++;
      if (acTimes[nIdx].rating >= personalBurstThreshold) abovePersonal++;
      contestIds[acTimes[nIdx].contestId] = true;
    }

    if (count >= AUDIT_BURST_THRESHOLD) {
      var uniqueContests = Object.keys(contestIds);
      // If all solves are in the same contest, it is a legitimate live contest participation
      if (uniqueContests.length === 1) {
        bIdx += count - 1;
        continue;
      }

      var sev = abovePersonal >= 2 ? 'FLAGGED' : 'SUSPICIOUS';
      anomalies.push(createAnomalyObject(acTimes[bIdx].row, 'BURST_MODE',
        count + ' ACs submitted within ' + AUDIT_BURST_WINDOW_MIN + ' min (' + abovePersonal + ' above your ' + Math.round(personalBurstThreshold) + ' baseline)', sev));
      bIdx += count - 1;
    }
  }

  // 9. IMPLAUSIBLE_SPEED — Rating-aware inter-solve gap analysis
  // Minimum plausible solve time (minutes) scales with problem difficulty:
  // Formula: max(3, floor((rating - 500) / 100)) minutes
  // Only fires for problems at or above student's baseline rating
  var speedPlausibilityEnabled = (typeof AUDIT_SPEED_PLAUSIBILITY_ENABLED !== 'undefined') ? (AUDIT_SPEED_PLAUSIBILITY_ENABLED == 1) : true;
  if (speedPlausibilityEnabled && acTimes.length > 1) {
    for (var sIdx = 1; sIdx < acTimes.length; sIdx++) {
      var prevAc = acTimes[sIdx - 1];
      var currAc = acTimes[sIdx];

      // Skip same-contest pairs (legitimate live contest participation)
      if (prevAc.contestId && currAc.contestId && prevAc.contestId === currAc.contestId) continue;

      var gapMinutes = (currAc.time - prevAc.time) / 60;
      var currRating = currAc.rating || 0;

      // Only check problems at or above student's baseline
      if (currRating < rollingAvgRating) continue;

      var minPlausibleMin = Math.max(3, Math.floor((currRating - 500) / 100));

      if (gapMinutes >= 0 && gapMinutes < minPlausibleMin) {
        var speedSev = currRating >= personalBurstThreshold ? 'FLAGGED' : 'SUSPICIOUS';
        anomalies.push(createAnomalyObject(currAc.row, 'IMPLAUSIBLE_SPEED',
          'AC on ' + currRating + '-rated problem only ' + Math.round(gapMinutes) +
          ' min after previous AC (minimum plausible: ' + minPlausibleMin +
          ' min for this difficulty, your baseline: ' + Math.round(rollingAvgRating) + ')', speedSev));
      }
    }
  }

  // Compute final statistics
  stats.avgRating = stats.ratingCount > 0 ? _roundUp2Helper(stats.ratingSum / stats.ratingCount) : 0;
  stats.hintRate = stats.totalSolves > 0 ? _roundUp2Helper((stats.hintCount / stats.totalSolves) * 100) : 0;
  var topTag = '', topCount = 0;
  for (var tag in stats.tagCounts) {
    if (stats.tagCounts[tag] > topCount) { topCount = stats.tagCounts[tag]; topTag = tag; }
  }
  stats.topTag = topTag;

  // ── Growth Trend Analysis (Appreciations & Concerns) ──
  var appreciations = [];
  var concerns = [];

  // First-Week Welcome Message (C3)
  if (!prevWeekStats && stats.totalSolves >= 1) {
    appreciations.push("Welcome to your first tracked week! You logged " + stats.totalSolves + " solves — this is your baseline. Every week from here, you'll see your growth tracked and celebrated.");
  }

  if (prevWeekStats) {
    var timeDelta = stats.totalTime - prevWeekStats.totalTime;
    var solveDelta = stats.totalSolves - prevWeekStats.totalSolves;
    var ratingDelta = _roundUp2Helper(stats.avgRating - prevWeekStats.avgRating);

    if (timeDelta >= 60) {
      appreciations.push('Practice time increased by ' + timeDelta + ' min compared to last week. Fantastic dedication!');
    } else if (timeDelta <= -60) {
      // Soften Concern Language for Active Students (C2)
      if (stats.totalSolves >= 3) {
        concerns.push('Practice time was ' + Math.abs(timeDelta) + ' min lower than last week, but you still showed up with ' + stats.totalSolves + ' solves. Even lighter weeks count when you stay consistent.');
      } else {
        concerns.push('Practice time decreased by ' + Math.abs(timeDelta) + ' min vs last week. A consistent 20-30 min daily session will quickly rebuild your momentum.');
      }
    }

    if (solveDelta >= 3) {
      appreciations.push('Solved ' + solveDelta + ' more problems than last week. Great upward curve!');
    } else if (solveDelta <= -3) {
      concerns.push('Solve count dropped by ' + Math.abs(solveDelta) + ' from last week. Steady daily practice yields greater long-term growth than late weekend sprints.');
    }

    if (ratingDelta >= 100) {
      appreciations.push('Average problem difficulty increased by +' + ratingDelta + ' points. Wonderful push on hard topics!');
    }

    var dailyVariance = _roundUp2Helper(computeDailyVariance(logRows));
    if (dailyVariance > 4) {
      concerns.push('Practice was concentrated into a single burst. Spreading practice evenly across the week significantly improves algorithmic retention.');
    } else if (dailyVariance < 1.5 && stats.totalSolves >= 5) {
      appreciations.push('Highly consistent daily practice throughout the week. Exactly the habit of top competitive programmers!');
    }
  }

  // Hint habits & independence analysis (B4)
  if (stats.totalSolves >= 5 && stats.hintCount === 0) {
    appreciations.push('100% independent solves this week (' + stats.totalSolves + ' solo ACs)! Zero reliance on hints or editorials is building immense contest-grade problem-solving grit.');
  } else if (stats.totalSolves >= 3 && stats.hintRate >= 40) {
    concerns.push('High hint reliance detected: ' + stats.hintRate + '% of your solves used hints/editorials (' + stats.hintCount + '/' + stats.totalSolves + '). Try spending at least 25-30 minutes thinking independently before opening any hint.');
  } else if (stats.totalSolves >= 3 && stats.hintRate >= 20 && stats.hintRate < 40) {
    appreciations.push('Good balance of independent and guided practice (' + stats.hintRate + '% hints). You are actively challenging yourself while maintaining independence.');
  }

  // Delta celebration: drop of >=10% in hint rate vs previous week
  if (prevWeekStats && prevWeekStats.hintRate !== undefined && stats.hintRate !== undefined && stats.totalSolves >= 2) {
    var hintDelta = prevWeekStats.hintRate - stats.hintRate;
    if (hintDelta >= 10) {
      appreciations.push('Your hint reliance dropped from ' + Math.round(prevWeekStats.hintRate) + '% to ' + Math.round(stats.hintRate) + '% — real independence growth!');
    }
  }

  // Repeat Offender Analysis & Auto-Escalation (A6)
  var flaggedWeeks = (studentHistory && typeof studentHistory.flaggedWeeks === 'number')
    ? studentHistory.flaggedWeeks
    : (prevWeekStats && typeof prevWeekStats.flaggedWeeks === 'number' ? prevWeekStats.flaggedWeeks : 0);

  if (flaggedWeeks >= 2) {
    concerns.unshift('Verification discrepancies detected in ' + flaggedWeeks + ' of last 4 audit weeks. New findings auto-escalated to FLAGGED severity.');
    for (var escIdx = 0; escIdx < anomalies.length; escIdx++) {
      if (anomalies[escIdx].severity === 'SUSPICIOUS') {
        anomalies[escIdx].severity = 'FLAGGED';
        anomalies[escIdx].detail = (anomalies[escIdx].detail || '') + ' [Auto-escalated to FLAGGED: repeat discrepancy history]';
      }
    }
  }

  // Celebration Streaks (C4)
  var cleanStreak = (studentHistory && typeof studentHistory.cleanStreak === 'number')
    ? studentHistory.cleanStreak
    : (prevWeekStats && typeof prevWeekStats.cleanStreak === 'number' ? prevWeekStats.cleanStreak : 0);

  if (cleanStreak >= 3 && stats.totalSolves > 0 && anomalies.length === 0) {
    appreciations.push('🔥 ' + cleanStreak + '-week clean streak! Consistent verified practice over multiple weeks is building rock-solid mastery.');
  }

  // Integrity notes
  var flaggedAnomalies = anomalies.filter(function(a) { return a.severity === 'FLAGGED'; });
  if (flaggedAnomalies.length > 0) {
    concerns.push('We detected ' + flaggedAnomalies.length + ' entry discrepancy(ies) with official OJ records. Please ensure only authentic solves from your registered handle(s) are logged.');
  } else if (anomalies.length === 0 && stats.totalSolves >= 1) {
    appreciations.push('100% clean and verified audit record this week (' + stats.totalSolves + ' verified solve' + (stats.totalSolves > 1 ? 's' : '') + '). Your discipline and honesty build real mastery!');
  }

  return {
    anomalies: anomalies,
    stats: stats,
    appreciations: appreciations,
    concerns: concerns
  };
}

// ─── Anomaly & Stats Factory Helpers ───────────────────────────────

function createAnomalyObject(row, type, detail, severity, links) {
  var finalSeverity = severity || 'SUSPICIOUS';
  var detailText = detail || '';

  return {
    rowNum: row.rowNum || '-',
    problem: row.canonicalName || row.link || 'Unknown',
    verdict: row.verdict || '-',
    rating: row.rating || 0,
    time: row.time || 0,
    date: row.date ? formatDate(row.date) : formatDate(new Date()),
    type: type,
    detail: detailText,
    severity: finalSeverity,
    links: Array.isArray(links) ? links : []
  };
}

function initializeStudentStats(studentInfo) {
  return {
    matricId: studentInfo.matricId,
    name: studentInfo.name,
    email: studentInfo.email,
    totalSolves: 0,
    verifiedSolves: 0,
    manualSolves: 0,
    unverifiedSolves: 0,
    soloSolves: 0,
    hintCount: 0,
    hintRate: 0,
    totalTime: 0,
    avgRating: 0,
    ratingSum: 0,
    ratingCount: 0,
    topTag: '',
    tagCounts: {},
    tagHintCounts: {}
  };
}

function extractSubmissionLinks(truth, allowedHandles) {
  if (!truth || !Array.isArray(truth.subs) || !allowedHandles || !allowedHandles.length) return [];

  var handleMap = {};
  for (var i = 0; i < allowedHandles.length; i++) {
    handleMap[String(allowedHandles[i]).trim().toLowerCase()] = true;
  }

  var urls = [];
  var seen = {};

  for (var j = 0; j < truth.subs.length; j++) {
    var sub = truth.subs[j];
    if (!sub || !sub.id) continue;

    var subHandle = String(sub.h || (sub.author && sub.author.handle) || '').trim().toLowerCase();
    if (subHandle && !handleMap[subHandle]) continue;

    var cid = String(truth.contestId || (sub.problem && sub.problem.contestId) || sub.c || '').trim();
    if (!cid) continue;

    var url = 'https://codeforces.com/contest/' + cid + '/submission/' + sub.id;
    if (!seen[url]) {
      seen[url] = true;
      urls.push(url);
    }
  }

  return urls;
}


function computeDailyVariance(logRows) {
  var daily = {};
  for (var i = 0; i < logRows.length; i++) {
    var d = formatDate(logRows[i].date);
    daily[d] = (daily[d] || 0) + 1;
  }
  var days = Object.keys(daily);
  if (days.length === 0) return 0;
  var avg = logRows.length / days.length;
  var varSum = 0;
  for (var j = 0; j < days.length; j++) {
    var diff = daily[days[j]] - avg;
    varSum += diff * diff;
  }
  return Math.sqrt(varSum / days.length);
}