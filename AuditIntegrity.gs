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
function runStudentAudit(studentInfo, logRows, cfIndex, rollingAvgRating, prevWeekStats, weekStart, weekEnd, acIndex) {
  var anomalies = [];
  var stats = initializeStudentStats(studentInfo);
  var acTimes = [];
  var seenAcProblems = {};

  var personalBurstThreshold = rollingAvgRating + AUDIT_PERSONAL_DELTA_BURST;
  var personalTimeThreshold = rollingAvgRating + AUDIT_PERSONAL_DELTA_TIME;

  // Check if student has no valid CF handle registered
  if (cfIndex.handles.length === 0) {
    var hasCFProblems = logRows.some(function(r) { return r.platform === 'codeforces'; });
    if (hasCFProblems) {
      anomalies.push({
        rowNum: '-',
        problem: 'Roster Profile',
        verdict: '-',
        rating: 0,
        time: 0,
        date: formatDate(new Date()),
        type: 'NO_VALID_HANDLE',
        detail: 'Codeforces handle missing or invalid in Roster. Automatic verification cannot verify claimed problems.',
        severity: 'SUSPICIOUS',
        links: []
      });
    }
  }

  for (var i = 0; i < logRows.length; i++) {
    var row = logRows[i];

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

    // ── AtCoder Problems: Verify against AtCoder API truth ──
    if (row.platform === 'atcoder' && acIndex) {
      var acKey = String(row.problemId || '').toLowerCase().trim();
      var acTruth = acIndex[acKey];

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
            'Claimed AC but AtCoder best verdict is ' + acTruth.v, 'FLAGGED'));
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
        }
      } else {
        // Problem not found in AtCoder submission history
        if (row.verdict === 'AC') {
          anomalies.push(createAnomalyObject(row, 'GHOST_AC',
            'Claimed AC but zero submissions found on registered AtCoder handle for ' + acKey, 'FLAGGED'));
          stats.unverifiedSolves++;
        }
      }
      continue;
    }

    // ── Non-Codeforces / Non-AtCoder Problems (Manual / LeetCode / Other OJ) ──
    if (row.platform !== 'codeforces') {
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
          'Claimed AC but Codeforces best verdict is ' + truth.bestVerdict, 'FLAGGED', submissionLinks));
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
          'Claimed AC but zero submissions found on any registered handle for CF ' + pKey, 'FLAGGED'));
        stats.unverifiedSolves++;
      } else {
        anomalies.push(createAnomalyObject(row, 'NO_SUB_CLAIMED',
          'Row claims "' + row.verdict + '" but no CF submission exists', 'INFO'));
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

  // Compute final statistics
  stats.avgRating = stats.ratingCount > 0 ? Math.round(stats.ratingSum / stats.ratingCount) : 0;
  stats.hintRate = stats.totalSolves > 0 ? Math.round((stats.hintCount / stats.totalSolves) * 100) : 0;
  var topTag = '', topCount = 0;
  for (var tag in stats.tagCounts) {
    if (stats.tagCounts[tag] > topCount) { topCount = stats.tagCounts[tag]; topTag = tag; }
  }
  stats.topTag = topTag;

  // ── Growth Trend Analysis (Appreciations & Concerns) ──
  var appreciations = [];
  var concerns = [];

  if (prevWeekStats) {
    var timeDelta = stats.totalTime - prevWeekStats.totalTime;
    var solveDelta = stats.totalSolves - prevWeekStats.totalSolves;
    var ratingDelta = stats.avgRating - prevWeekStats.avgRating;

    if (timeDelta >= 60) {
      appreciations.push('Practice time increased by ' + timeDelta + ' min compared to last week. Fantastic dedication!');
    } else if (timeDelta <= -60) {
      concerns.push('Practice time decreased by ' + Math.abs(timeDelta) + ' min vs last week. A consistent 20-30 min daily session will quickly rebuild your momentum.');
    }

    if (solveDelta >= 3) {
      appreciations.push('Solved ' + solveDelta + ' more problems than last week. Great upward curve!');
    } else if (solveDelta <= -3) {
      concerns.push('Solve count dropped by ' + Math.abs(solveDelta) + ' from last week. Steady daily practice yields greater long-term growth than late weekend sprints.');
    }

    if (ratingDelta >= 100) {
      appreciations.push('Average problem difficulty increased by +' + ratingDelta + ' points. Wonderful push on hard topics!');
    }

    var dailyVariance = computeDailyVariance(logRows);
    if (dailyVariance > 4) {
      concerns.push('Practice was concentrated into a single burst. Spreading practice evenly across the week significantly improves algorithmic retention.');
    } else if (dailyVariance < 1.5 && stats.totalSolves >= 5) {
      appreciations.push('Highly consistent daily practice throughout the week. Exactly the habit of top competitive programmers!');
    }
  }

  // Hint habits & independence analysis
  if (stats.totalSolves >= 5 && stats.hintCount === 0) {
    appreciations.push('100% independent solves this week (' + stats.totalSolves + ' solo ACs)! Zero reliance on hints or editorials is building immense contest-grade problem-solving grit.');
  } else if (stats.totalSolves >= 3 && stats.hintRate >= 40) {
    concerns.push('High hint reliance detected: ' + stats.hintRate + '% of your solves used hints/editorials (' + stats.hintCount + '/' + stats.totalSolves + '). Try spending at least 25-30 minutes thinking independently before opening any hint.');
  }

  // Integrity notes
  var flaggedAnomalies = anomalies.filter(function(a) { return a.severity === 'FLAGGED'; });
  if (flaggedAnomalies.length > 0) {
    concerns.push('We detected ' + flaggedAnomalies.length + ' entry discrepancy(ies) with Codeforces OJ records. Please ensure only authentic solves from your registered handle are logged.');
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