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

  // Bulk cache store
  try {
    if (Object.keys(cacheEntriesToStore).length > 0) {
      cache.putAll(cacheEntriesToStore, AUDIT_CACHE_TTL);
    }
  } catch (ce) {
    Logger.log('Cache putAll error for CF submissions: ' + ce);
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

  for (var i = 0; i < handlesList.length; i++) {
    var handle = handlesList[i];
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

    // Fetch from API (recent 6 months)
    var subMap = fetchAndIndexAtCoderSubmissions(handle, sixMonthsAgo);
    resultMap[handleLower] = subMap;

    var jsonStr = JSON.stringify(subMap);
    if (jsonStr.length <= 90000) {
      cache.put(cacheKey, jsonStr, AUDIT_CACHE_TTL);
    }
  }

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
