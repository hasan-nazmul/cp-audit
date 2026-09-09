/**
 * ═══════════════════════════════════════════════════════════════════
 * temp.gs — One-Time Migration Script: Add "Hint?" Column After Column L
 *
 * Targets:
 *   1. "Individual Copy" template sheet
 *   2. All student sheets matching pattern: /^C261\d{3}$/i (e.g. C261004, C261005)
 *
 * What it does:
 *   - Inserts a new column immediately after Column L (Column 12, "Rating")
 *   - Places "Hint?" header in Row 2, Column 13 (Column M)
 *   - Preserves dark blue header formatting, borders, and center alignment
 *   - Adjusts Row 1 "Problem Solving Arena" merged header banner
 *   - Safe & Idempotent: Skips sheets if "Hint?" is already present
 * ═══════════════════════════════════════════════════════════════════
 */

/**
 * Main execution function. Run this from the Apps Script editor.
 */
function addHintColumnToAllSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheets = ss.getSheets();
  var studentPattern = /^C261\d{3}$/i;

  var updatedCount = 0;
  var skippedCount = 0;
  var targetSheets = [];

  Logger.log('🚀 Starting "Hint?" column addition...');

  // Identify all target sheets
  for (var i = 0; i < sheets.length; i++) {
    var sheet = sheets[i];
    var sheetName = sheet.getName().trim();

    var isIndividualCopy = sheetName.toLowerCase() === 'individual copy';
    var isStudent = studentPattern.test(sheetName);

    if (isIndividualCopy || isStudent) {
      targetSheets.push(sheet);
    }
  }

  Logger.log('Found ' + targetSheets.length + ' matching target sheets.');

  // Process each sheet
  for (var j = 0; j < targetSheets.length; j++) {
    var targetSheet = targetSheets[j];
    var name = targetSheet.getName();

    try {
      // 1. Idempotency Check: Verify if "Hint?" or "Hint" already exists in Row 2
      var maxCols = Math.min(targetSheet.getMaxColumns(), 25);
      var headerRowValues = targetSheet.getRange(2, 1, 1, maxCols).getValues()[0];
      var alreadyExists = false;

      for (var c = 0; c < headerRowValues.length; c++) {
        var hText = String(headerRowValues[c] || '').toLowerCase().trim();
        if (hText === 'hint?' || hText === 'hint') {
          alreadyExists = true;
          break;
        }
      }

      if (alreadyExists) {
        Logger.log('⏩ Skipping "' + name + '": "Hint?" column already exists.');
        skippedCount++;
        continue;
      }

      // 2. Insert new column immediately after Column L (Column 12)
      // The new column will occupy Column 13 (Column M)
      targetSheet.insertColumnAfter(12);
      var newColIndex = 13; // Column M

      // 3. Set Header Value in Row 2, Column 13
      var headerCell = targetSheet.getRange(2, newColIndex);
      var sourceHeaderCell = targetSheet.getRange(2, 12); // Column L (Rating)

      // Copy exact formatting from Column L header (Background, Text color, Font size, Font weight, Borders)
      sourceHeaderCell.copyTo(headerCell, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
      headerCell.setValue('Hint?');
      headerCell.setFontWeight('bold');
      headerCell.setHorizontalAlignment('center');
      headerCell.setVerticalAlignment('middle');

      // 4. Set appropriate column width (matching Rating or ~90px)
      var colLWidth = targetSheet.getColumnWidth(12) || 90;
      targetSheet.setColumnWidth(newColIndex, Math.max(colLWidth, 80));

      // 5. Copy data cell formatting down the column (rows 3 to lastRow or maxRows)
      var maxRows = targetSheet.getMaxRows();
      if (maxRows >= 4) {
        var sourceDataRange = targetSheet.getRange(4, 12, maxRows - 3, 1);
        var targetDataRange = targetSheet.getRange(4, newColIndex, maxRows - 3, 1);
        sourceDataRange.copyTo(targetDataRange, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
        targetDataRange.setHorizontalAlignment('center');
      }

      // 6. Adjust Row 1 "Problem Solving Arena" merged banner if needed
      adjustProblemSolvingArenaBanner(targetSheet);

      Logger.log('✅ Added "Hint?" column to: ' + name);
      updatedCount++;

    } catch (err) {
      Logger.log('❌ Error updating sheet "' + name + '": ' + err.message);
    }
  }

  Logger.log('═══════════════════════════════════════════');
  Logger.log('🎉 Migration Completed!');
  Logger.log('Total Processed : ' + targetSheets.length);
  Logger.log('Updated         : ' + updatedCount);
  Logger.log('Skipped (Exists): ' + skippedCount);
  Logger.log('═══════════════════════════════════════════');
}

/**
 * Helper to ensure the Row 1 "Problem Solving Arena" banner cleanly merges
 * across all Problem Solving Arena columns (E through N, ending at Comment).
 */
function adjustProblemSolvingArenaBanner(sheet) {
  try {
    var commentCol = findHeaderColIndex(sheet, 2, 'comment');

    // If Comment column is found (e.g., Column 14 after insertion), ensure banner spans Column E(5) to CommentCol
    if (commentCol > 5) {
      var arenaText = String(sheet.getRange(1, 5).getValue() || '').trim();
      if (!arenaText) {
        for (var col = 1; col <= commentCol; col++) {
          var val = String(sheet.getRange(1, col).getValue() || '').trim();
          if (val.toLowerCase().indexOf('problem solving') !== -1) {
            arenaText = val;
            break;
          }
        }
      }

      if (!arenaText) {
        arenaText = 'Problem Solving Arena';
      }

      var bannerRange = sheet.getRange(1, 5, 1, commentCol - 5 + 1);
      bannerRange.merge();
      bannerRange.setValue(arenaText);
      bannerRange.setFontWeight('bold');
      bannerRange.setHorizontalAlignment('center');
      bannerRange.setVerticalAlignment('middle');
    }
  } catch (e) {
    Logger.log('Notice adjusting banner on ' + sheet.getName() + ': ' + e.message);
  }
}

/**
 * Preview / Dry-Run function: Lists which sheets will be modified without making changes.
 */
function previewAddHintColumn() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheets = ss.getSheets();
  var studentPattern = /^C261\d{3}$/i;

  var willUpdate = [];
  var willSkip = [];

  for (var i = 0; i < sheets.length; i++) {
    var sheet = sheets[i];
    var sheetName = sheet.getName().trim();

    var isIndividualCopy = sheetName.toLowerCase() === 'individual copy';
    var isStudent = studentPattern.test(sheetName);

    if (isIndividualCopy || isStudent) {
      var headerRow = sheet.getRange(2, 1, 1, Math.min(sheet.getMaxColumns(), 25)).getValues()[0];
      var hasHint = headerRow.some(function(h) {
        var str = String(h || '').toLowerCase().trim();
        return str === 'hint?' || str === 'hint';
      });

      if (hasHint) {
        willSkip.push(sheetName);
      } else {
        willUpdate.push(sheetName);
      }
    }
  }

  Logger.log('📋 PREVIEW RESULTS:');
  Logger.log('Sheets to UPDATE (' + willUpdate.length + '): ' + willUpdate.join(', '));
  Logger.log('Sheets to SKIP   (' + willSkip.length + '): ' + willSkip.join(', '));
}

/**
 * Rollback / Undo function: Removes the "Hint?" column if needed.
 */
function undoAddHintColumn() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheets = ss.getSheets();
  var studentPattern = /^C261\d{3}$/i;
  var removedCount = 0;

  Logger.log('⏪ Starting Undo (removing "Hint?" column)...');

  for (var i = 0; i < sheets.length; i++) {
    var sheet = sheets[i];
    var sheetName = sheet.getName().trim();

    if (sheetName.toLowerCase() === 'individual copy' || studentPattern.test(sheetName)) {
      var headerRow = sheet.getRange(2, 1, 1, Math.min(sheet.getMaxColumns(), 25)).getValues()[0];
      var hintColIndex = -1;

      for (var c = 0; c < headerRow.length; c++) {
        var str = String(headerRow[c] || '').toLowerCase().trim();
        if (str === 'hint?' || str === 'hint') {
          hintColIndex = c + 1; // 1-indexed
          break;
        }
      }

      if (hintColIndex !== -1) {
        sheet.deleteColumn(hintColIndex);
        Logger.log('🗑️ Removed "Hint?" column from: ' + sheetName);
        removedCount++;
      }
    }
  }

  Logger.log('Undo complete. Removed from ' + removedCount + ' sheets.');
}

/**
 * Utility: Find 1-indexed column index of a header in row 2.
 */
function findHeaderColIndex(sheet, rowNum, headerSubstr) {
  var maxCols = Math.min(sheet.getMaxColumns(), 25);
  var rowVals = sheet.getRange(rowNum, 1, 1, maxCols).getValues()[0];
  for (var i = 0; i < rowVals.length; i++) {
    var val = String(rowVals[i] || '').toLowerCase().trim();
    if (val.indexOf(headerSubstr.toLowerCase()) !== -1) {
      return i + 1;
    }
  }
  return -1;
}
