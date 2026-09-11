/**
 * ═══════════════════════════════════════════════════════════════════
 * AuditFetch.gs — External Platform Submission Fetching & Indexing
 *
 * RESPONSIBILITIES:
 * - Parallel batch fetching of Codeforces submissions with retry
 * - Compactification of raw submission payloads (preserving tags)
 * - Authoritative Codeforces submission indexing
 * - AtCoder cohort submission fetching and indexing
 * ═══════════════════════════════════════════════════════════════════
 */

/* ═══════════════════════════════════════════════════════════════════
   REUSABLE FETCH & DATA HELPERS
   ═══════════════════════════════════════════════════════════════════ */

/**
 * Compactify a raw CF submission object into a minimal storage-efficient record.
 * Eliminates duplicate compaction logic across fetch paths.
 * @param {Object} s - Raw CF API submission object.
 * @param {string} handle - The CF handle this submission belongs to.
 * @returns {Object|null} Compact submission or null if invalid.
 */
function compactifySubmission(s, handle) {
  if (!s || !s.problem || !s.problem.contestId || !s.problem.index) return null;
  return {
    c: String(s.problem.contestId),
    i: String(s.problem.index).toUpperCase(),
    v: s.verdict || '',
    t: Number(s.creationTimeSeconds || 0),
    r: s.problem.rating ? Number(s.problem.rating) : 0,
    h: handle,
    id: s.id || 0,
    tags: Array.isArray(s.problem.tags) ? s.problem.tags.join(',') : ''
  };
}

/**
 * Unified retry wrapper for UrlFetchApp.fetchAll() with exponential backoff.
 * Handles 429/503 rate-limit responses and transient network failures.
 * @param {Object[]} requests - Array of request objects for fetchAll.
 * @param {number} [maxRetries=3] - Maximum retry attempts.
 * @param {string} [label=''] - Logging label for diagnostics.
 * @returns {HTTPResponse[]|null} Array of responses or null if all retries failed.
 */
function fetchAllWithRetry(requests, maxRetries, label) {
  var retries = maxRetries || 3;
  var tag = label || 'fetchAll';
  var responses = null;

  for (var attempt = 1; attempt <= retries; attempt++) {
    try {
      responses = UrlFetchApp.fetchAll(requests);
      var needRetry = false;
      if (responses && responses.length > 0) {
        for (var chk = 0; chk < responses.length; chk++) {
          var rCode = responses[chk] ? responses[chk].getResponseCode() : 0;
          if (rCode === 429 || rCode === 503) {
            needRetry = true;
            break;
          }
        }
      }
      if (needRetry && attempt < retries) {
        var waitTime = 1500 * attempt;
        Logger.log('⏳ ' + tag + ': rate limit / busy (attempt ' + attempt + '/' + retries + '). Pausing ' + waitTime + 'ms...');
        Utilities.sleep(waitTime);
        continue;
      }
      return responses;
    } catch (err) {
      Logger.log('⚠️ ' + tag + ' error (attempt ' + attempt + '/' + retries + '): ' + err);
      if (attempt < retries) {
        Utilities.sleep(1500 * attempt);
      }
    }
  }
  return null;
}

/* ═══════════════════════════════════════════════════════════════════
   ASYNCHRONOUS PARALLEL FETCH CYCLES & SERIALIZATION
   ═══════════════════════════════════════════════════════════════════ */

/**
 * Fetch CF submission history in parallel for all verified handles across the cohort.
 * Uses UrlFetchApp.fetchAll() partitioned in micro-batches with rate-limiting pauses.
 * @param {string[]} handlesList - List of validated CF handles.
 * @returns {Object.<string, Array>} Map of handle -> submission records.
 */
function fetchCohortSubmissionsParallel(handlesList) {
  var resultMap = {};
  if (!Array.isArray(handlesList) || handlesList.length === 0) return resultMap;

  var cache = CacheService.getScriptCache();
  var handlesToFetch = [];

  // Check script cache first (<90KB per handle compact representation)
  for (var i = 0; i < handlesList.length; i++) {
    var handle = handlesList[i];
    var cacheKey = 'cf_all_' + handle.toLowerCase();
    var cached = cache.get(cacheKey);
    if (cached) {
      try {
        var parsed = JSON.parse(cached);
        if (Array.isArray(parsed)) {
          resultMap[handle.toLowerCase()] = parsed;
          continue;
        }
      } catch (e) { /* ignore cache parse error */ }
    }
    handlesToFetch.push(handle);
  }

  if (handlesToFetch.length === 0) return resultMap;

  // Process handlesToFetch in serialized parallel micro-batches
  var subBatchSize = AUDIT_PARALLEL_BATCH_SIZE;
  var cacheEntriesToStore = {};

  for (var b = 0; b < handlesToFetch.length; b += subBatchSize) {
    var subBatch = handlesToFetch.slice(b, b + subBatchSize);

    // Build parallel request objects
    var requests = subBatch.map(function(h) {
      return {
        url: 'https://codeforces.com/api/user.status?handle=' + encodeURIComponent(h) + '&from=1&count=200',
        method: 'get',
        muteHttpExceptions: true
      };
    });

    var responses = fetchAllWithRetry(requests, 3, 'CF sub-batch ' + b);
    if (!responses) continue;

    try {
      var deeperFetchNeeded = [];

      for (var r = 0; r < responses.length; r++) {
        var resp = responses[r];
        var curHandle = subBatch[r];
        var curHandleLower = curHandle.toLowerCase();
        var compactSubs = [];

        if (resp && resp.getResponseCode() === 200) {
          try {
            var json = JSON.parse(resp.getContentText());
            if (json && json.status === 'OK' && Array.isArray(json.result)) {
              for (var k = 0; k < json.result.length; k++) {
                var compact = compactifySubmission(json.result[k], curHandle);
                if (compact) compactSubs.push(compact);
              }

              // If count is 200, there might be more recent solves from earlier in the week
              if (json.result.length === 200) {
                deeperFetchNeeded.push({ handle: curHandle, initialSubs: compactSubs });
              } else {
                resultMap[curHandleLower] = compactSubs;
                var jsonStr = JSON.stringify(compactSubs);
                if (jsonStr.length <= 90000) {
                  cacheEntriesToStore['cf_all_' + curHandleLower] = jsonStr;
                }
              }
            }
          } catch (pe) {
            Logger.log('Error parsing parallel CF response for ' + curHandle + ': ' + pe);
          }
        }
      }

      // Handle deeper fetch for high-volume handles (from=201&count=500)
      if (deeperFetchNeeded.length > 0) {
        var deepRequests = deeperFetchNeeded.map(function(dfItem) {
          return {
            url: 'https://codeforces.com/api/user.status?handle=' + encodeURIComponent(dfItem.handle) + '&from=201&count=500',
            method: 'get',
            muteHttpExceptions: true
          };
        });

        var deepResponses = fetchAllWithRetry(deepRequests, 3, 'CF deep fetch');

        if (deepResponses) {
          for (var d = 0; d < deepResponses.length; d++) {
            var dResp = deepResponses[d];
            var dItem = deeperFetchNeeded[d];
            var dHandleLower = dItem.handle.toLowerCase();
            var mergedSubs = dItem.initialSubs;

            if (dResp && dResp.getResponseCode() === 200) {
              try {
                var dJson = JSON.parse(dResp.getContentText());
                if (dJson && dJson.status === 'OK' && Array.isArray(dJson.result)) {
                  if (dJson.result.length === 500) {
                    Logger.log('⚠️ CF submission deep-fetch ceiling reached (700 subs) for handle ' + dItem.handle + '. Older submissions from this week may be truncated.');
                  }
                  for (var dk = 0; dk < dJson.result.length; dk++) {
                    var dCompact = compactifySubmission(dJson.result[dk], dItem.handle);
                    if (dCompact) mergedSubs.push(dCompact);
                  }
                }
              } catch (dpe) {
                Logger.log('Error parsing deep CF response for ' + dItem.handle + ': ' + dpe);
              }
            }

            resultMap[dHandleLower] = mergedSubs;
            var dJsonStr = JSON.stringify(mergedSubs);
            if (dJsonStr.length <= 90000) {
              cacheEntriesToStore['cf_all_' + dHandleLower] = dJsonStr;
            }
          }
        }
      }
    } catch (batchErr) {
      Logger.log('Parallel fetch processing error: ' + batchErr);
    }

    // Rate-limiting throttle between sub-batches
    if (b + subBatchSize < handlesToFetch.length) {
      Utilities.sleep(AUDIT_THROTTLE_MS);
    }
  }

  // D3: Batch cache writes using putAll within the 90KB safety threshold
  try {
    var cacheKeys = Object.keys(cacheEntriesToStore);
    var currentBatch = {};
    var currentBatchSize = 0;

    for (var cki = 0; cki < cacheKeys.length; cki++) {
      var ck = cacheKeys[cki];
      var val = cacheEntriesToStore[ck];
      var entrySize = ck.length + (val ? val.length : 0);

      // If adding this entry would exceed 90KB (safe margin below 100KB), flush current batch
      if (currentBatchSize + entrySize > 90000 && Object.keys(currentBatch).length > 0) {
        try {
          cache.putAll(currentBatch, AUDIT_CACHE_TTL);
        } catch (batchPutErr) {
          for (var bKey in currentBatch) {
            try { cache.put(bKey, currentBatch[bKey], AUDIT_CACHE_TTL); } catch (e) {}
          }
        }
        currentBatch = {};
        currentBatchSize = 0;
      }

      currentBatch[ck] = val;
      currentBatchSize += entrySize;
    }

    if (Object.keys(currentBatch).length > 0) {
      try {
        cache.putAll(currentBatch, AUDIT_CACHE_TTL);
      } catch (lastBatchErr) {
        for (var lbKey in currentBatch) {
          try { cache.put(lbKey, currentBatch[lbKey], AUDIT_CACHE_TTL); } catch (e) {}
        }
      }
    }
  } catch (ce) {
    Logger.log('Cache storage error for CF submissions: ' + ce);
  }

  return resultMap;
}

/**
 * Build fast in-memory submission index from fetched cohort data for a specific student's handles.
 */
function buildAuthoritativeCFIndex(studentHandles, cohortSubmissionsMap) {
  var index = {};          // key: contestId+index -> { bestVerdict, acTime, attempts, handles: {}, ratings: [], subs: [] }
  var contestHandles = {}; // contestId -> { handle: true }

  for (var h = 0; h < studentHandles.length; h++) {
    var handle = studentHandles[h];
    var handleLower = handle.toLowerCase();
    var subs = cohortSubmissionsMap[handleLower] || [];

    for (var s = 0; s < subs.length; s++) {
      var sub = subs[s];
      var key = String(sub.c) + String(sub.i).toUpperCase().trim();
      var t = Number(sub.t || 0);

      if (!index[key]) {
        index[key] = {
          subs: [],
          bestVerdict: null,
          acTime: null,
          attempts: 0,
          handles: {},
          ratings: [],
          contestId: String(sub.c)
        };
      }

      var entry = index[key];
      entry.subs.push(sub);
      entry.attempts++;
      entry.handles[handle] = true;
      if (sub.r) entry.ratings.push(Number(sub.r));

      if (sub.v === 'OK') {
        if (!entry.acTime || t < entry.acTime) {
          entry.acTime = t;
          entry.bestVerdict = 'OK';
        }
      } else if (!entry.bestVerdict) {
        entry.bestVerdict = sub.v;
      }

      // Track multi-handle participation
      var cid = String(sub.c);
      if (!contestHandles[cid]) contestHandles[cid] = {};
      contestHandles[cid][handle] = true;
    }
  }

  return {
    index: index,
    contestHandles: contestHandles,
    handles: studentHandles
  };
}


/* ═══════════════════════════════════════════════════════════════════
   ATCODER COHORT FETCH & INDEX
   ═══════════════════════════════════════════════════════════════════ */

/**
 * Fetch AtCoder submissions for all cohort handles.
 * Uses sequential fetching with 1.1s throttle (AtCoder Problems API rate limit).
 * @param {string[]} handlesList - List of AtCoder handles.
 * @returns {Object.<string, Object>} Map of handle -> submission map.
 */
function fetchCohortAtCoderSubmissions(handlesList) {
  var resultMap = {};
  if (!Array.isArray(handlesList) || handlesList.length === 0) return resultMap;

  var cache = CacheService.getScriptCache();
  var sixMonthsAgo = Math.floor((Date.now() - 180 * 86400 * 1000) / 1000);
  var missingHandles = [];

  for (var i = 0; i < handlesList.length; i++) {
    var handle = handlesList[i];
    if (!handle) continue;
    var handleLower = handle.toLowerCase();
    var cacheKey = 'ac_sub_' + handleLower;
    var cached = cache.get(cacheKey);

    if (cached) {
      try {
        var parsed = JSON.parse(cached);
        if (parsed && typeof parsed === 'object') {
          resultMap[handleLower] = parsed;
          continue;
        }
      } catch (e) { /* re-fetch */ }
    }
    missingHandles.push(handle);
  }

  if (missingHandles.length === 0) return resultMap;

  // D2: Batch into groups of 3 using UrlFetchApp.fetchAll with a 1.5s inter-batch throttle
  var batchSize = 3;
  var cacheEntriesToStore = {};

  for (var b = 0; b < missingHandles.length; b += batchSize) {
    var currentBatchHandles = missingHandles.slice(b, b + batchSize);
    var requests = [];

    for (var r = 0; r < currentBatchHandles.length; r++) {
      var h = currentBatchHandles[r];
      var url = ((typeof ATCODER_API_BASE !== 'undefined') ? ATCODER_API_BASE : 'https://kenkoooo.com/atcoder/atcoder-api/v3') +
        '/user/submissions?user=' + encodeURIComponent(h) + '&from_second=' + sixMonthsAgo;
      requests.push({ url: url, muteHttpExceptions: true });
    }

    try {
      if (typeof UrlFetchApp !== 'undefined' && typeof UrlFetchApp.fetchAll === 'function') {
        var responses = UrlFetchApp.fetchAll(requests);
        for (var respI = 0; respI < responses.length; respI++) {
          var hndl = currentBatchHandles[respI];
          var hndlLower = hndl.toLowerCase();
          var resp = responses[respI];
          var subMap = {};

          if (resp && resp.getResponseCode() === 200) {
            try {
              var list = JSON.parse(resp.getContentText());
              if (Array.isArray(list)) {
                list.sort(function(a, b) { return a.epoch_second - b.epoch_second; });
                var attemptsMap = {};
                for (var li = 0; li < list.length; li++) {
                  var s = list[li];
                  if (!s.problem_id) continue;
                  var pKey = String(s.problem_id).toLowerCase();
                  attemptsMap[pKey] = (attemptsMap[pKey] || 0) + 1;
                  var isAc = (s.result === 'AC');
                  var existing = subMap[pKey];
                  if (!existing || isAc || existing.v !== 'AC') {
                    subMap[pKey] = {
                      v: s.result || '',
                      s: attemptsMap[pKey],
                      t: s.epoch_second || 0,
                      cid: s.contest_id || '',
                      execTime: s.execution_time || 0
                    };
                  } else {
                    existing.s = attemptsMap[pKey];
                  }
                }
              }
            } catch (pErr) {
              Logger.log('AtCoder JSON parse error for ' + hndl + ': ' + pErr);
            }
          }
          resultMap[hndlLower] = subMap;
          var jsonStr = JSON.stringify(subMap);
          if (jsonStr.length <= 90000) {
            cacheEntriesToStore['ac_sub_' + hndlLower] = jsonStr;
          }
        }
      } else {
        // Fallback to sequential fetchAndIndexAtCoderSubmissions
        for (var seqI = 0; seqI < currentBatchHandles.length; seqI++) {
          var seqH = currentBatchHandles[seqI];
          var seqMap = fetchAndIndexAtCoderSubmissions(seqH, sixMonthsAgo);
          var seqLower = seqH.toLowerCase();
          resultMap[seqLower] = seqMap;
          var sStr = JSON.stringify(seqMap);
          if (sStr.length <= 90000) {
            cacheEntriesToStore['ac_sub_' + seqLower] = sStr;
          }
        }
      }
    } catch (batchErr) {
      Logger.log('AtCoder batch fetch error: ' + batchErr);
    }

    // Respect AtCoder API rate limits (1.5s delay between batches)
    if (b + batchSize < missingHandles.length) {
      Utilities.sleep(1500);
    }
  }

  // Safe batch cache write
  try {
    for (var cKey in cacheEntriesToStore) {
      try { cache.put(cKey, cacheEntriesToStore[cKey], (typeof AUDIT_CACHE_TTL !== 'undefined' ? AUDIT_CACHE_TTL : 900)); } catch (e) {}
    }
  } catch (ce) {}

  return resultMap;
}

/**
 * Build per-student AtCoder submission index from cohort data.
 * @param {string[]} studentHandles - Student's AtCoder handles.
 * @param {Object} cohortAtCoderMap - Cohort-wide AtCoder submissions map.
 * @returns {Object.<string, Object>} Map of problem_id -> { v, t, s, cid }.
 */
function buildAtCoderSubmissionIndex(studentHandles, cohortAtCoderMap) {
  var index = {};
  if (!Array.isArray(studentHandles) || !cohortAtCoderMap) return index;

  for (var h = 0; h < studentHandles.length; h++) {
    var handle = studentHandles[h];
    var handleLower = handle.toLowerCase();
    var subs = cohortAtCoderMap[handleLower];
    if (!subs || typeof subs !== 'object') continue;

    for (var pid in subs) {
      if (!subs.hasOwnProperty(pid)) continue;
      var sub = subs[pid];
      var existing = index[pid];
      if (!existing || (sub.v === 'AC' && existing.v !== 'AC')) {
        index[pid] = sub;
      }
    }
  }

  return index;
}

/**
 * Batch fetch and index recent LeetCode submissions for an entire cohort.
 * Uses Script Cache with 'lc_sub_' prefix to avoid redundant GraphQL calls.
 *
 * @param {string[]} handlesList - Array of unique LeetCode handles.
 * @returns {Object.<string, Object>} Map of handle -> submission map (slug -> { v, s, t }).
 */
function fetchCohortLeetCodeSubmissions(handlesList) {
  var resultMap = {};
  if (!Array.isArray(handlesList) || handlesList.length === 0) return resultMap;

  var cache = CacheService.getScriptCache();

  for (var i = 0; i < handlesList.length; i++) {
    var handle = handlesList[i];
    if (!handle) continue;
    var handleLower = handle.toLowerCase();
    var cacheKey = 'lc_sub_' + handleLower;
    var cached = cache.get(cacheKey);

    if (cached) {
      try {
        var parsed = JSON.parse(cached);
        if (parsed && typeof parsed === 'object') {
          resultMap[handleLower] = parsed;
          continue;
        }
      } catch (e) { /* re-fetch */ }
    }

    var subMap = (typeof fetchAndIndexLeetCodeGraphQL === 'function')
      ? fetchAndIndexLeetCodeGraphQL(handle)
      : {};
    resultMap[handleLower] = subMap;

    var jsonStr = JSON.stringify(subMap);
    if (jsonStr.length <= 90000) {
      cache.put(cacheKey, jsonStr, (typeof AUDIT_CACHE_TTL !== 'undefined' ? AUDIT_CACHE_TTL : 900));
    }
  }

  return resultMap;
}

/**
 * Build per-student LeetCode submission index from cohort data.
 * @param {string[]} studentHandles - Student's LeetCode handles.
 * @param {Object} cohortLCMap - Cohort-wide LeetCode submissions map.
 * @returns {Object.<string, Object>} Map of slug -> { v, s, t }.
 */
function buildLeetCodeSubmissionIndex(studentHandles, cohortLCMap) {
  var index = {};
  if (!Array.isArray(studentHandles) || !cohortLCMap) return index;

  for (var h = 0; h < studentHandles.length; h++) {
    var handle = studentHandles[h];
    if (!handle) continue;
    var handleLower = handle.toLowerCase();
    var subs = cohortLCMap[handleLower];
    if (!subs || typeof subs !== 'object') continue;

    for (var slug in subs) {
      if (!subs.hasOwnProperty(slug)) continue;
      var sub = subs[slug];
      var existing = index[slug];
      if (!existing || (sub.v === 'AC' && existing.v !== 'AC')) {
        index[slug] = sub;
      }
    }
  }

  return index;
}
