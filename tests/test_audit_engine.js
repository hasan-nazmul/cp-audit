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

console.log('\n--- Group 7: Decimal Rounding Up (roundUp2) Checks ---');

test('roundUp2 rounds UP to at most 2 digits after decimal point', () => {
  assert.strictEqual(sandbox.roundUp2(85.71428571428571), 85.72, '85.71428571428571 should round up to 85.72');
  assert.strictEqual(sandbox.roundUp2(33.333333333333336), 33.34, '33.333333333333336 should round up to 33.34');
  assert.strictEqual(sandbox.roundUp2(2.5833333333333335), 2.59, '2.5833333333333335 should round up to 2.59');
  assert.strictEqual(sandbox.roundUp2(100), 100, 'Integer 100 should remain 100');
  assert.strictEqual(sandbox.roundUp2(0), 0, '0 should remain 0');
  assert.strictEqual(sandbox.roundUp2(12.341), 12.35, '12.341 should round up to 12.35');
  assert.strictEqual(sandbox.roundUp2(12.340), 12.34, '12.340 should remain 12.34');
});

test('renderStudentEmailHtml and renderInstructorDigestEmailHtml do not leak multi-digit floats', () => {
  const studentInfo = { matricId: 'C261001', name: 'Alice' };
  const stats = {
    totalSolves: 7,
    verifiedSolves: 6,
    totalTime: 155, // 155 / 60 = 2.5833333333333335h
    avgRating: 1214.2857142857142,
    hintCount: 2,
    soloSolves: 5,
    hintRate: 28.571428571428573,
    topTag: 'Greedy'
  };

  const emailHtml = sandbox.renderStudentEmailHtml(studentInfo, [], stats, [], [], '', new Date('2026-09-01'), new Date('2026-09-07'), null);
  assert(!emailHtml.includes('28.571428571428573%'), 'Hint rate must not leak float decimals in student email');
  assert(!emailHtml.includes('1214.2857142857142'), 'Avg rating must not leak float decimals in student email');
  assert(emailHtml.includes('71.43% Unassisted'), 'Should display rounded up 71.43% unassisted rate');
  assert(emailHtml.includes('Practice Time'), 'Student email should refer to Practice Time');
  assert(!emailHtml.includes('Study Time'), 'Student email should not refer to Study Time');

  const digestHtml = sandbox.renderInstructorDigestEmailHtml([], [], [], [stats], { totalSolves: 7, totalSoloSolves: 5, totalHintSolves: 2, cohortHintRate: 28.571428571428573 }, '', new Date('2026-09-01'), new Date('2026-09-07'), null, {});
  assert(!digestHtml.includes('2.5833333333333335h'), 'Study hours must not leak float decimals in digest email');
  assert(digestHtml.includes('2.59h'), 'Study hours should be formatted as 2.59h');
});

console.log('\n--- Group 8: Gym & Non-Contest CF Public API Skip Checks ---');

test('parseProblemServerInput detects Gym contest IDs >= 100000 and gym URLs', () => {
  const p1 = sandbox.parseProblemServerInput('https://codeforces.com/contest/102951/problem/A');
  assert.strictEqual(p1.isGym, true, 'ContestId 102951 must be marked as isGym = true');
  assert.strictEqual(p1.category, 'Gym', 'Category must be Gym');

  const p2 = sandbox.parseProblemServerInput('https://codeforces.com/gym/100001/problem/B');
  assert.strictEqual(p2.isGym, true, 'Gym URL must be marked as isGym = true');
  assert.strictEqual(p2.category, 'Gym', 'Category must be Gym');

  const p3 = sandbox.parseProblemServerInput('https://codeforces.com/group/abc123/contest/123/problem/A');
  assert.strictEqual(p3.platform, 'codeforces_unsupported', 'Group URL must be marked as unsupported CF');

  const p4 = sandbox.parseProblemServerInput('https://codeforces.com/edu/course/2/lesson/6/1/practice/contest/283911/problem/A');
  assert.strictEqual(p4.platform, 'codeforces_unsupported', 'Edu URL must be marked as unsupported CF');

  const p5 = sandbox.parseProblemServerInput('https://codeforces.com/problemset/problem/1800/A');
  assert.strictEqual(p5.isGym, false, 'Standard problemset problem must not be gym');
  assert.strictEqual(p5.platform, 'codeforces', 'Platform must be codeforces');
});

test('runStudentAudit skips CF API check for Gym problems and does NOT flag GHOST_AC', () => {
  const studentInfo = { matricId: 'C261001', name: 'Alice', cfHandle: 'alice_cf' };
  const weekStart = new Date('2026-09-01T00:00:00Z');
  const weekEnd = new Date('2026-09-07T23:59:59Z');
  const solveDate = new Date('2026-09-03T12:00:00Z');

  const logRows = [
    {
      rowNum: 4,
      link: 'https://codeforces.com/gym/102951/problem/A',
      verdict: 'AC',
      claimedSubs: 1,
      time: 25,
      date: solveDate,
      category: 'Gym',
      rating: 1400,
      hasHint: false,
      platform: 'codeforces',
      contestId: 102951,
      problemIndex: 'A',
      isGym: true
    },
    {
      rowNum: 5,
      link: 'https://codeforces.com/contest/103000/problem/B',
      verdict: 'AC',
      claimedSubs: 1,
      time: 30,
      date: solveDate,
      category: 'Gym',
      rating: 1500,
      hasHint: true,
      platform: 'codeforces',
      contestId: 103000,
      problemIndex: 'B',
      isGym: true
    }
  ];

  // cfIndex has NO entries for gym problems because CF public API doesn't return gym submissions
  const cfIndex = {
    index: {},
    handles: ['alice_cf'],
    contestHandles: {}
  };

  const audit = sandbox.runStudentAudit(studentInfo, logRows, cfIndex, 1300, null, weekStart, weekEnd, { index: {}, handles: [] });

  const ghostAnomalies = audit.anomalies.filter(a => a.type === 'GHOST_AC');
  assert.strictEqual(ghostAnomalies.length, 0, 'Gym problems must NOT trigger GHOST_AC anomalies');
  assert.strictEqual(audit.stats.totalSolves, 2, 'Gym solves must be counted in total solves');
  assert.strictEqual(audit.stats.totalTime, 55, 'Gym solve time must be counted in total study time');
  assert.strictEqual(audit.stats.manualSolves, 2, 'Gym solves must be recorded as manual solves');
});

// ── Group 9: Core & Advanced Cheat-Proofing Checks ──
console.log('\n--- Group 9: Core & Advanced Cheat-Proofing Checks ---');

test('runStudentAudit flags IMPLAUSIBLE_SPEED when solves at/above baseline occur with too small gap', () => {
  const studentInfo = { matricId: 'C261002', name: 'Bob', cfHandle: 'bob_cf' };
  const weekStart = new Date('2026-09-01T00:00:00Z');
  const weekEnd = new Date('2026-09-07T23:59:59Z');
  const baseEpoch = Math.floor(new Date('2026-09-03T12:00:00Z').getTime() / 1000);

  // Two 1400-rated problems solved 3 minutes apart across different contests
  // Formula: max(3, floor((1400 - 500) / 100)) = 9 minutes minimum plausible
  const logRows = [
    {
      rowNum: 4,
      link: 'https://codeforces.com/contest/1800/problem/C',
      verdict: 'AC',
      claimedSubs: 1,
      time: 20,
      date: new Date(baseEpoch * 1000),
      category: 'Codeforces',
      rating: 1400,
      hasHint: false,
      platform: 'codeforces',
      contestId: 1800,
      problemIndex: 'C'
    },
    {
      rowNum: 5,
      link: 'https://codeforces.com/contest/1850/problem/D',
      verdict: 'AC',
      claimedSubs: 1,
      time: 20,
      date: new Date((baseEpoch + 180) * 1000),
      category: 'Codeforces',
      rating: 1400,
      hasHint: false,
      platform: 'codeforces',
      contestId: 1850,
      problemIndex: 'D'
    }
  ];

  const cfIndex = {
    index: {
      '1800C': { bestVerdict: 'OK', acTime: baseEpoch, attempts: 1, handles: { bob_cf: true }, ratings: [1400], subs: [{ t: baseEpoch, v: 'OK', id: 101 }] },
      '1850D': { bestVerdict: 'OK', acTime: baseEpoch + 180, attempts: 1, handles: { bob_cf: true }, ratings: [1400], subs: [{ t: baseEpoch + 180, v: 'OK', id: 102 }] }
    },
    handles: ['bob_cf'],
    contestHandles: {}
  };

  const audit = sandbox.runStudentAudit(studentInfo, logRows, cfIndex, 1200, null, weekStart, weekEnd);
  const speedAnoms = audit.anomalies.filter(a => a.type === 'IMPLAUSIBLE_SPEED');
  assert.strictEqual(speedAnoms.length, 1, 'Should flag IMPLAUSIBLE_SPEED for 3-minute gap on 1400 problems');
});

test('runStudentAudit does NOT flag IMPLAUSIBLE_SPEED for same-contest solves or problems below baseline', () => {
  const studentInfo = { matricId: 'C261003', name: 'Charlie', cfHandle: 'charlie_cf' };
  const weekStart = new Date('2026-09-01T00:00:00Z');
  const weekEnd = new Date('2026-09-07T23:59:59Z');
  const baseEpoch = Math.floor(new Date('2026-09-03T12:00:00Z').getTime() / 1000);

  // Same contest (e.g. contest 1900): live contest participation exempt
  const logRows = [
    {
      rowNum: 4,
      link: 'https://codeforces.com/contest/1900/problem/A',
      verdict: 'AC',
      claimedSubs: 1,
      time: 5,
      date: new Date(baseEpoch * 1000),
      category: 'Codeforces',
      rating: 1400,
      hasHint: false,
      platform: 'codeforces',
      contestId: 1900,
      problemIndex: 'A'
    },
    {
      rowNum: 5,
      link: 'https://codeforces.com/contest/1900/problem/B',
      verdict: 'AC',
      claimedSubs: 1,
      time: 5,
      date: new Date((baseEpoch + 120) * 1000),
      category: 'Codeforces',
      rating: 1400,
      hasHint: false,
      platform: 'codeforces',
      contestId: 1900,
      problemIndex: 'B'
    }
  ];

  const cfIndex = {
    index: {
      '1900A': { bestVerdict: 'OK', acTime: baseEpoch, attempts: 1, handles: { charlie_cf: true }, ratings: [1400], subs: [{ t: baseEpoch, v: 'OK', id: 201 }] },
      '1900B': { bestVerdict: 'OK', acTime: baseEpoch + 120, attempts: 1, handles: { charlie_cf: true }, ratings: [1400], subs: [{ t: baseEpoch + 120, v: 'OK', id: 202 }] }
    },
    handles: ['charlie_cf'],
    contestHandles: {}
  };

  const audit = sandbox.runStudentAudit(studentInfo, logRows, cfIndex, 1200, null, weekStart, weekEnd);
  const speedAnoms = audit.anomalies.filter(a => a.type === 'IMPLAUSIBLE_SPEED');
  assert.strictEqual(speedAnoms.length, 0, 'Same contest solves must NOT trigger IMPLAUSIBLE_SPEED');
});

test('runStudentAudit flags TIME_MISSING, TIME_IMPLAUSIBLE, and FUTURE_TIMESTAMP', () => {
  const studentInfo = { matricId: 'C261004', name: 'Dave', cfHandle: 'dave_cf' };
  const weekStart = new Date('2026-09-01T00:00:00Z');
  const weekEnd = new Date('2026-09-07T23:59:59Z');

  const logRows = [
    {
      rowNum: 4,
      link: 'https://codeforces.com/problemset/problem/1000/A',
      verdict: 'AC',
      time: 0, // Missing time
      date: new Date('2026-09-03T12:00:00Z'),
      category: 'Codeforces',
      rating: 1000,
      platform: 'codeforces',
      contestId: 1000,
      problemIndex: 'A'
    },
    {
      rowNum: 5,
      link: 'https://codeforces.com/problemset/problem/1000/B',
      verdict: 'AC',
      time: 600, // Implausible 10 hours
      date: new Date('2026-09-04T12:00:00Z'),
      category: 'Codeforces',
      rating: 1000,
      platform: 'codeforces',
      contestId: 1000,
      problemIndex: 'B'
    },
    {
      rowNum: 6,
      link: 'https://codeforces.com/problemset/problem/1000/C',
      verdict: 'AC',
      time: 20,
      date: new Date('2026-09-10T12:00:00Z'), // Future date after weekEnd
      category: 'Codeforces',
      rating: 1000,
      platform: 'codeforces',
      contestId: 1000,
      problemIndex: 'C'
    }
  ];

  const cfIndex = {
    index: {
      '1000A': { bestVerdict: 'OK', acTime: Math.floor(new Date('2026-09-03T12:00:00Z').getTime() / 1000), attempts: 1, handles: { dave_cf: true }, ratings: [1000], subs: [] },
      '1000B': { bestVerdict: 'OK', acTime: Math.floor(new Date('2026-09-04T12:00:00Z').getTime() / 1000), attempts: 1, handles: { dave_cf: true }, ratings: [1000], subs: [] },
      '1000C': { bestVerdict: 'OK', acTime: Math.floor(new Date('2026-09-05T12:00:00Z').getTime() / 1000), attempts: 1, handles: { dave_cf: true }, ratings: [1000], subs: [] }
    },
    handles: ['dave_cf'],
    contestHandles: {}
  };

  const audit = sandbox.runStudentAudit(studentInfo, logRows, cfIndex, 1000, null, weekStart, weekEnd);
  assert.ok(audit.anomalies.some(a => a.type === 'TIME_MISSING'), 'Should flag TIME_MISSING when time is 0');
  assert.ok(audit.anomalies.some(a => a.type === 'TIME_IMPLAUSIBLE'), 'Should flag TIME_IMPLAUSIBLE when time > 480');
  assert.ok(audit.anomalies.some(a => a.type === 'FUTURE_TIMESTAMP'), 'Should flag FUTURE_TIMESTAMP when date > weekEnd');
});

test('runStudentAudit flags TIME_INFLATION when claimed time greatly exceeds inter-problem gap', () => {
  const studentInfo = { matricId: 'C261005', name: 'Eve', cfHandle: 'eve_cf' };
  const weekStart = new Date('2026-09-01T00:00:00Z');
  const weekEnd = new Date('2026-09-07T23:59:59Z');

  // Timeline: Previous problem (1799A) AC at T-300, then 1800A first sub at T, AC at T+360
  // Inter-problem gap = (T+360) - (T-300) = 660 sec = 11 min
  // Student claims 300 min → 300 > 11*3=33 AND (300-11)=289 > 60 → TIME_INFLATION
  const firstSubTime = 1756800000;
  const acSubTime = firstSubTime + 360; // 6 min coding time on OJ
  const prevProblemAcTime = firstSubTime - 300; // 5 min before first sub on 1800A

  const logRows = [
    {
      rowNum: 4,
      link: 'https://codeforces.com/contest/1800/problem/A',
      verdict: 'AC',
      claimedSubs: 2,
      time: 300, // Claims 300 min but OJ timeline shows only 11 min window
      date: new Date(acSubTime * 1000),
      category: 'Codeforces',
      rating: 1000,
      platform: 'codeforces',
      contestId: 1800,
      problemIndex: 'A'
    }
  ];

  const cfIndex = {
    index: {
      '1800A': {
        bestVerdict: 'OK',
        acTime: acSubTime,
        attempts: 2,
        handles: { eve_cf: true },
        ratings: [1000],
        contestId: '1800',
        subs: [
          { t: firstSubTime, v: 'WA', id: 301 },
          { t: acSubTime, v: 'OK', id: 302 }
        ]
      },
      // Previous different problem — gives the inter-problem reference point
      '1799A': {
        bestVerdict: 'OK',
        acTime: prevProblemAcTime,
        attempts: 1,
        handles: { eve_cf: true },
        ratings: [800],
        contestId: '1799',
        subs: [
          { t: prevProblemAcTime, v: 'OK', id: 300 }
        ]
      }
    },
    handles: ['eve_cf'],
    contestHandles: {}
  };

  const audit = sandbox.runStudentAudit(studentInfo, logRows, cfIndex, 1000, null, weekStart, weekEnd);
  const inflationAnoms = audit.anomalies.filter(a => a.type === 'TIME_INFLATION');
  assert.strictEqual(inflationAnoms.length, 1, 'Should flag TIME_INFLATION: 300m claim with 11m inter-problem window');
  assert.ok(inflationAnoms[0].detail.indexOf('previous problem') !== -1, 'Detail must reference inter-problem gap');
});

test('runStudentAudit flags SUSTAINED_SPIKE when 3+ problems are 300+ above baseline', () => {
  const studentInfo = { matricId: 'C261006', name: 'Frank', cfHandle: 'frank_cf' };
  const weekStart = new Date('2026-09-01T00:00:00Z');
  const weekEnd = new Date('2026-09-07T23:59:59Z');

  // Baseline is 1000, student solves 3 problems at 1350 (+350, below 500 single spike)
  const logRows = [
    { rowNum: 4, verdict: 'AC', time: 30, rating: 1350, platform: 'manual', category: 'Other OJ', date: new Date('2026-09-02') },
    { rowNum: 5, verdict: 'AC', time: 30, rating: 1350, platform: 'manual', category: 'Other OJ', date: new Date('2026-09-03') },
    { rowNum: 6, verdict: 'AC', time: 30, rating: 1350, platform: 'manual', category: 'Other OJ', date: new Date('2026-09-04') }
  ];

  const audit = sandbox.runStudentAudit(studentInfo, logRows, { index: {}, handles: [] }, 1000, null, weekStart, weekEnd);
  const sustainedAnoms = audit.anomalies.filter(a => a.type === 'SUSTAINED_SPIKE');
  assert.strictEqual(sustainedAnoms.length, 1, 'Should flag SUSTAINED_SPIKE when 3+ solves are at +350 rating');
});

test('runStudentAudit auto-escalates SUSPICIOUS anomalies to FLAGGED for repeat offenders', () => {
  const studentInfo = { matricId: 'C261007', name: 'Grace', cfHandle: 'grace_cf' };
  const weekStart = new Date('2026-09-01T00:00:00Z');
  const weekEnd = new Date('2026-09-07T23:59:59Z');

  // Claimed solve with time anomaly (normally SUSPICIOUS)
  const logRows = [
    {
      rowNum: 4,
      verdict: 'AC',
      time: 2, // Claimed in 2 min (below 5 min threshold)
      rating: 1400, // Above personalTimeThreshold (1000 + 200 = 1200)
      platform: 'manual',
      category: 'Other OJ',
      date: new Date('2026-09-03')
    }
  ];

  const studentHistory = {
    flaggedWeeks: 2, // Repeat offender: 2 of last 4 weeks had FLAGGED anomalies
    cleanStreak: 0,
    previousWeekStats: { totalTime: 60, totalSolves: 2, avgRating: 1000 }
  };

  const audit = sandbox.runStudentAudit(studentInfo, logRows, { index: {}, handles: [] }, 1000, studentHistory.previousWeekStats, weekStart, weekEnd, null, null, studentHistory);
  const timeAnom = audit.anomalies.find(a => a.type === 'TIME_ANOMALY');
  assert.ok(timeAnom, 'TIME_ANOMALY should be flagged');
  assert.strictEqual(timeAnom.severity, 'FLAGGED', 'TIME_ANOMALY should be auto-escalated to FLAGGED for repeat offender');
  assert.ok(audit.concerns.some(c => c.indexOf('Verification discrepancies detected in 2') !== -1), 'Repeat offender concern must be added');
});

// ── Group 10: LeetCode Verification & Progression Recommendations ──
console.log('\n--- Group 10: LeetCode Verification & Progression Recommendations ---');

test('runStudentAudit verifies LeetCode problems against lcIndex and flags GHOST_AC when missing', () => {
  const studentInfo = { matricId: 'C261008', name: 'Heidi', leetCodeHandle: 'heidi_lc' };
  const weekStart = new Date('2026-09-01T00:00:00Z');
  const weekEnd = new Date('2026-09-07T23:59:59Z');

  const logRows = [
    {
      rowNum: 4,
      link: 'https://leetcode.com/problems/two-sum/',
      titleSlug: 'two-sum',
      verdict: 'AC',
      time: 20,
      date: new Date('2026-09-03T12:00:00Z'),
      category: 'LeetCode',
      rating: 800,
      platform: 'leetcode'
    },
    {
      rowNum: 5,
      link: 'https://leetcode.com/problems/trapping-rain-water/',
      titleSlug: 'trapping-rain-water',
      verdict: 'AC',
      time: 40,
      date: new Date('2026-09-04T12:00:00Z'),
      category: 'LeetCode',
      rating: 1600,
      platform: 'leetcode'
    }
  ];

  // lcIndex only has two-sum, trapping-rain-water is missing
  const lcIndex = {
    'two-sum': { v: 'AC', s: 1, t: Math.floor(new Date('2026-09-03T12:00:00Z').getTime() / 1000) }
  };

  const audit = sandbox.runStudentAudit(studentInfo, logRows, { index: {}, handles: [] }, 1000, null, weekStart, weekEnd, null, lcIndex);

  assert.strictEqual(audit.stats.verifiedSolves, 1, 'two-sum must be verified');
  const ghostAnoms = audit.anomalies.filter(a => a.type === 'GHOST_AC');
  assert.strictEqual(ghostAnoms.length, 1, 'trapping-rain-water must trigger GHOST_AC');
  assert.ok(ghostAnoms[0].detail.indexOf('trapping-rain-water') !== -1, 'GHOST_AC detail must mention problem slug');
});

test('loadStudentAuditHistory collects multi-week history and computes cleanStreak correctly', () => {
  const mockSheet = {
    getDataRange: function() {
      return {
        getValues: function() {
          return [
            ['Timestamp', 'WeekStart', 'WeekEnd', 'MatricId', 'Name', 'RowNum', 'Type', 'Severity', 'Problem', 'Detail', 'Rating', 'Time', 'TotalTime', 'TotalSolves', 'AvgRating'],
            // Week 1 (most recent, clean)
            ['9/7/2026', '9/1/2026', '9/7/2026', 'C261010', 'Ivan', '', 'WEEK_SUMMARY', '', '', '', '', '', 120, 5, 1200],
            // Week 2 (clean)
            ['8/31/2026', '8/25/2026', '8/31/2026', 'C261010', 'Ivan', '', 'WEEK_SUMMARY', '', '', '', '', '', 100, 4, 1150],
            // Week 3 (clean)
            ['8/24/2026', '8/18/2026', '8/24/2026', 'C261010', 'Ivan', '', 'WEEK_SUMMARY', '', '', '', '', '', 150, 6, 1100],
            // Week 4 (flagged anomaly)
            ['8/17/2026', '8/11/2026', '8/17/2026', 'C261010', 'Ivan', '', 'WEEK_SUMMARY', '', '', '', '', '', 80, 3, 1050],
            ['8/17/2026', '8/11/2026', '8/17/2026', 'C261010', 'Ivan', '4', 'GHOST_AC', 'FLAGGED', 'CF 1234A', 'No sub', 1000, 20, '', '', '']
          ];
        }
      };
    }
  };

  const mockSs = {
    getSheetByName: function(name) {
      return name === 'AuditLog' ? mockSheet : null;
    }
  };

  const history = sandbox.loadStudentAuditHistory(mockSs, 4);
  const ivan = history['C261010'];
  assert.ok(ivan, 'Student C261010 must be in history map');
  assert.strictEqual(ivan.weeks.length, 4, 'Must have 4 weeks');
  assert.strictEqual(ivan.flaggedWeeks, 1, 'Week 4 was flagged, so flaggedWeeks must be 1');
  assert.strictEqual(ivan.cleanStreak, 3, 'Weeks 1, 2, 3 were clean, so cleanStreak must be 3');
  assert.strictEqual(ivan.previousWeekStats.totalSolves, 5, 'Previous week solves must be 5');
});

test('SuggestionEngine generates actionable Codeforces problemset links', () => {
  const link = sandbox.buildCFProblemsetLink('graphs', 1200);
  assert.strictEqual(link, 'https://codeforces.com/problemset?tags=graphs&order=BY_RATING_ASC&minDifficulty=1200&maxDifficulty=1400');
});

// ── Group 11: Missing Handles & Unverified/Manual Platform Exemption Checks ──
console.log('\n--- Group 11: Missing Handles & Unverified/Manual Platform Exemption Checks ---');

test('runStudentAudit does NOT flag or warn when AtCoder handle is empty/null/whitespace', () => {
  const studentInfo = {
    matricId: 'C261011',
    name: 'Ken',
    cfHandle: 'ken_cf',
    atCoderHandle: '   ', // whitespace/empty handle in roster
    leetCodeHandle: ''
  };
  const weekStart = new Date('2026-09-01T00:00:00Z');
  const weekEnd = new Date('2026-09-07T23:59:59Z');

  const logRows = [
    {
      rowNum: 4,
      link: 'https://atcoder.jp/contests/abc250/tasks/abc250_a',
      verdict: 'AC',
      claimedSubs: 1,
      time: 25,
      date: new Date('2026-09-03T12:00:00Z'),
      category: 'AtCoder',
      rating: 0,
      hasHint: false,
      platform: 'atcoder',
      problemId: 'abc250_a'
    }
  ];

  // AtCoder index is null / empty
  const audit = sandbox.runStudentAudit(studentInfo, logRows, { index: {}, handles: ['ken_cf'] }, 1000, null, weekStart, weekEnd, null, null);

  assert.strictEqual(audit.anomalies.length, 0, 'Must NOT generate GHOST_AC or any anomalies when AtCoder handle is empty');
  assert.strictEqual(audit.stats.totalSolves, 1, 'AtCoder solve must be counted toward total solves');
  assert.strictEqual(audit.stats.manualSolves, 1, 'AtCoder solve without handle must be counted as manual solve');
  assert.strictEqual(audit.stats.totalTime, 25, 'Solve time must be counted in practice time');
});

test('runStudentAudit does NOT flag or warn when Codeforces handle is empty/null/whitespace', () => {
  const studentInfo = {
    matricId: 'C261012',
    name: 'Leo',
    cfHandle: '', // Empty CF handle in roster
    atCoderHandle: '',
    leetCodeHandle: ''
  };
  const weekStart = new Date('2026-09-01T00:00:00Z');
  const weekEnd = new Date('2026-09-07T23:59:59Z');

  const logRows = [
    {
      rowNum: 4,
      link: 'https://codeforces.com/contest/1800/problem/A',
      verdict: 'AC',
      claimedSubs: 1,
      time: 30,
      date: new Date('2026-09-03T12:00:00Z'),
      category: 'Codeforces',
      rating: 1000,
      hasHint: false,
      platform: 'codeforces',
      contestId: 1800,
      problemIndex: 'A',
      isGym: false
    }
  ];

  // cfIndex has no handles
  const cfIndex = { index: {}, handles: [], contestHandles: {} };
  const audit = sandbox.runStudentAudit(studentInfo, logRows, cfIndex, 1000, null, weekStart, weekEnd, null, null);

  assert.strictEqual(audit.anomalies.length, 0, 'Must NOT generate NO_VALID_HANDLE or GHOST_AC when CF handle is empty');
  assert.strictEqual(audit.stats.totalSolves, 1, 'CF solve must be counted toward total solves');
  assert.strictEqual(audit.stats.manualSolves, 1, 'CF solve without handle must be counted as manual solve');
  assert.strictEqual(audit.stats.totalTime, 30, 'Solve time must be counted in practice time');
});

test('runStudentAudit does NOT flag or warn when LeetCode handle is empty/null/whitespace', () => {
  const studentInfo = {
    matricId: 'C261013',
    name: 'Mia',
    cfHandle: '',
    atCoderHandle: '',
    leetCodeHandle: null // null handle in roster
  };
  const weekStart = new Date('2026-09-01T00:00:00Z');
  const weekEnd = new Date('2026-09-07T23:59:59Z');

  const logRows = [
    {
      rowNum: 4,
      link: 'https://leetcode.com/problems/climbing-stairs/',
      verdict: 'AC',
      claimedSubs: 1,
      time: 20,
      date: new Date('2026-09-03T12:00:00Z'),
      category: 'LeetCode',
      rating: 0,
      hasHint: false,
      platform: 'leetcode',
      titleSlug: 'climbing-stairs'
    }
  ];

  const audit = sandbox.runStudentAudit(studentInfo, logRows, { index: {}, handles: [] }, 1000, null, weekStart, weekEnd, null, null);

  assert.strictEqual(audit.anomalies.length, 0, 'Must NOT generate GHOST_AC when LeetCode handle is empty');
  assert.strictEqual(audit.stats.totalSolves, 1, 'LeetCode solve must be counted toward total solves');
  assert.strictEqual(audit.stats.manualSolves, 1, 'LeetCode solve without handle must be counted as manual solve');
  assert.strictEqual(audit.stats.totalTime, 20, 'Solve time must be counted in practice time');
});

test('runStudentAudit does NOT flag or warn for CF Gym and Other OJ problems', () => {
  const studentInfo = {
    matricId: 'C261014',
    name: 'Noah',
    cfHandle: 'noah_cf',
    atCoderHandle: 'noah_ac',
    leetCodeHandle: 'noah_lc'
  };
  const weekStart = new Date('2026-09-01T00:00:00Z');
  const weekEnd = new Date('2026-09-07T23:59:59Z');

  const logRows = [
    {
      rowNum: 4,
      link: 'https://codeforces.com/gym/102951/problem/B',
      verdict: 'AC',
      claimedSubs: 1,
      time: 35,
      date: new Date('2026-09-03T12:00:00Z'),
      category: 'Gym',
      rating: 1300,
      hasHint: false,
      platform: 'codeforces',
      contestId: 102951,
      problemIndex: 'B',
      isGym: true
    },
    {
      rowNum: 5,
      link: 'https://cses.fi/problemset/task/1068',
      verdict: 'AC',
      claimedSubs: 1,
      time: 15,
      date: new Date('2026-09-04T12:00:00Z'),
      category: 'Other OJ',
      rating: 0,
      hasHint: false,
      platform: 'other',
      canonicalName: 'CSES 1068'
    }
  ];

  const cfIndex = { index: {}, handles: ['noah_cf'], contestHandles: {} };
  const audit = sandbox.runStudentAudit(studentInfo, logRows, cfIndex, 1000, null, weekStart, weekEnd, { index: {}, handles: ['noah_ac'] }, { index: {}, handles: ['noah_lc'] });

  assert.strictEqual(audit.anomalies.length, 0, 'Gym and Other OJ problems must not trigger any anomalies');
  assert.strictEqual(audit.stats.totalSolves, 2, 'Both solves must count');
  assert.strictEqual(audit.stats.manualSolves, 2, 'Both solves must be manual');
  assert.strictEqual(audit.stats.totalTime, 50, 'Both solve times must sum to 50');
});

console.log(`\n═══════════════════════════════════════════════`);
console.log(`🏁 Test Results: ${passed} Passed, ${failed} Failed`);
console.log(`═══════════════════════════════════════════════\n`);

if (failed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
