/**
 * ═══════════════════════════════════════════════════════════════════
 * Verifier.gs — Authoritative Server-Side Verification Engine
 *
 * Implements Zero-Trust verification in Google Apps Script:
 * 1. Pre-validation: Filters empty / placeholder / invalid syntax handles
 * 2. Codeforces: Batch handle validation + Tiered fetch (count=200 -> count=2000)
 *    with compact CacheService (<15KB)
 * 3. LeetCode: Direct GraphQL query + error body parsing + fallback
 * 4. Manual OJs: Unrestricted manual submissions (Gym, CSES, VJudge, Toph, etc.)
 * ═══════════════════════════════════════════════════════════════════
 */

var CACHE_TTL_SECONDS = 900;          // 15 minutes for submission caches
var HANDLE_CACHE_TTL_SECONDS = 86400; // 24 hours for handle validity caches
var MAX_MANUAL_SOLVES_PER_DAY = (typeof getAuditConfigNum === 'function') ? getAuditConfigNum('MAX_MANUAL_SOLVES_PER_DAY', 0) : 0; // 0 = unlimited

// ─── Handle Syntax & Placeholder Filtering ──────────────────────────

var PLACEHOLDER_HANDLES = {
  '': true,
  'none': true,
  'no': true,
  'n/a': true,
  'na': true,
  'null': true,
  'nil': true,
  '-': true,
  '--': true,
  '0': true,
  'fake': true,
  'test': true,
  'tbd': true,
  'pending': true,
  'user': true,
  'admin': true,
  'undefined': true,
  'unknown': true,
  'blank': true,
  'not provided': true
};

/**
 * Validates if a handle string has valid syntax and is not a placeholder.
 * @param {string} handle - The handle to check.
 * @param {string} [platform='codeforces'] - 'codeforces' or 'leetcode'.
 * @returns {boolean} True if syntactically valid and non-placeholder.
 */
function isValidHandleSyntax(handle, platform) {
  var clean = String(handle || '').trim();
  if (!clean) return false;

  var lower = clean.toLowerCase();
  if (PLACEHOLDER_HANDLES[lower]) return false;

  // Codeforces handle rules: 3-24 characters, latin letters, digits, dots, underscores, hyphens
  if (!platform || platform === 'codeforces') {
    if (clean.length < 3 || clean.length > 24) return false;
    if (!/^[a-zA-Z0-9_.-]{3,24}$/.test(clean)) return false;
    // Must contain at least one alphanumeric character
    if (!/[a-zA-Z0-9]/.test(clean)) return false;
    return true;
  }

  // LeetCode handle rules: 3-30 characters, alphanumeric, underscores, hyphens, dots
  if (platform === 'leetcode') {
    if (clean.length < 3 || clean.length > 30) return false;
    if (!/^[a-zA-Z0-9_.-]{3,30}$/.test(clean)) return false;
    if (!/[a-zA-Z0-9]/.test(clean)) return false;
    return true;
  }

  // AtCoder handle rules: 3-16 characters, alphanumeric and underscores only
  if (platform === 'atcoder') {
    if (clean.length < 3 || clean.length > 16) return false;
    if (!/^[a-zA-Z0-9_]{3,16}$/.test(clean)) return false;
    if (!/[a-zA-Z0-9]/.test(clean)) return false;
    return true;
  }

  return clean.length >= 2;
}

/**
 * Filter an array or comma-separated string of handles to only syntactically valid handles.
 * @param {string|string[]} rawHandles
 * @param {string} [platform='codeforces']
 * @returns {string[]}
 */
function sanitizeHandles(rawHandles, platform) {
  var list = Array.isArray(rawHandles)
    ? rawHandles
    : String(rawHandles || '').split(',');

  var result = [];
  var seen = {};

  for (var i = 0; i < list.length; i++) {
    var h = String(list[i] || '').trim();
    if (!h) continue;
    var norm = h.toLowerCase();
    if (seen[norm]) continue;
    seen[norm] = true;

    if (isValidHandleSyntax(h, platform)) {
      result.push(h);
    }
  }

  return result;
}

/**
 * Batch validate multiple Codeforces handles in a single user.info API request with caching.
 * @param {string[]} handles
 * @returns {Object.<string, boolean>} Map of handle -> boolean validity
 */
function validateCFHandlesBatch(handles) {
  var resultMap = {};
  if (!Array.isArray(handles) || handles.length === 0) return resultMap;

  var cache = CacheService.getScriptCache();
  var toFetch = [];

  for (var i = 0; i < handles.length; i++) {
    var h = String(handles[i] || '').trim();
    if (!isValidHandleSyntax(h, 'codeforces')) {
      resultMap[h] = false;
      continue;
    }

    var cacheKey = 'cf_hvalid_' + h.toLowerCase();
    var cached = cache.get(cacheKey);
    if (cached !== null && cached !== undefined) {
      resultMap[h] = cached === '1';
    } else {
      toFetch.push(h);
    }
  }

  if (toFetch.length === 0) return resultMap;

  // Batch in chunks of up to 50 handles per API request
  var chunkSize = 50;
  var cacheEntries = {};

  for (var c = 0; c < toFetch.length; c += chunkSize) {
    var chunk = toFetch.slice(c, c + chunkSize);
    try {
      var url = 'https://codeforces.com/api/user.info?handles=' + chunk.map(encodeURIComponent).join(';');
      var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
      if (res && res.getResponseCode() === 200) {
        var json = JSON.parse(res.getContentText());
        if (json && json.status === 'OK' && Array.isArray(json.result)) {
          var validFound = {};
          for (var j = 0; j < json.result.length; j++) {
            var user = json.result[j];
            if (user && user.handle) {
              validFound[user.handle.toLowerCase()] = true;
            }
          }

          for (var k = 0; k < chunk.length; k++) {
            var handleName = chunk[k];
            var isValid = !!validFound[handleName.toLowerCase()];
            resultMap[handleName] = isValid;
            cacheEntries['cf_hvalid_' + handleName.toLowerCase()] = isValid ? '1' : '0';
          }
          continue;
        }
      }

      // If batch fails (e.g. single bad handle in batch), fallback to individual check for this chunk
      for (var f = 0; f < chunk.length; f++) {
        var singleHandle = chunk[f];
        var singleValid = isSingleCFHandleValid(singleHandle);
        resultMap[singleHandle] = singleValid;
        cacheEntries['cf_hvalid_' + singleHandle.toLowerCase()] = singleValid ? '1' : '0';
      }
    } catch (e) {
      Logger.log('CF handle batch validation error for chunk: ' + e);
      for (var errIdx = 0; errIdx < chunk.length; errIdx++) {
        var eh = chunk[errIdx];
        resultMap[eh] = false;
      }
    }
  }

  // Bulk put into cache
  try {
    if (Object.keys(cacheEntries).length > 0) {
      cache.putAll(cacheEntries, HANDLE_CACHE_TTL_SECONDS);
    }
  } catch (ce) {
    Logger.log('Cache putAll error for CF handles: ' + ce);
  }

  return resultMap;
}

/**
 * Single CF handle validation fallback.
 */
function isSingleCFHandleValid(handle) {
  if (!isValidHandleSyntax(handle, 'codeforces')) return false;
  try {
    var url = 'https://codeforces.com/api/user.info?handles=' + encodeURIComponent(handle);
    var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (!res || res.getResponseCode() !== 200) return false;
    var json = JSON.parse(res.getContentText());
    return json && json.status === 'OK' && Array.isArray(json.result) && json.result.length > 0;
  } catch (e) {
    return false;
  }
}

// ─── Main Server-Side Verification Gateway ──────────────────────────

/**
 * Main server-side verification gateway.
 * Returns authoritative problem metadata or throws if verification fails.
 */
function verifyProblemServer(urlOrCode, studentInfo, studentSheet, manualVerdict, manualSubs) {
  var raw = String(urlOrCode || '').trim();
  if (!raw) {
    throw new Error('Problem URL or unique problem code is required.');
  }

  var todayDateStr = toSheetDate(new Date());
  var cfHandles = sanitizeHandles(studentInfo.cfHandle, 'codeforces');
  var lcHandles = sanitizeHandles(studentInfo.leetCodeHandle, 'leetcode');

  // ── 1. Parse Input Platform ──────────────────────────────────────
  var parsed = parseProblemServerInput(raw);

  if (parsed.isInvalidUrl) {
    throw new Error(parsed.error || 'Invalid problem link format.');
  }

  // ── 2. Codeforces Auto-Verified Problem ───────────────────────────
  if (parsed.platform === 'codeforces' && !parsed.isGym) {
    if (cfHandles.length === 0) {
      throw new Error('No valid Codeforces handle registered in course roster for student ' + (studentInfo.matricId || 'N/A') + '. Please update your handle in the Roster sheet.');
    }
    // Batch pre-validate handles to avoid querying non-existent accounts
    var validMap = validateCFHandlesBatch(cfHandles);
    var verifiedHandles = cfHandles.filter(function(h) { return validMap[h]; });
    if (verifiedHandles.length === 0) {
      throw new Error('Registered Codeforces handle(s) [' + cfHandles.join(', ') + '] do not exist on Codeforces. Please check spelling.');
    }

    return verifyCodeforcesServer(verifiedHandles, parsed.contestId, parsed.problemIndex, parsed.canonicalUrl, manualVerdict, manualSubs);
  }

  // ── 3. LeetCode Auto-Verified Problem ────────────────────────────
  if (parsed.platform === 'leetcode') {
    if (lcHandles.length === 0) {
      throw new Error('No valid LeetCode handle registered in course roster for student ' + (studentInfo.matricId || 'N/A') + '. Please update your handle in the Roster sheet.');
    }
    return verifyLeetCodeServer(lcHandles, parsed.titleSlug, parsed.canonicalUrl, manualVerdict, manualSubs);
  }

  // ── 3.5. AtCoder Auto-Verified Problem ──────────────────────────
  if (parsed.platform === 'atcoder') {
    var acHandles = sanitizeHandles(studentInfo.atCoderHandle, 'atcoder');
    if (acHandles.length === 0) {
      // Fall through to manual if no handle registered
      Logger.log('No valid AtCoder handle for student ' + (studentInfo.matricId || 'N/A') + '. Falling through to manual verification.');
    } else {
      return verifyAtCoderServer(acHandles, parsed.contestId, parsed.problemId, parsed.canonicalUrl, manualVerdict, manualSubs);
    }
  }

  // ── 4. Manual Platforms (Gym, CSES, VJudge, Toph, etc.) ──
  // Unrestricted manual problem submissions (no artificial daily limits)
  if (MAX_MANUAL_SOLVES_PER_DAY > 0) {
    var manualCountToday = countManualSubmissionsToday(studentSheet, todayDateStr);
    if (manualCountToday >= MAX_MANUAL_SOLVES_PER_DAY) {
      throw new Error('Daily limit of ' + MAX_MANUAL_SOLVES_PER_DAY + ' manual problem submissions reached for today (' + todayDateStr + '). Please submit verified Codeforces/LeetCode/AtCoder problems or contact an instructor.');
    }
  }

  var finalVerdict = String(manualVerdict || 'AC').toUpperCase().trim();
  var finalSubs = Math.max(toNum(manualSubs) || 1, 1);

  return {
    url: parsed.canonicalUrl || raw,
    canonicalName: parsed.canonicalName || raw,
    verdict: finalVerdict,
    submissionCount: finalSubs,
    rating: '',
    category: parsed.category || 'Other OJ',
    date: todayDateStr,
    isAutoVerified: false,
    verificationType: 'MANUAL',
  };
}

// ─── Codeforces Server Verifier (Compact Cache + Tiered Fetch) ─────

function verifyCodeforcesServer(handles, targetContestId, targetIndex, canonicalUrl, manualVerdict, manualSubs) {
  var targetCid = String(targetContestId).trim();
  var targetIdx = String(targetIndex).toUpperCase().trim();
  var targetKey = targetCid + targetIdx;

  var cache = CacheService.getScriptCache();
  var foundSub = null;

  for (var hIdx = 0; hIdx < handles.length; hIdx++) {
    var handle = handles[hIdx];
    var cacheKey = 'cf_idx_' + handle.toLowerCase();
    var cachedJson = cache.get(cacheKey);
    var subMap = null;

    if (cachedJson) {
      try {
        subMap = JSON.parse(cachedJson);
      } catch (e) {
        subMap = null;
      }
    }

    // Cache hit: Check if target problem exists in cached compact map
    if (subMap && subMap[targetKey]) {
      foundSub = subMap[targetKey];
      break;
    }

    // Cache miss / not in cache -> Tier 1 Fetch (count=200)
    var tier1Map = fetchAndIndexCFSubmissions(handle, 1, 200);
    if (tier1Map[targetKey]) {
      foundSub = tier1Map[targetKey];
      cache.put(cacheKey, JSON.stringify(tier1Map), CACHE_TTL_SECONDS);
      break;
    }

    // Target not in recent 200 -> Tier 2 Fetch (count=2000 fallback)
    var tier2Map = fetchAndIndexCFSubmissions(handle, 1, 2000);
    if (tier2Map[targetKey]) {
      foundSub = tier2Map[targetKey];
      cache.put(cacheKey, JSON.stringify(tier2Map), CACHE_TTL_SECONDS);
      break;
    }

    // Cache the Tier 2 map anyway to avoid re-fetching on next attempt
    cache.put(cacheKey, JSON.stringify(tier2Map), CACHE_TTL_SECONDS);
  }

  if (!foundSub) {
    var fallbackVerdict = String(manualVerdict || 'AC').toUpperCase().trim();
    var fallbackSubs = Math.max(toNum(manualSubs) || 1, 1);
    return {
      url: canonicalUrl || ('https://codeforces.com/problemset/problem/' + targetCid + '/' + targetIdx),
      canonicalName: 'CF ' + targetKey,
      verdict: fallbackVerdict,
      submissionCount: fallbackSubs,
      rating: '',
      category: 'Codeforces (Pending Review)',
      date: toSheetDate(new Date()),
      isAutoVerified: false,
      verificationType: 'PENDING_REVIEW',
    };
  }

  var v = foundSub.v === 'OK' ? 'AC' : (foundSub.v || 'WA');
  var solveDate = toSheetDate(new Date(foundSub.t * 1000));

  return {
    url: canonicalUrl || ('https://codeforces.com/problemset/problem/' + targetCid + '/' + targetIdx),
    canonicalName: 'CF ' + targetKey,
    verdict: v,
    submissionCount: foundSub.s || 1,
    rating: foundSub.r || '',
    category: foundSub.tags || 'Codeforces',
    date: solveDate,
    isAutoVerified: true,
    verificationType: 'CODEFORCES_API',
  };
}

/**
 * Fetch CF submissions and derive a compact index (<15KB) to fit under CacheService's 100KB limit.
 */
function fetchAndIndexCFSubmissions(handle, from, count) {
  var subMap = {};
  var attemptsMap = {};

  if (!handle || !isValidHandleSyntax(handle, 'codeforces')) {
    return subMap;
  }

  try {
    var url = 'https://codeforces.com/api/user.status?handle=' + encodeURIComponent(handle) + '&from=' + from + '&count=' + count;
    var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    var code = res.getResponseCode();

    if (code === 200) {
      var json = JSON.parse(res.getContentText());
      if (json.status === 'OK' && Array.isArray(json.result)) {
        // Reverse array so older submissions process first, newest overwrite
        var list = json.result.slice().reverse();
        for (var i = 0; i < list.length; i++) {
          var s = list[i];
          if (!s.problem || !s.problem.contestId || !s.problem.index) continue;
          var key = String(s.problem.contestId) + String(s.problem.index).toUpperCase().trim();

          attemptsMap[key] = (attemptsMap[key] || 0) + 1;

          var isAc = s.verdict === 'OK';
          var existing = subMap[key];

          if (!existing || isAc || existing.v !== 'OK') {
            subMap[key] = {
              v: s.verdict,
              r: s.problem.rating || '',
              s: attemptsMap[key],
              t: s.creationTimeSeconds,
              tags: Array.isArray(s.problem.tags) ? s.problem.tags.slice(0, 3).join(', ') : '',
            };
          } else {
            existing.s = attemptsMap[key];
          }
        }
      }
    }
  } catch (err) {
    Logger.log('CF fetch error for ' + handle + ': ' + err.message);
  }

  return subMap;
}

// ─── LeetCode Server Verifier (Direct GraphQL + Body Error Check) ───

function verifyLeetCodeServer(handles, targetSlug, canonicalUrl, manualVerdict, manualSubs) {
  var cleanSlug = String(targetSlug || '').toLowerCase().trim();
  var cache = CacheService.getScriptCache();
  var foundSub = null;

  for (var hIdx = 0; hIdx < handles.length; hIdx++) {
    var handle = handles[hIdx];
    var cacheKey = 'lc_sub_' + handle.toLowerCase();
    var cachedJson = cache.get(cacheKey);
    var subMap = null;

    if (cachedJson) {
      try {
        subMap = JSON.parse(cachedJson);
      } catch (e) {
        subMap = null;
      }
    }

    if (subMap && subMap[cleanSlug]) {
      foundSub = subMap[cleanSlug];
      break;
    }

    // Direct GraphQL query to leetcode.com/graphql
    var fetchedMap = fetchAndIndexLeetCodeGraphQL(handle);
    if (fetchedMap[cleanSlug]) {
      foundSub = fetchedMap[cleanSlug];
      cache.put(cacheKey, JSON.stringify(fetchedMap), CACHE_TTL_SECONDS);
      break;
    }
    cache.put(cacheKey, JSON.stringify(fetchedMap), CACHE_TTL_SECONDS);
  }

  // Graceful fallback for older submissions or when GraphQL is temporarily blocked
  if (!foundSub) {
    var fallbackVerdict = String(manualVerdict || 'AC').toUpperCase().trim();
    var fallbackSubs = Math.max(toNum(manualSubs) || 1, 1);
    return {
      url: canonicalUrl || ('https://leetcode.com/problems/' + cleanSlug + '/'),
      canonicalName: 'LC ' + cleanSlug.replace(/-/g, ' '),
      verdict: fallbackVerdict,
      submissionCount: fallbackSubs,
      rating: '',
      category: 'LeetCode',
      date: toSheetDate(new Date()),
      isAutoVerified: false,
      verificationType: 'LEETCODE_FALLBACK',
    };
  }

  return {
    url: canonicalUrl || ('https://leetcode.com/problems/' + cleanSlug + '/'),
    canonicalName: 'LC ' + cleanSlug.replace(/-/g, ' '),
    verdict: foundSub.v || 'AC',
    submissionCount: foundSub.s || 1,
    rating: '',
    category: 'LeetCode',
    date: toSheetDate(new Date(foundSub.t * 1000)),
    isAutoVerified: true,
    verificationType: 'LEETCODE_GRAPHQL',
  };
}

function fetchAndIndexLeetCodeGraphQL(handle) {
  var subMap = {};
  if (!handle || !isValidHandleSyntax(handle, 'leetcode')) return subMap;

  try {
    var graphqlQuery = JSON.stringify({
      query: 'query recentAcSubmissions($username: String!, $limit: Int!) { recentAcSubmissionList(username: $username, limit: $limit) { titleSlug status timestamp } }',
      variables: { username: handle, limit: 50 }
    });

    var res = UrlFetchApp.fetch('https://leetcode.com/graphql', {
      method: 'post',
      contentType: 'application/json',
      payload: graphqlQuery,
      muteHttpExceptions: true,
    });

    var code = res.getResponseCode();
    if (code === 200) {
      var json = JSON.parse(res.getContentText());
      if (json.data && Array.isArray(json.data.recentAcSubmissionList)) {
        var list = json.data.recentAcSubmissionList;
        for (var i = 0; i < list.length; i++) {
          var s = list[i];
          var slug = String(s.titleSlug || '').toLowerCase().trim();
          if (slug) {
            subMap[slug] = {
              v: 'AC',
              s: 1,
              t: Number(s.timestamp || 0),
            };
          }
        }
      }
    }
  } catch (err) {
    Logger.log('LeetCode GraphQL fetch error for ' + handle + ': ' + err.message);
  }

  return subMap;
}

// ─── Persistent Manual Rate Limiting ───────────────────────────────

/**
 * Scan the student's sheet rows to count how many manual problems have been logged today.
 */
function countManualSubmissionsToday(sheet, todayDateStr) {
  if (!sheet) return 0;
  var lastRow = Math.max(getLastRowInColumn(sheet, 6), 3);
  if (lastRow <= 3) return 0;

  var count = 0;
  // Read Column J (Date: col 10) and Column K (Category: col 11)
  var rangeData = sheet.getRange(4, 10, lastRow - 3, 2).getValues();

  for (var i = 0; i < rangeData.length; i++) {
    var rowDate = toSheetDate(rangeData[i][0]);
    var category = String(rangeData[i][1] || '').trim();

    if (rowDate === todayDateStr) {
      if (category === 'Gym' || category === 'CF Gym' || category === 'CSES' || category === 'AtCoder' ||
          category === 'VJudge' || category === 'Toph' || category === 'SPOJ' || category === 'LightOJ' ||
          category === 'CodeChef' || category === 'HackerRank' || category === 'Other OJ' || category === 'Other') {
        count++;
      }
    }
  }

  return count;
}

// ─── Server-Side Problem Parser ────────────────────────────────────

function parseProblemServerInput(rawInput) {
  var raw = String(rawInput || '').trim();
  var u = raw.toLowerCase();
  var res = {
    platform: 'other',
    isValid: true,
    isInvalidUrl: false,
    canonicalUrl: raw,
    canonicalName: raw,
    category: 'Other OJ',
    contestId: '',
    problemIndex: '',
    problemId: '',
    titleSlug: '',
    isGym: false
  };

  if (!raw) {
    res.isValid = false;
    res.isInvalidUrl = true;
    res.error = 'Empty problem input.';
    return res;
  }

  var isUrl = u.startsWith('http://') || u.startsWith('https://');

  // ── Codeforces Domain Detection (PRIORITY — checked before URL validation) ──
  // Any input containing codeforces.com is routed here immediately so the
  // generic URL validator can never accidentally reject a valid CF link.
  if (u.indexOf('codeforces.com') !== -1) {

    // Unsupported CF paths (groups, edu, newcomer rounds)
    if (/codeforces\.com\/(?:group|edu|newcomer)\//i.test(u)) {
      res.platform = 'codeforces_unsupported';
      res.category = 'Other OJ';
      return res;
    }

    res.platform = 'codeforces';

    // Gym URL: /gym/102951/problem/B  or  /gym/102951
    var gymMatch = raw.match(/gym\/(\d+)(?:\/problem\/([a-zA-Z]\d?))?/i);
    if (gymMatch) {
      res.isGym = true;
      res.contestId = gymMatch[1];
      res.problemIndex = (gymMatch[2] || 'A').toUpperCase();
      res.category = 'Gym';
      res.canonicalName = 'CF Gym ' + res.contestId + res.problemIndex;
      res.canonicalUrl = 'https://codeforces.com/gym/' + res.contestId + '/problem/' + res.problemIndex;
      return res;
    }

    // Contest URL: /contest/1768/problem/A  (with optional trailing slash, query, hash)
    // Problemset URL: /problemset/problem/1768/A
    // Problems URL: /problems/1768/A  (alternate path)
    var cfUrlMatch = raw.match(/(?:contest|problemset\/problem|problems)\/(\d+)\/(?:problem\/)?([a-zA-Z]\d?)/i);
    if (cfUrlMatch) {
      res.isGym = false;
      res.contestId = cfUrlMatch[1];
      res.problemIndex = cfUrlMatch[2].toUpperCase();
      res.category = 'Codeforces';
      res.canonicalName = 'CF ' + res.contestId + res.problemIndex;
      res.canonicalUrl = 'https://codeforces.com/problemset/problem/' + res.contestId + '/' + res.problemIndex;
      return res;
    }

    // Fallback: any codeforces.com path containing /digits/letter pattern
    // e.g. https://codeforces.com/1768/A or mangled URLs
    var cfPathFallback = raw.match(/codeforces\.com\/.*?(\d{1,6})\/([a-zA-Z]\d?)/i);
    if (cfPathFallback) {
      res.isGym = false;
      res.contestId = cfPathFallback[1];
      res.problemIndex = cfPathFallback[2].toUpperCase();
      res.category = 'Codeforces';
      res.canonicalName = 'CF ' + res.contestId + res.problemIndex;
      res.canonicalUrl = 'https://codeforces.com/problemset/problem/' + res.contestId + '/' + res.problemIndex;
      return res;
    }

    // CF domain present but no parseable problem — still mark as CF
    res.category = 'Codeforces';
    return res;
  }

  // ── LeetCode Domain Detection ──
  if (u.indexOf('leetcode.com') !== -1) {
    res.platform = 'leetcode';
    res.category = 'LeetCode';
    var lcMatch = raw.match(/problems\/([a-zA-Z0-9-]+)/i);
    if (lcMatch) {
      res.titleSlug = lcMatch[1].toLowerCase().replace(/\/+$/, '');
      res.canonicalName = 'LC ' + res.titleSlug.replace(/-/g, ' ');
      res.canonicalUrl = 'https://leetcode.com/problems/' + res.titleSlug + '/';
      return res;
    }
    return res;
  }

  // ── Generic URL Validation (only for non-CF, non-LC URLs) ──
  if (isUrl) {
    var urlPattern = /^https?:\/\/([^\/\s:]+)(?::\d+)?(\/[^\s]*)?$/i;
    var urlMatch = raw.match(urlPattern);
    if (!urlMatch || !urlMatch[1] || urlMatch[1].indexOf('.') === -1) {
      res.isInvalidUrl = true;
      res.error = 'Invalid URL format.';
      return res;
    }
  }

  // ── Codeforces Gym Short Code: "gym 102951A", "cf gym 102951/B" ──
  var gymCodeMatch = raw.match(/^(?:gym|cf\s*gym)\s*[:#\/-]?\s*(\d{4,8})\s*(?:\/|-|_|\s)?\s*([a-zA-Z]\d?)?$/i);
  if (gymCodeMatch) {
    res.platform = 'codeforces';
    res.isGym = true;
    res.contestId = gymCodeMatch[1];
    res.problemIndex = (gymCodeMatch[2] || 'A').toUpperCase();
    res.category = 'Gym';
    res.canonicalName = 'CF Gym ' + res.contestId + res.problemIndex;
    res.canonicalUrl = 'https://codeforces.com/gym/' + res.contestId + '/problem/' + res.problemIndex;
    return res;
  }

  // ── Other Known OJ Domains & Short Prefixes ──
  if (u.indexOf('cses.fi') !== -1 || /^cses\s+/i.test(raw)) { res.category = 'CSES'; return res; }

  // ── AtCoder Domain Detection ──
  if (u.indexOf('atcoder.jp') !== -1) {
    res.platform = 'atcoder';
    res.category = 'AtCoder';
    // URL pattern: atcoder.jp/contests/{contest_id}/tasks/{problem_id}
    var acUrlMatch = raw.match(/atcoder\.jp\/contests\/([a-zA-Z0-9_]+)\/tasks\/([a-zA-Z0-9_]+)/i);
    if (acUrlMatch) {
      res.contestId = acUrlMatch[1].toLowerCase();
      res.problemId = acUrlMatch[2].toLowerCase();
      res.canonicalName = 'AC ' + res.problemId;
      res.canonicalUrl = 'https://atcoder.jp/contests/' + res.contestId + '/tasks/' + res.problemId;
    }
    return res;
  }
  if (u.indexOf('vjudge.net') !== -1 || /^(?:vjudge|vj)\s+/i.test(raw)) { res.category = 'VJudge'; return res; }
  if (u.indexOf('toph.co') !== -1 || /^toph\s+/i.test(raw)) { res.category = 'Toph'; return res; }
  if (u.indexOf('spoj.com') !== -1 || /^spoj\s+/i.test(raw)) { res.category = 'SPOJ'; return res; }
  if (u.indexOf('lightoj.com') !== -1 || /^(?:lightoj|loj)\s+/i.test(raw)) { res.category = 'LightOJ'; return res; }
  if (u.indexOf('codechef.com') !== -1 || /^(?:codechef|cc)\s+/i.test(raw)) { res.category = 'CodeChef'; return res; }
  if (u.indexOf('hackerrank.com') !== -1 || /^(?:hackerrank|hr)\s+/i.test(raw)) { res.category = 'HackerRank'; return res; }

  // ── Codeforces Page Title / Short Code ──
  // Matches: "Problem - 1669B - Codeforces", "1669B", "CF 1800C1", "cf:1768A",
  //          "CF-1768-A", "codeforces 1768A", "1768 A", "1768/A", "1768_A"

  // Pattern 1: Title-style with "Codeforces" keyword anywhere
  var cfTitleMatch = raw.match(/(?:problem\s*[-\u2013\u2014:]*\s*)?([1-9]\d{0,4})\s*([a-zA-Z]\d?)(?:\s*[-\u2013\u2014:]*(?:[a-zA-Z0-9_\s]+)?[-\u2013\u2014:]*\s*codeforces|\s*[-\u2013\u2014:]*\s*codeforces)/i)
    || raw.match(/codeforces\s*[-\u2013\u2014:]*\s*(?:problem\s*)?([1-9]\d{0,4})\s*[-\u2013\u2014:#\/_ ]?\s*([a-zA-Z]\d?)/i)
    || raw.match(/^(?:problem\s*[:#-]?\s*)?([1-9]\d{0,4})\s*(?:\/|-|_|\s)?\s*([a-zA-Z]\d?)\s*[-\u2013\u2014:]*\s*codeforces/i);

  // Pattern 2: Explicit prefix: "cf 1768A", "CF:1768A", "cf-1768-A", "CF#1768A", "[CF] 1768A", with optional trailing title
  var cfExplicitMatch = raw.match(/^\[?(?:cf|codeforces)\]?\s*[:#\-\/]?\s*([1-9]\d{0,4})\s*[-\u2013\u2014:#\/_ ]?\s*([a-zA-Z]\d?)(?:(?:\s*[-\u2013\u2014.:\(\[]|\s+).*)?$/i);

  // Pattern 3: "Problem" prefix: "Problem 1768A", "Problem 1768 A - Name", "Problem: 1768A"
  var cfProblemMatch = raw.match(/^problem\s*[:#\-]?\s*([1-9]\d{0,4})\s*(?:\/|-|_|\s)?\s*([a-zA-Z]\d?)(?:(?:\s*[-\u2013\u2014.:\(\[]|\s+).*)?$/i);

  // Pattern 4: Bare format with optional name: "1768A", "1768 A", "1768-A", "1768/A", "1768_A", "1768A1", "1768A - Hayato and School", "1768A. Hayato"
  var cfBareMatch = raw.match(/^([1-9]\d{0,4})\s*(?:\/|-|_|\s)?\s*([a-zA-Z]\d?)(?:$|(?:\s*[-\u2013\u2014.:\(\/]\s*|\s+)[a-zA-Z0-9].*)/i);

  var cfMatch = cfTitleMatch || cfExplicitMatch || cfProblemMatch || cfBareMatch;
  if (cfMatch) {
    res.platform = 'codeforces';
    res.isGym = false;
    res.contestId = cfMatch[1];
    res.problemIndex = cfMatch[2].toUpperCase();
    res.category = 'Codeforces';
    res.canonicalName = 'CF ' + res.contestId + res.problemIndex;
    res.canonicalUrl = 'https://codeforces.com/problemset/problem/' + res.contestId + '/' + res.problemIndex;
    return res;
  }

  // ── LeetCode Short Slug: "two-sum", "path-sum-ii", "lc: 3sum-closest" ──
  var lcCodeMatch = raw.match(/^(?:lc|leetcode)\s*[:#\-]?\s*([a-zA-Z0-9-]+)$/i);
  var lcSlugMatch = /^[a-z][a-z0-9]*-[a-z0-9]+-?[a-z0-9-]*$/i.test(raw) && raw.length >= 4 ? [null, raw] : null;
  var lcCode = lcCodeMatch || lcSlugMatch;
  if (lcCode) {
    res.platform = 'leetcode';
    res.category = 'LeetCode';
    res.titleSlug = lcCode[1].toLowerCase();
    res.canonicalName = 'LC ' + res.titleSlug.replace(/-/g, ' ');
    res.canonicalUrl = 'https://leetcode.com/problems/' + res.titleSlug + '/';
    return res;
  }

  // ── AtCoder Short Code: "atcoder abc350_a", "AC abc350 a", "ac:abc350_a" ──
  var acCodeMatch = raw.match(/^(?:ac|atcoder)\s*[:#\-]?\s*([a-zA-Z0-9_]+)$/i);
  if (acCodeMatch) {
    var acProbId = acCodeMatch[1].toLowerCase();
    // Derive contest_id from problem_id (e.g. abc350_a -> abc350)
    var acContestMatch = acProbId.match(/^([a-z]+\d+)/i);
    res.platform = 'atcoder';
    res.category = 'AtCoder';
    res.problemId = acProbId;
    res.contestId = acContestMatch ? acContestMatch[1].toLowerCase() : acProbId;
    res.canonicalName = 'AC ' + acProbId;
    res.canonicalUrl = 'https://atcoder.jp/contests/' + res.contestId + '/tasks/' + acProbId;
    return res;
  }

  return res;
}

// ─── AtCoder Server Verifier (AtCoder Problems API) ────────────────

var ATCODER_API_BASE = 'https://kenkoooo.com/atcoder/atcoder-api/v3';
var ATCODER_DIFFICULTY_URL = 'https://kenkoooo.com/atcoder/resources/problem-models.json';
var ATCODER_DIFFICULTY_CACHE_TTL = 86400; // 24 hours

/**
 * Verify an AtCoder problem submission using the AtCoder Problems API.
 * @param {string[]} handles - Validated AtCoder handles.
 * @param {string} targetContestId - e.g. 'abc350'.
 * @param {string} targetProblemId - e.g. 'abc350_a'.
 * @param {string} canonicalUrl - Canonical URL for the problem.
 * @param {string} manualVerdict - Fallback verdict from user input.
 * @param {number} manualSubs - Fallback submission count from user input.
 * @returns {Object} Verification result.
 */
function verifyAtCoderServer(handles, targetContestId, targetProblemId, canonicalUrl, manualVerdict, manualSubs) {
  var targetKey = String(targetProblemId || '').toLowerCase().trim();
  var cache = CacheService.getScriptCache();
  var foundSub = null;

  for (var hIdx = 0; hIdx < handles.length; hIdx++) {
    var handle = handles[hIdx];
    var cacheKey = 'ac_sub_' + handle.toLowerCase();
    var cachedJson = cache.get(cacheKey);
    var subMap = null;

    if (cachedJson) {
      try {
        subMap = JSON.parse(cachedJson);
      } catch (e) {
        subMap = null;
      }
    }

    // Cache hit
    if (subMap && subMap[targetKey]) {
      foundSub = subMap[targetKey];
      break;
    }

    // Cache miss → fetch from AtCoder Problems API
    // Tier 1: Recent 6 months
    var sixMonthsAgo = Math.floor((Date.now() - 180 * 86400 * 1000) / 1000);
    var tier1Map = fetchAndIndexAtCoderSubmissions(handle, sixMonthsAgo);
    if (tier1Map[targetKey]) {
      foundSub = tier1Map[targetKey];
      cache.put(cacheKey, JSON.stringify(tier1Map), CACHE_TTL_SECONDS);
      break;
    }

    // Tier 2: All time
    var tier2Map = fetchAndIndexAtCoderSubmissions(handle, 0);
    if (tier2Map[targetKey]) {
      foundSub = tier2Map[targetKey];
      cache.put(cacheKey, JSON.stringify(tier2Map), CACHE_TTL_SECONDS);
      break;
    }

    // Cache the tier 2 map to avoid re-fetching
    cache.put(cacheKey, JSON.stringify(tier2Map), CACHE_TTL_SECONDS);
  }

  if (!foundSub) {
    var fallbackVerdict = String(manualVerdict || 'AC').toUpperCase().trim();
    var fallbackSubs = Math.max(toNum(manualSubs) || 1, 1);
    return {
      url: canonicalUrl || ('https://atcoder.jp/contests/' + targetContestId + '/tasks/' + targetKey),
      canonicalName: 'AC ' + targetKey,
      verdict: fallbackVerdict,
      submissionCount: fallbackSubs,
      rating: '',
      category: 'AtCoder (Pending Review)',
      date: toSheetDate(new Date()),
      isAutoVerified: false,
      verificationType: 'PENDING_REVIEW',
    };
  }

  // Fetch difficulty if available
  var difficultyMap = fetchAtCoderDifficultyMap(targetKey);
  var difficulty = (difficultyMap && difficultyMap[targetKey]) ? difficultyMap[targetKey] : '';

  var v = foundSub.v === 'AC' ? 'AC' : (foundSub.v || 'WA');
  var solveDate = toSheetDate(new Date(foundSub.t * 1000));

  return {
    url: canonicalUrl || ('https://atcoder.jp/contests/' + targetContestId + '/tasks/' + targetKey),
    canonicalName: 'AC ' + targetKey,
    verdict: v,
    submissionCount: foundSub.s || 1,
    rating: difficulty,
    category: 'AtCoder',
    date: solveDate,
    isAutoVerified: true,
    verificationType: 'ATCODER_API',
  };
}

/**
 * Fetch AC submissions from AtCoder Problems API and index by problem_id.
 * Rate limit: Must sleep 1s between calls (handled by caller or throttle).
 * @param {string} handle - AtCoder username.
 * @param {number} fromSecond - Unix timestamp to fetch submissions from.
 * @returns {Object.<string, Object>} Map of problem_id -> { v, t, s }.
 */
function fetchAndIndexAtCoderSubmissions(handle, fromSecond) {
  var subMap = {};
  var attemptsMap = {};

  if (!handle || !isValidHandleSyntax(handle, 'atcoder')) {
    return subMap;
  }

  try {
    var url = ATCODER_API_BASE + '/user/submissions?user=' + encodeURIComponent(handle) + '&from_second=' + (fromSecond || 0);
    var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    var code = res.getResponseCode();

    if (code === 200) {
      var list = JSON.parse(res.getContentText());
      if (Array.isArray(list)) {
        // Sort by epoch_second ascending so newest overwrite oldest
        list.sort(function(a, b) { return a.epoch_second - b.epoch_second; });

        for (var i = 0; i < list.length; i++) {
          var s = list[i];
          if (!s.problem_id) continue;
          var key = String(s.problem_id).toLowerCase();

          attemptsMap[key] = (attemptsMap[key] || 0) + 1;

          var isAc = s.result === 'AC';
          var existing = subMap[key];

          if (!existing || isAc || existing.v !== 'AC') {
            subMap[key] = {
              v: s.result || '',
              s: attemptsMap[key],
              t: s.epoch_second || 0,
              cid: s.contest_id || '',
              execTime: s.execution_time || 0,
            };
          } else {
            existing.s = attemptsMap[key];
          }
        }
      }
    } else {
      Logger.log('AtCoder API returned status ' + code + ' for handle ' + handle);
    }
  } catch (err) {
    Logger.log('AtCoder fetch error for ' + handle + ': ' + err.message);
  }

  // Throttle: sleep 1s to respect AtCoder Problems API rate limit
  Utilities.sleep(1100);

  return subMap;
}

/**
 * Fetch and cache AtCoder problem difficulty ratings from problem-models.json.
 * Returns a map of problem_id -> difficulty (integer).
 * Cached for 24 hours. Returns empty map on failure.
 * @returns {Object.<string, number>}
 */
function fetchAtCoderDifficultyMap(targetProblemId) {
  // If in-memory cache is already loaded, use it immediately
  if (typeof _atcoderDifficultyCache !== 'undefined' && _atcoderDifficultyCache) {
    return _atcoderDifficultyCache;
  }

  var cache = CacheService.getScriptCache();
  // Fast path for single problem lookups (e.g. onEdit verification):
  if (targetProblemId) {
    try {
      var cachedSingle = cache.get('ac_diff_' + targetProblemId);
      if (cachedSingle) {
        var map = {};
        map[targetProblemId] = Number(cachedSingle);
        return map;
      }
    } catch (e) { /* ignore cache read error */ }
  }

  // Fetch fresh problem models from Kenkoooo
  var diffMap = {};
  try {
    var res = UrlFetchApp.fetch(ATCODER_DIFFICULTY_URL, { muteHttpExceptions: true });
    if (res && res.getResponseCode() === 200) {
      var raw = JSON.parse(res.getContentText());
      // Extract only problem_id -> difficulty integer (compact)
      for (var pid in raw) {
        if (raw.hasOwnProperty(pid) && raw[pid] && typeof raw[pid].difficulty === 'number') {
          diffMap[pid] = Math.round(raw[pid].difficulty);
        }
      }

      // Cache target problem in CacheService (per-key 100KB limit; avoids PropertiesService 9KB limit)
      if (targetProblemId && diffMap[targetProblemId]) {
        try {
          cache.put('ac_diff_' + targetProblemId, String(diffMap[targetProblemId]), 86400); // 24 hours
        } catch (ce) { /* ignore */ }
      }
    }
  } catch (err) {
    Logger.log('AtCoder difficulty fetch error: ' + err.message);
  }

  _atcoderDifficultyCache = diffMap;
  Utilities.sleep(1100); // Rate limit
  return diffMap;
}

var _atcoderDifficultyCache = null;

// ─── Utility Helpers ───────────────────────────────────────────────


function toNum(v) {
  var n = Number(v);
  return isNaN(n) ? 0 : n;
}

function toSheetDate(d) {
  if (!d) return '';
  var dt = (d instanceof Date) ? d : new Date(d);
  if (isNaN(dt.getTime())) return '';
  return (dt.getMonth() + 1) + '/' + dt.getDate() + '/' + dt.getFullYear();
}

function getLastRowInColumn(sheet, colIndex) {
  if (!sheet) return 0;
  var data = sheet.getRange(1, colIndex, sheet.getMaxRows(), 1).getValues();
  for (var i = data.length - 1; i >= 0; i--) {
    if (data[i][0] !== '' && data[i][0] !== null && data[i][0] !== undefined) {
      return i + 1;
    }
  }
  return 0;
}
