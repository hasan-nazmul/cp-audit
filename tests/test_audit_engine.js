/**
 * tests/test_audit_engine.js — Automated Test Suite for CP Audit Engine
 * Run locally via: node tests/test_audit_engine.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

console.log('🧪 Starting CP Audit Engine Test Suite...\n');

// 1. Mock Google Apps Script Globals
const mockScriptProperties = {
  KIMI_KEY: 'test-kimi-key',
  GEMINI_KEY: 'test-gemini-key',
  INSTRUCTOR_EMAIL: 'coach@edu.org, ta@edu.org',
  WEB_APP_API_KEY: 'test-secret-key-123'
};

const mockCache = {};

const sandbox = {
  console: console,
  Date: Date,
  Math: Math,
  JSON: JSON,
  String: String,
  Number: Number,
  Array: Array,
  Object: Object,
  RegExp: RegExp,
  parseInt: parseInt,
  parseFloat: parseFloat,
  isNaN: isNaN,
  isFinite: isFinite,
  Logger: {
    log: function () {}
  },
  Utilities: {
    sleep: function () {},
    formatDate: function (d) { return d.toISOString().split('T')[0]; }
  },
  PropertiesService: {
    getScriptProperties: function () {
      return {
        getProperty: function (key) { return mockScriptProperties[key] || null; },
        setProperty: function (key, val) { mockScriptProperties[key] = String(val); }
      };
    }
  },
  CacheService: {
    getScriptCache: function () {
      return {
        get: function (k) { return mockCache[k] || null; },
        put: function (k, v, ttl) { mockCache[k] = v; },
        remove: function (k) { delete mockCache[k]; },
        putAll: function (entries, ttl) {
          var totalSize = JSON.stringify(entries).length;
          if (totalSize > 100000) {
            throw new Error('Argument too large: Total size of values must be less than 100KB');
          }
          Object.assign(mockCache, entries);
        }
      };
    }
  },
  LockService: {
    getScriptLock: function () {
      return {
        tryLock: function () { return true; },
        releaseLock: function () {}
      };
    },
    getDocumentLock: function () {
      return {
        tryLock: function () { return true; },
        releaseLock: function () {}
      };
    }
  },
  UrlFetchApp: {
    fetch: function () {
      return {
        getResponseCode: function () { return 200; },
        getContentText: function () { return JSON.stringify({ status: 'OK', result: [] }); }
      };
    }
  },
  ContentService: {
    MimeType: { JSON: 'application/json' },
    createTextOutput: function (content) {
      return {
        content: content,
        setMimeType: function () { return this; }
      };
    }
  }
};

vm.createContext(sandbox);

// 2. Load all .gs files in dependency order
const projectDir = path.resolve(__dirname, '..');
const gsFiles = [
  'AuditStorage.gs',
  'ReportRenderer.gs',
  'SuggestionEngine.gs',
  'Verifier.gs',
  'AuditProgression.gs',
  'AuditIntegrity.gs',
  'AuditFetch.gs',
  'AIService.gs',
  'AuditReports.gs',
  'WeeklyAudit.gs',
  'Code.gs'
];

gsFiles.forEach(f => {
  const filePath = path.join(projectDir, f);
  const code = fs.readFileSync(filePath, 'utf8');
  vm.runInContext(code, sandbox, { filename: f });
});

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ PASS: ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${name}`);
    console.error(`     Error: ${err.message}`);
    failed++;
  }
}

// ─── Test Suite ──────────────────────────────────────────────────

console.log('--- Group 1: Security & HTML / XSS Escaping ---');

test('formatMarkdownToHtml escapes malicious script tags in markdown', () => {
  const malicious = 'Here is an issue: <script>alert("xss")</script> and **bold** text.';
  const html = sandbox.formatMarkdownToHtml(malicious);
  assert(!html.includes('<script>'), 'Raw <script> tag must not exist in output');
  assert(html.includes('&lt;script&gt;'), 'Script tag must be HTML-escaped');
  assert(html.includes('<strong style="color:#0f172a;">bold</strong>'), 'Markdown bold must still render');
});

test('formatMarkdownToHtml escapes img onerror payloads', () => {
  const payload = '### Problem\n* CF 1000A — <img src=x onerror=alert(1)> Math Problem ($x \\leq y$)';
  const html = sandbox.formatMarkdownToHtml(payload);
  assert(!html.includes('<img'), 'Raw <img> tag must not exist in output');
  assert(html.includes('&lt;img'), 'Img tag must be escaped');
  assert(html.includes('≤'), 'LaTeX \\leq should be converted to Unicode ≤');
  assert(html.includes('<code'), 'Math block should be converted to styled code tag');
});

test('renderStudentEmailHtml and renderInstructorDigestEmailHtml generate valid email markup', () => {
  const studentInfo = { matricId: 'C261001', name: 'Alice', email: 'alice@edu.org' };
  const stats = { totalSolves: 5, verifiedSolves: 5, totalTime: 120, avgRating: 1100, topTag: 'Greedy' };
  const weekStart = new Date('2026-09-01T00:00:00Z');
  const weekEnd = new Date('2026-09-07T23:59:59Z');

  const studentHtml = sandbox.renderStudentEmailHtml(studentInfo, [], stats, ['Great consistency!'], [], 'Keep up the momentum!', weekStart, weekEnd, null);
  assert(studentHtml.includes('Weekly Practice &amp; Performance Intelligence') || studentHtml.includes('Weekly Practice & Performance Intelligence'), 'Student email should include header title');
  assert(studentHtml.includes('Alice'), 'Student email should include student name');
  assert(studentHtml.includes('1100'), 'Student email should include avg rating');

  const digestHtml = sandbox.renderInstructorDigestEmailHtml([], [], [], [stats], { totalSolves: 5 }, '<p>AI Report</p>', weekStart, weekEnd, null, {});
  assert(digestHtml.includes('Executive Intelligence Digest'), 'Digest email should include executive digest title');
  assert(digestHtml.includes('AI Report'), 'Digest email should include instructor report');
});

console.log('\n--- Group 2: Schema Consistency & Column Detection ---');

test('hasHintColumn and getStatusColumnIndex stay strictly consistent', () => {
  const mockSheetWithHint = {
    getRange: function (row, col) {
      return {
        getValue: function () {
          if (row === 2 && col === 13) return 'Hint (editorial)?';
          return '';
        }
      };
    }
  };

  const mockSheetLegacy = {
    getRange: function (row, col) {
      return {
        getValue: function () {
          if (row === 2 && col === 13) return 'Comment';
          return '';
        }
      };
    }
  };

  assert.strictEqual(sandbox.hasHintColumn(mockSheetWithHint), true, 'Sheet with Hint header should return true');
  assert.strictEqual(sandbox.getStatusColumnIndex(mockSheetWithHint), 15, 'Status column must be 15 when Hint exists');

  assert.strictEqual(sandbox.hasHintColumn(mockSheetLegacy), false, 'Legacy sheet without Hint should return false');
  assert.strictEqual(sandbox.getStatusColumnIndex(mockSheetLegacy), 14, 'Status column must be 14 in legacy schema');
});

console.log('\n--- Group 3: AI Circuit Breaker & Cooldown ---');

test('Circuit breaker trips on failure and re-enables after cooldown', () => {
  sandbox._aiCircuitTrippedAt = Date.now() - 30000; // tripped 30s ago
  sandbox._aiCircuitOpen = true;
  assert.strictEqual(sandbox.isAICircuitOpen(), true, 'Circuit should remain open within 60s cooldown');

  sandbox._aiCircuitTrippedAt = Date.now() - 65000; // tripped 65s ago (past 60s cooldown)
  assert.strictEqual(sandbox.isAICircuitOpen(), false, 'Circuit should reset and allow retries after 60s cooldown');
});

console.log('\n--- Group 4: Anti-Cheat Anomaly Detection ---');

test('runStudentAudit flags GHOST_AC when solve claimed without contest/API match', () => {
  const studentInfo = { matricId: 'C261001', name: 'Alice', cfHandle: 'alice_cf' };
  const weekStart = new Date('2026-09-01T00:00:00Z');
  const weekEnd = new Date('2026-09-07T23:59:59Z');
  const solveDate = new Date('2026-09-03T10:00:00Z');

  const logRows = [{
    rowNum: 4,
    link: 'https://codeforces.com/contest/1800/problem/A',
    verdict: 'AC',
    claimedSubs: 1,
    time: 25,
    date: solveDate,
    category: 'Codeforces',
    rating: 1200,
    hasHint: false,
    platform: 'codeforces',
    contestId: 1800,
    problemIndex: 'A',
    isGym: false
  }];

  // Empty CF index (meaning problem was never submitted on Codeforces server)
  const cfIndex = { index: {}, handles: ['alice_cf'] };
  const acIndex = { index: {}, handles: [] };

  const audit = sandbox.runStudentAudit(studentInfo, logRows, cfIndex, 1200, null, weekStart, weekEnd, acIndex);

  assert(audit.anomalies.length > 0, 'Should detect an anomaly for ghost solve');
  const ghostAnomaly = audit.anomalies.find(a => a.type === 'GHOST_AC');
  assert(ghostAnomaly, 'Anomaly type must be GHOST_AC');
  assert.strictEqual(ghostAnomaly.severity, 'FLAGGED', 'Ghost AC should be FLAGGED severity');
});

test('runStudentAudit flags BURST_MODE when 3+ rated problems solved in 15 minutes', () => {
  const studentInfo = { matricId: 'C261002', name: 'Bob', cfHandle: 'bob_cf' };
  const weekStart = new Date('2026-09-01T00:00:00Z');
  const weekEnd = new Date('2026-09-07T23:59:59Z');
  const baseTime = new Date('2026-09-03T14:00:00Z').getTime();

  const logRows = [
    { rowNum: 4, link: 'https://codeforces.com/contest/1800/problem/A', verdict: 'AC', claimedSubs: 1, time: 2, date: new Date(baseTime), category: 'Codeforces', rating: 1300, hasHint: false, platform: 'codeforces', contestId: 1800, problemIndex: 'A', isGym: false },
    { rowNum: 5, link: 'https://codeforces.com/contest/1801/problem/A', verdict: 'AC', claimedSubs: 1, time: 2, date: new Date(baseTime + 3 * 60000), category: 'Codeforces', rating: 1300, hasHint: false, platform: 'codeforces', contestId: 1801, problemIndex: 'A', isGym: false },
    { rowNum: 6, link: 'https://codeforces.com/contest/1802/problem/A', verdict: 'AC', claimedSubs: 1, time: 3, date: new Date(baseTime + 7 * 60000), category: 'Codeforces', rating: 1300, hasHint: false, platform: 'codeforces', contestId: 1802, problemIndex: 'A', isGym: false }
  ];

  // Index matches all 3 so they are not ghost solves, but solved across distinct contests in <15m
  const cfIndex = {
    index: {
      '1800A': { bestVerdict: 'OK', acTime: baseTime / 1000, attempts: 1, handles: { bob_cf: true }, ratings: [1300] },
      '1801A': { bestVerdict: 'OK', acTime: (baseTime + 3 * 60000) / 1000, attempts: 1, handles: { bob_cf: true }, ratings: [1300] },
      '1802A': { bestVerdict: 'OK', acTime: (baseTime + 7 * 60000) / 1000, attempts: 1, handles: { bob_cf: true }, ratings: [1300] }
    },
    handles: ['bob_cf'],
    contestHandles: {}
  };

  const audit = sandbox.runStudentAudit(studentInfo, logRows, cfIndex, 1100, null, weekStart, weekEnd, { index: {}, handles: [] });
  const burst = audit.anomalies.find(a => a.type === 'BURST_MODE');
  assert(burst, 'Should detect BURST_MODE anomaly');
});

test('computeDailyVariance computes low standard deviation for consistent practice', () => {
  const weekDates = [
    new Date('2026-09-01'), new Date('2026-09-02'), new Date('2026-09-03'),
    new Date('2026-09-04'), new Date('2026-09-05'), new Date('2026-09-06')
  ];
  // 1 solve per day = 0 variance
  const logRows = weekDates.map((d, idx) => ({ rowNum: idx + 4, date: d, verdict: 'AC' }));
  const variance = sandbox.computeDailyVariance(logRows);
  assert(variance < 1.0, `Variance for daily consistency should be < 1.0, got ${variance}`);
});

console.log('\n--- Group 5: Performance Optimization Checks ---');

test('analyzeRatingProgression accepts preloaded data and avoids sheet reads', () => {
  let sheetRangeCalled = false;
  const mockSheet = {
    getRange: function () {
      sheetRangeCalled = true;
      return { getValues: function () { return []; } };
    },
    getLastRow: function () { return 10; }
  };

  const preloadedData = [
    ['https://codeforces.com/contest/1800/problem/A', 'AC', 1, 20, '2026-09-02', 'Greedy', 1000, 'no'],
    ['https://codeforces.com/contest/1800/problem/B', 'AC', 1, 25, '2026-09-03', 'Greedy', 1000, 'no'],
    ['https://codeforces.com/contest/1800/problem/C', 'AC', 1, 15, '2026-09-04', 'Greedy', 1000, 'no']
  ];

  const result = sandbox.analyzeRatingProgression(mockSheet, { matricId: 'C261001' }, { index: {}, handles: [] }, {}, {}, preloadedData, true);
  assert.strictEqual(sheetRangeCalled, false, 'Sheet.getRange should NOT be called when preloadedData is provided');
  assert.strictEqual(result.currentTier, 1000, 'Should deduce 1000 working tier from preloaded solves');
});

console.log('\n--- Group 6: Manual Submission Unrestricted Checks ---');

test('verifyProblemServer accepts unlimited manual submissions with no daily limit', () => {
  const studentInfo = { matricId: 'C261001', name: 'Alice' };
  const mockSheet = {
    getRange: function () {
      return {
        getValues: function () {
          // Mock 10 manual problems already logged today
          return Array(10).fill(['2026-09-09', 'CSES']);
        }
      };
    },
    getLastRow: function () { return 15; }
  };

  // Submitting an 11th manual problem should succeed without throwing a daily limit error
  const result = sandbox.verifyProblemServer('https://cses.fi/problemset/task/1068', studentInfo, mockSheet, 'AC', 2);
  assert.strictEqual(result.verificationType, 'MANUAL');
  assert.strictEqual(result.category, 'CSES');
  assert.strictEqual(result.verdict, 'AC');
  assert.strictEqual(result.submissionCount, 2);
});

console.log(`\n═══════════════════════════════════════════════`);
console.log(`🏁 Test Results: ${passed} Passed, ${failed} Failed`);
console.log(`═══════════════════════════════════════════════\n`);

if (failed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
