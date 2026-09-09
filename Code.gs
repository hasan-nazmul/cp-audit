/**
 * ═══════════════════════════════════════════════════════════════════
 * Code.gs — Main Entry Point for Google Sheets Installable Triggers
 * Manages onEdit triggers, roster cache, and real-time OJ verification.
 * ═══════════════════════════════════════════════════════════════════
 */

// ─── INSTALLABLE onEdit Trigger ────────────────────────────────────

function onEditInstallable(e) {
  if (!e || !e.range) return;

  var lock = LockService.getDocumentLock();
  var hasLock = false;

  try {
    // Acquire lock to prevent race conditions during rapid cell edits
    hasLock = lock.tryLock(5000);
    if (!hasLock) {
      Logger.log('⚠️ Could not obtain document lock for onEditInstallable; skipping concurrent trigger.');
      return;
    }

    var range = e.range;
    var sheet = range.getSheet();
    var sheetName = sheet.getName();

    // If Roster was edited, invalidate cached roster data
    if (sheetName.toLowerCase() === 'roster') {
      invalidateRosterCache();
      return;
    }

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

    // Lookup student in Roster (cached)
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
  } finally {
    if (hasLock) {
      lock.releaseLock();
    }
  }
}

/**
 * Get the status column index (1-indexed).
 * Aligned with hasHintColumn: Column 15 (O) if "Hint?" exists, otherwise Column 14 (N).
 */
function getStatusColumnIndex(sheet) {
  try {
    if (typeof hasHintColumn === 'function') {
      return hasHintColumn(sheet) ? 15 : 14;
    }
    var h13 = String(sheet.getRange(2, 13).getValue() || '').toLowerCase().trim();
    if (h13.indexOf('hint') !== -1) {
      return 15; // Column O
    }
  } catch (e) { /* ignore */ }
  return 14; // Column N (legacy schema)
}

// ─── Roster Lookup (with CacheService & Memory Cache) ──────────────

var _rosterMemoryCache = null;
var _rosterMemoryCacheTs = 0;
var ROSTER_CACHE_TTL_SEC = 900; // 15 minutes

function invalidateRosterCache() {
  _rosterMemoryCache = null;
  _rosterMemoryCacheTs = 0;
  try {
    CacheService.getScriptCache().remove('roster_data_map');
  } catch (e) { /* ignore */ }
}

function getRosterMap() {
  var now = Date.now();
  if (_rosterMemoryCache && (now - _rosterMemoryCacheTs < ROSTER_CACHE_TTL_SEC * 1000)) {
    return _rosterMemoryCache;
  }

  var cache = CacheService.getScriptCache();
  try {
    var cachedJson = cache.get('roster_data_map');
    if (cachedJson) {
      _rosterMemoryCache = JSON.parse(cachedJson);
      _rosterMemoryCacheTs = now;
      return _rosterMemoryCache;
    }
  } catch (e) { /* fallback to sheet */ }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var roster = ss.getSheetByName('Roster');
  if (!roster) return {};

  var data = roster.getDataRange().getValues();
  if (data.length < 2) return {};

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
  if (colAC === -1) colAC = 5;
  if (colRole === -1) colRole = 6;

  var map = {};
  for (var i = 1; i < data.length; i++) {
    var mId = String(data[i][colMatric] || '').trim();
    if (!mId) continue;
    map[mId] = {
      email: String(data[i][colEmail] || '').trim(),
      matricId: mId,
      name: String(data[i][colName] || '').trim(),
      cfHandle: String(data[i][colCF] || '').trim(),
      leetCodeHandle: String(data[i][colLC] || '').trim(),
      atCoderHandle: String(data[i][colAC] || '').trim(),
      role: String(data[i][colRole] || '').trim()
    };
  }

  _rosterMemoryCache = map;
  _rosterMemoryCacheTs = now;
  try {
    var str = JSON.stringify(map);
    if (str.length < 95000) {
      cache.put('roster_data_map', str, ROSTER_CACHE_TTL_SEC);
    }
  } catch (ce) { /* ignore cache put error */ }

  return map;
}

function getStudentInfoFromRoster(matricId) {
  if (!matricId) return null;
  var rosterMap = getRosterMap();
  return rosterMap[String(matricId).trim()] || null;
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

    // Batch update row with authoritative API values (2 RPCs instead of 4)
    sheet.getRange(row, 7, 1, 2).setValues([[result.verdict, result.submissionCount]]); // G:H
    sheet.getRange(row, 11, 1, 2).setValues([[result.category, result.rating]]);         // K:L

  } else if (result.verificationType === 'MANUAL') {
    status = 'MANUAL';
    note = '⚠ Manual platform (' + result.category + ').';
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

