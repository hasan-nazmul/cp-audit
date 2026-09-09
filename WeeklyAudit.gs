/**
 * ═══════════════════════════════════════════════════════════════════
 * WeeklyAudit.gs — Main Audit Workflow & Trigger Orchestrator
 *
 * PURPOSE:
 * Serves as the primary entry point and orchestrator for the weekly
 * CP audit cycle. Invoked automatically by time-driven trigger.
 *
 * TRIGGER ENTRY POINT:
 *   weeklyAuditAndHistory()
 *
 * ARCHITECTURAL MODULES:
 * 1. WeeklyAudit.gs     — Global config, trigger entry point & high-level pipeline
 * 2. AuditFetch.gs      — Parallel CF & AtCoder submission fetching with retry
 * 3. AuditIntegrity.gs  — Multi-vector anomaly detection & anti-cheat engine
 * 4. AuditProgression.gs— Tier progression curves, milestone gating & topic analysis
 * 5. SuggestionEngine.gs— Topic metadata encyclopedia, curriculum taxonomy & gap detector
 * 6. AIService.gs       — Dual-provider LLM cascade (Kimi -> Gemini), cohort analytics
 * 7. AuditReports.gs    — Premium HTML email reports for students & instructor digest
 * 8. AuditStorage.gs    — Google Sheets batch reads/writes, history updates & shared utils
 * ═══════════════════════════════════════════════════════════════════
 */

function getAuditConfigNum(key, defaultVal) {
  try {
    if (typeof PropertiesService !== 'undefined' && PropertiesService.getScriptProperties) {
      var val = PropertiesService.getScriptProperties().getProperty(key);
      if (val !== null && val !== '') {
        var n = Number(val);
        if (!isNaN(n)) return n;
      }
    }
  } catch (e) { /* fallback */ }
  return defaultVal;
}

var AUDIT_CACHE_TTL = getAuditConfigNum('AUDIT_CACHE_TTL', 900);
var AUDIT_BURST_WINDOW_MIN = getAuditConfigNum('AUDIT_BURST_WINDOW_MIN', 15);
var AUDIT_BURST_THRESHOLD = getAuditConfigNum('AUDIT_BURST_THRESHOLD', 3);
var AUDIT_RATING_SPIKE_DELTA = getAuditConfigNum('AUDIT_RATING_SPIKE_DELTA', 500);
var AUDIT_TIME_ANOMALY_CAP_MIN = getAuditConfigNum('AUDIT_TIME_ANOMALY_CAP_MIN', 5);
var AUDIT_PERSONAL_DELTA_BURST = getAuditConfigNum('AUDIT_PERSONAL_DELTA_BURST', 200);
var AUDIT_PERSONAL_DELTA_TIME = getAuditConfigNum('AUDIT_PERSONAL_DELTA_TIME', 200);
var AUDIT_WEEK_DAYS = getAuditConfigNum('AUDIT_WEEK_DAYS', 7);
var AUDIT_PARALLEL_BATCH_SIZE = getAuditConfigNum('AUDIT_PARALLEL_BATCH_SIZE', 5);
var AUDIT_THROTTLE_MS = getAuditConfigNum('AUDIT_THROTTLE_MS', 250);

/* ═══════════════════════════════════════════════════════════════════
   MAIN AUDIT WORKFLOW
   ═══════════════════════════════════════════════════════════════════ */


/**
 * Main weekly audit entry point.
 * Run weekly (e.g. Sunday 11:00 PM) before history archive.
 */
function weeklyAuditAndHistory() {
  var lock = LockService.getScriptLock();
  var hasLock = false;

  try {
    hasLock = lock.tryLock(30000);
    if (!hasLock) {
      Logger.log('⚠️ Could not obtain script lock for weeklyAuditAndHistory; another instance is already running.');
      return;
    }

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var now = new Date();
    var auditStartMs = Date.now();
  var weekEnd = new Date(now);
  var weekStart = new Date(now);
  weekStart.setDate(weekStart.getDate() - AUDIT_WEEK_DAYS);
  weekStart.setHours(0, 0, 0, 0);
  weekEnd.setHours(23, 59, 59, 999);

  // Reset AI circuit breaker for this fresh audit cycle
  _aiCircuitOpen = false;
  _geminiCircuitOpen = false;

  // ── Step 1: Single-Pass Cohort Roster & Stats Loading ──
  var stepStart = Date.now();
  var rosterData = loadCohortRoster(ss);
  var prevStatsMap = loadPreviousWeekStatsMap(ss);
  var studentSheets = getActiveStudentSheets(ss, rosterData);
  Logger.log('⏱ Step 1 (Roster & Stats) completed in ' + (Date.now() - stepStart) + 'ms — ' + studentSheets.length + ' active students');

  if (studentSheets.length === 0) {
    Logger.log('No active student sheets found for audit.');
    return;
  }

  // ── Step 2: Extract & Batch Pre-Validate All Cohort CF Handles + AtCoder Handles ──
  stepStart = Date.now();
  var validatedHandlesMap = {};
  var allCohortAtCoderHandles = [];
  try {
    var allCohortCFHandles = [];
    for (var s = 0; s < studentSheets.length; s++) {
      var sInfo = studentSheets[s].studentInfo;
      var validHandles = sanitizeHandles(sInfo.cfHandle, 'codeforces');
      for (var h = 0; h < validHandles.length; h++) {
        allCohortCFHandles.push(validHandles[h]);
      }
      // Collect AtCoder handles
      var acHandles = sanitizeHandles(sInfo.atCoderHandle, 'atcoder');
      for (var ah = 0; ah < acHandles.length; ah++) {
        allCohortAtCoderHandles.push(acHandles[ah]);
      }
    }
    validatedHandlesMap = validateCFHandlesBatch(allCohortCFHandles) || {};
  } catch (handleErr) {
    Logger.log('⚠️ Could not pre-validate CF handles (network or API issue): ' + handleErr.message);
    validatedHandlesMap = {};
  }
  Logger.log('⏱ Step 2 (Handle Validation) completed in ' + (Date.now() - stepStart) + 'ms — ' + Object.keys(validatedHandlesMap).length + ' CF handles, ' + allCohortAtCoderHandles.length + ' AtCoder handles');

  // ── Step 3: Asynchronous Parallel Fetching for All Verified Handles (CF + AtCoder) ──
  stepStart = Date.now();
  var cohortSubmissionsMap = {};
  var cohortAtCoderMap = {};
  try {
    var verifiedHandlesToFetch = Object.keys(validatedHandlesMap).filter(function(handle) {
      return validatedHandlesMap[handle] === true;
    });
    cohortSubmissionsMap = fetchCohortSubmissionsParallel(verifiedHandlesToFetch) || {};
  } catch (fetchErr) {
    Logger.log('⚠️ Could not fetch CF cohort submissions: ' + fetchErr.message);
    cohortSubmissionsMap = {};
  }

  // Fetch AtCoder submissions for all handles
  try {
    if (allCohortAtCoderHandles.length > 0) {
      cohortAtCoderMap = fetchCohortAtCoderSubmissions(allCohortAtCoderHandles) || {};
    }
  } catch (acFetchErr) {
    Logger.log('⚠️ Could not fetch AtCoder cohort submissions: ' + acFetchErr.message);
    cohortAtCoderMap = {};
  }
  Logger.log('⏱ Step 3 (Parallel Fetch) completed in ' + (Date.now() - stepStart) + 'ms — ' + Object.keys(cohortSubmissionsMap).length + ' CF handles, ' + Object.keys(cohortAtCoderMap).length + ' AtCoder handles fetched');

  // ── Step 4: Audit Each Student (Isolated Per Student) ──
  stepStart = Date.now();
  var allStudentStats = [];
  var cohortAnomalies = [];
  var cohortAppreciations = [];
  var cohortConcerns = [];
  var auditLogRowsToWrite = [];
  var allCohortLogs = [];

  for (var i = 0; i < studentSheets.length; i++) {
    var studentItem = studentSheets[i];
    var studentInfo = studentItem.studentInfo;
    var sheet = studentItem.sheet;

    try {
      // Build authoritative CF index for student's valid verified handles
      var studentCFHandles = sanitizeHandles(studentInfo.cfHandle, 'codeforces').filter(function(h) {
        return validatedHandlesMap[h] === true;
      });

      var cfIndex = buildAuthoritativeCFIndex(studentCFHandles, cohortSubmissionsMap);

      // Build AtCoder submission index for student
      var studentACHandles = sanitizeHandles(studentInfo.atCoderHandle, 'atcoder');
      var acIndex = buildAtCoderSubmissionIndex(studentACHandles, cohortAtCoderMap);

      // Single-pass sheet read: read columns 6 to 15 once to avoid redundant RPCs
      var lastRow = sheet.getLastRow();
      var hasHintCol = hasHintColumn(sheet);
      var preloadedData = lastRow >= 4 ? sheet.getRange(4, 6, lastRow - 3, 10).getValues() : [];

      // Read student log rows for the week using preloaded data
      var logRows = readStudentWeekLog(sheet, weekStart, weekEnd, preloadedData, hasHintCol);

      // Fetch previous week stats from memory map
      var prevWeekStats = prevStatsMap[studentInfo.matricId] || null;

      // Compute rolling 4-week average rating using preloaded data
      var rollingAvgRating = computeStudentRollingAvgRating(sheet, preloadedData);

      // Run authoritative audit (now includes AtCoder index)
      var audit = runStudentAudit(studentInfo, logRows, cfIndex, rollingAvgRating, prevWeekStats, weekStart, weekEnd, acIndex);

      allStudentStats.push(audit.stats);
      if (audit.anomalies.length > 0) {
        cohortAnomalies.push({ student: studentInfo, anomalies: audit.anomalies, stats: audit.stats });
      }
      if (audit.appreciations.length > 0) {
        cohortAppreciations.push({ student: studentInfo, notes: audit.appreciations });
      }
      if (audit.concerns.length > 0) {
        cohortConcerns.push({ student: studentInfo, notes: audit.concerns });
      }

      // Accumulate logs and rows for batch processing (including preloaded data)
      allCohortLogs.push({
        studentInfo: studentInfo,
        logRows: logRows,
        audit: audit,
        sheet: sheet,
        cfIndex: cfIndex,
        acIndex: acIndex,
        preloadedData: preloadedData,
        hasHintCol: hasHintCol
      });
      prepareAuditLogRows(auditLogRowsToWrite, weekStart, weekEnd, studentInfo, sheet, audit.anomalies, audit.stats);
    } catch (studentAuditErr) {
      Logger.log('⚠️ Error auditing student ' + (studentInfo.matricId || studentInfo.name || i) + ': ' + studentAuditErr.message);
    }
  }
  Logger.log('⏱ Step 4 (Student Audits) completed in ' + (Date.now() - stepStart) + 'ms — ' + allStudentStats.length + ' audited, ' + cohortAnomalies.length + ' with anomalies');

  // ── Step 4.5: Rating Progression & Weakness Analysis (Coaching Engine) ──
  stepStart = Date.now();
  var cohortCoachingSummaries = {};
  try {
    for (var ci = 0; ci < allCohortLogs.length; ci++) {
      var logEntry = allCohortLogs[ci];
      var stInfo = logEntry.studentInfo;
      var stSheet = logEntry.sheet;
      var stAudit = logEntry.audit;
      var stCfIdx = logEntry.cfIndex;

      var progressionAnalysis = analyzeRatingProgression(stSheet, stInfo, stCfIdx, cohortSubmissionsMap, cohortAtCoderMap, logEntry.preloadedData, logEntry.hasHintCol);
      var tagAnalysis = analyzeTagWeaknesses(stSheet, stInfo, stCfIdx, cohortSubmissionsMap, cohortAtCoderMap, progressionAnalysis.currentTier, logEntry.preloadedData, logEntry.hasHintCol);
      var coachingSummary = generateStudentCoachingSummary(progressionAnalysis, tagAnalysis, stAudit.stats, prevStatsMap[stInfo.matricId] || null);

      stAudit.coachingSummary = coachingSummary;
      cohortCoachingSummaries[stInfo.matricId] = coachingSummary;
    }
  } catch (coachErr) {
    Logger.log('⚠️ Coaching engine error: ' + coachErr.message);
  }
  Logger.log('⏱ Step 4.5 (Coaching Engine) completed in ' + (Date.now() - stepStart) + 'ms — ' + Object.keys(cohortCoachingSummaries).length + ' students analyzed');

  // ── Step 5: Bulk Write AuditLog Sheet (Isolated) ──
  stepStart = Date.now();
  try {
    if (auditLogRowsToWrite.length > 0) {
      // Prepend a prominent Weekly Audit Divider Banner
      var bannerRow = {
        isBanner: true,
        data: [
          formatDate(now) + ' ' + now.toLocaleTimeString(),
          formatDate(weekStart),
          formatDate(weekEnd),
          '── WEEK AUDIT ──',
          'Cohort Audit: ' + formatDate(weekStart) + ' to ' + formatDate(weekEnd),
          '',
          'WEEK_BANNER',
          'SECTION',
          'Weekly Cycle',
          'Audited ' + studentSheets.length + ' active students',
          '',
          '',
          allStudentStats.reduce(function(sum, s) { return sum + (s.totalTime || 0); }, 0),
          allStudentStats.reduce(function(sum, s) { return sum + (s.totalSolves || 0); }, 0),
          allStudentStats.length > 0 ? (typeof roundUp2 === 'function' ? roundUp2(allStudentStats.reduce(function(sum, s) { return sum + (s.avgRating || 0); }, 0) / allStudentStats.length) : Math.round(allStudentStats.reduce(function(sum, s) { return sum + (s.avgRating || 0); }, 0) / allStudentStats.length)) : ''
        ]
      };
      auditLogRowsToWrite.unshift(bannerRow);
    }
    bulkWriteAuditLog(ss, auditLogRowsToWrite);
  } catch (auditLogErr) {
    Logger.log('⚠️ Could not write to AuditLog sheet: ' + auditLogErr.message);
  }
  Logger.log('⏱ Step 5 (AuditLog Write) completed in ' + (Date.now() - stepStart) + 'ms — ' + auditLogRowsToWrite.length + ' rows written');

  // ── Step 6: History Sheet Update (Configurable Archive) ──
  var enableHistoryArchive = PropertiesService.getScriptProperties().getProperty('ENABLE_HISTORY_ARCHIVE');
  if (enableHistoryArchive === 'true' || (enableHistoryArchive !== 'false' && ss.getSheetByName('History'))) {
    try {
      updateHistoryWithAudit(ss, weekStart, weekEnd, allStudentStats, cohortAnomalies);
      Logger.log('✅ Step 6: History sheet updated with weekly archive.');
    } catch (histErr) {
      Logger.log('⚠️ Could not update History sheet: ' + histErr.message);
    }
  } else {
    Logger.log('ℹ️ Step 6: History archiving skipped (AuditLog is the authoritative ledger).');
  }

  // ── Step 7: Cohort Analytics & AI Insights (Isolated) ──
  stepStart = Date.now();
  var cohortAnalytics = null;
  var instructorAiReport = '';
  try {
    cohortAnalytics = aggregateCohortAnalytics(allCohortLogs, allStudentStats, cohortAnomalies);
    instructorAiReport = generateInstructorAIReport(cohortAnalytics, allStudentStats, cohortAnomalies, weekStart, weekEnd);
  } catch (aiErr) {
    Logger.log('⚠️ Could not generate AI cohort analytics: ' + aiErr.message);
    instructorAiReport = '';
  }
  Logger.log('⏱ Step 7 (AI Insights) completed in ' + (Date.now() - stepStart) + 'ms');

  // ── Step 8: Send Student Reports & Instructor Executive Digest (Selective & Quota-Protected) ──
  stepStart = Date.now();
  Logger.log('── Step 8: Starting Email Dispatch ──');
  var remainingQuota = 100;
  try {
    if (typeof MailApp !== 'undefined' && typeof MailApp.getRemainingDailyQuota === 'function') {
      remainingQuota = MailApp.getRemainingDailyQuota();
      Logger.log('Current MailApp remaining daily quota: ' + remainingQuota);
    }
  } catch (quotaErr) {
    Logger.log('Could not check remaining quota: ' + quotaErr.message);
  }

  // Pre-build O(1) index maps for cohort data (eliminates O(n²) .find() inside loop)
  var anomalyIndex = {};
  for (var ai = 0; ai < cohortAnomalies.length; ai++) {
    anomalyIndex[cohortAnomalies[ai].student.matricId] = cohortAnomalies[ai];
  }
  var statsIndex = {};
  for (var si = 0; si < allStudentStats.length; si++) {
    statsIndex[allStudentStats[si].matricId] = allStudentStats[si];
  }
  var appreciationIndex = {};
  for (var pi = 0; pi < cohortAppreciations.length; pi++) {
    appreciationIndex[cohortAppreciations[pi].student.matricId] = cohortAppreciations[pi].notes;
  }
  var concernIndex = {};
  for (var ci = 0; ci < cohortConcerns.length; ci++) {
    concernIndex[cohortConcerns[ci].student.matricId] = cohortConcerns[ci].notes;
  }

  var studentsToEmail = [];
  for (var j = 0; j < studentSheets.length; j++) {
    var currentStudent = studentSheets[j].studentInfo;
    var mid = currentStudent.matricId;
    var studentAuditEntry = anomalyIndex[mid] || null;
    var studentAnomalies = studentAuditEntry ? studentAuditEntry.anomalies : [];
    var studentStatsObj = statsIndex[mid] || null;
    var studentAppreciations = appreciationIndex[mid] || [];
    var studentConcerns = concernIndex[mid] || [];

    // Selective Trigger: Send if has anomaly alert, appreciation for betterment, concern, progression milestone update, or falling apart
    var stCoach = cohortCoachingSummaries[mid] || null;
    var hasProgressionUpdate = stCoach && (stCoach.progressionVerdict === 'READY_TO_ADVANCE' || stCoach.progressionVerdict === 'HINT_DEPENDENT');
    var isFallingApart = (studentStatsObj && studentStatsObj.totalSolves === 0) || studentConcerns.length >= 2;
    var hasTrigger = studentAnomalies.length > 0 || studentAppreciations.length > 0 || studentConcerns.length > 0 || isFallingApart || hasProgressionUpdate;

    var studentEmails = sanitizeEmailList(currentStudent.email || currentStudent.rawEmail);
    if (!studentEmails) {
      Logger.log('Skipping student ' + (currentStudent.name || currentStudent.matricId) + ': missing/invalid email (' + (currentStudent.email || currentStudent.rawEmail || 'none') + ')');
      continue;
    }

    if (!hasTrigger) {
      Logger.log('Skipping student ' + currentStudent.name + ': steady/clean week without anomalies or shifts');
      continue;
    }

    studentsToEmail.push({
      student: currentStudent,
      emails: studentEmails,
      stats: studentStatsObj,
      anomalies: studentAnomalies,
      appreciations: studentAppreciations,
      concerns: studentConcerns,
      coachingSummary: stCoach
    });
  }

  // Generate ALL student coaching notes in 1 single batch LLM call (conserves 95% of RPD & respects RPM)
  var batchAiNotes = generateCohortStudentAICoachingBatch(studentsToEmail);

  for (var k = 0; k < studentsToEmail.length; k++) {
    var emailItem = studentsToEmail[k];
    if (remainingQuota <= 1) {
      Logger.log('Email daily quota low (' + remainingQuota + ' remaining). Reserving quota for instructor digest.');
      break;
    }

    try {
      var studentAiNote = batchAiNotes[emailItem.student.matricId] || getFallbackStudentCoaching(emailItem.stats, emailItem.anomalies);
      var studentCoaching = cohortCoachingSummaries[emailItem.student.matricId] || null;
      sendStudentWeeklyReportEmail(emailItem.student, emailItem.anomalies, emailItem.stats, emailItem.appreciations, emailItem.concerns, studentAiNote, weekStart, weekEnd, studentCoaching);
      remainingQuota--;
    } catch (studentMailErr) {
      Logger.log('Could not send student email to ' + emailItem.emails + ': ' + studentMailErr.message);
    }
  }

  // Send Admin Cohort Digest with AI Observations, Tag Analysis, and Draft Lesson Plan
  try {
    sendInstructorDigestEmail(cohortAnomalies, cohortAppreciations, cohortConcerns, allStudentStats, cohortAnalytics, instructorAiReport, weekStart, weekEnd, ss, cohortCoachingSummaries);
  } catch (instMailErr) {
    Logger.log('Could not send admin digest email: ' + instMailErr.message);
  }
  Logger.log('⏱ Step 8 (Email Dispatch) completed in ' + (Date.now() - stepStart) + 'ms — ' + studentsToEmail.length + ' student emails sent');
  Logger.log('═══ AUDIT COMPLETE — Total elapsed: ' + (Date.now() - auditStartMs) + 'ms ═══');
  } finally {
    if (hasLock) {
      lock.releaseLock();
    }
  }
}
