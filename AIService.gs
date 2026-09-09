/**
 * ═══════════════════════════════════════════════════════════════════
 * AIService.gs — LLM Intelligence Cascade & Cohort Analytics
 *
 * RESPONSIBILITIES:
 * - Dual-provider LLM cascade (Kimi Moonshot -> Google Gemini)
 * - Strict RPM rate limiting & circuit breaker protection
 * - Cohort-level statistics & trend aggregation
 * - Batch student coaching & instructor executive digest generation
 * - Markdown & LaTeX formatting helpers
 * ═══════════════════════════════════════════════════════════════════
 */

/* ═══════════════════════════════════════════════════════════════════
   AI SERVICE (KIMI -> GEMINI CASCADE) & COHORT ANALYTICS
   ═══════════════════════════════════════════════════════════════════ */

var _aiCircuitOpen = false;
var _geminiCircuitOpen = false; // backwards compatibility alias
var _lastGeminiCallTime = 0;

/**
 * Enforce strict RPM limits (5 RPM for 3.8/3.7/3.6, 15 RPM for 3.5-lite).
 * Spaces out consecutive Gemini calls to guarantee RPM compliance.
 */
function enforceGeminiRPMLimit(model) {
  var minIntervalMs = 12500; // 12.5s for 5 RPM models (~4.8 RPM)
  if (model && model.indexOf('3.5') !== -1) {
    minIntervalMs = 4500; // 4.5s for 15 RPM models (~13.3 RPM)
  }

  var now = Date.now();
  var elapsed = now - _lastGeminiCallTime;
  if (elapsed < minIntervalMs && _lastGeminiCallTime > 0) {
    var sleepMs = minIntervalMs - elapsed;
    Logger.log('\u23F3 Respecting Gemini RPM limit. Pacing call with ' + Math.ceil(sleepMs / 1000) + 's pause...');
    Utilities.sleep(sleepMs);
  }
  _lastGeminiCallTime = Date.now();
}

/**
 * Attempt to call Kimi AI using KIMI_KEY from Script Properties.
 * Moonshot AI / Kimi endpoint (OpenAI compatible).
 * Returns response text string on success, or null on failure.
 */
function callKimiAI(prompt, systemInstruction) {
  var apiKey = PropertiesService.getScriptProperties().getProperty('KIMI_KEY');
  if (!apiKey || !String(apiKey).trim()) {
    return null;
  }

  var trimmedKey = String(apiKey).trim();
  var endpoints = [
    'https://api.moonshot.ai/v1/chat/completions',
    'https://api.moonshot.cn/v1/chat/completions'
  ];
  var models = ['kimi-k3', 'kimi-k2.7-code-highspeed', 'kimi-k2.6', 'moonshot-v1-8k', 'moonshot-v1-32k'];

  var messages = [];
  if (systemInstruction) {
    messages.push({ role: 'system', content: String(systemInstruction) });
  }
  messages.push({ role: 'user', content: String(prompt) });

  for (var epIdx = 0; epIdx < endpoints.length; epIdx++) {
    var endpoint = endpoints[epIdx];

    for (var mIdx = 0; mIdx < models.length; mIdx++) {
      var model = models[mIdx];
      var payload = {
        model: model,
        messages: messages,
        temperature: 0.7
      };

      try {
        var res = UrlFetchApp.fetch(endpoint, {
          method: 'post',
          contentType: 'application/json',
          headers: {
            'Authorization': 'Bearer ' + trimmedKey
          },
          payload: JSON.stringify(payload),
          muteHttpExceptions: true
        });

        var responseCode = res ? res.getResponseCode() : 0;
        if (res && responseCode === 200) {
          var json = JSON.parse(res.getContentText());
          if (json && json.choices && json.choices.length > 0) {
            var choice = json.choices[0];
            if (choice.message && choice.message.content) {
              var text = String(choice.message.content).trim();
              if (text) {
                Logger.log('\u2705 AI response received from Kimi (' + model + ')');
                return text;
              }
            }
          }
        }

        var errText = res ? res.getContentText() : '';
        Logger.log('Kimi API returned status ' + responseCode + ' for ' + model + ' (' + endpoint + '): ' + errText);

        // If unauthorized/forbidden (invalid key), stop trying other models on this key
        if (responseCode === 401 || responseCode === 403) {
          Logger.log('\u26A0\uFE0F KIMI_KEY appears invalid or unauthorized (status ' + responseCode + ').');
          return null;
        }
      } catch (e) {
        Logger.log('Kimi API call error on ' + model + ': ' + e.message);
      }
    }
  }

  Logger.log('\u26A0\uFE0F Kimi AI returned no valid response. Falling back to Gemini...');
  return null;
}

/**
 * Call Gemini AI using GEMINI_KEY from Script Properties.
 * Returns response text string on success, or null on failure.
 */
function callGeminiAIService(prompt, systemInstruction) {
  var apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_KEY');
  if (!apiKey || !String(apiKey).trim()) return null;

  var trimmedKey = String(apiKey).trim();
  // Valid, active Gemini model identifiers — gemini-3.8-flash prioritized first
  var models = ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite'];

  for (var m = 0; m < models.length; m++) {
    var model = models[m];
    var maxModelAttempts = 2;

    for (var attempt = 1; attempt <= maxModelAttempts; attempt++) {
      try {
        enforceGeminiRPMLimit(model);

        var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + encodeURIComponent(trimmedKey);
        var payload = {
          contents: [{
            parts: [{ text: prompt }]
          }],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 4096
          }
        };

        if (systemInstruction) {
          payload.systemInstruction = {
            parts: [{ text: systemInstruction }]
          };
        }

        var res = UrlFetchApp.fetch(url, {
          method: 'post',
          contentType: 'application/json',
          payload: JSON.stringify(payload),
          muteHttpExceptions: true
        });

        var responseCode = res ? res.getResponseCode() : 0;

        if (res && responseCode === 200) {
          var json = JSON.parse(res.getContentText());
          if (json && json.candidates && json.candidates.length > 0) {
            var cand = json.candidates[0];
            if (cand.content && cand.content.parts && cand.content.parts.length > 0) {
              var text = String(cand.content.parts[0].text || '').trim();
              if (text) {
                Logger.log('\u2705 AI response received from Gemini (' + model + ')');
                return text;
              }
            }
          }
        }

        var errText = res ? res.getContentText() : '';

        // If daily quota exhausted (RPD 20 limit reached on Free Tier), cascade to next model immediately
        if (responseCode === 429 && (errText.indexOf('RESOURCE_EXHAUSTED') !== -1 || errText.indexOf('quota') !== -1)) {
          Logger.log('\u26A0\uFE0F ' + model + ' quota exhausted (Free Tier 20 RPD limit reached). Cascading to next model...');
          break;
        }

        // If transient server blip (500/503), pause and retry
        if ((responseCode === 500 || responseCode === 503) && attempt < maxModelAttempts) {
          var waitMs = 3000 * attempt;
          Logger.log('Gemini API status ' + responseCode + ' on ' + model + ' (attempt ' + attempt + '). Pausing ' + waitMs + 'ms before retry...');
          Utilities.sleep(waitMs);
          continue;
        }

        Logger.log('Gemini API returned status ' + (responseCode || 'none') + ' for ' + model + ': ' + errText);
        break; // If model is 404 or non-transient, try next model
      } catch (e) {
        Logger.log('Gemini API call error on ' + model + ' (attempt ' + attempt + '): ' + e.message);
        if (attempt < maxModelAttempts) {
          Utilities.sleep(3000 * attempt);
        }
      }
    }
  }

  return null;
}

/**
 * Universal AI Caller:
 * 1. Try first with KIMI_KEY (Moonshot AI).
 * 2. If no valid response, try with GEMINI_KEY.
 * 3. If neither returns a valid response, activate circuit breaker and return null.
 */
function callAI(prompt, systemInstruction) {
  if (_aiCircuitOpen || _geminiCircuitOpen) return null;

  // 1. Try first with KIMI_KEY
  var kimiResponse = callKimiAI(prompt, systemInstruction);
  if (kimiResponse) {
    return kimiResponse;
  }

  // 2. If no valid response, try GEMINI_KEY
  var geminiResponse = callGeminiAIService(prompt, systemInstruction);
  if (geminiResponse) {
    return geminiResponse;
  }

  // 3. Both failed or neither key configured
  _aiCircuitOpen = true;
  _geminiCircuitOpen = true;
  Logger.log('\u26A0\uFE0F Both Kimi and Gemini AI services unavailable or quota exhausted. Activated circuit breaker; using built-in coaching notes.');
  return null;
}

/**
 * Primary alias for all audit functions:
 * Seamlessly routes through Kimi first, then Gemini fallback.
 */
function callGeminiAI(prompt, systemInstruction) {
  return callAI(prompt, systemInstruction);
}

/**
 * Aggregate cohort-wide metrics, bottleneck problems (high attempts), tag distributions, and student trends.
 */
function aggregateCohortAnalytics(allCohortLogs, allStudentStats, cohortAnomalies) {
  var highAttemptProblems = {}; // problem -> { problem, maxAttempts, students: [], rating }
  var tagMap = {};              // tag -> { solves, ratingSum, ratingCount, hintSolves, soloSolves, sampleProblems }
  var messySheets = [];
  var strugglingStudents = [];
  var topImprovers = [];

  var totalSolves = 0;
  var verifiedSolves = 0;
  var unverifiedSolves = 0;
  var totalSoloSolves = 0;
  var totalHintSolves = 0;

  for (var i = 0; i < allCohortLogs.length; i++) {
    var entry = allCohortLogs[i];
    var student = entry.studentInfo;
    var logRows = entry.logRows;
    var stats = entry.audit.stats;
    var anomalies = entry.audit.anomalies;

    totalSolves += stats.totalSolves;
    verifiedSolves += stats.verifiedSolves;
    unverifiedSolves += stats.unverifiedSolves;
    totalSoloSolves += (stats.soloSolves || 0);
    totalHintSolves += (stats.hintCount || 0);

    // Check high attempt problems (>=3 attempts or failed verdicts)
    for (var r = 0; r < logRows.length; r++) {
      var row = logRows[r];
      var pName = row.canonicalName || row.link || ('CF ' + row.contestId + row.problemIndex);
      var subs = Math.max(row.claimedSubs || 1, 1);

      if (subs >= 3 || (row.verdict && row.verdict !== 'AC')) {
        if (!highAttemptProblems[pName]) {
          highAttemptProblems[pName] = { problem: pName, maxAttempts: subs, students: [], rating: row.rating || 0 };
        }
        highAttemptProblems[pName].students.push(student.name + ' (' + subs + ' attempts, ' + (row.verdict || 'AC') + ')');
        if (subs > highAttemptProblems[pName].maxAttempts) highAttemptProblems[pName].maxAttempts = subs;
      }

      var tag = row.category || 'General';
      if (!tagMap[tag]) {
        tagMap[tag] = { solves: 0, ratingSum: 0, ratingCount: 0, hintSolves: 0, soloSolves: 0, sampleProblems: [] };
      }
      tagMap[tag].solves++;
      if (row.hasHint) {
        tagMap[tag].hintSolves++;
      } else {
        tagMap[tag].soloSolves++;
      }
      if (row.rating > 0) {
        tagMap[tag].ratingSum += row.rating;
        tagMap[tag].ratingCount++;
      }
      if (tagMap[tag].sampleProblems.length < 3 && tagMap[tag].sampleProblems.indexOf(pName) === -1) {
        tagMap[tag].sampleProblems.push(pName);
      }
    }

    // Check messy tracksheet / critical flags
    var criticalFlags = anomalies.filter(function(a) { return a.severity === 'FLAGGED'; });
    if (criticalFlags.length > 0) {
      messySheets.push({
        student: student,
        criticalCount: criticalFlags.length,
        types: criticalFlags.map(function(a) { return a.type; })
      });
    }

    // Check struggling / inactive / falling apart
    if (stats.totalSolves === 0 || entry.audit.concerns.length >= 2) {
      strugglingStudents.push({
        student: student,
        stats: stats,
        concerns: entry.audit.concerns
      });
    }

    // Check top improvers
    if (entry.audit.appreciations.length >= 2 || (stats.totalSolves >= 7 && stats.avgRating >= 1300)) {
      topImprovers.push({
        student: student,
        stats: stats,
        appreciations: entry.audit.appreciations
      });
    }
  }

  var cohortHintRate = totalSolves > 0 ? Math.round((totalHintSolves / totalSolves) * 100) : 0;

  return {
    highAttemptProblems: highAttemptProblems,
    tagMap: tagMap,
    messySheets: messySheets,
    strugglingStudents: strugglingStudents,
    topImprovers: topImprovers,
    totalSolves: totalSolves,
    verifiedSolves: verifiedSolves,
    unverifiedSolves: unverifiedSolves,
    totalSoloSolves: totalSoloSolves,
    totalHintSolves: totalHintSolves,
    cohortHintRate: cohortHintRate
  };
}

/**
 * Generate comprehensive AI Report for Instructor (Observations, Tags, Betterment Opportunities, and Draft Lesson Plan).
 */
function generateInstructorAIReport(cohortAnalytics, allStudentStats, cohortAnomalies, weekStart, weekEnd) {
  var highAttemptsList = Object.keys(cohortAnalytics.highAttemptProblems).map(function(k) {
    var p = cohortAnalytics.highAttemptProblems[k];
    return '- **' + p.problem + '** (Rating: ' + (p.rating || 'N/A') + '): ' + p.students.join(', ');
  }).slice(0, 10).join('\n') || '- No acute problem bottlenecks detected.';

  var tagList = Object.keys(cohortAnalytics.tagMap).map(function(t) {
    var d = cohortAnalytics.tagMap[t];
    var avg = d.ratingCount > 0 ? Math.round(d.ratingSum / d.ratingCount) : 'N/A';
    return '- **' + t + '**: ' + d.solves + ' solves (Avg Rating: ' + avg + ') | Examples: ' + d.sampleProblems.join(', ');
  }).join('\n') || '- General practice logged.';

  var improversList = cohortAnalytics.topImprovers.map(function(im) {
    return '- **' + im.student.name + '** (' + im.student.matricId + '): ' + im.stats.totalSolves + ' solves, Avg Rating ' + im.stats.avgRating + ' (' + im.appreciations.join('; ') + ')';
  }).slice(0, 8).join('\n') || '- Steady cohort pace.';

  var strugglingList = cohortAnalytics.strugglingStudents.map(function(st) {
    return '- **' + st.student.name + '** (' + st.student.matricId + '): ' + st.stats.totalSolves + ' solves (' + st.concerns.join('; ') + ')';
  }).slice(0, 8).join('\n') || '- No severely struggling students.';

  var messyList = cohortAnalytics.messySheets.map(function(m) {
    return '- **' + m.student.name + '** (' + m.student.matricId + '): ' + m.criticalCount + ' critical flags (' + m.types.join(', ') + ')';
  }).slice(0, 8).join('\n') || '- All student tracksheets are clean.';

  var systemInstruction = 'You are an expert Competitive Programming Head Coach and curriculum architect for university course CSE-1230. Deliver high-signal, actionable pedagogical analytics.\n' +
    'CRITICAL FORMATTING MANDATES FOR EMAIL RENDERING:\n' +
    '1. NEVER use LaTeX or dollar signs ($ or $$). Email clients (Gmail, Outlook) do NOT render LaTeX, causing raw backslashes and symbols to look broken.\n' +
    '2. Write all math, formulas, and variables in clean, readable plain text (e.g. write "x * b^a = y" instead of "$x \\cdot b^a = y$", write "(n - 1) / 2" instead of "\\frac{n-1}{2}", write "y mod x != 0" instead of "\\pmod", write "=>" instead of "\\implies", write "<=" instead of "\\le").\n' +
    '3. In Section 1, for each bottleneck problem, format each entry with three distinct bullet points:\n' +
    '   * CF <Contest><Index> — <Problem Name> (brief plain-text formula or concept)\n' +
    '   * Issue: <which students struggled and attempt count>\n' +
    '   * Root Pitfall: <the algorithmic trap, edge case, and clean invariant fix>\n' +
    '4. Complete all 4 sections concisely so the text concludes fully without trailing off.';

  var prompt = 'Analyze this week\'s CP student cohort audit data for CSE-1230 (' + formatDate(weekStart) + ' – ' + formatDate(weekEnd) + '):\n\n' +
    'COHORT SUMMARY:\n' +
    '- Active Students: ' + allStudentStats.length + '\n' +
    '- Total Solves Logged: ' + cohortAnalytics.totalSolves + ' (Verified: ' + cohortAnalytics.verifiedSolves + ', Unverified: ' + cohortAnalytics.unverifiedSolves + ')\n\n' +
    'TOPICS & TAGS BREAKDOWN:\n' + tagList + '\n\n' +
    'BOTTLENECK PROBLEMS (High Attempts / Stuck / WA):\n' + highAttemptsList + '\n\n' +
    'TRACKSHEET INTEGRITY ISSUES:\n' + messyList + '\n\n' +
    'STUDENT PERFORMANCE TRENDS:\n' +
    'Top Improvers:\n' + improversList + '\n' +
    'Struggling / Inactive:\n' + strugglingList + '\n\n' +
    'Please write a structured markdown report with the following 4 sections:\n' +
    '### 1. 🔍 Detailed Problem & Attempt Observations\n' +
    '(Explain specific problems where students got stuck or needed high attempts, identifying typical algorithmic pitfalls, edge cases, or complexity mistakes)\n\n' +
    '### 2. 🏷️ Topic & Tag Mastery Analysis\n' +
    '(Analyze strengths, conceptual gaps, and neglected areas)\n\n' +
    '### 3. 🚀 Betterment Opportunities & Student Callouts\n' +
    '(Highlight breakthroughs and note students needing 1-on-1 check-ins)\n\n' +
    '### 4. 📚 Draft Lesson Plan for This Week\n' +
    '- **Recommended Focus Topic**\n' +
    '- **Core Concepts & Techniques to Reinforce** (2-3 bullet points)\n' +
    '- **Suggested Practice Problem Ladder** (3-4 specific CF problems from Easy to Hard with problem name, ID/rating, and key takeaway)\n' +
    '- **Classroom / Live-Coding Tip for Instructor**\n\n' +
    'IMPORTANT: Do NOT use LaTeX math ($...$ or \\frac or \\cdot). Use plain text math formulas like "x * b^a = y" so it renders cleanly in email.';

  var aiResponse = callGeminiAI(prompt, systemInstruction);
  if (aiResponse) {
    return formatMarkdownToHtml(aiResponse);
  }

  // Graceful rule-based fallback report if GEMINI_KEY is missing or API unavailable
  return generateFallbackInstructorReportHtml(cohortAnalytics, allStudentStats, cohortAnomalies);
}

/**
 * Generate personalized student coaching notes in ONE single batch LLM request.
 * Conserves 95% of daily RPD quota (uses 1 request instead of 15+) and strictly respects RPM limits.
 * @param {Array} studentsToEmail - List of student objects needing coaching notes.
 * @returns {Object.<string, string>} Map of matricId -> personalized coaching note.
 */
function generateCohortStudentAICoachingBatch(studentsToEmail) {
  var resultMap = {};
  if (!Array.isArray(studentsToEmail) || studentsToEmail.length === 0) return resultMap;

  var prompt = 'Write a personalized 2-sentence encouraging, growth-oriented coaching note for each student in university course CSE-1230.\n' +
    'Students:\n';

  for (var i = 0; i < studentsToEmail.length; i++) {
    var item = studentsToEmail[i];
    var s = item.student;
    var st = item.stats || {};
    var coach = item.coachingSummary || {};
    var flaggedCount = (item.anomalies || []).filter(function(a) { return a.severity === 'FLAGGED'; }).length;
    var noteStatus = (item.anomalies || []).length === 0 ? 'Clean & Verified' : (flaggedCount > 0 ? flaggedCount + ' discrepancies' : 'Minor check notes');
    var soloCount = st.soloSolves || 0;
    var hintCount = st.hintCount || 0;

    prompt += (i + 1) + '. ID: ' + s.matricId + ', Name: ' + s.name + ', Solves: ' + (st.totalSolves || 0) + ' (' + soloCount + ' solo, ' + hintCount + ' with hints, ' + noteStatus + ')\n';
    if (st.totalSolves > 0 && st.hintRate >= 40) {
      prompt += '   Hint Reliance: ' + st.hintRate + '% solves used hints - encourage 25-min unassisted attempt timer before looking at solutions.\n';
    } else if (st.totalSolves >= 5 && hintCount === 0) {
      prompt += '   Independence: 100% unassisted solo solves! Praise contest-grade grit and independent synthesis.\n';
    }
    if (coach.progressionVerdict) {
      prompt += '   Progression: ' + coach.progressionVerdict + ' at ' + (coach.currentTier || 800) + ' rating\n';
    }
    if (coach.weakTags && coach.weakTags.length > 0) {
      var musts = coach.weakTags.filter(function(w) { return w.isMust; });
      if (musts.length > 0) {
        prompt += '   Must-Have Milestone: ' + musts.map(function(w) { return w.tag; }).join(', ') + ' for ' + (coach.currentTier || 800) + ' tier (needs unassisted practice)\n';
      } else {
        prompt += '   Focus Topics: ' + coach.weakTags.slice(0, 2).map(function(w) { return w.tag; }).join(', ') + ' at ' + (coach.currentTier || 800) + ' tier\n';
      }
    }
    if (item.appreciations && item.appreciations.length > 0) {
      prompt += '   Growth: ' + item.appreciations.join('; ') + '\n';
    }
  }

  prompt += '\nReturn ONLY a valid JSON object mapping student ID to the 2-sentence note. Example:\n' +
    '{\n  "C261014": "...",\n  "C261018": "..."\n}';

  var systemInstruction = 'You are an inspiring competitive programming mentor. Take special consideration of hint usage and rating-tier milestones (e.g., 1200 must master binary search, 1300 must master graphs/DFS, 1400 must master dynamic programming). Warmly praise students solving independently without hints, and constructively coach students with high hint reliance to attempt problems solo for 25-30 mins before checking hints. Return ONLY valid JSON mapping student matric IDs to encouraging coaching notes.';
  var aiResponse = callGeminiAI(prompt, systemInstruction);

  if (aiResponse) {
    try {
      var cleaned = String(aiResponse).trim().replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim();
      var parsed = JSON.parse(cleaned);
      if (parsed && typeof parsed === 'object') {
        return parsed;
      }
    } catch (e) {
      Logger.log('Could not parse batch student coaching JSON: ' + e.message);
    }
  }

  // Fallback to heuristic notes for each student
  for (var k = 0; k < studentsToEmail.length; k++) {
    var stObj = studentsToEmail[k];
    resultMap[stObj.student.matricId] = getFallbackStudentCoaching(stObj.stats, stObj.anomalies);
  }

  return resultMap;
}

function getFallbackStudentCoaching(stats, anomalies) {
  var anoms = anomalies || [];
  var flagged = anoms.filter(function(a) { return a.severity === 'FLAGGED'; });
  var isClean = anoms.length === 0;

  if (stats && stats.totalSolves >= 3 && stats.hintRate >= 40) {
    return 'Great practice momentum this week! With ' + stats.hintRate + '% of solves using hints, challenge yourself to sit with difficult test cases for at least 25 minutes before opening hints—that struggle is where breakthrough contest grit is born!';
  } else if (stats && stats.totalSolves >= 5 && stats.hintCount === 0) {
    return 'Incredible work this week! 100% independent solves with zero hints demonstrates true contest-grade grit. You are building rock-solid algorithmic foundations!';
  } else if (isClean && stats && stats.totalSolves >= 1) {
    return 'Fantastic consistency this week! Every verified solve strengthens your algorithmic problem-solving intuition. Keep up this wonderful momentum!';
  } else if (flagged.length > 0) {
    return 'Take a moment to align your sheet with your live Codeforces submissions. Honest practice and wrestling through tough test cases is where real mastery happens.';
  } else if (stats && stats.totalSolves === 0) {
    return 'Momentum is built one problem at a time. Commit to just 20-30 minutes of focused practice today to restart your growth streak.';
  }

  return 'Consistency beats intensity every time. Steady daily practice builds stronger problem-solving intuition than weekend sprints!';
}

/**
 * Fallback instructor observation report when GEMINI_KEY is unavailable.
 */
function generateFallbackInstructorReportHtml(cohortAnalytics, allStudentStats, cohortAnomalies) {
  var html = '';

  // Section 1: Problem Observations
  html += '<div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin-bottom:16px;">';
  html += '<h3 style="color:#0f172a;margin-top:0;font-size:15px;">🔍 1. Detailed Problem & Attempt Observations</h3>';
  var highProbKeys = Object.keys(cohortAnalytics.highAttemptProblems);
  if (highProbKeys.length > 0) {
    html += '<p style="font-size:13px;color:#334155;">The following problems required the highest attempts across the cohort, indicating common algorithmic traps, tricky edge cases, or complexity pitfalls:</p><ul>';
    for (var i = 0; i < Math.min(highProbKeys.length, 6); i++) {
      var hp = cohortAnalytics.highAttemptProblems[highProbKeys[i]];
      html += '<li style="font-size:13px;margin-bottom:6px;"><strong>' + escHtml(hp.problem) + '</strong> (Rating: ' + (hp.rating || 'N/A') + '): Logged with up to ' + hp.maxAttempts + ' attempts by ' + hp.students.slice(0, 3).join(', ') + '</li>';
    }
    html += '</ul>';
  } else {
    html += '<p style="font-size:13px;color:#059669;">No acute problem bottlenecks detected. Students cleared attempted problems within standard submission bounds.</p>';
  }
  html += '</div>';

  // Section 2: Topic & Tag Mastery
  html += '<div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin-bottom:16px;">';
  html += '<h3 style="color:#0f172a;margin-top:0;font-size:15px;">🏷️ 2. Topic & Tag Mastery Analysis</h3>';
  var tagKeys = Object.keys(cohortAnalytics.tagMap);
  if (tagKeys.length > 0) {
    html += '<ul style="font-size:13px;">';
    for (var t = 0; t < tagKeys.length; t++) {
      var td = cohortAnalytics.tagMap[tagKeys[t]];
      var avgR = td.ratingCount > 0 ? Math.round(td.ratingSum / td.ratingCount) : 'N/A';
      html += '<li style="margin-bottom:6px;"><strong>' + escHtml(tagKeys[t]) + '</strong>: ' + td.solves + ' solves (Avg Difficulty: ' + avgR + ') | Examples: ' + td.sampleProblems.slice(0, 3).join(', ') + '</li>';
    }
    html += '</ul>';
  }
  html += '</div>';

  // Section 3: Betterment & Student Callouts
  html += '<div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin-bottom:16px;">';
  html += '<h3 style="color:#0f172a;margin-top:0;font-size:15px;">🚀 3. Betterment Opportunities & Action Items</h3>';
  if (cohortAnalytics.topImprovers.length > 0) {
    html += '<div style="font-size:13px;color:#059669;margin-bottom:8px;"><strong>🌟 Standout Improvers:</strong> ' + cohortAnalytics.topImprovers.map(function(im) { return im.student.name; }).join(', ') + '</div>';
  }
  if (cohortAnalytics.strugglingStudents.length > 0) {
    html += '<div style="font-size:13px;color:#dc2626;margin-bottom:8px;"><strong>🚨 Needs Follow-up (Inactive / Falling Behind):</strong> ' + cohortAnalytics.strugglingStudents.map(function(st) { return st.student.name; }).join(', ') + '</div>';
  }
  if (cohortAnalytics.messySheets.length > 0) {
    html += '<div style="font-size:13px;color:#d97706;"><strong>⚠️ Messy / Unverified Tracksheets:</strong> ' + cohortAnalytics.messySheets.map(function(m) { return m.student.name + ' (' + m.criticalCount + ' flags)'; }).join(', ') + '</div>';
  }
  html += '</div>';

  // Section 4: Draft Lesson Plan
  html += '<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px;">';
  html += '<h3 style="color:#166534;margin-top:0;font-size:15px;">📚 4. Draft Lesson Plan for This Week</h3>';
  html += '<div style="font-size:13px;color:#1e293b;line-height:1.6;">';
  html += '<p><strong>Recommended Focus Topic:</strong> Binary Search on Answer & Two Pointers Mastery</p>';
  html += '<p><strong>Core Concepts to Reinforce:</strong><br>• Monotonicity check and predicate function design<br>• Correct boundary updates (avoiding infinite loops: <code>low = mid + 1</code> vs <code>high = mid</code>)<br>• Time complexity estimation before coding</p>';
  html += '<p><strong>Suggested Problem Ladder:</strong><br>1. <em>CF 1669F (Eating Queries)</em> — Rating 1100 (Prefix Sums + Binary Search)<br>2. <em>CF 1618C (Paint the Array)</em> — Rating 1200 (Number Theory & Invariants)<br>3. <em>CF 1800E2 (Unforgivable Curse)</em> — Rating 1400 (Graph Connected Components / Greedy)</p>';
  html += '<p><strong>Live-Coding Tip:</strong> Walk through writing a robust binary search template live on the board and illustrate how off-by-one errors occur when bounds are mismanaged.</p>';
  html += '</div></div>';

  return html;
}

/**
 * Clean markdown to styled, modern HTML email converter with card layouts and math normalization.
 */
function formatMarkdownToHtml(md) {
  if (!md) return '';
  var cleanedMd = cleanLatexMath(md);
  var lines = cleanedMd.split('\n');
  var html = '';
  var inList = false;
  var inOl = false;
  var inCard = false;

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line) {
      if (inList) { html += '</ul>'; inList = false; }
      if (inOl) { html += '</ol>'; inOl = false; }
      continue;
    }

    // Section Headers with context-aware accent colors
    if (line.match(/^###?\s*(\d\.)?\s*([🔍🏷️🚀📚])?\s*(.*)/i)) {
      if (inList) { html += '</ul>'; inList = false; }
      if (inOl) { html += '</ol>'; inOl = false; }
      if (inCard) { html += '</div>'; inCard = false; }

      var headerText = line.replace(/^#+\s*/, '');
      var headerLower = headerText.toLowerCase();
      var accentColor = '#3b82f6'; // default blue
      var bgGradient = 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)';
      var borderColor = '#e2e8f0';

      if (headerLower.indexOf('lesson plan') !== -1) {
        accentColor = '#10b981'; bgGradient = 'linear-gradient(135deg, #ecfdf5 0%, #f0fdf4 100%)'; borderColor = '#bbf7d0';
      } else if (headerLower.indexOf('topic') !== -1 || headerLower.indexOf('tag') !== -1) {
        accentColor = '#8b5cf6'; bgGradient = 'linear-gradient(135deg, #f5f3ff 0%, #ede9fe 100%)'; borderColor = '#ddd6fe';
      } else if (headerLower.indexOf('betterment') !== -1 || headerLower.indexOf('callout') !== -1) {
        accentColor = '#f59e0b'; bgGradient = 'linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%)'; borderColor = '#fde68a';
      }

      html += '<div style="background:' + bgGradient + ';border:1px solid ' + borderColor + ';border-left:5px solid ' + accentColor + ';border-radius:10px;padding:14px 18px;margin:28px 0 14px 0;">';
      html += '<h3 style="margin:0;color:#0f172a;font-size:15px;font-weight:800;">' + parseInlineFormatting(headerText) + '</h3>';
      html += '</div>';
      continue;
    }

    // Problem card detection: e.g. * CF 1674A — Number Transformation ...
    var cfProblemMatch = line.match(/^[-*]\s*(?:🎯\s*)?(CF\s*\d+[A-Za-z0-9].*)/i);
    if (cfProblemMatch) {
      if (inList) { html += '</ul>'; inList = false; }
      if (inOl) { html += '</ol>'; inOl = false; }
      if (inCard) { html += '</div>'; inCard = false; }

      var probTitle = cfProblemMatch[1].trim();
      inCard = true;
      html += '<div style="background:#ffffff;border:1px solid #e2e8f0;border-left:4px solid #6366f1;border-radius:10px;padding:14px 18px;margin:12px 0;box-shadow:0 1px 4px rgba(0,0,0,0.04);">';
      html += '<div style="font-size:14px;font-weight:700;color:#0f172a;">🎯 ' + parseInlineFormatting(probTitle) + '</div>';
      continue;
    }

    // Issue line in card
    var issueMatch = line.match(/^[-*]?\s*(?:\*\*)?Issue:(?:\*\*)?\s*(.*)/i);
    if (issueMatch && inCard) {
      html += '<div style="margin-top:8px;font-size:13px;color:#334155;line-height:1.5;">';
      html += '<span style="background:linear-gradient(135deg,#fee2e2,#fecdd3);color:#991b1b;border:1px solid #fecaca;padding:2px 8px;border-radius:6px;font-size:10px;font-weight:800;letter-spacing:0.5px;margin-right:6px;text-transform:uppercase;">Student Friction</span>';
      html += parseInlineFormatting(issueMatch[1]);
      html += '</div>';
      continue;
    }

    // Root Pitfall line in card
    var pitfallMatch = line.match(/^[-*]?\s*(?:\*\*)?Root Pitfall:(?:\*\*)?\s*(.*)/i);
    if (pitfallMatch && inCard) {
      html += '<div style="margin-top:8px;font-size:13px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px 14px;color:#1e293b;line-height:1.55;">';
      html += '<span style="background:linear-gradient(135deg,#fef3c7,#fde68a);color:#92400e;border:1px solid #fde68a;padding:2px 8px;border-radius:6px;font-size:10px;font-weight:800;letter-spacing:0.5px;margin-right:6px;text-transform:uppercase;">Root Pitfall & Fix</span>';
      html += parseInlineFormatting(pitfallMatch[1]);
      html += '</div>';
      continue;
    }

    // Numbered list items (1. 2. 3.)
    var numMatch = line.match(/^(\d+)\.\s+(.*)/);
    if (numMatch) {
      if (inCard) { html += '</div>'; inCard = false; }
      if (inList) { html += '</ul>'; inList = false; }
      if (!inOl) {
        html += '<ol style="margin:8px 0;padding-left:22px;font-size:13px;line-height:1.6;color:#334155;">';
        inOl = true;
      }
      html += '<li style="margin-bottom:6px;">' + parseInlineFormatting(numMatch[2]) + '</li>';
      continue;
    }

    // Standard list items (- or *)
    if (line.startsWith('- ') || line.startsWith('* ')) {
      if (inCard) {
        html += '</div>';
        inCard = false;
      }
      if (inOl) { html += '</ol>'; inOl = false; }
      if (!inList) {
        html += '<ul style="margin:8px 0;padding-left:20px;font-size:13px;line-height:1.6;color:#334155;">';
        inList = true;
      }
      html += '<li style="margin-bottom:6px;">' + parseInlineFormatting(line.substring(2)) + '</li>';
      continue;
    }

    if (inList) { html += '</ul>'; inList = false; }
    if (inOl) { html += '</ol>'; inOl = false; }
    if (inCard) { html += '</div>'; inCard = false; }

    html += '<p style="margin:8px 0;font-size:13px;line-height:1.65;color:#334155;">' + parseInlineFormatting(line) + '</p>';
  }

  if (inList) html += '</ul>';
  if (inOl) html += '</ol>';
  if (inCard) html += '</div>';

  return html;
}

/**
 * Clean and normalize raw LaTeX math commands into readable plain text/Unicode for email.
 */
function cleanLatexMath(str) {
  if (!str) return '';
  var s = String(str);

  s = s.replace(/\\cdot/g, ' · ')
       .replace(/\\times/g, ' × ')
       .replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, '($1 / $2)')
       .replace(/\\text\{([^}]+)\}/g, '$1')
       .replace(/\\pmod\s*\{?([a-zA-Z0-9_]+)\}?/g, ' mod $1')
       .replace(/\\pmod\s+([a-zA-Z0-9_]+)/g, ' mod $1')
       .replace(/\\neq/g, ' ≠ ')
       .replace(/\\ne/g, ' ≠ ')
       .replace(/\\leq/g, ' ≤ ')
       .replace(/\\le/g, ' ≤ ')
       .replace(/\\geq/g, ' ≥ ')
       .replace(/\\ge/g, ' ≥ ')
       .replace(/\\implies/g, ' ⟹ ')
       .replace(/\\iff/g, ' ⟺ ')
       .replace(/\\to/g, ' → ')
       .replace(/\\leftarrow/g, ' ← ')
       .replace(/\\in/g, ' ∈ ')
       .replace(/\\approx/g, ' ≈ ')
       .replace(/\\ldots/g, '…')
       .replace(/\\dots/g, '…')
       .replace(/\\([a-zA-Z]+)/g, '$1')
       .replace(/\\([0-9\s])/g, '$1');

  // Convert double-dollar math $$...$$ to styled code tags
  s = s.replace(/\$\$([^$]+)\$\$/g, function(m, p1) {
    return ' <code style="background:#f1f5f9;border:1px solid #e2e8f0;padding:2px 6px;border-radius:4px;font-size:12px;color:#0f172a;font-family:monospace;">' + p1.replace(/\s+/g, ' ').trim() + '</code> ';
  });

  // Convert single-dollar math $...$ to styled code tags
  s = s.replace(/\$([^$]+)\$/g, function(m, p1) {
    return '<code style="background:#f1f5f9;border:1px solid #e2e8f0;padding:1px 5px;border-radius:3px;font-size:12px;color:#0f172a;font-family:monospace;">' + p1.replace(/\s+/g, ' ').trim() + '</code>';
  });

  return s;
}

function parseInlineFormatting(str) {
  if (!str) return '';
  return str
    .replace(/\*\*(.*?)\*\*/g, '<strong style="color:#0f172a;">$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code style="background:#f1f5f9;border:1px solid #e2e8f0;padding:2px 5px;border-radius:4px;font-size:12px;color:#0f172a;font-family:monospace;">$1</code>');
}
