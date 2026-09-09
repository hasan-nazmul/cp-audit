/**
 * ═══════════════════════════════════════════════════════════════════
 * SuggestionEngine.gs — Topic Distribution & Curriculum Guidance
 *
 * PURPOSE:
 * Analyzes a student's solved-problem tag distribution against a
 * rating-tiered curriculum, identifies current milestone gaps,
 * foundational debt (consolidation needs), over-reliance, hint crutches,
 * and upcoming preview topics.
 *
 * INTEGRATION:
 * - Called by WeeklyAudit.gs during weekly audit pipeline.
 * - Embedded into student weekly report emails.
 * - Exposed via doGet in Code.gs (?action=getSuggestions&matricId=...).
 * ═══════════════════════════════════════════════════════════════════
 */

/* ─── CONFIGURATION ────────────────────────────────────────────── */

var SUGGESTION_CONFIG = {
  // Solves in a "must" topic before considered competent at current tier
  MUST_COMPETENCY_COUNT: 5,
  // Solves in a "core" topic before considered adequate exposure
  CORE_COMPETENCY_COUNT: 3,
  // Solves required in a previous tier's "must" topic to clear foundational debt
  CONSOLIDATE_COMPETENCY_COUNT: 5,
  // Threshold for "over-reliance" (% of total solves concentrated in one topic)
  OVER_RELIANCE_PERCENT: 40,
  // Minimum solves in a topic before over-reliance triggers
  OVER_RELIANCE_MIN_SOLVES: 6,
  // Max number of prioritized suggestions returned in summary
  MAX_SUGGESTIONS: 5
};

/* ─── TIER CURRICULUM ────────────────────────────────────────────
 *
 * Each tier maps a rating floor to expected knowledge.
 *
 * must        = Mandatory benchmark topics for this tier (advancement gates).
 * consolidate = Previous tier must-topics that must be rock-solid (foundational debt).
 * core        = Supporting topics with frequent contest appearance.
 * preview     = Emerging topics for the next tier (early warm-up).
 */

var TIER_CURRICULUM = {
  800: {
    consolidate: [],
    must: ['constructive algorithms', 'math', 'strings', 'greedy'],
    core: ['implementation', 'brute force', 'sortings'],
    preview: ['number theory', 'two pointers']
  },
  900: {
    consolidate: ['constructive algorithms', 'math', 'strings', 'greedy'],
    must: ['sortings', 'number theory'],
    core: ['brute force', 'two pointers', 'combinatorics'],
    preview: ['bitmasks', 'data structures']
  },
  1000: {
    consolidate: ['sortings', 'number theory'],
    must: ['two pointers', 'bitmasks', 'combinatorics'],
    core: ['math', 'greedy', 'implementation'],
    preview: ['data structures', 'prefix sums', 'sliding window']
  },
  1100: {
    consolidate: ['two pointers', 'bitmasks', 'combinatorics'],
    must: ['data structures', 'prefix sums', 'sliding window'],
    core: ['number theory', 'math', 'greedy'],
    preview: ['binary search', 'dsu']
  },
  1200: {
    consolidate: ['data structures', 'prefix sums', 'two pointers'],
    must: ['binary search'], // 1200 MUST benchmark
    core: ['two pointers', 'data structures', 'bitmasks', 'combinatorics', 'dsu'],
    preview: ['graphs', 'dfs and similar']
  },
  1300: {
    consolidate: ['binary search', 'prefix sums'], // Foundational debt if missing binary search
    must: ['graphs', 'dfs and similar'], // 1300 MUST benchmark
    core: ['binary search', 'dsu', 'shortest paths', 'greedy'],
    preview: ['trees', 'shortest paths', 'dp']
  },
  1400: {
    consolidate: ['graphs', 'dfs and similar', 'binary search'], // Foundational debt if missing graphs or BS
    must: ['dp'], // 1400 MUST benchmark
    core: ['trees', 'shortest paths', 'number theory', 'divide and conquer'],
    preview: ['games', 'geometry', 'probabilities']
  },
  1500: {
    consolidate: ['dp', 'graphs', 'dfs and similar'],
    must: ['dp', 'trees'],
    core: ['shortest paths', 'games', 'combinatorics', 'geometry'],
    preview: ['probabilities', 'interactive', 'matrices']
  },
  1600: {
    consolidate: ['trees', 'shortest paths', 'dp'],
    must: ['data structures', 'dp'],
    core: ['interactive', 'divide and conquer', 'games', 'matrices'],
    preview: ['flows', 'graph matchings', 'string suffix structures']
  },
  1700: {
    consolidate: ['data structures', 'trees'],
    must: ['trees', 'graphs', 'geometry'],
    core: ['flows', 'matrices', 'probabilities', 'meet-in-the-middle'],
    preview: ['fft', '2-sat', 'chinese remainder theorem']
  },
  1800: {
    consolidate: ['flows', 'geometry'],
    must: ['data structures', 'dp', 'graphs'],
    core: ['trees', 'flows', 'string suffix structures', 'fft', 'graph matchings'],
    preview: ['expression parsing', 'schedules']
  }
};

/* ─── TOPIC METADATA ─────────────────────────────────────────────
 *
 * Rich encyclopedia mapping every topic to canonical CF tag(s),
 * description, typical rating range, prerequisites, target counts,
 * and practical contest problem archetypes.
 */

var TOPIC_METADATA = {
  'implementation': {
    cfTags: ['implementation'],
    desc: 'Direct simulation, I/O handling, and array manipulation without complex algorithms.',
    ratingRange: [800, 1300],
    prereqs: [],
    targetCount: 15,
    examples: 'Reading input, simulation loops, string formatting, 2D matrix navigation'
  },
  'math': {
    cfTags: ['math'],
    desc: 'Basic arithmetic, algebraic simplification, series summation, floor/ceil logic, and parity.',
    ratingRange: [800, 1400],
    prereqs: [],
    targetCount: 12,
    examples: 'GCD/LCM, arithmetic progression, parity invariants, divisibility rules'
  },
  'greedy': {
    cfTags: ['greedy'],
    desc: 'Making locally optimal choices that mathematically yield a global optimum.',
    ratingRange: [800, 1600],
    prereqs: ['implementation'],
    targetCount: 12,
    examples: 'Activity selection, sorting-based greedy, coin exchange, exchange arguments'
  },
  'constructive algorithms': {
    cfTags: ['constructive algorithms'],
    desc: 'Synthesizing a valid configuration, permutation, or sequence satisfying strict constraints.',
    ratingRange: [800, 1700],
    prereqs: ['implementation', 'greedy'],
    targetCount: 10,
    examples: 'Building valid arrays, parity balancing, chess/grid configurations, operation inverses'
  },
  'strings': {
    cfTags: ['strings'],
    desc: 'String parsing, comparisons, palindromes, character frequencies, and pattern matching.',
    ratingRange: [800, 1500],
    prereqs: ['implementation'],
    targetCount: 8,
    examples: 'Palindrome checks, frequency histograms, anagram detection, substring manipulation'
  },
  'sortings': {
    cfTags: ['sortings'],
    desc: 'Exploiting ordered structure, custom comparators, coordinate compression, and greedy sorting.',
    ratingRange: [800, 1400],
    prereqs: ['implementation'],
    targetCount: 8,
    examples: 'Custom struct sort, median extraction, interval scheduling, pair sorting'
  },
  'brute force': {
    cfTags: ['brute force'],
    desc: 'Exhaustive search and search space pruning under small constraints.',
    ratingRange: [800, 1200],
    prereqs: ['implementation'],
    targetCount: 6,
    examples: 'Subset generation, permutation loops, recursive grid checks'
  },
  'number theory': {
    cfTags: ['number theory'],
    desc: 'Primes, prime factorization, divisors, modular arithmetic, and Euclidean algorithm.',
    ratingRange: [900, 1700],
    prereqs: ['math'],
    targetCount: 10,
    examples: 'Sieve of Eratosthenes, fast modular exponentiation, prime factorization, modular inverse'
  },
  'combinatorics': {
    cfTags: ['combinatorics'],
    desc: 'Counting configurations, permutations, combinations, and inclusion-exclusion.',
    ratingRange: [900, 1700],
    prereqs: ['math', 'number theory'],
    targetCount: 8,
    examples: 'Binomial coefficients with mod inverse, stars and bars, pigeonhole principle'
  },
  'two pointers': {
    cfTags: ['two pointers'],
    desc: 'Scanning monotonic arrays with two indices converging or moving in tandem.',
    ratingRange: [1000, 1500],
    prereqs: ['sortings', 'implementation'],
    targetCount: 8,
    examples: 'Pair sum, 3-sum, container with most water, subarray sum bounded'
  },
  'bitmasks': {
    cfTags: ['bitmasks'],
    desc: 'Bitwise manipulation representing subsets, compact states, and XOR properties.',
    ratingRange: [1000, 1600],
    prereqs: ['math', 'implementation'],
    targetCount: 6,
    examples: 'Subset iteration, bitwise power sets, XOR basis, state representation'
  },
  'binary search': {
    cfTags: ['binary search'],
    desc: 'Monotonic predicate search, lower/upper bound, and binary search on answer.',
    ratingRange: [1200, 1700],
    prereqs: ['implementation', 'sortings'],
    targetCount: 10,
    examples: 'Search on answer, predicate functions, aggressive cows, capacity allocation'
  },
  'prefix sums': {
    cfTags: ['data structures'],
    desc: '1D/2D cumulative sums for range queries and difference arrays for range updates.',
    ratingRange: [1000, 1500],
    prereqs: ['implementation'],
    targetCount: 8,
    examples: 'Subarray sum equals K, 2D grid sub-rectangle sum, difference array point queries'
  },
  'sliding window': {
    cfTags: ['two pointers'],
    desc: 'Maintaining dynamic window invariants with amortized O(1) updates.',
    ratingRange: [1100, 1600],
    prereqs: ['two pointers', 'implementation'],
    targetCount: 6,
    examples: 'Max sum subarray of size K, longest substring without repeating characters'
  },
  'data structures': {
    cfTags: ['data structures'],
    desc: 'Stacks, queues, ordered sets, maps, priority queues, segment trees, and Fenwick trees.',
    ratingRange: [1100, 1900],
    prereqs: ['implementation'],
    targetCount: 12,
    examples: 'Monotonic stack, heap top-k, Fenwick tree point-update range-sum, segment trees'
  },
  'graphs': {
    cfTags: ['graphs'],
    desc: 'Graph modeling, adjacency representations, BFS/DFS traversal, and structural properties.',
    ratingRange: [1200, 1800],
    prereqs: ['implementation', 'dfs and similar'],
    targetCount: 10,
    examples: 'BFS shortest path in unweighted graph, grid flood fill, bipartite check, cycle detection'
  },
  'dfs and similar': {
    cfTags: ['dfs and similar'],
    desc: 'Depth-first search, connected components, cycle finding, and tree traversals.',
    ratingRange: [1200, 1700],
    prereqs: ['implementation', 'graphs'],
    targetCount: 10,
    examples: 'Connected component counting, topological sort, backtracking, island perimeter'
  },
  'dsu': {
    cfTags: ['dsu'],
    desc: 'Disjoint Set Union (Union-Find) with path compression and union by rank/size.',
    ratingRange: [1200, 1700],
    prereqs: ['graphs', 'implementation'],
    targetCount: 6,
    examples: 'Kruskal minimum spanning tree, dynamic connectivity, cycle detection'
  },
  'trees': {
    cfTags: ['trees'],
    desc: 'Acyclic connected graphs: diameter, centers, subtrees, LCA, and binary lifting.',
    ratingRange: [1300, 1800],
    prereqs: ['graphs', 'dfs and similar'],
    targetCount: 10,
    examples: 'Tree diameter via two DFS, subtree sizes, LCA with binary lifting, tree distance'
  },
  'shortest paths': {
    cfTags: ['shortest paths'],
    desc: 'Dijkstra, 0-1 BFS, Bellman-Ford, and Floyd-Warshall shortest path algorithms.',
    ratingRange: [1300, 1800],
    prereqs: ['graphs', 'dfs and similar'],
    targetCount: 8,
    examples: 'Dijkstra with priority queue, 0-1 BFS with deque, all-pairs shortest paths'
  },
  'dp': {
    cfTags: ['dp'],
    desc: 'Dynamic programming: states, transitions, optimal substructure, and memoization.',
    ratingRange: [1300, 2000],
    prereqs: ['implementation'],
    targetCount: 20,
    examples: '0/1 Knapsack, LIS, LCS, interval DP, digit DP, tree DP, bitmask DP'
  },
  'games': {
    cfTags: ['games'],
    desc: 'Combinatorial game theory: Nim, Grundy numbers, winning/losing states, and Sprague-Grundy.',
    ratingRange: [1400, 1700],
    prereqs: ['math', 'implementation'],
    targetCount: 6,
    examples: 'Nim sum (XOR), subtraction games, Sprague-Grundy theorem, stone taking games'
  },
  'divide and conquer': {
    cfTags: ['divide and conquer'],
    desc: 'Decomposing problems into independent subproblems and recombining results.',
    ratingRange: [1400, 1800],
    prereqs: ['implementation', 'binary search'],
    targetCount: 6,
    examples: 'Merge sort inversion count, CDQ divide and conquer, tree centroid decomposition'
  },
  'geometry': {
    cfTags: ['geometry'],
    desc: '2D/3D computational geometry: points, vectors, cross product, polygons, and convex hull.',
    ratingRange: [1400, 2000],
    prereqs: ['math', 'implementation'],
    targetCount: 6,
    examples: 'Cross product orientation, convex hull (Monotone Chain), point in polygon'
  },
  'probabilities': {
    cfTags: ['probabilities'],
    desc: 'Expected values, linearity of expectation, Markov chains, and probability DP.',
    ratingRange: [1500, 1900],
    prereqs: ['math', 'dp'],
    targetCount: 4,
    examples: 'Expected number of steps, random walk absorption, coupon collector'
  },
  'interactive': {
    cfTags: ['interactive'],
    desc: 'Interactive problems requiring query minimization, hidden array search, and flushing.',
    ratingRange: [1500, 1900],
    prereqs: ['binary search', 'implementation'],
    targetCount: 4,
    examples: 'Hidden permutation search, tree edge discovery via queries, guess the number'
  },
  'matrices': {
    cfTags: ['matrices'],
    desc: 'Matrix multiplication and matrix exponentiation for linear recurrence acceleration.',
    ratingRange: [1500, 1900],
    prereqs: ['math', 'number theory'],
    targetCount: 4,
    examples: 'Fibonacci in O(log N), counting paths of fixed length in graphs via matrix exp'
  },
  'flows': {
    cfTags: ['flows'],
    desc: 'Network flow algorithms: maximum flow, minimum cut, bipartite matching, and min-cost flow.',
    ratingRange: [1600, 2000],
    prereqs: ['graphs', 'shortest paths'],
    targetCount: 6,
    examples: 'Dinic max flow, Konig theorem, project selection problem, circulation'
  },
  'graph matchings': {
    cfTags: ['graph matchings'],
    desc: 'Bipartite and general graph matching, augmenting paths, and Hall marriage theorem.',
    ratingRange: [1600, 2000],
    prereqs: ['graphs', 'flows'],
    targetCount: 4,
    examples: 'Hopcroft-Karp, maximum independent set in bipartite graphs, Blossom algorithm'
  },
  'string suffix structures': {
    cfTags: ['string suffix structures'],
    desc: 'Advanced string algorithms: suffix array with LCP, suffix automaton, and suffix tree.',
    ratingRange: [1600, 2000],
    prereqs: ['strings', 'data structures'],
    targetCount: 4,
    examples: 'Distinct substring counting, longest common substring, pattern matching'
  },
  'fft': {
    cfTags: ['fft'],
    desc: 'Fast Fourier Transform and Number Theoretic Transform for polynomial multiplication.',
    ratingRange: [1700, 2000],
    prereqs: ['math', 'number theory'],
    targetCount: 3,
    examples: 'Polynomial convolution, string matching with wildcards via FFT'
  },
  'meet-in-the-middle': {
    cfTags: ['meet-in-the-middle'],
    desc: 'Bisecting search space to reduce exponential complexity.',
    ratingRange: [1700, 2000],
    prereqs: ['bitmasks', 'sortings', 'binary search'],
    targetCount: 3,
    examples: 'Subset sum up to N=40, 4-sum, maximum XOR subset'
  },
  '2-sat': {
    cfTags: ['2-sat'],
    desc: '2-Satisfiability via strongly connected components in implication graphs.',
    ratingRange: [1700, 2000],
    prereqs: ['graphs', 'dfs and similar'],
    targetCount: 3,
    examples: 'Tarjan SCC implication graph, variable truth assignments'
  },
  'chinese remainder theorem': {
    cfTags: ['chinese remainder theorem'],
    desc: 'Solving systems of modular congruences with pairwise coprime or non-coprime moduli.',
    ratingRange: [1700, 2000],
    prereqs: ['number theory'],
    targetCount: 2,
    examples: 'Remainder systems, Garner algorithm'
  },
  'ternary search': {
    cfTags: ['ternary search'],
    desc: 'Extremum search on strictly unimodal or convex functions.',
    ratingRange: [1700, 2000],
    prereqs: ['binary search', 'math'],
    targetCount: 2,
    examples: 'Unimodal function minimum, geometric distance minimization'
  },
  'expression parsing': {
    cfTags: ['expression parsing'],
    desc: 'Arithmetic and logical expression evaluation via shunting-yard or recursive descent.',
    ratingRange: [1800, 2000],
    prereqs: ['data structures', 'implementation'],
    targetCount: 2,
    examples: 'Infix to postfix, calculator parser with precedence and parentheses'
  },
  'schedules': {
    cfTags: ['schedules'],
    desc: 'Task scheduling, machine allocation, deadline optimization, and flow-shop scheduling.',
    ratingRange: [1800, 2000],
    prereqs: ['greedy', 'sortings'],
    targetCount: 2,
    examples: 'Interval partitioning, weighted job scheduling with binary search DP'
  }
};

/* ─── TAG NORMALIZATION & ALIASES ──────────────────────────────── */

var TAG_ALIASES = {
  // Generic / platform labels to ignore
  'codeforces': null,
  'gym': null,
  'cses': null,
  'atcoder': null,
  'leetcode': null,
  'other': null,
  'other oj': null,

  // Graph synonyms
  'graph': 'graphs',
  'graphs': 'graphs',
  'graph theory': 'graphs',
  'bfs': 'graphs',
  'dfs': 'dfs and similar',
  'dfs and similar': 'dfs and similar',
  'connected components': 'dfs and similar',

  // Trees & paths
  'tree': 'trees',
  'trees': 'trees',
  'lca': 'trees',
  'shortest path': 'shortest paths',
  'shortest paths': 'shortest paths',
  'dijkstra': 'shortest paths',
  'bellman-ford': 'shortest paths',
  'floyd-warshall': 'shortest paths',
  '0-1 bfs': 'shortest paths',

  // DP
  'dp': 'dp',
  'dynamic programming': 'dp',
  'memoization': 'dp',
  'knapsack': 'dp',

  // Binary search & Two pointers
  'binary search': 'binary search',
  'binarysearch': 'binary search',
  'bs': 'binary search',
  'two pointer': 'two pointers',
  'two pointers': 'two pointers',
  'sliding window': 'two pointers',

  // Sorting & strings
  'sorting': 'sortings',
  'sortings': 'sortings',
  'sort': 'sortings',
  'string': 'strings',
  'strings': 'strings',

  // Constructive & math
  'constructive': 'constructive algorithms',
  'constructive algorithm': 'constructive algorithms',
  'constructive algorithms': 'constructive algorithms',
  'math': 'math',
  'maths': 'math',
  'number theory': 'number theory',
  'modular': 'number theory',
  'sieve': 'number theory',
  'prime': 'number theory',
  'primes': 'number theory',
  'greedy': 'greedy',
  'brute force': 'brute force',
  'bitmask': 'bitmasks',
  'bitmasks': 'bitmasks',
  'bitwise': 'bitmasks',

  // Data structures
  'dsu': 'dsu',
  'union find': 'dsu',
  'union-find': 'dsu',
  'disjoint set union': 'dsu',
  'data structure': 'data structures',
  'data structures': 'data structures',
  'segment tree': 'data structures',
  'fenwick': 'data structures',
  'fenwick tree': 'data structures',
  'bit': 'data structures',
  'ordered set': 'data structures',
  'prefix sum': 'data structures',
  'prefix sums': 'data structures',
  'difference array': 'data structures',

  // Game theory & advanced
  'nim': 'games',
  'grundy': 'games',
  'game theory': 'games',
  'games': 'games',
  'kmp': 'string suffix structures',
  'z-algorithm': 'string suffix structures',
  'suffix array': 'string suffix structures',
  'suffix automaton': 'string suffix structures',
  'max flow': 'flows',
  'min cut': 'flows',
  'bipartite matching': 'graph matchings',
  'crt': 'chinese remainder theorem',
  'shunting yard': 'expression parsing'
};

/**
 * Maps a raw category or tag string to its canonical topic key.
 * Returns null if the tag should be ignored (e.g. generic platform names).
 */
function mapCFTagToTopic(rawTag) {
  var tag = String(rawTag || '').toLowerCase().trim();
  if (!tag) return null;

  // Direct alias match
  if (TAG_ALIASES.hasOwnProperty(tag)) {
    return TAG_ALIASES[tag];
  }

  // Direct match in TOPIC_METADATA
  if (TOPIC_METADATA[tag]) return tag;

  // Check cfTags arrays in metadata
  for (var topic in TOPIC_METADATA) {
    var meta = TOPIC_METADATA[topic];
    if (meta.cfTags && meta.cfTags.indexOf(tag) !== -1) {
      return topic;
    }
  }

  return tag; // passthrough
}

/* ─── TIER HELPERS ─────────────────────────────────────────────── */

/**
 * Maps a rating to the appropriate 100-point tier floor.
 */
function getTierForRating(rating) {
  var r = Number(rating) || 800;
  var tiers = [800, 900, 1000, 1100, 1200, 1300, 1400, 1500, 1600, 1700, 1800];
  var matched = 800;
  for (var i = 0; i < tiers.length; i++) {
    if (r >= tiers[i]) matched = tiers[i];
  }
  return matched;
}

/**
 * Get cumulative expected tags for a given rating tier (must + core).
 */
function getExpectedTagsForTier(tier) {
  var expected = [];
  var tiers = Object.keys(TIER_CURRICULUM).map(Number).sort(function(a, b) { return a - b; });
  for (var i = 0; i < tiers.length; i++) {
    if (tiers[i] > tier) break;
    var c = TIER_CURRICULUM[tiers[i]];
    if (!c) continue;
    var all = (c.must || []).concat(c.core || []);
    for (var j = 0; j < all.length; j++) {
      if (expected.indexOf(all[j]) === -1) {
        expected.push(all[j]);
      }
    }
  }
  return expected;
}

/**
 * Get MUST benchmark tags for a specific tier.
 */
function getMustTagsForTier(tier) {
  var c = TIER_CURRICULUM[tier];
  return (c && c.must) ? c.must : [];
}

/**
 * Get consolidate tags (foundational debt) for a specific tier.
 */
function getConsolidateTagsForTier(tier) {
  var c = TIER_CURRICULUM[tier];
  return (c && c.consolidate) ? c.consolidate : [];
}

/**
 * Get NEW topics introduced at a specific tier (non-cumulative).
 */
function getNewTagsAtTier(tier) {
  var c = TIER_CURRICULUM[tier];
  if (!c) return [];
  return (c.must || []).concat(c.core || []);
}

/* ─── GAP ANALYSIS ENGINE ──────────────────────────────────────── */

/**
 * Analyze a student's topic distribution against the curriculum for their working tier.
 *
 * Evaluates:
 * 1. MUST Gaps: Current-tier mandatory milestone requirements.
 * 2. Consolidation Needs: Unfulfilled milestones from previous tiers (foundational debt).
 * 3. Core Gaps: Insufficient exposure to core topics for their tier.
 * 4. Over-Reliance: >40% volume concentrated in a single topic.
 * 5. Hint Crutches: Topics with >=50% hint reliance.
 * 6. Preview Topics: Emerging topics for the next tier.
 *
 * @param {number} currentTier - Working rating tier (floored to 100).
 * @param {Object} dist - Tag distribution object from getStudentTagDistribution().
 * @returns {Object} Full gap analysis breakdown.
 */
function analyzeTopicGaps(currentTier, dist) {
  var tier = currentTier || 800;
  var curriculum = TIER_CURRICULUM[tier];
  if (!curriculum) return { urgentGaps: [], consolidationNeeds: [], coreGaps: [], overReliance: [], previewTopics: [], hintCrutches: [], allSuggestions: [] };

  var urgentGaps = [];
  var consolidationNeeds = [];
  var coreGaps = [];
  var overReliance = [];
  var previewTopics = [];
  var hintCrutches = [];
  var totalSolved = dist.totalSolved || 0;

  // 1. MUST Gaps (current tier mandatory milestones)
  for (var i = 0; i < curriculum.must.length; i++) {
    var mustTopic = curriculum.must[i];
    var count = dist.tagCounts[mustTopic] || 0;
    var meta = TOPIC_METADATA[mustTopic] || {};
    var threshold = meta.targetCount ? Math.max(3, Math.floor(meta.targetCount / 2)) : SUGGESTION_CONFIG.MUST_COMPETENCY_COUNT;

    if (count < threshold) {
      urgentGaps.push({
        topic: mustTopic,
        solved: count,
        needed: threshold,
        priority: 'HIGH',
        type: 'MUST_GAP',
        reason: 'Mandatory milestone for ' + tier + ' rating tier. Only ' + count + ' solve' + (count === 1 ? '' : 's') + ' logged.',
        desc: meta.desc || '',
        examples: meta.examples || '',
        prereqs: meta.prereqs || [],
        tier: tier,
        isMust: true
      });
    }
  }

  // 2. Consolidation Needs (foundational debt from previous tiers)
  for (var c = 0; c < curriculum.consolidate.length; c++) {
    var consTopic = curriculum.consolidate[c];
    var consCount = dist.tagCounts[consTopic] || 0;
    var consMeta = TOPIC_METADATA[consTopic] || {};
    var consThreshold = SUGGESTION_CONFIG.CONSOLIDATE_COMPETENCY_COUNT;

    if (consCount < consThreshold) {
      consolidationNeeds.push({
        topic: consTopic,
        solved: consCount,
        needed: consThreshold,
        priority: 'HIGH',
        type: 'CONSOLIDATE',
        reason: 'Foundational topic from prior tiers with only ' + consCount + ' solve' + (consCount === 1 ? '' : 's') + '. Solidify to remove conceptual cracks.',
        desc: consMeta.desc || '',
        examples: consMeta.examples || '',
        prereqs: consMeta.prereqs || [],
        tier: tier - 100,
        isConsolidate: true
      });
    }
  }

  // 3. Core Exposure Gaps
  for (var j = 0; j < curriculum.core.length; j++) {
    var coreTopic = curriculum.core[j];
    var coreCount = dist.tagCounts[coreTopic] || 0;
    var coreMeta = TOPIC_METADATA[coreTopic] || {};

    if (coreCount < SUGGESTION_CONFIG.CORE_COMPETENCY_COUNT) {
      coreGaps.push({
        topic: coreTopic,
        solved: coreCount,
        needed: SUGGESTION_CONFIG.CORE_COMPETENCY_COUNT,
        priority: 'MEDIUM',
        type: 'CORE_GAP',
        reason: 'Core exposure topic at ' + tier + ' rating (' + coreCount + ' solve' + (coreCount === 1 ? '' : 's') + '). Practice builds contest flexibility.',
        desc: coreMeta.desc || '',
        examples: coreMeta.examples || '',
        tier: tier
      });
    }
  }

  // 4. Over-Reliance Detection
  for (var topic in dist.tagCounts) {
    if (totalSolved >= 10 && dist.tagCounts[topic] >= SUGGESTION_CONFIG.OVER_RELIANCE_MIN_SOLVES) {
      var pct = Math.round((dist.tagCounts[topic] / totalSolved) * 100);
      if (pct >= SUGGESTION_CONFIG.OVER_RELIANCE_PERCENT) {
        overReliance.push({
          topic: topic,
          percentage: pct,
          count: dist.tagCounts[topic],
          priority: 'MEDIUM',
          type: 'OVER_RELIANCE',
          reason: topic + ' accounts for ' + pct + '% of your solves. Diversify into unfamiliar problem paradigms.'
        });
      }
    }
  }

  // 5. Hint Crutches (topics where student relied >=50% on hints)
  if (dist.tagHintStats) {
    for (var ht in dist.tagHintStats) {
      var hStat = dist.tagHintStats[ht];
      if (hStat.solves >= 3 && hStat.hintRate >= 50) {
        hintCrutches.push({
          topic: ht,
          solves: hStat.solves,
          hintCount: hStat.hintCount,
          hintRate: hStat.hintRate,
          priority: 'HIGH',
          type: 'HINT_CRUTCH',
          reason: hStat.hintRate + '% of your solves in ' + ht + ' (' + hStat.hintCount + '/' + hStat.solves + ') relied on hints. Solve similar problems unassisted.'
        });
      }
    }
  }

  // 6. Preview Opportunities (emerging topics for the next tier)
  var nextTier = getTierForRating(tier + 100);
  if (nextTier > tier && TIER_CURRICULUM[nextTier]) {
    var nextMust = TIER_CURRICULUM[nextTier].must || [];
    for (var n = 0; n < nextMust.length; n++) {
      var nextTopic = nextMust[n];
      var nextCount = dist.tagCounts[nextTopic] || 0;
      var nextMeta = TOPIC_METADATA[nextTopic] || {};
      if (nextCount < 2) {
        previewTopics.push({
          topic: nextTopic,
          solved: nextCount,
          priority: 'LOW',
          type: 'PREVIEW',
          reason: 'Introduced at ' + nextTier + ' rating. Try 1–2 problems as a warm-up before advancing.',
          desc: nextMeta.desc || '',
          examples: nextMeta.examples || '',
          tier: nextTier
        });
      }
    }
  }

  // Priority order: MUST gaps first, then consolidation needs, then hint crutches, then core gaps, then previews
  var allSuggestions = [];
  allSuggestions = allSuggestions.concat(urgentGaps);
  allSuggestions = allSuggestions.concat(consolidationNeeds);
  allSuggestions = allSuggestions.concat(coreGaps);

  // Sort by priority and least solves
  allSuggestions.sort(function(a, b) {
    var prioMap = { HIGH: 0, MEDIUM: 1, LOW: 2 };
    if (prioMap[a.priority] !== prioMap[b.priority]) {
      return prioMap[a.priority] - prioMap[b.priority];
    }
    return (a.solved || 0) - (b.solved || 0);
  });

  return {
    tier: tier,
    totalSolved: totalSolved,
    avgRating: dist.avgRating || 0,
    urgentGaps: urgentGaps.slice(0, 4),
    consolidationNeeds: consolidationNeeds.slice(0, 3),
    coreGaps: coreGaps.slice(0, 3),
    overReliance: overReliance,
    hintCrutches: hintCrutches,
    previewTopics: previewTopics.slice(0, 3),
    allSuggestions: allSuggestions.slice(0, SUGGESTION_CONFIG.MAX_SUGGESTIONS)
  };
}

/* ─── STUDENT TAG DISTRIBUTION ─────────────────────────────────── */

/**
 * Reads student problem solves, merging sheet entries with optional CF API data.
 *
 * @param {Sheet} sheet - Student's individual copy sheet.
 * @param {string[]} [handles] - Student's CF handles.
 * @param {Object} [optCohortSubmissionsMap] - Optional pre-fetched cohort submissions map.
 * @returns {Object} Tag distribution object.
 */
function getStudentTagDistribution(sheet, handles, optCohortSubmissionsMap) {
  var dist = {
    tagCounts: {},
    tagHintStats: {}, // tag -> { solves, hintCount, hintRate }
    totalSolved: 0,
    totalSolo: 0,
    totalHints: 0,
    totalCF: 0,
    totalManual: 0,
    avgRating: 0,
    ratingSum: 0,
    ratingCount: 0
  };

  if (!sheet) return dist;

  var countedKeys = {};

  // 1. Process pre-fetched CF API data if available
  if (optCohortSubmissionsMap && Array.isArray(handles)) {
    for (var h = 0; h < handles.length; h++) {
      var hLower = handles[h].toLowerCase();
      var subs = optCohortSubmissionsMap[hLower] || [];

      for (var s = 0; s < subs.length; s++) {
        var sub = subs[s];
        if (!sub || sub.v !== 'OK') continue;

        var key = String(sub.c) + String(sub.i).toUpperCase().trim();
        if (countedKeys[key]) continue;
        countedKeys[key] = true;

        var tagsStr = sub.tags || '';
        var rawTags = tagsStr ? tagsStr.split(',').map(function(t) { return t.trim(); }).filter(function(t) { return t; }) : ['general'];

        dist.totalSolved++;
        dist.totalCF++;
        if (sub.r > 0) {
          dist.ratingSum += sub.r;
          dist.ratingCount++;
        }

        for (var ti = 0; ti < rawTags.length; ti++) {
          var topic = mapCFTagToTopic(rawTags[ti]);
          if (!topic) continue;

          dist.tagCounts[topic] = (dist.tagCounts[topic] || 0) + 1;
          if (!dist.tagHintStats[topic]) {
            dist.tagHintStats[topic] = { solves: 0, hintCount: 0, hintRate: 0 };
          }
          dist.tagHintStats[topic].solves++;
        }
      }
    }
  }

  // 2. Process student sheet rows (Columns F:O with dynamic Hint? column detection)
  var lastRow = sheet.getLastRow();
  if (lastRow >= 4) {
    var hasHintCol = (typeof hasHintColumn === 'function') ? hasHintColumn(sheet) : false;
    var numCols = hasHintCol ? 8 : 7;
    var sheetData = sheet.getRange(4, 6, lastRow - 3, numCols).getValues();

    for (var r = 0; r < sheetData.length; r++) {
      var link = String(sheetData[r][0] || '').trim();
      var verdict = String(sheetData[r][1] || '').toUpperCase().trim();
      var rawCategory = String(sheetData[r][5] || '').trim();
      var ratingVal = Number(sheetData[r][6]) || 0;
      var isHint = hasHintCol ? ((typeof isHintPresent === 'function') ? isHintPresent(sheetData[r][7]) : false) : false;

      if (!link || verdict !== 'AC') continue;

      var topic = mapCFTagToTopic(rawCategory);
      if (!topic) topic = rawCategory ? rawCategory.toLowerCase() : null;

      // Check if already counted via CF API
      var parsed = (typeof parseProblemServerInput === 'function') ? parseProblemServerInput(link) : { platform: 'unknown' };
      if (parsed.platform === 'codeforces' && !parsed.isGym) {
        var cfKey = String(parsed.contestId) + String(parsed.problemIndex).toUpperCase().trim();
        if (countedKeys[cfKey]) {
          // Only augment hint data
          if (topic && dist.tagHintStats[topic]) {
            if (isHint) {
              dist.tagHintStats[topic].hintCount++;
              dist.totalHints++;
            } else {
              dist.totalSolo++;
            }
            dist.tagHintStats[topic].hintRate = Math.round((dist.tagHintStats[topic].hintCount / dist.tagHintStats[topic].solves) * 100);
          }
          continue;
        }
      }

      // New solve not in CF API (manual, AtCoder, VJudge, CSES, LeetCode)
      dist.totalSolved++;
      if (parsed.platform === 'codeforces') dist.totalCF++;
      else dist.totalManual++;

      if (isHint) dist.totalHints++;
      else dist.totalSolo++;

      if (ratingVal > 0) {
        dist.ratingSum += ratingVal;
        dist.ratingCount++;
      }

      if (topic) {
        dist.tagCounts[topic] = (dist.tagCounts[topic] || 0) + 1;
        if (!dist.tagHintStats[topic]) {
          dist.tagHintStats[topic] = { solves: 0, hintCount: 0, hintRate: 0 };
        }
        dist.tagHintStats[topic].solves++;
        if (isHint) dist.tagHintStats[topic].hintCount++;
        dist.tagHintStats[topic].hintRate = Math.round((dist.tagHintStats[topic].hintCount / dist.tagHintStats[topic].solves) * 100);
      }
    }
  }

  dist.avgRating = dist.ratingCount > 0 ? Math.round(dist.ratingSum / dist.ratingCount) : 0;
  return dist;
}

/* ─── PUBLIC REPORTING & EXPORT API ────────────────────────────── */

/**
 * Generate a complete topic recommendation report for a student.
 *
 * @param {string} matricId - Student matric ID (e.g. C261014).
 * @param {Object} [optCohortSubmissionsMap] - Optional pre-fetched cohort submissions.
 * @returns {Object} Structured recommendation report.
 */
function generateSuggestionReport(matricId, optCohortSubmissionsMap) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(matricId);
  if (!sheet) return { error: 'Student sheet not found for ID: ' + matricId };

  var studentInfo = (typeof getStudentInfoFromRoster === 'function') ? getStudentInfoFromRoster(matricId) : null;
  if (!studentInfo) return { error: 'Student ' + matricId + ' not found in Roster' };

  var handles = [];
  if (studentInfo.cfHandle) handles.push(studentInfo.cfHandle);

  var dist = getStudentTagDistribution(sheet, handles, optCohortSubmissionsMap);
  var workingTier = getTierForRating(dist.avgRating || 800);
  var analysis = analyzeTopicGaps(workingTier, dist);

  return {
    student: studentInfo,
    currentTier: workingTier,
    avgRating: dist.avgRating,
    totalSolved: dist.totalSolved,
    soloSolved: dist.totalSolo,
    hintSolved: dist.totalHints,
    cfSolved: dist.totalCF,
    manualSolved: dist.totalManual,
    tagBreakdown: dist.tagCounts,
    urgentGaps: analysis.urgentGaps,
    consolidationNeeds: analysis.consolidationNeeds,
    coreGaps: analysis.coreGaps,
    overReliance: analysis.overReliance,
    hintCrutches: analysis.hintCrutches,
    previewTopics: analysis.previewTopics,
    topSuggestions: analysis.allSuggestions
  };
}

/**
 * Generate mobile-responsive HTML snippet for embedding into student reports or web dashboards.
 *
 * @param {string} matricId - Student matric ID.
 * @param {Object} [optReport] - Optional pre-generated report object.
 * @returns {string} HTML string.
 */
function getSuggestionHtmlForStudent(matricId, optReport) {
  var report = optReport || generateSuggestionReport(matricId);
  if (report.error) {
    return '<p style="color:#dc2626;font-size:13px;">Suggestion Engine notice: ' + ((typeof escHtml === 'function') ? escHtml(report.error) : report.error) + '</p>';
  }

  var esc = (typeof escHtml === 'function') ? escHtml : function(s) { return String(s || ''); };

  var html = '<div style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;background:#ffffff;border:1px solid #e2e8f0;border-radius:14px;padding:20px;margin:20px 0;box-shadow:0 2px 8px rgba(0,0,0,.03);">';
  html += '<div style="display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #f1f5f9;padding-bottom:12px;margin-bottom:16px;">';
  html += '<div>';
  html += '<div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:1px;color:#6d28d9;">\u{1F3AF} Curriculum & Focus Guidance</div>';
  html += '<div style="font-size:16px;font-weight:800;color:#0f172a;margin-top:2px;">Personalized Topic Roadmap</div>';
  html += '</div>';
  html += '<div style="background:#ede9fe;color:#5b21b6;font-size:11px;font-weight:800;padding:4px 10px;border-radius:9999px;">Tier ' + report.currentTier + '</div>';
  html += '</div>';

  html += '<p style="font-size:13px;color:#475569;margin:0 0 16px;line-height:1.5;">Based on your <strong>' + report.totalSolved + '</strong> logged solves (avg rating <strong>' + report.avgRating + '</strong>). Here is your tailored skill progression:</p>';

  // 1. Mandatory Milestone Gaps
  if (report.urgentGaps && report.urgentGaps.length > 0) {
    html += '<div style="background:#fff1f2;border:1px solid #fecdd3;border-radius:10px;padding:14px;margin-bottom:14px;">';
    html += '<div style="font-size:12px;font-weight:800;color:#9f1239;margin-bottom:8px;">\u{1F3AF} Mandatory Milestones for Tier ' + report.currentTier + ':</div>';
    html += '<ul style="margin:0;padding-left:18px;font-size:13px;color:#881337;line-height:1.6;">';
    for (var ug = 0; ug < report.urgentGaps.length; ug++) {
      var g = report.urgentGaps[ug];
      html += '<li style="margin-bottom:6px;">';
      html += '<strong>' + esc(g.topic) + '</strong> (' + g.solved + '/' + g.needed + ' target solves) — ' + esc(g.reason);
      if (g.examples) {
        html += '<br><span style="font-size:11px;color:#be123c;">\u{1F4D6} Archetypes: ' + esc(g.examples) + '</span>';
      }
      html += '</li>';
    }
    html += '</ul></div>';
  }

  // 2. Consolidation Needs (Foundational Debt)
  if (report.consolidationNeeds && report.consolidationNeeds.length > 0) {
    html += '<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:14px;margin-bottom:14px;">';
    html += '<div style="font-size:12px;font-weight:800;color:#92400e;margin-bottom:8px;">\u{1F527} Foundational Debt (Needs Consolidation):</div>';
    html += '<ul style="margin:0;padding-left:18px;font-size:13px;color:#78350f;line-height:1.6;">';
    for (var cn = 0; cn < report.consolidationNeeds.length; cn++) {
      var c = report.consolidationNeeds[cn];
      html += '<li style="margin-bottom:6px;">';
      html += '<strong>' + esc(c.topic) + '</strong> (only ' + c.solved + ' solves from Tier ' + c.tier + ') — ' + esc(c.reason);
      if (c.examples) {
        html += '<br><span style="font-size:11px;color:#b45309;">\u{1F4A1} Key concepts: ' + esc(c.examples) + '</span>';
      }
      html += '</li>';
    }
    html += '</ul></div>';
  }

  // 3. Hint Crutches
  if (report.hintCrutches && report.hintCrutches.length > 0) {
    html += '<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:14px;margin-bottom:14px;">';
    html += '<div style="font-size:12px;font-weight:800;color:#991b1b;margin-bottom:8px;">\u{1F9E9} Hint Crutch Warning:</div>';
    html += '<ul style="margin:0;padding-left:18px;font-size:13px;color:#7f1d1d;line-height:1.6;">';
    for (var hc = 0; hc < report.hintCrutches.length; hc++) {
      var h = report.hintCrutches[hc];
      html += '<li><strong>' + esc(h.topic) + '</strong>: ' + h.hintRate + '% hint solves (' + h.hintCount + '/' + h.solves + '). Solve unassisted to build independent synthesis.</li>';
    }
    html += '</ul></div>';
  }

  // 4. Over-reliance
  if (report.overReliance && report.overReliance.length > 0) {
    html += '<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px;margin-bottom:14px;">';
    html += '<div style="font-size:12px;font-weight:800;color:#334155;margin-bottom:6px;">\u26A0\uFE0F Concentration Alert:</div>';
    html += '<ul style="margin:0;padding-left:18px;font-size:13px;color:#475569;line-height:1.6;">';
    for (var orIdx = 0; orIdx < report.overReliance.length; orIdx++) {
      var o = report.overReliance[orIdx];
      html += '<li>' + esc(o.reason) + '</li>';
    }
    html += '</ul></div>';
  }

  // 5. Next Tier Preview
  if (report.previewTopics && report.previewTopics.length > 0) {
    html += '<div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:14px;">';
    html += '<div style="font-size:12px;font-weight:800;color:#1e40af;margin-bottom:8px;">\u{1F52D} Next Tier (' + (report.currentTier + 100) + ') Preview:</div>';
    html += '<ul style="margin:0;padding-left:18px;font-size:13px;color:#1e3a8a;line-height:1.6;">';
    for (var pt = 0; pt < report.previewTopics.length; pt++) {
      var p = report.previewTopics[pt];
      html += '<li><strong>' + esc(p.topic) + '</strong>: ' + esc(p.reason);
      if (p.examples) {
        html += ' <em style="font-size:11px;color:#3b82f6;">(' + esc(p.examples) + ')</em>';
      }
      html += '</li>';
    }
    html += '</ul></div>';
  }

  html += '</div>';
  return html;
}

/* ─── WEB APP CONTROLLER ───────────────────────────────────────── */

/**
 * Controller for GET ?action=getSuggestions&matricId=...
 *
 * @param {string} matricId - Student matric ID.
 * @returns {Object} JSON serializable response object.
 */
function handleGetSuggestions(matricId) {
  if (!matricId || !String(matricId).trim()) {
    return { error: 'Missing parameter: matricId is required' };
  }
  return generateSuggestionReport(String(matricId).trim());
}
