/**
 * ═══════════════════════════════════════════════════════════════════
 * AuditStorage.gs — Google Sheets Batch I/O & General Utilities
 *
 * RESPONSIBILITIES:
 * - Cohort roster loading & active student sheet discovery
 * - Student week log reading (including Hint? column detection)
 * - Audit log rows preparation & bulk insertion
 * - History sheet updates with weekly audit summary
 * - Shared string, date, and validation utilities
 * ═══════════════════════════════════════════════════════════════════
 */

/* ═══════════════════════════════════════════════════════════════════
   BATCH SPREADSHEET READS & WRITES
   ═══════════════════════════════════════════════════════════════════ */

/**
 * Load entire cohort roster in a single read.
 */
function loadCohortRoster(ss) {
  var rosterSheet = ss.getSheetByName('Roster');
  var map = {};
  if (!rosterSheet) return map;

  var data = rosterSheet.getDataRange().getValues();
  if (data.length < 2) return map;

  // Header detection with fallback to user's layout:
  // Col A(0): Email, Col B(1): Matric ID, Col C(2): Name, Col D(3): CF Handle,
  // Col E(4): LeetCode Handle, Col F(5): Atcoder Handle, Col G(6): Role
  var headers = data[0].map(function(h) { return String(h || '').toLowerCase().trim(); });
  var colEmail = headers.indexOf('email');
  var colMatric = headers.indexOf('matric id');
  if (colMatric === -1) colMatric = headers.indexOf('matric');
  var colName = headers.indexOf('name');
  var colCF = headers.indexOf('cf handle');
  if (colCF === -1) colCF = headers.indexOf('cf');
  var colLC = headers.indexOf('leetcode handle');
  if (colLC === -1) colLC = headers.indexOf('leetcode');
  var colAC = headers.indexOf('atcoder handle');
  if (colAC === -1) colAC = headers.indexOf('atcoder');
  var colRole = headers.indexOf('role');

  if (colEmail === -1) colEmail = 0;
  if (colMatric === -1) colMatric = 1;
  if (colName === -1) colName = 2;
  if (colCF === -1) colCF = 3;
  if (colLC === -1) colLC = 4;
  if (colAC === -1) colAC = 5; // Column F: Atcoder Handle
  if (colRole === -1) colRole = 6; // Column G: Role

  for (var i = 1; i < data.length; i++) {
    var matricId = String(data[i][colMatric] || '').trim();
    if (!matricId) continue;

    var rawEmail = String(data[i][colEmail] || '').trim();
    map[matricId] = {
      email: sanitizeEmailList(rawEmail),
      rawEmail: rawEmail,
      matricId: matricId,
      name: String(data[i][colName] || '').trim(),
      cfHandle: String(data[i][colCF] || '').trim(),
      leetCodeHandle: String(data[i][colLC] || '').trim(),
      atCoderHandle: String(data[i][colAC] || '').trim(),
      role: String(data[i][colRole] || '').trim()
    };
  }

  return map;
}

/**
 * Load previous week stats for all students in a single scan.
 */
function loadPreviousWeekStatsMap(ss) {
  var map = {};
  var auditLog = ss.getSheetByName('AuditLog');
  if (!auditLog) return map;

  var data = auditLog.getDataRange().getValues();
  for (var i = data.length - 1; i >= 1; i--) {
    var rawMatricId = String(data[i][3] || '').trim();
    var rowMatricId = extractMatricId(rawMatricId);
    var rowType = String(data[i][6] || '').trim();

    if (rowMatricId && rowType === 'WEEK_SUMMARY' && !map[rowMatricId]) {
      map[rowMatricId] = {
        totalTime: toNum(data[i][12]),
        totalSolves: toNum(data[i][13]),
        avgRating: toNum(data[i][14])
      };
    }
  }

  return map;
}

function extractMatricId(val) {
  var s = String(val || '').trim();
  if (s.startsWith('=')) {
    var match = s.match(/,\s*"([^"]+)"\s*\)/);
    if (match) return match[1].trim();
  }
  return s;
}

/**
 * Filter active student sheets corresponding to roster.
 */
function getActiveStudentSheets(ss, rosterMap) {
  var sheets = ss.getSheets();
  var result = [];

  for (var i = 0; i < sheets.length; i++) {
    var sh = sheets[i];
    var name = sh.getName();
    if (isSystemSheet(name)) continue;

    var student = rosterMap[name];
    if (student && student.matricId && String(student.role || '').toLowerCase().trim() !== 'admin') {
      result.push({ sheet: sh, studentInfo: student });
    }
  }

  return result;
}

/**
 * Check whether a sheet has the 'Hint?' column at Row 2, Column 13.
 * Dynamic detection guarantees full backward compatibility with legacy sheets.
 * @param {Sheet} sheet - Target sheet.
 * @returns {boolean}
 */
function hasHintColumn(sheet) {
  try {
    var header = String(sheet.getRange(2, 13).getValue() || '').trim().toLowerCase();
    return header.indexOf('hint') !== -1;
  } catch (e) {
    return false;
  }
}

/**
 * Determine if a raw value in the 'Hint?' column indicates hint or editorial usage.
 * Handles strings ('yes', 'y', 'hint', 'editorial', etc.), numbers (1), and booleans (true).
 * @param {*} val - Raw cell value.
 * @returns {boolean} True if hint was used.
 */
function isHintPresent(val) {
  if (val === true || val === 1) return true;
  if (!val) return false;
  var s = String(val).trim().toLowerCase();
  if (!s) return false;
  return /^(yes|y|true|1|hint|editorial|solution|sol|check|checked)$/i.test(s) ||
         s.indexOf('hint') !== -1 ||
         s.indexOf('editorial') !== -1 ||
         s.indexOf('yes') !== -1;
}

/**
 * Read student log rows for the week in a single 2D range read.
 * Dynamically adjusts column mapping if 'Hint?' column (Col 13) is present.
 */
function readStudentWeekLog(sheet, weekStart, weekEnd) {
  var lastRow = sheet.getLastRow();
  var rows = [];
  if (lastRow < 4) return rows;

  var hasHintCol = hasHintColumn(sheet);
  // Read columns F(6) through O(15) (10 columns):
  // When Hint? is present (Col 13 / M):
  // Col 6(F): Link, 7(G): Verdict, 8(H): Subs, 9(I): Time, 10(J): Date, 11(K): Category, 12(L): Rating, 13(M): Hint?, 14(N): Comment, 15(O): Status
  // Legacy layout (no Hint?):
  // Col 13(M): Comment, 14(N): Status, 15(O): Note
  var data = sheet.getRange(4, 6, lastRow - 3, 10).getValues();

  for (var r = 0; r < data.length; r++) {
    var rowNum = r + 4;
    var row = data[r];
    var link = String(row[0] || '').trim();
    if (!link) continue;

    var rowDate = parseDate(row[4]); // Col J: Date
    if (!rowDate || rowDate < weekStart || rowDate > weekEnd) continue;

    var parsed = parseProblemServerInput(link);
    if (parsed.platform === 'codeforces_unsupported') continue;

    var rawHintVal = hasHintCol ? row[7] : '';
    var hintUsed = isHintPresent(rawHintVal);
    var commentVal = hasHintCol ? String(row[8] || '').trim() : String(row[7] || '').trim();
    var verStatusVal = hasHintCol ? String(row[9] || '').trim() : String(row[8] || '').trim();
    var verNoteVal = hasHintCol ? '' : String(row[9] || '').trim();

    rows.push({
      rowNum: rowNum,
      link: link,
      verdict: String(row[1] || '').toUpperCase().trim(),
      claimedSubs: toNum(row[2]),
      time: toNum(row[3]),
      date: rowDate,
      category: String(row[5] || '').trim(),
      rating: toNum(row[6]),
      rawHint: rawHintVal,
      hasHint: hintUsed,
      comment: commentVal,
      verStatus: verStatusVal,
      verNote: verNoteVal,
      platform: parsed.platform,
      contestId: parsed.contestId,
      problemIndex: parsed.problemIndex,
      problemId: parsed.problemId || '',
      titleSlug: parsed.titleSlug,
      canonicalName: parsed.canonicalName || link
    });
  }

  return rows;
}

/**
 * Compute student rolling 4-week average rating from all historical rows.
 */
function computeStudentRollingAvgRating(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 4) return 1000;

  var data = sheet.getRange(4, 11, lastRow - 3, 2).getValues(); // Cols K(Category), L(Rating)
  var sum = 0, count = 0;

  for (var i = 0; i < data.length; i++) {
    var cat = String(data[i][0] || '');
    var rating = toNum(data[i][1]);
    if (rating > 0 && (cat === 'Codeforces' || cat === '')) {
      sum += rating;
      count++;
    }
  }

  return count > 0 ? (sum / count) : 1000;
}


/**
 * Prepare audit log rows in memory for bulk insertion.
 * Formats Matric ID as a clickable hyperlink to the student's sheet tab.
 */
function prepareAuditLogRows(collector, weekStart, weekEnd, studentInfo, studentSheet, anomalies, stats) {
  var nowStr = formatDate(new Date()) + ' ' + new Date().toLocaleTimeString();
  var weekStartStr = formatDate(weekStart);
  var weekEndStr = formatDate(weekEnd);

  var matricIdDisplay = studentInfo.matricId;
  if (studentSheet && typeof studentSheet.getSheetId === 'function') {
    matricIdDisplay = '=HYPERLINK("#gid=' + studentSheet.getSheetId() + '", "' + studentInfo.matricId + '")';
  }

  // Summary Row
  collector.push({
    isSummary: true,
    data: [
      nowStr, weekStartStr, weekEndStr, matricIdDisplay, studentInfo.name, '', 'WEEK_SUMMARY', '', '', '', '', '',
      stats.totalTime, stats.totalSolves, stats.avgRating
    ]
  });

  // Anomaly Detail Rows
  for (var i = 0; i < anomalies.length; i++) {
    var a = anomalies[i];
    var detailText = String(a.detail || '');
    var linksText = (Array.isArray(a.links) && a.links.length > 0) ? a.links.join(' | ') : '';
    if (linksText) detailText += (detailText ? ' | ' : '') + linksText;

    collector.push({
      isSummary: false,
      severity: a.severity,
      data: [
        nowStr, weekStartStr, weekEndStr, matricIdDisplay, studentInfo.name, a.rowNum, a.type, a.severity, a.problem,
        detailText, a.rating, a.time, '', '', ''
      ]
    });
  }
}

/**
 * Bulk write accumulated audit log rows to AuditLog sheet in a single operation.
 */
function bulkWriteAuditLog(ss, rowsToWrite) {
  if (!rowsToWrite || rowsToWrite.length === 0) return;

  var sheet = ss.getSheetByName('AuditLog');
  if (!sheet) {
    sheet = ss.insertSheet('AuditLog');
    sheet.setFrozenRows(1);
    sheet.appendRow([
      'Timestamp', 'WeekStart', 'WeekEnd', 'MatricId', 'Name', 'RowNum',
      'Type', 'Severity', 'Problem', 'Detail', 'Rating', 'Time', 'TotalTime', 'TotalSolves', 'AvgRating'
    ]);
    sheet.getRange(1, 1, 1, 15)
      .setFontWeight('bold')
      .setBackground('#1e293b')
      .setFontColor('#f8fafc')
      .setBorder(true, true, true, true, true, true, '#334155', SpreadsheetApp.BorderStyle.SOLID);
  }

  var numRows = rowsToWrite.length;
  var numCols = 15;
  sheet.insertRows(2, numRows);

  var values = rowsToWrite.map(function(r) { return r.data; });
  var range = sheet.getRange(2, 1, numRows, numCols);
  range.setValues(values);

  // Build 2D styling matrices for batch RPC (3 calls vs N×3+ per-row calls)
  var bgMatrix = [];
  var weightMatrix = [];
  var colorMatrix = [];

  for (var i = 0; i < rowsToWrite.length; i++) {
    var item = rowsToWrite[i];
    var bgRow = [];
    var weightRow = [];
    var colorRow = [];

    if (item.isBanner) {
      for (var c = 0; c < numCols; c++) {
        bgRow.push('#0f172a');
        weightRow.push('bold');
        colorRow.push((c === 3 || c === 6) ? '#38bdf8' : '#f8fafc');
      }
    } else if (item.isSummary) {
      for (var c2 = 0; c2 < numCols; c2++) {
        bgRow.push('#e0e7ff');
        weightRow.push('bold');
        colorRow.push(c2 === 6 ? '#3730a3' : '#1e1b4b');
      }
    } else {
      var bg = '#f8fafc';
      var sevColor = '#2563eb';
      if (item.severity === 'FLAGGED') {
        bg = '#fef2f2';
        sevColor = '#dc2626';
      } else if (item.severity === 'SUSPICIOUS') {
        bg = '#fffbeb';
        sevColor = '#d97706';
      }

      for (var c3 = 0; c3 < numCols; c3++) {
        bgRow.push(bg);
        weightRow.push((c3 === 6 || c3 === 7) ? 'bold' : 'normal');
        colorRow.push(c3 === 7 ? sevColor : '#334155');
      }
    }

    bgMatrix.push(bgRow);
    weightMatrix.push(weightRow);
    colorMatrix.push(colorRow);
  }

  // Apply all styling in 3 bulk RPC calls instead of N×3+
  range.setBackgrounds(bgMatrix);
  range.setFontWeights(weightMatrix);
  range.setFontColors(colorMatrix);

  // Add a bold bottom divider line below this week's batch to clearly separate it from prior weeks
  if (rowsToWrite.length > 0) {
    sheet.getRange(1 + rowsToWrite.length, 1, 1, 15)
      .setBorder(null, null, true, null, null, null, '#0f172a', SpreadsheetApp.BorderStyle.SOLID_THICK);
  }

  sheet.setFrozenRows(1);
}

/**
 * Bulk update History sheet with weekly audit overview block.
 */
function updateHistoryWithAudit(ss, weekStart, weekEnd, allStats, cohortAnomalies) {
  var source = ss.getSheetByName('Overview');
  var target = ss.getSheetByName('History');
  if (!target || !source) return;

  var lastCol = target.getLastColumn();
  var startColIndex = lastCol + 2;
  var c0 = getColumnString(startColIndex);
  var c6 = getColumnString(startColIndex + 6);

  // Headers
  target.getRange(c0 + '1').setValue('Weekly Audit — ' + formatDate(weekStart));
  target.getRange(c0 + '1:' + c6 + '1').setFontWeight('bold').setBackground('#1e293b').setFontColor('#f8fafc');
  target.getRange(c0 + '2').setValue('To ' + formatDate(weekEnd));
  target.getRange(c0 + '2:' + c6 + '2').setFontWeight('normal').setBackground('#f8fafc').setFontColor('#475569');

  var hdrs = ['SL', 'ID', 'Name', 'Weekly Time', 'Status', 'Anomalies', 'Note'];
  for (var h = 0; h < hdrs.length; h++) {
    target.getRange(getColumnString(startColIndex + h) + '3').setValue(hdrs[h]).setFontWeight('bold').setBackground('#f1f5f9');
  }

  // Build anomaly lookup
  var anomalyMap = {};
  for (var a = 0; a < cohortAnomalies.length; a++) {
    anomalyMap[cohortAnomalies[a].student.matricId] = cohortAnomalies[a].anomalies;
  }

  // Read Overview rows 3-40 in one single call
  var overviewRows = source.getRange('K3:N40').getValues();
  var historyMatrix = [];

  for (var r = 0; r < overviewRows.length; r++) {
    var sl = overviewRows[r][0];
    var id = String(overviewRows[r][1] || '').trim();
    var name = overviewRows[r][2];
    var time = overviewRows[r][3];

    if (!id) {
      historyMatrix.push(['', '', '', '', '', '', '']);
      continue;
    }

    var anoms = anomalyMap[id];
    var statusText = '✅ Clean';
    var countText = '0';
    var noteText = 'No anomalies';

    if (anoms && anoms.length > 0) {
      var flaggedCount = anoms.filter(function(x) { return x.severity === 'FLAGGED'; }).length;
      statusText = flaggedCount > 0 ? '🚩 Review' : '⚠️ Suspicious';
      countText = anoms.length + (flaggedCount > 0 ? ' (' + flaggedCount + ' flagged)' : '');
      noteText = anoms.map(function(x) { return x.type; }).slice(0, 3).join(', ');
    }

    historyMatrix.push([sl, id, name, time, statusText, countText, noteText]);
  }

  target.getRange(3, startColIndex, historyMatrix.length, 7).setValues(historyMatrix);
}


/* ═══════════════════════════════════════════════════════════════════
   GENERAL UTILITY HELPERS
   ═══════════════════════════════════════════════════════════════════ */

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

/**
 * Sanitize and extract all valid email addresses from a string.
 * Supports comma, space, semicolon, or newline separated emails.
 * Deduplicates and returns a clean comma-separated list of valid emails.
 * (e.g. "nh2826239@gmail.com, c201018@ugrad.iiuc.ac.bd").
 */
function sanitizeEmailList(rawEmail) {
  if (!rawEmail) return '';
  var tokens = String(rawEmail).split(/[\s,;]+/);
  var validList = [];
  var seen = {};
  for (var i = 0; i < tokens.length; i++) {
    var email = tokens[i].trim();
    if (email && isValidEmail(email) && !seen[email.toLowerCase()]) {
      seen[email.toLowerCase()] = true;
      validList.push(email);
    }
  }
  return validList.join(', ');
}

function parseDate(v) {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  var d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function formatDate(d) {
  if (!d) return '';
  var dt = (d instanceof Date) ? d : new Date(d);
  if (isNaN(dt.getTime())) return '';
  return (dt.getMonth() + 1) + '/' + dt.getDate() + '/' + dt.getFullYear();
}

function escHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function isSystemSheet(name) {
  var sys = ['Overview', 'Heatmap (Time)', 'Heatmap (Solve Count)', 'History', 'Roster', 'Individual Copy', 'Template', 'ErrorLog', 'AuditLog'];
  return sys.indexOf(name) !== -1;
}

function getColumnString(columnNumber) {
  var columnName = '';
  while (columnNumber > 0) {
    var remainder = (columnNumber - 1) % 26;
    columnName = String.fromCharCode(65 + remainder) + columnName;
    columnNumber = Math.floor((columnNumber - 1) / 26);
  }
  return columnName;
}

/**
 * Compute daily variance of log rows to detect bursty vs consistent practice patterns.
 * Returns standard deviation of daily solve counts.
 * Low values (< 1.5) indicate consistent daily practice.
 * High values (> 4) indicate bursty, concentrated sessions.
 * @param {Object[]} logRows - Student log rows for the week.
 * @returns {number} Standard deviation of daily solve distribution.
 */