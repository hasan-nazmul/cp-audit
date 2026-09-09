# CP-Audit 🎯

> **Enterprise-Grade Competitive Programming Coaching, Anti-Cheat Integrity Verification & Curriculum Guidance Engine built for Google Apps Script.**

[![Google Apps Script](https://img.shields.io/badge/Google%20Apps%20Script-4285F4?logo=google&logoColor=white)](https://developers.google.com/apps-script)
[![Codeforces API](https://img.shields.io/badge/Codeforces%20API-1F8ACB?logo=codeforces&logoColor=white)](https://codeforces.com/apiHelp)
[![AtCoder Problems API](https://img.shields.io/badge/AtCoder%20Problems-000000?logo=atcoder&logoColor=white)](https://kenkoooo.com/atcoder/)
[![Gemini AI](https://img.shields.io/badge/Google%20Gemini-8E75C4?logo=googlegemini&logoColor=white)](https://ai.google.dev/)
[![Kimi Moonshot AI](https://img.shields.io/badge/Moonshot%20AI-0052D9?logo=openai&logoColor=white)](https://platform.moonshot.cn/)

---

## 📖 Overview

**CP-Audit** is an automated, serverless training camp and university course audit engine designed to supervise competitive programming cohorts (e.g. Codeforces, AtCoder). Running entirely on **Google Apps Script** integrated with **Google Sheets**, CP-Audit eliminates the manual overhead of progress verification, fraud detection, and tailored pedagogical coaching.

The platform provides a complete closed-loop cycle:
1. **Real-Time Verification & API**: Students verify problem solves in real-time via tracksheets and external dashboards.
2. **Weekly Retrospective Audit**: A Sunday night cron job ingests student logs across the entire cohort, matches every claimed solve against official platform APIs, flags discrepancies, and detects speed/burst anomalies.
3. **Curriculum & Topic Guidance**: Classifies solved problems against a 37-topic competitive programming curriculum, identifies **Foundational Debt**, enforces **Benchmark Milestones**, and detects **Hint Crutches**.
4. **Dual-Provider AI Cascade**: Generates rich, personalized coaching summaries and weekly lesson plans utilizing **Kimi Moonshot** with fallback to **Google Gemini**.
5. **Mobile-Responsive Dispatch**: Delivers branded, motivating HTML progress reports to students and comprehensive executive digests to instructors.

---

## 🏗 System Architecture

```
                                  +---------------------------+
                                  |   Weekly Audit Trigger    |
                                  | (weeklyAuditAndHistory()) |
                                  +-------------+-------------+
                                                |
                        +-----------------------+-----------------------+
                        |                                               |
                        v                                               v
        +-------------------------------+               +-------------------------------+
        |        AuditStorage.gs        |               |         AuditFetch.gs         |
        | - loadCohortRoster()          |               | - fetchCohortSubmissionsParallel() |
        | - readStudentWeekLog()        |               | - fetchCohortAtCoderSubmissions()  |
        +---------------+---------------+               +---------------+---------------+
                        |                                               |
                        +-----------------------+-----------------------+
                                                |
                                                v
                                +-------------------------------+
                                |       AuditIntegrity.gs       |
                                | - Authoritative Cross-Check   |
                                | - 7 Anomaly Vectors (GHOST_AC)|
                                +---------------+---------------+
                                                |
                                                v
                                +-------------------------------+
                                |      AuditProgression.gs      |
                                | - 10-Solve Progression Curves |
                                | - Milestone Benchmark Gating  |
                                | - Hint Dependency Detection   |
                                +---------------+---------------+
                                                |
                                                v
                                +-------------------------------+
                                |      SuggestionEngine.gs      |
                                | - 37-Topic Metadata Database  |
                                | - 4-Tier Curriculum Taxonomy  |
                                | - Foundational Debt Detection |
                                +---------------+---------------+
                                                |
                                                v
                                +-------------------------------+
                                |          AIService.gs         |
                                | - Kimi Moonshot -> Gemini     |
                                | - Cohort-Wide Batch Prompting |
                                +---------------+---------------+
                                                |
                        +-----------------------+-----------------------+
                        |                                               |
                        v                                               v
        +-------------------------------+               +-------------------------------+
        |        AuditReports.gs        |               |        AuditStorage.gs        |
        | - Student Weekly Report HTML  |               | - prepareAuditLogRows()       |
        | - Instructor Digest Email     |               | - bulkWriteAuditLog()         |
        +-------------------------------+               | - updateHistoryWithAudit()    |
                                                        +-------------------------------+
```

---

## 📁 Modular Codebase Structure

The project conforms to industry-standard modular architecture, separating network, business logic, storage, and AI layers into focused files:

| File | Lines | Primary Responsibility |
| :--- | :---: | :--- |
| [`WeeklyAudit.gs`](WeeklyAudit.gs) | 348 | **Trigger Entry Point & Pipeline Orchestrator**: Houses `weeklyAuditAndHistory()`, runtime configuration, and the 8-step weekly batch execution loop. |
| [`AuditFetch.gs`](AuditFetch.gs) | 367 | **Platform API Fetching**: Serialized parallel micro-batch fetching (`fetchAllWithRetry`), compactification with tag retention, and AtCoder submission indexing. |
| [`AuditIntegrity.gs`](AuditIntegrity.gs) | 458 | **Anti-Cheat & Verification Engine**: Multi-vector cross-verification against CF & AtCoder indices, 7 anomaly detection rules, and daily variance analysis. |
| [`AuditProgression.gs`](AuditProgression.gs) | 574 | **Mastery Curves & Progression Analytics**: 10-solve bucketed performance trends, hint reliance calculation, and milestone advancement gating. |
| [`SuggestionEngine.gs`](SuggestionEngine.gs) | 1,090 | **Topic Encyclopedia & Curriculum Engine**: 37 CP topics, 4-tier taxonomy (`consolidate`, `must`, `core`, `preview`), gap detector, and Web API handler. |
| [`AIService.gs`](AIService.gs) | 753 | **Dual-Provider LLM Intelligence**: Kimi Moonshot $\rightarrow$ Google Gemini cascade, RPM limiters, circuit breakers, and cohort KPI aggregations. |
| [`AuditReports.gs`](AuditReports.gs) | 770 | **Email Templating & Dispatch**: Mobile-responsive HTML student report emails (Topic Mastery Radar, MUST/DEBT badges) and executive instructor digests. |
| [`AuditStorage.gs`](AuditStorage.gs) | 513 | **Google Sheets Batch I/O**: Single-pass roster extraction, week log ingestion, bulk audit log writes, history archiving, and common helpers. |
| [`Verifier.gs`](Verifier.gs) | 1,027 | **Real-Time Row Verifier**: On-demand single submission validation across Codeforces and AtCoder with scraper fallbacks. |
| [`Code.gs`](Code.gs) | 268 | **Web App Router & Controller**: Dispatches `doGet` (`getSuggestions`, status checks) and `doPost` requests. |
| [`temp.gs`](temp.gs) | 210 | **One-Time Migration Script**: Automated idempotent insertion of the `Hint?` column after Column L across all student sheets. |

---

## ⚡ Key Features

### 1. Multi-Vector Anti-Cheat & Anomaly Detection (`AuditIntegrity.gs`)
Every claimed solve in a student's sheet is checked against authoritative contest and submission logs from Codeforces and AtCoder:

- **`GHOST_AC`**: Student logged an Accepted verdict, but zero submissions exist on any registered platform handle.
- **`WRONG_VERDICT`**: Student logged Accepted, but actual platform verdict was Wrong Answer, Time Limit Exceeded, Runtime Error, etc.
- **`DATE_MISMATCH`**: Solve was submitted outside the active weekly accounting window.
- **`FUTURE_TIMESTAMP`**: Solve date claimed in the sheet is ahead of actual system time.
- **`HIGH_ATTEMPTS`**: Significant trial-and-error discrepancy on the platform without reflecting effort in the tracker.
- **`SUSPICIOUS_SPEED_SPIKE` / `TIME_ANOMALY`**: High-difficulty problems claimed solved in $<5$ minutes compared to the student's 4-week baseline.
- **`STUDY_ARENA_GAP`**: Solves recorded in individual student sheets missing corresponding official study arena entries.

---

### 2. 4-Tier Curriculum Engine & Foundational Debt (`SuggestionEngine.gs`)

Unlike simple solve counts, CP-Audit evaluates *algorithmic depth* and *topic breadth* against a structured 4-tier curriculum per rating tier:

| Tier | Mandatory (`must`) | Foundational Debt (`consolidate`) | Core Topics (`core`) | Upcoming Preview (`preview`) |
| :---: | :--- | :--- | :--- | :--- |
| **800** | Constructive Algorithms, Math | — | Implementation, Brute Force | Sortings, Strings |
| **900** | Sortings, Number Theory | Implementation, Math | Greedy, Brute Force, Strings | Two Pointers, Bitmasks |
| **1000** | Two Pointers, Bitmasks | Sortings, Number Theory | Combinatorics, Math, Greedy | Data Structures, Binary Search |
| **1100** | Data Structures, Two Pointers | Bitmasks, Number Theory | Greedy, Combinatorics, Math | Binary Search, DSU |
| **1200** | **Binary Search [MUST]** | Data Structures, Two Pointers | Bitmasks, Combinatorics, DSU | Graphs, DFS and Similar |
| **1300** | **Graphs, DFS and Similar [MUST]** | Binary Search, Prefix Sums | DSU, Shortest Paths, Greedy | Trees, DP |
| **1400** | **Dynamic Programming [MUST]** | Graphs, Binary Search | Trees, Shortest Paths, Divide & Conquer | Games, Geometry, Probabilities |
| **1500+**| Trees, DP, Data Structures | DP, Graphs | Games, Shortest Paths, Geometry | Flows, Suffix Structures, FFT |

#### Pedagogical Safeguards:
- **Foundational Debt Detection**: If a student is at 1300 rating but only has 1 binary search solve (a 1200 milestone), it is flagged as **🔧 Foundational Debt (Needs Consolidation)** rather than a generic weakness.
- **Milestone Gating**: Students reaching 20+ solves at their working tier are held back from advancing if mandatory milestone topics have insufficient solves ($<2$).
- **Hint Crutch Detection**: Identifies topics where the student relied on hints $\ge 50\%$ of the time across 3+ solves, mandating unassisted practice.
- **Over-Reliance Alert**: Warns when a single topic (e.g. Greedy) exceeds $>40\%$ of a student's total volume.

---

### 3. Dual-Provider AI Cascade (`AIService.gs`)
CP-Audit integrates an intelligent LLM failover cascade with strict rate-limit management:

```
                  +--------------------------+
                  | Cohort Analytics Summary |
                  +-------------+------------+
                                |
                                v
               [ Try Primary: Kimi Moonshot AI ]
                  (moonshot-v1-8k / 32k)
                                |
                      +---------+---------+
                      |                   |
                  (Success)            (Error / Timeout)
                      |                   |
                      v                   v
            [ Formatted Coaching ]   [ Failover to Google Gemini ]
                                       (gemini-2.5-flash / pro)
                                          |
                                +---------+---------+
                                |                   |
                            (Success)            (Error / RPM Exceeded)
                                |                   |
                                v                   v
                      [ Formatted Coaching ]   [ Algorithmic Fallback Engine ]
```

- **Zero RPM Blowout**: Uses cohort-wide single-batch prompting, condensing 40+ students into one structured payload.
- **Circuit Breaker**: Detects 429 rate limits or network issues, immediately tripping the breaker and switching providers without hanging the execution.
- **Algorithmic Fallback**: Even in total network failure, programmatic template engines generate concrete, actionable advice lines.

---

## 📊 Spreadsheet Schemas

### Roster Sheet (`Roster`)
Defines the authoritative cohort identity and platform handle mappings:

| Col | Header | Description | Example |
| :---: | :--- | :--- | :--- |
| **A** | `Email` | Student or instructor email address | `student@university.edu` |
| **B** | `Matric ID` | Unique student ID (Pattern: `/^C261\d{3}$/i`) | `C261014` |
| **C** | `Name` | Full display name | `Alice Smith` |
| **D** | `CF Handle` | Codeforces username | `tourist` |
| **E** | `LeetCode Handle` | LeetCode profile handle | `alicesmith` |
| **F** | `Atcoder Handle` | AtCoder username | `chokudai` |
| **G** | `Role` | User role (`student`, `instructor`, `admin`) | `student` |

---

### Student Tracksheet Tab (`C261014`, `Individual Copy`)
Each student logs problem-solving activity on their personal tab:

| Column | Header | Data Type | Description |
| :---: | :--- | :--- | :--- |
| **F (6)** | `Problem Link` | URL / Shortcode | URL (`codeforces.com/contest/...`) or shortcode (`ac:abc350_a`) |
| **G (7)** | `Verdict` | String | `AC`, `WA`, `TLE`, `MLE`, etc. |
| **H (8)** | `Claimed Subs`| Number | Number of submission attempts made |
| **I (9)** | `Solve Time` | Number | Solve duration in minutes |
| **J (10)** | `Date` | Date | Problem completion date |
| **K (11)** | `Category` | String | Topic tag (e.g., `greedy`, `binary search`, `dp`) |
| **L (12)** | `Rating` | Number | Official problem rating (e.g., `800`, `1200`, `1400`) |
| **M (13)** | `Hint?` | Boolean / Text | `Yes`/`No`, `1`/`0`, `hint`/`solo` (Indicates unassisted vs editorial solve) |
| **N (14)** | `Comment` | String | Optional student notes or reflections |
| **O (15)** | `Status` | String | Verification status written by CP-Audit (`VERIFIED`, `FLAGGED`, etc.) |
| **P (16)** | `SL` | String | Study Arena reference ID |

---

## 🌐 Web App API Endpoints

Deploying `Code.gs` as a Google Apps Script Web App exposes lightweight JSON endpoints for integration into external portals, Discord bots, or training dashboards:

### 1. Get Topic Suggestions & Curriculum Report
```http
GET https://script.google.com/macros/s/{SCRIPT_ID}/exec?action=getSuggestions&matricId=C261014
```

#### Response Example:
```json
{
  "status": "SUCCESS",
  "data": {
    "student": {
      "matricId": "C261014",
      "name": "Alice Smith",
      "cfHandle": "tourist",
      "currentTier": 1300
    },
    "metrics": {
      "totalSolved": 45,
      "hintRate": 18
    },
    "urgentGaps": [
      {
        "topic": "graphs",
        "solved": 0,
        "needed": 5,
        "priority": "MUST",
        "reason": "1300 MUST milestone topic. Core requirement to advance.",
        "examples": "BFS on grids, cycle detection, connected components"
      }
    ],
    "consolidationNeeds": [
      {
        "topic": "binary search",
        "solved": 1,
        "needed": 4,
        "priority": "HIGH",
        "reason": "Foundational topic from prior tiers with only 1 solve. Solidify to remove conceptual cracks.",
        "examples": "Search on answer, aggressive cows, capacity allocation"
      }
    ],
    "hintCrutches": [],
    "overReliance": []
  }
}
```

---

## 🚀 Setup & Deployment Guide

### Prerequisites
- A Google Spreadsheet with a **Roster** tab and student tabs (`C261\d{3}`).
- Google Apps Script project bound to the Spreadsheet or deployed standalone via [clasp](https://github.com/google/clasp).

### 1. Upload Source Files
Push all `.gs` files into your Apps Script project:
```bash
clasp push
```
*(Or copy and paste the 11 `.gs` files directly into the Apps Script web editor).*

### 2. Configure Script Properties
In the Google Apps Script IDE, navigate to **Project Settings** $\rightarrow$ **Script Properties** and add:

| Property | Description | Alternative / Alias | Example |
| :--- | :--- | :--- | :--- |
| `KIMI_KEY` | API Key for Kimi Moonshot AI | `MOONSHOT_API_KEY` | `sk-...` |
| `GEMINI_KEY` | API Key for Google Gemini | `GEMINI_API_KEY` | `AIzaSy...` |
| `INSTRUCTOR_EMAIL` | Instructor email list (comma/semicolon-separated) | `INSTRUCTOR_EMAILS` | `coach@edu.org, ta@edu.org` |
| `WEB_APP_API_KEY` | Optional auth key to secure `doGet` endpoints | — | `secret-api-key-xyz` |
| `ENABLE_HISTORY_ARCHIVE` | Toggle Step 6 History sheet archiving (`true`/`false`) | Auto-enabled if `History` sheet exists | `true` |

*(Note: The engine supports both `KIMI_KEY` and `MOONSHOT_API_KEY`, `GEMINI_KEY` and `GEMINI_API_KEY`, and `INSTRUCTOR_EMAIL` and `INSTRUCTOR_EMAILS` interchangeably).*

### 3. Run Schema Migration (If Adding Hint Column)
If your student sheets do not yet have Column M (`Hint?`), run `addHintColumnToAllSheets()` in [`temp.gs`](temp.gs) once from the Apps Script editor. This will idempotently insert Column M and shift subsequent columns without corrupting Study Arena data.

### 4. Configure Weekly Time-Driven Trigger
To automate the weekly audit:
1. In the Apps Script IDE, select **Triggers** (clock icon) $\rightarrow$ **Add Trigger**.
2. Set **Choose which function to run**: `weeklyAuditAndHistory`
3. Set **Choose which deployment should run**: `Head`
4. Set **Select event source**: `Time-driven`
5. Set **Type of time based trigger**: `Week timer`
6. Set **Day of week**: `Every Sunday`
7. Set **Time of day**: `11pm to Midnight`

---

## 🧪 Testing & Validation

The codebase includes an automated test harness that tests the anomaly detection engine, HTML escaping (preventing XSS in emails), AI circuit breaker cooldowns, and column header schema detection.

Run the automated test suite locally using Node.js:
```bash
node tests/test_audit_engine.js
```

Validate JavaScript syntax for all Google Apps Script files:
```bash
node -e '
const fs = require("fs"), vm = require("vm");
const files = fs.readdirSync(".").filter(f => f.endsWith(".gs"));
files.forEach(f => {
  vm.createScript(fs.readFileSync(f, "utf8"));
  console.log("✅ Syntax valid:", f);
});
'
```

---

## 📜 License & Acknowledgments

- **Author**: Hasan Nazmul
- **Target Course**: CSE-1230 Competitive Programming Training Cohort
- **External APIs**: [Codeforces API](https://codeforces.com/apiHelp), [Kenkoooo AtCoder Problems API](https://kenkoooo.com/atcoder/), [Google Gemini](https://ai.google.dev/), [Moonshot AI](https://platform.moonshot.cn/).
- **License**: MIT
