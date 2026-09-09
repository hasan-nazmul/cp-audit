/**
 * ═══════════════════════════════════════════════════════════════════
 * AuditReports.gs — Email Report Dispatcher & Recipient Resolution
 *
 * RESPONSIBILITIES:
 * - Dispatch student weekly progress & anomaly report email
 * - Dispatch instructor executive weekly digest email
 * - Admin/Instructor recipient resolution from Roster and Script Properties
 *
 * Presentation and HTML template rendering are decoupled in ReportRenderer.gs.
 * ═══════════════════════════════════════════════════════════════════
 */

/**
 * Send weekly report email to student.
 * Uses ReportRenderer.gs to generate the modern responsive HTML body.
 *
 * @param {Object} studentInfo
 * @param {Array} anomalies
 * @param {Object} stats
 * @param {Array} appreciations
 * @param {Array} concerns
 * @param {string} aiNote
 * @param {Date} weekStart
 * @param {Date} weekEnd
 * @param {Object} [coachingSummary]
 */
function sendStudentWeeklyReportEmail(studentInfo, anomalies, stats, appreciations, concerns, aiNote, weekStart, weekEnd, coachingSummary) {
  var flagged = (anomalies || []).filter(function(a) { return a.severity === 'FLAGGED'; });
  var isClean = (anomalies || []).length === 0;

  var subject = isClean
    ? '🌟 CSE-1230 Weekly Report: Outstanding Verified Progress (' + formatDate(weekStart) + ' – ' + formatDate(weekEnd) + ')'
    : (flagged.length > 0
        ? '⚠️ CSE-1230 Weekly Audit Alert: Verification Discrepancies (' + formatDate(weekStart) + ' – ' + formatDate(weekEnd) + ')'
        : '📋 CSE-1230 Weekly Practice Audit & Coaching Notes (' + formatDate(weekStart) + ' – ' + formatDate(weekEnd) + ')');

  // Render HTML via dedicated presentation engine
  var html = renderStudentEmailHtml(studentInfo, anomalies, stats, appreciations, concerns, aiNote, weekStart, weekEnd, coachingSummary);

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
    Logger.log('✅ Sent weekly report email to student: ' + targetEmails);
  } catch (e) {
    Logger.log('❌ Could not send student report to ' + targetEmails + ': ' + e.message);
  }
}

/**
 * Extract all unique admin email addresses from Script Properties or Roster sheet.
 * @param {Spreadsheet} [ss] - The active spreadsheet.
 * @returns {string} Comma-separated list of valid, deduplicated admin emails.
 */
function getAdminRecipientsFromRoster(ss) {
  var adminMap = {};

  // 1. First priority: INSTRUCTOR_EMAIL property from Script Properties
  try {
    if (typeof PropertiesService !== 'undefined' && PropertiesService.getScriptProperties) {
      var scriptProp = PropertiesService.getScriptProperties().getProperty('INSTRUCTOR_EMAIL') ||
                       PropertiesService.getScriptProperties().getProperty('INSTRUCTOR_EMAILS') || '';
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
 * Send executive cohort digest email to admins.
 * Uses ReportRenderer.gs to generate the modern responsive HTML body.
 *
 * @param {Array} cohortAnomalies
 * @param {Array} cohortAppreciations
 * @param {Array} cohortConcerns
 * @param {Array} allStats
 * @param {Object} cohortAnalytics
 * @param {string} instructorAiReport
 * @param {Date} weekStart
 * @param {Date} weekEnd
 * @param {Spreadsheet} ss
 * @param {Object} [cohortCoachingSummaries]
 */
function sendInstructorDigestEmail(cohortAnomalies, cohortAppreciations, cohortConcerns, allStats, cohortAnalytics, instructorAiReport, weekStart, weekEnd, ss, cohortCoachingSummaries) {
  var adminEmails = getAdminRecipientsFromRoster(ss);
  if (!adminEmails) {
    Logger.log('⚠️ No admin/instructor emails found in Script Properties or Roster to send digest.');
    return;
  }

  var subject = '📊 CSE-1230 Executive Audit Digest & Lesson Plan: ' + formatDate(weekStart) + ' – ' + formatDate(weekEnd);

  // Render HTML via dedicated presentation engine
  var html = renderInstructorDigestEmailHtml(cohortAnomalies, cohortAppreciations, cohortConcerns, allStats, cohortAnalytics, instructorAiReport, weekStart, weekEnd, ss, cohortCoachingSummaries);

  try {
    MailApp.sendEmail({
      to: adminEmails,
      subject: subject,
      htmlBody: html,
      name: 'CSE-1230 Tracker'
    });
    Logger.log('✅ Sent executive audit digest email to: ' + adminEmails);
  } catch (e) {
    Logger.log('❌ Could not send admin digest email to ' + adminEmails + ': ' + e.message);
  }
}
