/**
 * ═══════════════════════════════════════════════════════════════════
 * AuditReports.gs — Email Report Generation & Dispatch
 *
 * RESPONSIBILITIES:
 * - Student weekly progress & anomaly report email (HTML & plain text)
 * - Instructor executive weekly digest & lesson plan email
 * - Admin recipient resolution from Roster and Script Properties
 * ═══════════════════════════════════════════════════════════════════
 */

/* ═══════════════════════════════════════════════════════════════════
   PREMIUM & MOTIVATING EMAIL GENERATION
   ═══════════════════════════════════════════════════════════════════ */

/**
 * Send a premium, mobile-responsive weekly report email to student.
 * Features: fluid table layout, viewport meta, 2×2 stacked stat grid,
 * AI coaching notes, scrollable anomaly table, growth highlights.
 */
function sendStudentWeeklyReportEmail(studentInfo, anomalies, stats, appreciations, concerns, aiNote, weekStart, weekEnd, coachingSummary) {
  var flagged = anomalies.filter(function(a) { return a.severity === 'FLAGGED'; });
  var suspicious = anomalies.filter(function(a) { return a.severity === 'SUSPICIOUS'; });
  var isClean = anomalies.length === 0;

  var hasBetterment = Array.isArray(appreciations) && appreciations.length > 0;
  var isFallingApart = (stats && stats.totalSolves === 0) || (Array.isArray(concerns) && concerns.length >= 2);

  var studentDisplayName = escHtml(studentInfo.name || 'Student');
  var studentMatric = escHtml(studentInfo.matricId || '');

  var subject = isClean
    ? '\u{1F31F} CSE-1230 Weekly Report: Outstanding Verified Progress (' + formatDate(weekStart) + ' \u2013 ' + formatDate(weekEnd) + ')'
    : (flagged.length > 0
        ? '\u26A0\uFE0F CSE-1230 Weekly Audit Alert: Verification Discrepancies (' + formatDate(weekStart) + ' \u2013 ' + formatDate(weekEnd) + ')'
        : '\u{1F4CB} CSE-1230 Weekly Practice Audit & Coaching Notes (' + formatDate(weekStart) + ' \u2013 ' + formatDate(weekEnd) + ')');

  var statusBadge = isClean ? '\u2705 All Verified' : (flagged.length > 0 ? '\u{1F6A9} ' + flagged.length + ' Flag' + (flagged.length > 1 ? 's' : '') : '\u{1F4A1} ' + suspicious.length + ' Note' + (suspicious.length > 1 ? 's' : ''));
  var statusBadgeBg = isClean ? '#059669' : (flagged.length > 0 ? '#dc2626' : '#d97706');

  var avgRating = stats ? stats.avgRating : 0;
  var topTag = stats ? (stats.topTag || '\u2014') : '\u2014';

  // ── Build mobile-responsive HTML ──
  var html = '<!DOCTYPE html><html><head><meta charset="utf-8">';
  html += '<meta name="viewport" content="width=device-width, initial-scale=1.0">';
  html += '<style>';
  html += 'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;background:#f1f5f9;color:#1e293b;margin:0;padding:16px 8px;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}';
  html += 'table{border-collapse:collapse}';
  html += '</style></head><body>';

  // Outer wrapper table for centering
  html += '<table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f1f5f9"><tr><td align="center" style="padding:12px 6px">';

  // Card container — fluid max-width with subtle elevation
  html += '<table cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:640px;background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 10px 25px -5px rgba(15,23,42,.08),0 8px 10px -6px rgba(15,23,42,.04);border:1px solid #e2e8f0">';

  // ── Header ──
  html += '<tr><td style="background:linear-gradient(135deg,#0f172a 0%,#1e1b4b 60%,#312e81 100%);padding:28px 26px 24px">';
  html += '<table cellpadding="0" cellspacing="0" border="0" width="100%"><tr>';
  html += '<td style="font-size:11px;color:#a5b4fc;font-weight:700;letter-spacing:1.2px;text-transform:uppercase">CSE-1230 \u2022 Competitive Programming</td>';
  html += '<td align="right"><span style="background:' + statusBadgeBg + ';color:#fff;padding:6px 14px;border-radius:9999px;font-size:11px;font-weight:800;letter-spacing:.6px;text-transform:uppercase;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,.25)">' + statusBadge + '</span></td>';
  html += '</tr></table>';
  html += '<h1 style="margin:14px 0 4px;font-size:23px;font-weight:800;color:#ffffff;letter-spacing:-.4px;line-height:1.25">Weekly Practice & Performance Intelligence</h1>';
  html += '<div style="font-size:14px;color:#e0e7ff;font-weight:600;margin-top:6px">' + studentDisplayName + (studentMatric ? ' (' + studentMatric + ')' : '') + '</div>';
  html += '<div style="margin-top:4px;font-size:12px;color:#a5b4fc">Audit Cycle: ' + formatDate(weekStart) + ' \u2013 ' + formatDate(weekEnd) + '</div>';
  html += '</td></tr>';

  // ── Stats Dashboard (2×2 + 1 stacked grid) ──
  html += '<tr><td style="background:linear-gradient(180deg,#f8fafc,#ffffff);padding:20px 18px;border-bottom:1px solid #e2e8f0">';

  var statItems = [
    { val: (stats ? stats.totalSolves : 0), label: 'Total Solves', color: '#0f172a', accent: '#e2e8f0', icon: '\u{1F3C6}' },
    { val: (stats ? stats.verifiedSolves : 0), label: 'Verified', color: '#059669', accent: '#d1fae5', icon: '\u2705' },
    { val: (stats ? stats.totalTime : 0) + 'm', label: 'Study Time', color: '#2563eb', accent: '#dbeafe', icon: '\u23F1\uFE0F' },
    { val: avgRating, label: 'Avg Rating', color: '#7c3aed', accent: '#ede9fe', icon: '\u2B50' }
  ];

  // Row 1: first 2 stats
  html += '<table cellpadding="0" cellspacing="0" border="0" width="100%"><tr>';
  for (var si = 0; si < 2; si++) {
    var s = statItems[si];
    html += '<td width="50%" style="padding:0 5px 10px"><div style="background:#ffffff;border:1px solid ' + s.accent + ';border-radius:14px;padding:14px 12px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.03)">';
    html += '<div style="font-size:12px;margin-bottom:2px">' + s.icon + '</div>';
    html += '<div style="font-size:26px;font-weight:800;color:' + s.color + ';letter-spacing:-.5px">' + s.val + '</div>';
    html += '<div style="font-size:10px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.6px;margin-top:2px">' + s.label + '</div>';
    html += '</div></td>';
  }
  html += '</tr></table>';

  // Row 2: next 2 stats
  html += '<table cellpadding="0" cellspacing="0" border="0" width="100%"><tr>';
  for (var si2 = 2; si2 < 4; si2++) {
    var s2 = statItems[si2];
    html += '<td width="50%" style="padding:0 5px 10px"><div style="background:#ffffff;border:1px solid ' + s2.accent + ';border-radius:14px;padding:14px 12px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.03)">';
    html += '<div style="font-size:12px;margin-bottom:2px">' + s2.icon + '</div>';
    html += '<div style="font-size:26px;font-weight:800;color:' + s2.color + ';letter-spacing:-.5px">' + s2.val + '</div>';
    html += '<div style="font-size:10px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.6px;margin-top:2px">' + s2.label + '</div>';
    html += '</div></td>';
  }
  html += '</tr></table>';

  // Row 3: Top Focus (full width)
  html += '<table cellpadding="0" cellspacing="0" border="0" width="100%"><tr><td style="padding:0 5px">';
  html += '<div style="background:#ffffff;border:1px solid #fce7f3;border-radius:12px;padding:12px 14px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.03)">';
  html += '<span style="font-size:14px;font-weight:800;color:#be185d;letter-spacing:-.2px">' + escHtml(topTag) + '</span>';
  html += ' <span style="font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.6px">\u2014 Primary Topic Focus</span>';
  html += '</div></td></tr></table>';

  // Row 4: Independence & Hint Balance
  if (stats && stats.totalSolves > 0) {
    var independenceRate = Math.max(100 - (stats.hintRate || 0), 0);
    var indColor = independenceRate >= 70 ? '#059669' : (independenceRate >= 50 ? '#d97706' : '#dc2626');
    var indBg = independenceRate >= 70 ? '#ecfdf5' : (independenceRate >= 50 ? '#fffbeb' : '#fef2f2');
    var indBorder = independenceRate >= 70 ? '#a7f3d0' : (independenceRate >= 50 ? '#fde68a' : '#fecaca');

    html += '<table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:8px"><tr><td style="padding:0 5px">';
    html += '<div style="background:' + indBg + ';border:1px solid ' + indBorder + ';border-radius:12px;padding:10px 14px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.03)">';
    html += '<span style="font-size:13px;font-weight:800;color:' + indColor + '">\u{1F9E9} Practice Independence: ' + (stats.soloSolves || 0) + ' Solo / ' + (stats.hintCount || 0) + ' With Hints (' + independenceRate + '% Unassisted)</span>';
    html += '</div></td></tr></table>';
  }

  html += '</td></tr>';

  // ── Content Body ──
  html += '<tr><td style="padding:24px 22px">';

  html += '<p style="font-size:15px;line-height:1.7;margin:0 0 18px;color:#334155">Hello <strong style="color:#0f172a">' + studentDisplayName + '</strong>,</p>';

  // ── 1. AI Coaching Card ──
  if (aiNote) {
    html += '<div style="background:linear-gradient(135deg,#eff6ff 0%,#e0e7ff 100%);border:1px solid #c7d2fe;border-radius:14px;padding:18px 20px;margin:0 0 20px;box-shadow:0 2px 8px rgba(99,102,241,.06)">';
    html += '<div style="font-weight:800;font-size:12px;text-transform:uppercase;letter-spacing:.8px;color:#4338ca;margin-bottom:8px">\u{1F916} Personalized Coach\'s Note</div>';
    html += '<div style="font-size:14px;color:#1e3a8a;line-height:1.65">' + escHtml(aiNote) + '</div>';
    html += '</div>';
  }

  // ── 2. Rating Progression & Milestone Forecast Card ──
  if (coachingSummary) {
    var cTier = coachingSummary.currentTier || 800;
    var cVerdict = coachingSummary.progressionVerdict || 'BUILDING';
    var cForecast = coachingSummary.forecastSolvesNeeded || 0;
    var cAdvice = coachingSummary.progressionAdvice || '';
    var tierBreakdown = coachingSummary.tierBreakdown || [];

    var verdictConfig = {
      'READY_TO_ADVANCE': {
        badge: '\u{1F680} Ready to Advance',
        badgeBg: 'background:linear-gradient(135deg,#059669,#10b981)',
        cardBg: '#f0fdf4',
        border: '#a7f3d0',
        textColor: '#065f46',
        desc: 'Mastery demonstrated at ' + cTier + '! You are ready to step up to ' + (cTier + 100) + '-rated problems.'
      },
      'HINT_DEPENDENT': {
        badge: '\u{1F9E9} Hint Dependent',
        badgeBg: 'background:linear-gradient(135deg,#e11d48,#f43f5e)',
        cardBg: '#fff1f2',
        border: '#fecdd3',
        textColor: '#9f1239',
        desc: 'High solve volume at ' + cTier + ', but heavily reliant on hints/editorials. Gated from advancing until unassisted mastery is demonstrated.'
      },
      'ALMOST_READY': {
        badge: '\u23F3 Nearing Milestone',
        badgeBg: 'background:linear-gradient(135deg,#2563eb,#3b82f6)',
        cardBg: '#eff6ff',
        border: '#bfdbfe',
        textColor: '#1e40af',
        desc: 'Strong momentum! Solve ' + cForecast + ' more verified problems at ' + cTier + ' to solidify speed before stepping up.'
      },
      'PLATEAU': {
        badge: '\u26A0\uFE0F Plateau Alert',
        badgeBg: 'background:linear-gradient(135deg,#d97706,#f59e0b)',
        cardBg: '#fffbeb',
        border: '#fde68a',
        textColor: '#92400e',
        desc: 'Solve times at ' + cTier + ' have stabilized. Diversify into unfamiliar problem tags rather than repetitive patterns to break through.'
      },
      'BUILDING': {
        badge: '\u{1F9F1} Building Foundation',
        badgeBg: 'background:linear-gradient(135deg,#6366f1,#8b5cf6)',
        cardBg: '#faf5ff',
        border: '#ddd6fe',
        textColor: '#5b21b6',
        desc: (cForecast > 0 ? ('Target ' + cForecast + ' more problems at ' + cTier + ' to build speed and intuitive recognition.') : 'Keep building confidence and speed at ' + cTier + ' rating.')
      }
    };

    var vInfo = verdictConfig[cVerdict] || verdictConfig['BUILDING'];

    html += '<div style="background:' + vInfo.cardBg + ';border:1px solid ' + vInfo.border + ';border-radius:14px;padding:18px 20px;margin:0 0 20px;box-shadow:0 2px 6px rgba(0,0,0,.02)">';
    html += '<table cellpadding="0" cellspacing="0" border="0" width="100%"><tr>';
    html += '<td style="font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.8px;color:' + vInfo.textColor + '">\u{1F3AF} Rating Progression & Next Leap Forecast</td>';
    html += '<td align="right"><span style="' + vInfo.badgeBg + ';color:#fff;padding:4px 12px;border-radius:9999px;font-size:10px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;white-space:nowrap">' + vInfo.badge + '</span></td>';
    html += '</tr></table>';

    html += '<div style="margin-top:10px;font-size:14px;color:' + vInfo.textColor + ';line-height:1.6">';
    html += '<strong>Current Working Tier:</strong> <span style="display:inline-block;background:#ffffff;padding:2px 8px;border-radius:6px;border:1px solid ' + vInfo.border + ';font-weight:800;color:' + vInfo.textColor + '">' + cTier + ' Rating</span> <span style="font-size:12px;color:#64748b">(majority of last 20 solves)</span><br>';
    html += '<div style="margin-top:8px;padding:12px 14px;background:#ffffff;border-radius:10px;border:1px solid ' + vInfo.border + ';font-size:13px;line-height:1.55">';
    html += '<strong style="color:' + vInfo.textColor + '">Engine Guidance:</strong> ' + escHtml(cAdvice || vInfo.desc);
    html += '</div>';
    html += '</div>';

    // 10-Solve Batches Progression Table
    if (tierBreakdown && tierBreakdown.length > 0) {
      html += '<div style="margin-top:14px">';
      html += '<div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.6px;color:#475569;margin-bottom:6px">\u{1F4CA} Historical Rating Tiers & 10-Solve Velocity Batches (Date-Sorted):</div>';
      html += '<div style="overflow-x:auto;-webkit-overflow-scrolling:touch">';
      html += '<table cellpadding="0" cellspacing="0" border="0" width="100%" style="font-size:12px;border-collapse:separate;border-spacing:0;background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #e2e8f0">';
      html += '<tr>';
      html += '<th style="background:#f8fafc;padding:9px 10px;text-align:left;font-weight:700;color:#475569;border-bottom:1px solid #e2e8f0;font-size:11px">Tier</th>';
      html += '<th style="background:#f8fafc;padding:9px 10px;text-align:center;font-weight:700;color:#475569;border-bottom:1px solid #e2e8f0;font-size:11px">Solves</th>';
      html += '<th style="background:#f8fafc;padding:9px 10px;text-align:center;font-weight:700;color:#475569;border-bottom:1px solid #e2e8f0;font-size:11px">Solo / Hint</th>';
      html += '<th style="background:#f8fafc;padding:9px 10px;text-align:center;font-weight:700;color:#475569;border-bottom:1px solid #e2e8f0;font-size:11px">Avg Time</th>';
      html += '<th style="background:#f8fafc;padding:9px 10px;text-align:left;font-weight:700;color:#475569;border-bottom:1px solid #e2e8f0;font-size:11px">10-Solve Batches Progression (Chronological)</th>';
      html += '</tr>';

      for (var ti = 0; ti < tierBreakdown.length; ti++) {
        var tb = tierBreakdown[ti];
        var isCurrent = (tb.tier === cTier);
        var tRowBg = isCurrent ? '#fdf4ff' : (ti % 2 === 0 ? '#ffffff' : '#fafbfc');

        var groupsDesc = '';
        if (tb.groups && tb.groups.length > 0) {
          var groupStrs = [];
          for (var gi = 0; gi < tb.groups.length; gi++) {
            var grp = tb.groups[gi];
            var grpSoloText = grp.hintCount !== undefined ? ' <span style="color:#64748b;font-size:10px">(' + grp.soloCount + 's/' + grp.hintCount + 'h)</span>' : '';
            groupStrs.push('G' + grp.groupIndex + ' (' + grp.solveCount + '): <strong>' + grp.avgTime + 'm</strong>' + grpSoloText);
          }
          groupsDesc = groupStrs.join(' \u2192 ');
          if (tb.isTimeImproving) {
            groupsDesc += ' <span style="color:#059669;font-weight:700">\u26A1 Pace Improving</span>';
          }
        } else {
          groupsDesc = '\u2014';
        }

        var soloHintStr = tb.soloSolves !== undefined ? (tb.soloSolves + 's / ' + tb.hintSolves + 'h') : '\u2014';

        html += '<tr style="background:' + tRowBg + '">';
        html += '<td style="padding:9px 10px;border-bottom:1px solid #f1f5f9;font-weight:' + (isCurrent ? '800' : '600') + ';color:' + (isCurrent ? '#6d28d9' : '#0f172a') + '">' + tb.tier + (isCurrent ? ' \u2605' : '') + '</td>';
        html += '<td style="padding:9px 10px;text-align:center;border-bottom:1px solid #f1f5f9;color:#334155">' + tb.solves + '</td>';
        html += '<td style="padding:9px 10px;text-align:center;border-bottom:1px solid #f1f5f9;color:#334155;font-size:11px">' + soloHintStr + '</td>';
        html += '<td style="padding:9px 10px;text-align:center;border-bottom:1px solid #f1f5f9;color:#334155">' + tb.avgTime + 'm</td>';
        html += '<td style="padding:9px 10px;border-bottom:1px solid #f1f5f9;color:#475569;font-size:11px">' + groupsDesc + '</td>';
        html += '</tr>';
      }

      html += '</table></div></div>';
    }

    html += '</div>';
  }

  // ── 3. Topic & Tag Mastery Radar ──
  if (coachingSummary && (coachingSummary.weakTags || coachingSummary.overFocusedTags || coachingSummary.strongTags || coachingSummary.hintHeavyTags)) {
    var hasWeak = coachingSummary.weakTags && coachingSummary.weakTags.length > 0;
    var hasOver = coachingSummary.overFocusedTags && coachingSummary.overFocusedTags.length > 0;
    var hasStrong = coachingSummary.strongTags && coachingSummary.strongTags.length > 0;
    var hasHintCrutch = coachingSummary.hintHeavyTags && coachingSummary.hintHeavyTags.length > 0;

    if (hasWeak || hasOver || hasStrong || hasHintCrutch) {
      html += '<div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:14px;padding:18px 20px;margin:0 0 20px;box-shadow:0 2px 6px rgba(0,0,0,.02)">';
      html += '<div style="font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.8px;color:#0f172a;margin-bottom:12px">\u{1F3F7}\uFE0F Topic Mastery & Blindspot Radar</div>';

      // Hint Crutch Warning
      if (hasHintCrutch) {
        html += '<div style="margin-bottom:12px;padding:12px 14px;background:#fff1f2;border:1px solid #fecdd3;border-radius:10px">';
        html += '<div style="font-size:12px;font-weight:800;color:#9f1239;margin-bottom:6px">\u{1F9E9} Hint/Editorial Crutch in Topics:</div>';
        html += '<div style="font-size:13px;color:#881337;line-height:1.6">';
        for (var hi = 0; hi < coachingSummary.hintHeavyTags.length; hi++) {
          var ht = coachingSummary.hintHeavyTags[hi];
          html += '<span style="display:inline-block;background:#ffffff;border:1px solid #fda4af;color:#be123c;padding:3px 10px;border-radius:9999px;font-size:11px;font-weight:700;margin:2px 4px 2px 0">' + escHtml(ht.tag) + ' (' + ht.hintRate + '% hints \u2022 ' + ht.hintCount + '/' + ht.solves + ')</span>';
        }
        html += '<div style="margin-top:6px;font-size:12px;color:#9f1239">\u{1F4A1} <em>Over 50% of your solves in these tags relied on hints. Re-attempt similar problems with zero hints to build true conceptual mastery.</em></div>';
        html += '</div></div>';
      }

      // Weak points / Blindspots
      if (hasWeak) {
        html += '<div style="margin-bottom:12px;padding:12px 14px;background:#fef2f2;border:1px solid #fecaca;border-radius:10px">';
        html += '<div style="font-size:12px;font-weight:800;color:#991b1b;margin-bottom:6px">\u{1F3AF} Priority Practice Blindspots:</div>';
        html += '<div style="font-size:13px;color:#7f1d1d;line-height:1.6">';
        for (var wi = 0; wi < Math.min(coachingSummary.weakTags.length, 5); wi++) {
          var wt = coachingSummary.weakTags[wi];
          var badgeStyle = wt.isMust
            ? 'background:#fff1f2;border:1.5px solid #e11d48;color:#9f1239;padding:3px 10px;border-radius:9999px;font-size:11px;font-weight:800;margin:2px 4px 2px 0'
            : (wt.isConsolidate
                ? 'background:#fffbeb;border:1.5px solid #d97706;color:#92400e;padding:3px 10px;border-radius:9999px;font-size:11px;font-weight:800;margin:2px 4px 2px 0'
                : 'background:#ffffff;border:1px solid #fca5a5;color:#b91c1c;padding:3px 10px;border-radius:9999px;font-size:11px;font-weight:700;margin:2px 4px 2px 0');
          var iconPrefix = wt.isMust ? '\u{1F3AF} MUST: ' : (wt.isConsolidate ? '\u{1F527} DEBT: ' : '');
          var tagLabel = iconPrefix + escHtml(wt.tag) + ' (' + wt.solves + ' solve' + (wt.solves === 1 ? '' : 's') + ')';
          html += '<span style="display:inline-block;' + badgeStyle + '">' + tagLabel + '</span>';
        }
        html += '<div style="margin-top:6px;font-size:12px;color:#991b1b">\u{1F4A1} <em>Target these topics in your next practice sessions. Topics marked \u{1F3AF} MUST are tier milestones gating advancement; \u{1F527} DEBT indicates unmastered topics from previous tiers.</em></div>';
        html += '</div></div>';
      }

      // Over-focus Warning
      if (hasOver) {
        html += '<div style="margin-bottom:12px;padding:12px 14px;background:#fffbeb;border:1px solid #fde68a;border-radius:10px">';
        html += '<div style="font-size:12px;font-weight:800;color:#92400e;margin-bottom:6px">\u26A0\uFE0F Over-Concentrated Topics:</div>';
        html += '<div style="font-size:13px;color:#78350f;line-height:1.6">';
        for (var oi = 0; oi < coachingSummary.overFocusedTags.length; oi++) {
          var ot = coachingSummary.overFocusedTags[oi];
          html += '<span style="display:inline-block;background:#ffffff;border:1px solid #fcd34d;color:#b45309;padding:3px 10px;border-radius:9999px;font-size:11px;font-weight:700;margin:2px 4px 2px 0">' + escHtml(ot.tag) + ' (' + ot.percent + '% of total solves)</span>';
        }
        html += '<div style="margin-top:6px;font-size:12px;color:#92400e">\u{1F4A1} <em>Over 40% volume concentrated here. Branch into diverse algorithmic paradigms.</em></div>';
        html += '</div></div>';
      }

      // Strong Points
      if (hasStrong) {
        html += '<div style="padding:12px 14px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px">';
        html += '<div style="font-size:12px;font-weight:800;color:#166534;margin-bottom:6px">\u2B50 Proven Strengths:</div>';
        html += '<div style="font-size:13px;color:#14532d;line-height:1.6">';
        for (var sti = 0; sti < Math.min(coachingSummary.strongTags.length, 3); sti++) {
          var stTag = coachingSummary.strongTags[sti];
          html += '<span style="display:inline-block;background:#ffffff;border:1px solid #86efac;color:#15803d;padding:3px 10px;border-radius:9999px;font-size:11px;font-weight:700;margin:2px 4px 2px 0">' + escHtml(stTag.tag) + ' (' + stTag.solves + ' solves \u2022 avg ' + stTag.avgRating + ')</span>';
        }
        html += '</div></div>';
      }

      html += '</div>';
    }
  }

  // ── 4. Growth Highlights ──
  if (hasBetterment) {
    html += '<div style="background:linear-gradient(135deg,#ecfdf5,#f0fdf4);border:1px solid #a7f3d0;border-radius:14px;padding:16px 20px;margin:0 0 20px">';
    html += '<div style="font-weight:800;font-size:12px;text-transform:uppercase;letter-spacing:.8px;color:#047857;margin-bottom:8px">\u{1F31F} Highlights & Growth This Week</div>';
    html += '<ul style="margin:0;padding-left:18px;font-size:14px;color:#065f46;line-height:1.65">';
    for (var ap = 0; ap < appreciations.length; ap++) {
      html += '<li style="margin-bottom:4px">' + escHtml(appreciations[ap]) + '</li>';
    }
    html += '</ul></div>';
  }

  // ── 5. Critical Discrepancies Alert ──
  if (flagged.length > 0) {
    html += '<div style="background:linear-gradient(135deg,#fef2f2,#fff1f2);border:1px solid #fecaca;border-radius:14px;padding:16px 20px;margin:0 0 20px">';
    html += '<div style="font-weight:800;font-size:14px;color:#b91c1c;margin-bottom:6px">\u{1F6A9} Verification Discrepancies (' + flagged.length + ' Critical Flag' + (flagged.length > 1 ? 's' : '') + ')</div>';
    html += '<div style="font-size:14px;color:#991b1b;line-height:1.6">Our verifier cross-checked your log against official Codeforces and AtCoder API records and identified entries that did not match the OJ server. Please review the items below so your verified course points accurately reflect your practice.</div>';
    html += '</div>';
  } else if (suspicious.length > 0) {
    html += '<div style="background:linear-gradient(135deg,#fffbeb,#fefce8);border:1px solid #fde68a;border-radius:14px;padding:16px 20px;margin:0 0 20px">';
    html += '<div style="font-weight:800;font-size:14px;color:#92400e;margin-bottom:6px">\u{1F4A1} Practice & Logging Notes (' + suspicious.length + ' Item' + (suspicious.length > 1 ? 's' : '') + ')</div>';
    html += '<div style="font-size:14px;color:#78350f;line-height:1.6">We noted a few minor discrepancies for your review.</div>';
    html += '</div>';
  }

  // ── 6. Momentum Check ──
  if (isFallingApart && flagged.length === 0) {
    html += '<div style="background:linear-gradient(135deg,#fffbeb,#fefce8);border:1px solid #fde68a;border-radius:14px;padding:16px 20px;margin:0 0 20px">';
    html += '<div style="font-weight:800;font-size:14px;color:#92400e;margin-bottom:6px">\u{1F6A8} Practice Momentum Check</div>';
    html += '<div style="font-size:14px;color:#78350f;line-height:1.6">Your practice activity was lower this week. Don\'t worry\u2014consistency can be rebuilt quickly. Aim for a short, steady 20\u201330 minute session every day to get back into rhythm!</div>';
    html += '</div>';
  }

  // ── 7. Anomalies Table (scrollable on mobile) ──
  if (anomalies.length > 0) {
    html += '<div style="margin-top:20px;margin-bottom:8px;font-size:14px;font-weight:800;color:#0f172a">\u{1F50D} Audit Findings Details</div>';
    html += '<div style="overflow-x:auto;-webkit-overflow-scrolling:touch">';
    html += '<table cellpadding="0" cellspacing="0" border="0" width="100%" style="min-width:440px;border-collapse:separate;border-spacing:0;border-radius:10px;overflow:hidden;border:1px solid #e2e8f0;font-size:13px">';
    html += '<tr>';
    html += '<th style="background:linear-gradient(180deg,#f8fafc,#f1f5f9);padding:12px;text-align:left;font-weight:700;color:#334155;font-size:11px;text-transform:uppercase;letter-spacing:.5px;border-bottom:2px solid #e2e8f0">Problem</th>';
    html += '<th style="background:linear-gradient(180deg,#f8fafc,#f1f5f9);padding:12px;text-align:left;font-weight:700;color:#334155;font-size:11px;text-transform:uppercase;letter-spacing:.5px;border-bottom:2px solid #e2e8f0">Type</th>';
    html += '<th style="background:linear-gradient(180deg,#f8fafc,#f1f5f9);padding:12px;text-align:left;font-weight:700;color:#334155;font-size:11px;text-transform:uppercase;letter-spacing:.5px;border-bottom:2px solid #e2e8f0">Detail</th>';
    html += '</tr>';

    for (var ai = 0; ai < anomalies.length; ai++) {
      var anom = anomalies[ai];
      var rowBg = (ai % 2 === 0) ? '#ffffff' : '#fafbfc';
      var sevBg = anom.severity === 'FLAGGED' ? 'background:linear-gradient(135deg,#fecaca,#fca5a5);color:#991b1b' : 'background:linear-gradient(135deg,#fde68a,#fcd34d);color:#78350f';

      var linksHtml = '';
      if (anom.links && anom.links.length > 0) {
        linksHtml = '<div style="margin-top:8px">';
        for (var li = 0; li < anom.links.length; li++) {
          linksHtml += '<a href="' + anom.links[li] + '" target="_blank" style="display:inline-block;background:linear-gradient(135deg,#eff6ff,#dbeafe);color:#1d4ed8;text-decoration:none;padding:6px 12px;border-radius:6px;font-weight:700;font-size:11px;border:1px solid #93c5fd;margin:2px 4px 2px 0">View Submission \u2197</a>';
        }
        linksHtml += '</div>';
      }

      html += '<tr style="background:' + rowBg + '">';
      html += '<td style="padding:12px;border-bottom:1px solid #f1f5f9;vertical-align:top"><strong style="color:#0f172a;font-size:13px">' + escHtml(anom.problem) + '</strong><br><span style="font-size:11px;color:#94a3b8">' + escHtml(anom.date) + '</span></td>';
      html += '<td style="padding:12px;border-bottom:1px solid #f1f5f9;vertical-align:top"><span style="display:inline-block;padding:4px 10px;border-radius:9999px;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.5px;white-space:nowrap;' + sevBg + '">' + escHtml(anom.type) + '</span></td>';
      html += '<td style="padding:12px;border-bottom:1px solid #f1f5f9;font-size:13px;line-height:1.5;vertical-align:top;color:#334155">' + escHtml(anom.detail) + linksHtml + '</td>';
      html += '</tr>';
    }
    html += '</table></div>';
  }

  // ── 8. Concerns (gentle framing) ──
  if (Array.isArray(concerns) && concerns.length > 0 && !isFallingApart) {
    html += '<div style="background:#fefce8;border:1px solid #fef08a;border-radius:12px;padding:14px 18px;margin:18px 0 0">';
    html += '<div style="font-weight:800;font-size:12px;color:#854d0e;text-transform:uppercase;letter-spacing:.6px;margin-bottom:6px">\u{1F4DD} Areas for Growth & Reflection</div>';
    html += '<ul style="margin:0;padding-left:18px;font-size:14px;color:#713f12;line-height:1.6">';
    for (var cn = 0; cn < concerns.length; cn++) {
      html += '<li style="margin-bottom:4px">' + escHtml(concerns[cn]) + '</li>';
    }
    html += '</ul></div>';
  }

  html += '</td></tr>'; // end content

  // ── Footer ──
  html += '<tr><td style="text-align:center;padding:26px 20px;font-size:12px;color:#94a3b8;background:linear-gradient(180deg,#fafafa,#f1f5f9);border-top:1px solid #e2e8f0">';
  html += '<div style="font-size:14px;color:#475569;font-weight:700;margin-bottom:6px">Every problem you solve expands your algorithmic intuition \u{1F4AA}</div>';
  html += '<div style="font-size:11px;color:#94a3b8">\u2014 CSE-1230 Course Staff & Automated Verification Engine</div>';
  html += '</td></tr>';

  html += '</table>'; // end card
  html += '</td></tr></table>'; // end wrapper
  html += '</body></html>';

  var targetEmails = sanitizeEmailList(studentInfo.email);
  if (!targetEmails) {
    Logger.log('Could not send student report to ' + (studentInfo.name || 'student') + ': no valid recipient email');
    return;
  }

  try {
    MailApp.sendEmail({
      to: targetEmails,
      subject: subject,
      htmlBody: html,
      name: 'CSE-1230 Tracker'
    });
    Logger.log('\u2705 Sent weekly report email to student: ' + targetEmails);
  } catch (e) {
    Logger.log('\u274C Could not send student report to ' + targetEmails + ': ' + e.message);
  }
}

/**
 * Extract all unique admin email addresses from the Roster sheet (Role === 'admin').
 * Reads Column A (Email) for all rows where Column F (Role) is 'admin'.
 * Supports comma-separated, space-separated, or semicolon-separated emails in Column A.
 * @param {Spreadsheet} [ss] - The active spreadsheet.
 * @returns {string} Comma-separated list of valid, deduplicated admin emails.
 */
function getAdminRecipientsFromRoster(ss) {
  var adminMap = {};

  // 1. First priority: INSTRUCTOR_EMAIL property from Script Properties
  try {
    if (typeof PropertiesService !== 'undefined' && PropertiesService.getScriptProperties) {
      var scriptProp = PropertiesService.getScriptProperties().getProperty('INSTRUCTOR_EMAIL') || '';
      if (scriptProp) {
        var propTokens = scriptProp.split(/[\s,;]+/);
        for (var p = 0; p < propTokens.length; p++) {
          var pEmail = propTokens[p].trim();
          if (pEmail && isValidEmail(pEmail)) {
            adminMap[pEmail.toLowerCase()] = pEmail;
          }
        }
      }
    }
  } catch (e) { /* ignore */ }

  // 2. Second priority: Roster sheet roles (admin, instructor, faculty, lead)
  var targetSs = ss;
  if (!targetSs) {
    try {
      if (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.getActiveSpreadsheet) {
        targetSs = SpreadsheetApp.getActiveSpreadsheet();
      }
    } catch (e) { targetSs = null; }
  }

  if (targetSs && typeof targetSs.getSheetByName === 'function') {
    var rosterSheet = targetSs.getSheetByName('Roster');
    if (rosterSheet) {
      var data = rosterSheet.getDataRange().getValues();
      if (data.length > 1) {
        var headers = data[0].map(function(h) { return String(h || '').toLowerCase().trim(); });
        var colRole = headers.indexOf('role');
        if (colRole === -1) colRole = 6; // Column G: Role
        var colEmail = headers.indexOf('email');
        if (colEmail === -1) colEmail = 0; // Column A: Email

        for (var i = 1; i < data.length; i++) {
          var role = String(data[i][colRole] || '').toLowerCase().trim();
          if (role === 'admin' || role === 'instructor' || role === 'faculty' || role === 'lead') {
            var rawEmail = String(data[i][colEmail] || '').trim();
            if (!rawEmail) continue;

            var tokens = rawEmail.split(/[\s,;]+/);
            for (var k = 0; k < tokens.length; k++) {
              var email = tokens[k].trim();
              if (email && isValidEmail(email)) {
                adminMap[email.toLowerCase()] = email;
              }
            }
          }
        }
      }
    }
  }

  // 3. Fallback: Session.getActiveUser()
  if (Object.keys(adminMap).length === 0) {
    try {
      if (typeof Session !== 'undefined' && Session.getActiveUser) {
        var activeUserEmail = Session.getActiveUser().getEmail();
        if (activeUserEmail && isValidEmail(activeUserEmail)) {
          adminMap[activeUserEmail.toLowerCase()] = activeUserEmail;
        }
      }
    } catch (e) { /* ignore */ }
  }

  var emails = Object.keys(adminMap).map(function(k) { return adminMap[k]; });
  var result = emails.join(', ');
  Logger.log('Resolved admin digest recipient(s): ' + (result || 'NONE FOUND'));
  return result;
}

var getInstructorRecipients = getAdminRecipientsFromRoster;

/**
 * Send premium, mobile-responsive executive cohort digest email to admins.
 * Features: fluid table layout, viewport meta, 2×2 stacked stat grid,
 * AI pedagogical curriculum plan, scrollable anomaly ledger.
 */
function sendInstructorDigestEmail(cohortAnomalies, cohortAppreciations, cohortConcerns, allStats, cohortAnalytics, instructorAiReport, weekStart, weekEnd, ss, cohortCoachingSummaries) {
  var adminEmails = getAdminRecipientsFromRoster(ss);
  if (!adminEmails) {
    Logger.log('\u26A0\uFE0F No admin/instructor emails found in Script Properties or Roster to send digest.');
    return;
  }
  var totalStudents = allStats.length;
  var totalAnomalies = cohortAnomalies.reduce(function(s, c) { return s + c.anomalies.length; }, 0);
  var flaggedStudents = cohortAnomalies.length;
  var cleanStudents = totalStudents - flaggedStudents;
  var cleanPercent = totalStudents > 0 ? Math.round((cleanStudents / totalStudents) * 100) : 100;

  var totalSolves = (cohortAnalytics && cohortAnalytics.totalSolves) || allStats.reduce(function(sum, st) { return sum + st.totalSolves; }, 0);
  var avgCohortRating = totalStudents > 0 ? Math.round(allStats.reduce(function(sum, st) { return sum + st.avgRating; }, 0) / totalStudents) : 0;
  var totalTime = allStats.reduce(function(sum, st) { return sum + (st.totalTime || 0); }, 0);

  var subject = '\u{1F4CA} CSE-1230 Executive Audit Digest & Lesson Plan: ' + formatDate(weekStart) + ' \u2013 ' + formatDate(weekEnd);

  var html = '<!DOCTYPE html><html><head><meta charset="utf-8">';
  html += '<meta name="viewport" content="width=device-width, initial-scale=1.0">';
  html += '<style>';
  html += 'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;background:#f1f5f9;color:#1e293b;margin:0;padding:16px 8px;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}';
  html += 'table{border-collapse:collapse}';
  html += '</style></head><body>';

  // Centered fluid wrapper
  html += '<table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f1f5f9"><tr><td align="center" style="padding:12px 6px">';

  // Card container — fluid max-width with elevation
  html += '<table cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:740px;background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 10px 25px -5px rgba(15,23,42,.08),0 8px 10px -6px rgba(15,23,42,.04);border:1px solid #e2e8f0">';

  // Header
  html += '<tr><td style="background:linear-gradient(135deg,#0f172a 0%,#1e1b4b 60%,#312e81 100%);color:#ffffff;padding:28px 26px 24px">';
  html += '<div style="font-size:11px;color:#a5b4fc;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;margin-bottom:8px">CSE-1230 \u2022 Executive Intelligence Digest</div>';
  html += '<h1 style="margin:0;font-size:23px;font-weight:800;letter-spacing:-.4px;color:#ffffff">Weekly Practice Audit & Coaching Ledger</h1>';
  html += '<div style="font-size:13px;color:#c7d2fe;margin-top:6px">Audit Window: ' + formatDate(weekStart) + ' \u2013 ' + formatDate(weekEnd) + '</div>';
  html += '</td></tr>';

  // 5-Stat Dashboard: 2×2 grid + 1 full-width row
  html += '<tr><td style="background:linear-gradient(180deg,#f8fafc,#ffffff);padding:20px 18px;border-bottom:1px solid #e2e8f0">';

  var dashStats = [
    { val: totalStudents, label: 'Active Students', color: '#0f172a', icon: '\u{1F393}', border: '#e2e8f0' },
    { val: cleanPercent + '%', label: 'Clean Audit Rate', color: '#059669', icon: '\u2705', border: '#d1fae5' },
    { val: flaggedStudents, label: 'Flagged Students', color: (flaggedStudents > 0 ? '#dc2626' : '#059669'), icon: '\u26A0\uFE0F', border: (flaggedStudents > 0 ? '#fecaca' : '#d1fae5') },
    { val: totalSolves, label: 'Cohort Solves', color: '#2563eb', icon: '\u{1F4C8}', border: '#dbeafe' }
  ];

  // Row 1: 2 stats
  html += '<table cellpadding="0" cellspacing="0" border="0" width="100%"><tr>';
  for (var di = 0; di < 2; di++) {
    var ds = dashStats[di];
    html += '<td width="50%" style="padding:0 5px 10px"><div style="background:#ffffff;border:1px solid ' + ds.border + ';border-radius:14px;padding:14px 12px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.03)">';
    html += '<div style="font-size:12px;margin-bottom:2px">' + ds.icon + '</div>';
    html += '<div style="font-size:24px;font-weight:800;color:' + ds.color + ';letter-spacing:-.5px">' + ds.val + '</div>';
    html += '<div style="font-size:10px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.6px;margin-top:2px">' + ds.label + '</div>';
    html += '</div></td>';
  }
  html += '</tr></table>';

  // Row 2: 2 stats
  html += '<table cellpadding="0" cellspacing="0" border="0" width="100%"><tr>';
  for (var di2 = 2; di2 < 4; di2++) {
    var ds2 = dashStats[di2];
    html += '<td width="50%" style="padding:0 5px 10px"><div style="background:#ffffff;border:1px solid ' + ds2.border + ';border-radius:14px;padding:14px 12px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.03)">';
    html += '<div style="font-size:12px;margin-bottom:2px">' + ds2.icon + '</div>';
    html += '<div style="font-size:24px;font-weight:800;color:' + ds2.color + ';letter-spacing:-.5px">' + ds2.val + '</div>';
    html += '<div style="font-size:10px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.6px;margin-top:2px">' + ds2.label + '</div>';
    html += '</div></td>';
  }
  html += '</tr></table>';

  // Row 3: Full width metric
  var cohortSoloCount = (cohortAnalytics && cohortAnalytics.totalSoloSolves) || 0;
  var cohortHintCount = (cohortAnalytics && cohortAnalytics.totalHintSolves) || 0;
  var cohortHintPct = (cohortAnalytics && cohortAnalytics.cohortHintRate) || 0;

  html += '<table cellpadding="0" cellspacing="0" border="0" width="100%"><tr><td style="padding:0 5px">';
  html += '<div style="background:#ffffff;border:1px solid #e0e7ff;border-radius:12px;padding:12px 14px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.03)">';
  html += '<span style="font-size:13px;font-weight:800;color:#4338ca">\u2B50 Avg Rating: ' + avgCohortRating + '</span>';
  html += ' <span style="font-size:12px;color:#94a3b8;margin:0 6px">\u2022</span> ';
  html += '<span style="font-size:13px;font-weight:700;color:#2563eb">\u23F1\uFE0F Practice Time: ' + totalTime + 'm (' + Math.round(totalTime / 60) + 'h)</span>';
  html += ' <span style="font-size:12px;color:#94a3b8;margin:0 6px">\u2022</span> ';
  html += '<span style="font-size:13px;font-weight:700;color:#059669">\u{1F9E9} Independence: ' + cohortSoloCount + ' Solo / ' + cohortHintCount + ' Hints (' + (100 - cohortHintPct) + '%)</span>';
  html += '</div></td></tr></table>';

  html += '</td></tr>';

  // Content Area
  html += '<tr><td style="padding:24px 22px">';

  // 1. AI Pedagogical Curriculum Plan
  if (instructorAiReport) {
    html += '<div style="margin-bottom:28px">' + instructorAiReport + '</div>';
    html += '<div style="border-top:2px solid #e2e8f0;margin:28px 0"></div>';
  }

  // 2. Integrity Anomaly Ledger (Scrollable on mobile)
  if (cohortAnomalies.length > 0) {
    html += '<div style="font-size:16px;font-weight:800;color:#dc2626;margin-bottom:12px">\u26A0\uFE0F Integrity Anomaly Ledger (' + totalAnomalies + ' Total Item' + (totalAnomalies > 1 ? 's' : '') + ')</div>';
    html += '<div style="overflow-x:auto;-webkit-overflow-scrolling:touch">';
    html += '<table cellpadding="0" cellspacing="0" border="0" width="100%" style="min-width:540px;border-collapse:separate;border-spacing:0;border-radius:10px;overflow:hidden;border:1px solid #e2e8f0;font-size:12px">';
    html += '<tr>';
    html += '<th style="background:linear-gradient(180deg,#f8fafc,#f1f5f9);padding:12px 10px;text-align:left;font-weight:700;color:#334155;font-size:11px;text-transform:uppercase;letter-spacing:.5px;border-bottom:2px solid #e2e8f0">Student</th>';
    html += '<th style="background:linear-gradient(180deg,#f8fafc,#f1f5f9);padding:12px 10px;text-align:left;font-weight:700;color:#334155;font-size:11px;text-transform:uppercase;letter-spacing:.5px;border-bottom:2px solid #e2e8f0">Problem</th>';
    html += '<th style="background:linear-gradient(180deg,#f8fafc,#f1f5f9);padding:12px 10px;text-align:left;font-weight:700;color:#334155;font-size:11px;text-transform:uppercase;letter-spacing:.5px;border-bottom:2px solid #e2e8f0">Type</th>';
    html += '<th style="background:linear-gradient(180deg,#f8fafc,#f1f5f9);padding:12px 10px;text-align:left;font-weight:700;color:#334155;font-size:11px;text-transform:uppercase;letter-spacing:.5px;border-bottom:2px solid #e2e8f0">Severity</th>';
    html += '<th style="background:linear-gradient(180deg,#f8fafc,#f1f5f9);padding:12px 10px;text-align:left;font-weight:700;color:#334155;font-size:11px;text-transform:uppercase;letter-spacing:.5px;border-bottom:2px solid #e2e8f0">Detail</th>';
    html += '</tr>';

    for (var i = 0; i < cohortAnomalies.length; i++) {
      var ca = cohortAnomalies[i];
      for (var j = 0; j < ca.anomalies.length; j++) {
        var anom = ca.anomalies[j];
        var rowBg = (j % 2 === 0) ? '#ffffff' : '#fafbfc';
        if (anom.severity === 'FLAGGED') rowBg = '#fef2f2';
        else if (anom.severity === 'SUSPICIOUS') rowBg = '#fffbeb';

        var sevBg = anom.severity === 'FLAGGED' ? 'background:linear-gradient(135deg,#fecaca,#fca5a5);color:#991b1b' : 'background:linear-gradient(135deg,#fde68a,#fcd34d);color:#78350f';

        html += '<tr style="background:' + rowBg + '">';
        html += '<td style="padding:10px;border-bottom:1px solid #f1f5f9;vertical-align:top"><strong style="color:#0f172a;font-size:12px">' + escHtml(ca.student.name) + '</strong><br><span style="font-size:10px;color:#64748b">' + escHtml(ca.student.matricId) + '</span></td>';
        html += '<td style="padding:10px;border-bottom:1px solid #f1f5f9;vertical-align:top"><span style="color:#0f172a;font-weight:600">' + escHtml(anom.problem) + '</span><br><span style="font-size:10px;color:#94a3b8">' + escHtml(anom.date) + '</span></td>';
        html += '<td style="padding:10px;border-bottom:1px solid #f1f5f9;vertical-align:top"><strong>' + escHtml(anom.type) + '</strong></td>';
        html += '<td style="padding:10px;border-bottom:1px solid #f1f5f9;vertical-align:top"><span style="display:inline-block;padding:3px 8px;border-radius:9999px;font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.5px;white-space:nowrap;' + sevBg + '">' + escHtml(anom.severity) + '</span></td>';
        html += '<td style="padding:10px;border-bottom:1px solid #f1f5f9;font-size:11px;line-height:1.45;color:#334155;vertical-align:top">' + escHtml(anom.detail) + '</td>';
        html += '</tr>';
      }
    }
    html += '</table></div>';
  } else {
    html += '<div style="background:linear-gradient(135deg,#ecfdf5,#f0fdf4);padding:16px 20px;border-radius:12px;border:1px solid #a7f3d0;color:#065f46;font-size:14px;font-weight:600">\u2705 Excellent! Zero integrity anomalies detected across the entire cohort this week.</div>';
  }

  // 3. Automated Student Coaching & Advice Ledger (Summary of engine recommendations per student)
  if (cohortCoachingSummaries && Object.keys(cohortCoachingSummaries).length > 0) {
    html += '<div style="border-top:2px solid #e2e8f0;margin:28px 0"></div>';
    html += '<div style="font-size:16px;font-weight:800;color:#1e1b4b;margin-bottom:12px">\u{1F393} Automated Coaching & Progression Digest (' + Object.keys(cohortCoachingSummaries).length + ' Students)</div>';
    html += '<div style="overflow-x:auto;-webkit-overflow-scrolling:touch">';
    html += '<table cellpadding="0" cellspacing="0" border="0" width="100%" style="min-width:640px;border-collapse:separate;border-spacing:0;border-radius:10px;overflow:hidden;border:1px solid #e2e8f0;font-size:12px">';
    html += '<tr>';
    html += '<th style="background:linear-gradient(180deg,#f8fafc,#f1f5f9);padding:12px 10px;text-align:left;font-weight:700;color:#334155;font-size:11px;text-transform:uppercase;letter-spacing:.5px;border-bottom:2px solid #e2e8f0">Student</th>';
    html += '<th style="background:linear-gradient(180deg,#f8fafc,#f1f5f9);padding:12px 10px;text-align:center;font-weight:700;color:#334155;font-size:11px;text-transform:uppercase;letter-spacing:.5px;border-bottom:2px solid #e2e8f0">Tier</th>';
    html += '<th style="background:linear-gradient(180deg,#f8fafc,#f1f5f9);padding:12px 10px;text-align:center;font-weight:700;color:#334155;font-size:11px;text-transform:uppercase;letter-spacing:.5px;border-bottom:2px solid #e2e8f0">Status</th>';
    html += '<th style="background:linear-gradient(180deg,#f8fafc,#f1f5f9);padding:12px 10px;text-align:left;font-weight:700;color:#334155;font-size:11px;text-transform:uppercase;letter-spacing:.5px;border-bottom:2px solid #e2e8f0">Engine Advice & Milestone Forecast</th>';
    html += '<th style="background:linear-gradient(180deg,#f8fafc,#f1f5f9);padding:12px 10px;text-align:left;font-weight:700;color:#334155;font-size:11px;text-transform:uppercase;letter-spacing:.5px;border-bottom:2px solid #e2e8f0">Topic Guidance</th>';
    html += '</tr>';

    var cKeys = Object.keys(cohortCoachingSummaries);
    for (var cki = 0; cki < cKeys.length; cki++) {
      var cMatric = cKeys[cki];
      var cData = cohortCoachingSummaries[cMatric];
      if (!cData) continue;

      var stMatch = allStats.filter(function(s) { return s.matricId === cMatric; })[0];
      var stName = stMatch ? (stMatch.name || stMatch.studentName || cMatric) : cMatric;

      var rowBg2 = (cki % 2 === 0) ? '#ffffff' : '#fafbfc';
      var vBadgeColor = '#64748b';
      var vBadgeBg = '#f1f5f9';
      var vText = cData.progressionVerdict || 'BUILDING';

      if (vText === 'READY_TO_ADVANCE') {
        vBadgeColor = '#065f46';
        vBadgeBg = '#d1fae5';
      } else if (vText === 'HINT_DEPENDENT') {
        vBadgeColor = '#9f1239';
        vBadgeBg = '#ffe4e6';
      } else if (vText === 'ALMOST_READY') {
        vBadgeColor = '#1e40af';
        vBadgeBg = '#dbeafe';
      } else if (vText === 'PLATEAU') {
        vBadgeColor = '#92400e';
        vBadgeBg = '#fef3c7';
      } else {
        vBadgeColor = '#5b21b6';
        vBadgeBg = '#ede9fe';
      }

      var topicNotes = [];
      if (cData.hintHeavyTags && cData.hintHeavyTags.length > 0) {
        var hintCrutchNames = cData.hintHeavyTags.map(function(h) { return h.tag + ' (' + h.hintRate + '% hints)'; }).join(', ');
        topicNotes.push('<span style="color:#e11d48;font-weight:600">Hint Crutch:</span> ' + escHtml(hintCrutchNames));
      }
      if (cData.weakTags && cData.weakTags.length > 0) {
        var weakNames = cData.weakTags.slice(0, 2).map(function(w) { return w.tag; }).join(', ');
        topicNotes.push('<span style="color:#b91c1c;font-weight:600">Needs:</span> ' + escHtml(weakNames));
      }
      if (cData.overFocusedTags && cData.overFocusedTags.length > 0) {
        var overNames = cData.overFocusedTags.slice(0, 1).map(function(o) { return o.tag + ' (' + o.percent + '%)'; }).join(', ');
        topicNotes.push('<span style="color:#d97706;font-weight:600">Over-focus:</span> ' + escHtml(overNames));
      }
      var topicNotesHtml = topicNotes.length > 0 ? topicNotes.join('<br>') : '<span style="color:#94a3b8">Balanced</span>';

      html += '<tr style="background:' + rowBg2 + '">';
      html += '<td style="padding:10px;border-bottom:1px solid #f1f5f9;vertical-align:top"><strong style="color:#0f172a;font-size:12px">' + escHtml(stName) + '</strong><br><span style="font-size:10px;color:#64748b">' + escHtml(cMatric) + '</span></td>';
      html += '<td style="padding:10px;text-align:center;border-bottom:1px solid #f1f5f9;vertical-align:top;font-weight:800;color:#334155">' + (cData.currentTier || 800) + '</td>';
      html += '<td style="padding:10px;text-align:center;border-bottom:1px solid #f1f5f9;vertical-align:top"><span style="display:inline-block;padding:3px 8px;border-radius:9999px;font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.5px;white-space:nowrap;background:' + vBadgeBg + ';color:' + vBadgeColor + '">' + escHtml(vText.replace(/_/g, ' ')) + '</span></td>';
      html += '<td style="padding:10px;border-bottom:1px solid #f1f5f9;font-size:11px;line-height:1.45;color:#334155;vertical-align:top">' + escHtml(cData.progressionAdvice || cData.overallRecommendation || '\u2014') + '</td>';
      html += '<td style="padding:10px;border-bottom:1px solid #f1f5f9;font-size:11px;line-height:1.45;vertical-align:top">' + topicNotesHtml + '</td>';
      html += '</tr>';
    }

    html += '</table></div>';
  }

  // Quick summary card
  html += '<div style="margin-top:24px;background:linear-gradient(135deg,#f8fafc,#f1f5f9);border:1px solid #e2e8f0;border-radius:12px;padding:16px 20px">';
  html += '<div style="font-weight:800;font-size:12px;color:#475569;text-transform:uppercase;letter-spacing:.8px;margin-bottom:8px">\u{1F4CB} Quick Summary</div>';
  html += '<div style="font-size:13px;color:#334155;line-height:1.7">';
  html += '\u2022 <strong>' + totalStudents + '</strong> students audited with <strong>' + totalSolves + '</strong> total solves (' + cohortSoloCount + ' unassisted solo, ' + cohortHintCount + ' with hints) and <strong>' + totalTime + '</strong> minutes practice time<br>';
  html += '\u2022 <strong>' + cleanPercent + '%</strong> clean audit rate (' + cleanStudents + '/' + totalStudents + ' students with zero flags)<br>';
  if (flaggedStudents > 0) {
    html += '\u2022 <strong>' + flaggedStudents + '</strong> student' + (flaggedStudents > 1 ? 's' : '') + ' with <strong>' + totalAnomalies + '</strong> total anomalies requiring review';
  } else {
    html += '\u2022 No students requiring follow-up this week';
  }
  html += '</div></div>';

  html += '</td></tr>'; // end content

  // Footer
  html += '<tr><td style="text-align:center;padding:22px 24px;font-size:11px;color:#94a3b8;background:linear-gradient(180deg,#fafafa,#f1f5f9);border-top:1px solid #e2e8f0">';
  html += '\u2014 CSE-1230 Automated Audit & Verification Engine';
  html += '</td></tr>';

  html += '</table>'; // end card
  html += '</td></tr></table>'; // end wrapper
  html += '</body></html>';

  try {
    MailApp.sendEmail({
      to: adminEmails,
      subject: subject,
      htmlBody: html,
      name: 'CSE-1230 Tracker'
    });
    Logger.log('\u2705 Sent executive audit digest email to: ' + adminEmails);
  } catch (e) {
    Logger.log('\u274C Could not send admin digest email to ' + adminEmails + ': ' + e.message);
  }
}
