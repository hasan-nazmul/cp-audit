/**
 * ═══════════════════════════════════════════════════════════════════
 * Code.gs — Main Entry Point for Apps Script Web App & Triggers
 * Routes doGet / doPost to appropriate handlers and manages onEdit.
 * ═══════════════════════════════════════════════════════════════════
 */

/**
 * Handle GET requests (read-only endpoints).
 * URL: ?action=getOverview | getHeatmap&sheet=Time | getStudentProfile&matricId=... | getHistory&matricId=... | getSuggestions&matricId=...
 */
function doGet(e) {
  try {
    var action = (e && e.parameter && e.parameter.action) || '';

    switch (action) {
      case 'getOverview':
        return jsonResponse(typeof handleGetOverview === 'function' ? handleGetOverview() : { status: 'OK' });

      case 'getHeatmap':
        return jsonResponse(typeof handleGetHeatmap === 'function' ? handleGetHeatmap(e.parameter.sheet || 'Time') : { status: 'OK' });

      case 'getStudentProfile':
        if (!e.parameter.matricId) return errorResponse('matricId is required', 400);
        return jsonResponse(typeof handleGetStudentProfile === 'function' ? handleGetStudentProfile(e.parameter.matricId) : { status: 'OK' });

      case 'getHistory':
        if (!e.parameter.matricId) return errorResponse('matricId is required', 400);
        return jsonResponse(typeof handleGetHistory === 'function' ? handleGetHistory(e.parameter.matricId || '') : { status: 'OK' });

      case 'getSuggestions':
        if (!e.parameter.matricId) return errorResponse('matricId is required', 400);
        return jsonResponse(typeof handleGetSuggestions === 'function' ? handleGetSuggestions(e.parameter.matricId) : { status: 'OK' });

      default:
        return errorResponse('Unknown action: ' + action, 400);
    }
  } catch (err) {
    if (typeof logSystemError === 'function') {
      logSystemError('doGet:' + ((e && e.parameter && e.parameter.action) || 'unknown'), (e && e.parameter && e.parameter.matricId) || 'N/A', err, e && e.parameter);
    }
    return errorResponse(err.message || 'Internal server error', 500);
  }
}

/**
 * Handle POST requests (auth + mutations).
 * Body: { action, idToken, ... }
 */
function doPost(e) {
  var body = {};
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var action = body.action || '';

    switch (action) {
      case 'verifyLogin':
        return jsonResponse(typeof handleVerifyLogin === 'function' ? handleVerifyLogin(body.idToken) : { authenticated: true });

      case 'addProblem': {
        var user = typeof authorizeRequest === 'function' ? authorizeRequest(body.idToken, body.matricId) : null;
        return jsonResponse(typeof handleAddProblem === 'function' ? handleAddProblem(body.matricId, body.problemData, user) : { success: true });
      }

      case 'addStudy': {
        var userStudy = typeof authorizeRequest === 'function' ? authorizeRequest(body.idToken, body.matricId) : null;
        return jsonResponse(typeof handleAddStudy === 'function' ? handleAddStudy(body.matricId, body.studyData, userStudy) : { success: true });
      }

      default:
        return errorResponse('Unknown action: ' + action, 400);
    }
  } catch (err) {
    if (typeof logSystemError === 'function') {
      logSystemError('doPost:' + (body.action || 'unknown'), body.matricId || 'N/A', err, body);
    }
    return errorResponse(err.message || 'Internal server error', 500);
  }
}

// ─── Response Helpers ──────────────────────────────────────────────

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function errorResponse(message, code) {
  return ContentService
    .createTextOutput(JSON.stringify({ error: message, code: code || 500 }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ─── INSTALLABLE onEdit Trigger ────────────────────────────────────

function onEditInstallable(e) {
  if (!e || !e.range) return;

  try {
    var range = e.range;
    var sheet = range.getSheet();
    var sheetName = sheet.getName();

    // Skip system sheets
    if (isSystemSheet(sheetName)) return;

    var row = range.getRow();
    var col = range.getColumn();

    // Trigger only on Problem Link (Column F = 6), rows 4+
    if (row < 4 || col !== 6) return;

    var problemLink = String(e.value || '').trim();
    if (!problemLink || problemLink === String(e.oldValue || '').trim()) return;

    // Dynamic status column detection based on Hint? schema
    var statusCol = getStatusColumnIndex(sheet);

    // Single-pass read of the row slice (from F up to statusCol)
    var numCols = statusCol - 6 + 1;
    var rowSlice = sheet.getRange(row, 6, 1, numCols).getValues()[0];
    var existingStatus = String(rowSlice[statusCol - 6] || '').trim();

    // Skip if already processed
    if (existingStatus && existingStatus !== 'PENDING') return;

    // Mark as pending (single range access to reduce RPC calls)
    sheet.getRange(row, statusCol).setValue('PENDING').setNote('Verifying with OJ server...');

    // Lookup student in Roster
    var studentInfo = getStudentInfoFromRoster(sheetName);
    if (!studentInfo) {
      markAuditRow(sheet, row, 'NO_ROSTER', 'Matric ID not found in Roster sheet');
      return;
    }

    var manualVerdict = rowSlice[1]; // Col G
    var manualSubs = rowSlice[2];    // Col H

    // Authoritative verification via Verifier.gs
    var result = verifyProblemServer(problemLink, studentInfo, sheet, manualVerdict, manualSubs);

    // Apply verification to row
    applyVerificationToRow(sheet, row, result);

  } catch (err) {
    Logger.log('onEdit error: ' + err.message);
    if (e && e.range) {
      try {
        var errRow = e.range.getRow();
        markAuditRow(e.range.getSheet(), errRow, 'ERROR', err.message || 'Verification error');
      } catch (me) { /* ignore */ }
    }
  }
}

/**
 * Get the status column index (1-indexed).
 * Column 15 (O) if Column 13 (M) is "Hint?", otherwise Column 14 (N).
 */
function getStatusColumnIndex(sheet) {
  try {
    var h13 = String(sheet.getRange(2, 13).getValue() || '').toLowerCase().trim();
    if (h13 === 'hint?' || h13 === 'hint') {
      return 15; // Column O
    }
  } catch (e) { /* ignore */ }
  return 14; // Column N (legacy schema)
}

// ─── Roster Lookup ─────────────────────────────────────────────────

function getStudentInfoFromRoster(matricId) {
  if (!matricId) return null;
  var targetId = String(matricId).trim();

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var roster = ss.getSheetByName('Roster');
  if (!roster) return null;

  var data = roster.getDataRange().getValues();
  if (data.length < 2) return null;

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
    if (String(data[i][colMatric] || '').trim() === targetId) {
      return {
        email: String(data[i][colEmail] || '').trim(),
        matricId: String(data[i][colMatric] || '').trim(),
        name: String(data[i][colName] || '').trim(),
        cfHandle: String(data[i][colCF] || '').trim(),
        leetCodeHandle: String(data[i][colLC] || '').trim(),
        atCoderHandle: String(data[i][colAC] || '').trim(),
        role: String(data[i][colRole] || '').trim()
      };
    }
  }
  return null;
}

// ─── Apply Verification Result to Row ──────────────────────────────

function applyVerificationToRow(sheet, row, result) {
  var status = 'UNKNOWN';
  var note = result.verificationType || 'Unknown';
  var bg = '#f8fafc';
  var font = '#334155';

  if (result.verificationType === 'CODEFORCES_API' || result.verificationType === 'LEETCODE_GRAPHQL' || result.verificationType === 'ATCODER_API') {
    status = 'VERIFIED';
    note = '✓ Auto-verified via ' + result.verificationType;
    bg = '#ecfdf5';
    font = '#065f46';

    // Update row with authoritative API values
    sheet.getRange(row, 7).setValue(result.verdict);          // G: Verdict
    sheet.getRange(row, 8).setValue(result.submissionCount);  // H: Subs
    sheet.getRange(row, 11).setValue(result.category);        // K: Category
    sheet.getRange(row, 12).setValue(result.rating);          // L: Rating

  } else if (result.verificationType === 'MANUAL') {
    status = 'MANUAL';
    note = '⚠ Manual platform (' + result.category + '). Max 5/day.';
    bg = '#fffbeb';
    font = '#92400e';

  } else if (result.verificationType === 'PENDING_REVIEW' || result.verificationType === 'LEETCODE_FALLBACK') {
    status = 'PENDING_REVIEW';
    note = '✕ Could not auto-verify on registered handle. ' + result.verificationType;
    bg = '#fef2f2';
    font = '#991b1b';
  }

  var statusCol = getStatusColumnIndex(sheet);
  sheet.getRange(row, statusCol).setValue(status).setNote(note);
  sheet.getRange(row, 6, 1, statusCol - 6).setBackground(bg).setFontColor(font);
}

function markAuditRow(sheet, row, status, note) {
  var statusCol = getStatusColumnIndex(sheet);
  sheet.getRange(row, statusCol).setValue(status).setNote(note);
  sheet.getRange(row, 6, 1, statusCol - 6).setBackground('#fef2f2').setFontColor('#991b1b');
}
