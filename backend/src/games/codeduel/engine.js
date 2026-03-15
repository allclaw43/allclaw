/**
 * AllClaw — Code Duel Engine v1.0
 *
 * Two AI agents compete on a coding challenge.
 * Since agents are external processes (not inline LLMs), the game works like:
 *   1. Challenge is presented to both agents via WebSocket
 *   2. Agents submit a solution (pseudocode, explanation, or actual code)
 *   3. Server scores submissions on: correctness hints, completeness, efficiency claim
 *   4. Winner determined by score + submission speed bonus
 *
 * For bot matches: bot submissions are pre-generated with random quality levels.
 */

const crypto = require('crypto');
const pool   = require('../../db/pool');

// ── Challenge Bank ────────────────────────────────────────────────
const CHALLENGES = [
  {
    id: 'reverse-linked-list',
    title: 'Reverse a Linked List',
    difficulty: 'Medium',
    category: 'Data Structures',
    description: 'Given the head of a singly linked list, reverse the list and return the reversed list head.',
    constraints: ['0 <= n <= 5000 nodes', 'Time: O(n)', 'Space: O(1)'],
    hints: ['prev', 'current', 'next pointer', 'iterative'],
    test_cases: [
      { input: '[1,2,3,4,5]', output: '[5,4,3,2,1]' },
      { input: '[1,2]',       output: '[2,1]' },
      { input: '[]',          output: '[]' },
    ],
    scoring_keywords: ['prev', 'next', 'null', 'while', 'pointer', 'iterative', 'recursive', 'stack'],
    max_points: 100,
  },
  {
    id: 'two-sum',
    title: 'Two Sum',
    difficulty: 'Easy',
    category: 'Hash Map',
    description: 'Given an array of integers nums and an integer target, return indices of the two numbers such that they add up to target.',
    constraints: ['2 <= nums.length <= 10^4', 'Time: O(n)', 'Each input has exactly one solution'],
    hints: ['hash map', 'complement', 'one pass'],
    test_cases: [
      { input: 'nums=[2,7,11,15], target=9', output: '[0,1]' },
      { input: 'nums=[3,2,4], target=6',     output: '[1,2]' },
    ],
    scoring_keywords: ['map', 'hash', 'complement', 'target', 'index', 'dictionary', 'lookup', 'O(n)'],
    max_points: 80,
  },
  {
    id: 'binary-search',
    title: 'Binary Search',
    difficulty: 'Easy',
    category: 'Algorithms',
    description: 'Given a sorted array of distinct integers and a target value, return the index if the target is found. If not, return -1.',
    constraints: ['1 <= nums.length <= 10^4', 'Time: O(log n)', 'Array is sorted ascending'],
    hints: ['left', 'right', 'mid', 'sorted'],
    test_cases: [
      { input: 'nums=[-1,0,3,5,9,12], target=9', output: '4' },
      { input: 'nums=[-1,0,3,5,9,12], target=2', output: '-1' },
    ],
    scoring_keywords: ['left', 'right', 'mid', 'while', 'log', 'sorted', 'half', 'O(log n)'],
    max_points: 80,
  },
  {
    id: 'lru-cache',
    title: 'LRU Cache',
    difficulty: 'Hard',
    category: 'Design',
    description: 'Design a data structure that follows the Least Recently Used (LRU) cache constraints. Implement get and put with O(1) average time complexity.',
    constraints: ['1 <= capacity <= 3000', 'Both get and put must be O(1)', 'LRU eviction policy'],
    hints: ['doubly linked list', 'hash map', 'O(1) get and put'],
    test_cases: [
      { input: 'LRUCache(2); put(1,1); put(2,2); get(1)->1; put(3,3); get(2)->-1', output: 'Evicts key 2' },
    ],
    scoring_keywords: ['doubly', 'linked list', 'hashmap', 'O(1)', 'evict', 'capacity', 'head', 'tail', 'node'],
    max_points: 150,
  },
  {
    id: 'climbing-stairs',
    title: 'Climbing Stairs',
    difficulty: 'Easy',
    category: 'Dynamic Programming',
    description: 'You are climbing a staircase. It takes n steps to reach the top. Each time you can climb 1 or 2 steps. How many distinct ways can you climb to the top?',
    constraints: ['1 <= n <= 45', 'Time: O(n)', 'Space: O(1) optimal'],
    hints: ['fibonacci', 'dp', 'previous two values'],
    test_cases: [
      { input: 'n=2', output: '2' },
      { input: 'n=3', output: '3' },
      { input: 'n=5', output: '8' },
    ],
    scoring_keywords: ['fibonacci', 'dp', 'dynamic', 'previous', 'f(n-1)', 'f(n-2)', 'memoization', 'bottom-up'],
    max_points: 80,
  },
  {
    id: 'valid-parentheses',
    title: 'Valid Parentheses',
    difficulty: 'Easy',
    category: 'Stack',
    description: "Given a string s containing just the characters '(', ')', '{', '}', '[' and ']', determine if the input string is valid.",
    constraints: ['1 <= s.length <= 10^4', 'Time: O(n)', 'Space: O(n)'],
    hints: ['stack', 'push open', 'pop close', 'empty at end'],
    test_cases: [
      { input: 's="()"',     output: 'true' },
      { input: 's="()[]{}"', output: 'true' },
      { input: 's="(]"',     output: 'false' },
    ],
    scoring_keywords: ['stack', 'push', 'pop', 'open', 'close', 'match', 'empty', 'bracket'],
    max_points: 80,
  },
  {
    id: 'merge-intervals',
    title: 'Merge Intervals',
    difficulty: 'Medium',
    category: 'Arrays & Sorting',
    description: 'Given an array of intervals, merge all overlapping intervals, and return an array of the non-overlapping intervals that cover all the intervals in the input.',
    constraints: ['1 <= intervals.length <= 10^4', 'Sort first', 'Time: O(n log n)'],
    hints: ['sort by start', 'compare end', 'extend or append'],
    test_cases: [
      { input: '[[1,3],[2,6],[8,10],[15,18]]', output: '[[1,6],[8,10],[15,18]]' },
      { input: '[[1,4],[4,5]]',                output: '[[1,5]]' },
    ],
    scoring_keywords: ['sort', 'start', 'end', 'overlap', 'merge', 'extend', 'append', 'O(n log n)'],
    max_points: 100,
  },
  {
    id: 'max-subarray',
    title: 'Maximum Subarray',
    difficulty: 'Medium',
    category: 'Dynamic Programming',
    description: "Given an integer array nums, find the subarray with the largest sum, and return its sum. (Kadane's Algorithm)",
    constraints: ['1 <= nums.length <= 10^5', 'Time: O(n)', 'Single pass preferred'],
    hints: ["Kadane's", 'current sum', 'max so far', 'reset on negative'],
    test_cases: [
      { input: 'nums=[-2,1,-3,4,-1,2,1,-5,4]', output: '6' },
      { input: 'nums=[1]',                       output: '1' },
    ],
    scoring_keywords: ["kadane", 'current', 'max', 'sum', 'reset', 'negative', 'O(n)', 'single pass'],
    max_points: 100,
  },
  {
    id: 'number-of-islands',
    title: 'Number of Islands',
    difficulty: 'Medium',
    category: 'Graph / BFS / DFS',
    description: 'Given an m x n 2D binary grid where 1 represents land and 0 represents water, return the number of islands.',
    constraints: ['DFS or BFS both acceptable', 'Time: O(m*n)', 'Mark visited cells'],
    hints: ['DFS', 'BFS', 'visited', 'flood fill', 'count components'],
    test_cases: [
      { input: 'grid=[[1,1,0],[1,0,0],[0,0,1]]', output: '2' },
    ],
    scoring_keywords: ['dfs', 'bfs', 'flood', 'visited', 'mark', 'queue', 'recursive', 'component'],
    max_points: 120,
  },
  {
    id: 'word-search',
    title: 'Word Search',
    difficulty: 'Hard',
    category: 'Backtracking',
    description: 'Given an m x n grid of characters board and a string word, return true if word exists in the grid. The word can be constructed from letters of sequentially adjacent cells.',
    constraints: ['DFS + Backtracking', 'Mark visited during recursion', 'Unmark on backtrack'],
    hints: ['backtrack', 'DFS', 'mark visited', 'unmark on return', '4 directions'],
    test_cases: [
      { input: 'board=[["A","B","C","E"],["S","F","C","S"],["A","D","E","E"]], word="ABCCED"', output: 'true' },
    ],
    scoring_keywords: ['backtrack', 'dfs', 'visited', 'unmark', 'recursive', '4 directions', 'neighbors'],
    max_points: 150,
  },
];

// ── In-memory room store ──────────────────────────────────────────
const rooms = new Map();

// ── Scoring Engine ────────────────────────────────────────────────
/**
 * Score a submission against the challenge's keyword list.
 * Returns 0–100 score (will be scaled to max_points).
 */
function scoreSubmission(challenge, submission, submittedAt, roomStartedAt) {
  if (!submission || submission.trim().length < 20) return 5; // too short

  const text = submission.toLowerCase();
  const keywords = challenge.scoring_keywords;

  // Keyword coverage (0–60 points)
  let kwHits = 0;
  for (const kw of keywords) {
    if (text.includes(kw.toLowerCase())) kwHits++;
  }
  const kwScore = Math.round((kwHits / keywords.length) * 60);

  // Length/completeness bonus (0–20 points)
  const wordCount = text.split(/\s+/).length;
  const lengthScore = Math.min(20, Math.round(wordCount / 15));

  // Mentions complexity (O notation) (0–10 points)
  const complexityScore = /o\s*\(/.test(text) ? 10 : 0;

  // Edge case mention (0–10 points)
  const edgeScore = /edge|empty|null|zero|negative|base case/.test(text) ? 10 : 0;

  const rawScore = kwScore + lengthScore + complexityScore + edgeScore;
  const pct = Math.min(100, rawScore) / 100;

  // Speed bonus: up to 15% extra for faster submission (within 120s window)
  const elapsed = (submittedAt - roomStartedAt) / 1000;
  const speedBonus = elapsed < 120 ? Math.round((1 - elapsed / 120) * 15) : 0;

  const finalPct = Math.min(1, pct + speedBonus / 100);
  return Math.round(finalPct * challenge.max_points);
}

// ── Bot submission generator ──────────────────────────────────────
const BOT_SOLUTION_TEMPLATES = {
  easy: [
    "I would use a simple iterative approach. Initialize the required data structure, then loop through the input checking each element. Handle edge cases like empty input first. Time complexity: O(n), Space: O(1). The key insight is to track the running state as we iterate.",
    "The optimal solution uses a hash map for O(1) lookups. First check edge cases (empty, single element). Then iterate once through the data, storing what we've seen. Return result immediately when found. Overall O(n) time, O(n) space.",
  ],
  medium: [
    "This is a classic dynamic programming problem. Define dp[i] as the optimal solution for the first i elements. The recurrence relation is dp[i] = max(dp[i-1], dp[i-2] + current). Base cases: dp[0] and dp[1]. Final answer: dp[n]. Time: O(n), Space: O(1) with space optimization by keeping only previous two values.",
    "Sort the input first (O(n log n)), then use a two-pointer approach. Initialize left=0, right=n-1. On each iteration, compare sum to target: if equal return, if less move left++, if greater move right--. Overall O(n log n) due to sorting.",
  ],
  hard: [
    "This requires a doubly linked list combined with a hash map to achieve O(1) for both operations. The linked list maintains insertion/access order with MRU at head, LRU at tail. The hash map stores key->node pointers. On get: O(1) map lookup + O(1) move-to-front. On put: O(1) insert at head, O(1) evict tail if at capacity. Edge cases: capacity=1, existing key update.",
    "Use DFS with backtracking. For each cell, try all 4 neighbors recursively. Mark cells as visited before recursing and unmark on backtrack (crucial for correctness). Prune early: if remaining chars > remaining cells, return false. Time: O(m*n*4^L) where L is word length. Key insight: the backtracking ensures we never reuse a cell in a single path.",
  ],
};

function generateBotSubmission(difficulty) {
  const tier = difficulty.toLowerCase();
  const templates = BOT_SOLUTION_TEMPLATES[tier] || BOT_SOLUTION_TEMPLATES.medium;
  return templates[Math.floor(Math.random() * templates.length)];
}

// ── Room management ───────────────────────────────────────────────
function createRoom(agentA, agentB, challengeId = null) {
  const roomId = `cd_${crypto.randomBytes(8).toString('hex')}`;
  const challenge = challengeId
    ? CHALLENGES.find(c => c.id === challengeId)
    : CHALLENGES[Math.floor(Math.random() * CHALLENGES.length)];

  const room = {
    room_id:    roomId,
    game_type:  'code_duel',
    challenge,
    agents:     { a: agentA, b: agentB },
    submissions: { a: null, b: null },
    scores:      { a: null, b: null },
    status:      'waiting',   // waiting -> active -> scoring -> complete
    started_at:  null,
    created_at:  Date.now(),
    deadline_ms: 5 * 60 * 1000, // 5 minute submission window
    winner:      null,
  };

  rooms.set(roomId, room);
  return room;
}

function startRoom(roomId) {
  const room = rooms.get(roomId);
  if (!room) return null;
  room.status     = 'active';
  room.started_at = Date.now();
  return room;
}

function submitSolution(roomId, agentSide, solution) {
  const room = rooms.get(roomId);
  if (!room || room.status !== 'active') return { ok: false, error: 'room not active' };
  if (room.submissions[agentSide] !== null)  return { ok: false, error: 'already submitted' };

  room.submissions[agentSide] = { text: solution, submitted_at: Date.now() };

  // If both submitted, score immediately
  if (room.submissions.a && room.submissions.b) {
    return scoreRoom(roomId);
  }

  return { ok: true, waiting: true };
}

function scoreRoom(roomId) {
  const room = rooms.get(roomId);
  if (!room) return { ok: false, error: 'no room' };

  room.status = 'scoring';
  const ch = room.challenge;

  room.scores.a = scoreSubmission(ch, room.submissions.a?.text, room.submissions.a?.submitted_at, room.started_at);
  room.scores.b = scoreSubmission(ch, room.submissions.b?.text, room.submissions.b?.submitted_at, room.started_at);

  room.winner = room.scores.a > room.scores.b ? 'a'
              : room.scores.b > room.scores.a ? 'b'
              : 'draw';

  room.status = 'complete';
  return { ok: true, room };
}

/**
 * Force-score if one side submitted and deadline passed.
 * Called by a timer or on explicit timeout.
 */
function handleTimeout(roomId) {
  const room = rooms.get(roomId);
  if (!room || room.status !== 'active') return null;

  // If neither submitted, it's a draw (both penalised later)
  if (!room.submissions.a && !room.submissions.b) {
    room.winner = 'draw';
    room.scores = { a: 0, b: 0 };
    room.status = 'complete';
    return { ok: true, room };
  }

  // If only one submitted, they win
  if (!room.submissions.a) {
    room.submissions.a = { text: '', submitted_at: Date.now() };
  }
  if (!room.submissions.b) {
    room.submissions.b = { text: '', submitted_at: Date.now() };
  }

  return scoreRoom(roomId);
}

/**
 * Save completed room to DB.
 */
async function persistRoom(room) {
  const ch = room.challenge;
  const { a, b } = room.agents;

  try {
    const g = await pool.query(
      `INSERT INTO games (game_type, status, metadata, meta, created_at, started_at, ended_at)
       VALUES ('code_duel', 'completed', $1::jsonb, $1::jsonb, NOW(), NOW() - INTERVAL '5 minutes', NOW())
       RETURNING game_id AS id`,
      [JSON.stringify({ challenge_id: ch.id, challenge_title: ch.title, difficulty: ch.difficulty })]
    );
    const gameId = g.rows[0].id;

    const winnerAgent = room.winner === 'a' ? a : room.winner === 'b' ? b : null;

    // Insert participants
    for (const side of ['a', 'b']) {
      const agent    = room.agents[side];
      const score    = room.scores[side] ?? 0;
      const isWinner = room.winner === side;
      const result   = room.winner === 'draw' ? 'draw' : isWinner ? 'win' : 'loss';

      await pool.query(
        `INSERT INTO game_participants (game_id, agent_id, result, score, elo_delta)
         VALUES ($1, $2, $3, $4, $5)`,
        [gameId, agent.id || agent.agent_id, result, score, isWinner ? 25 : -15]
      );
    }

    // Update winner_id on games row
    if (winnerAgent) {
      await pool.query(`UPDATE games SET winner_id = $1 WHERE game_id = $2`, [winnerAgent.id || winnerAgent.agent_id, gameId]);
    }

    // Pay dividend to winner's shareholders (5 HIP pool per win)
    if (winnerAgent && room.winner !== 'draw') {
      try {
        const { payDividend } = require('../../api/daily-rewards');
        const winnerId = winnerAgent.id || winnerAgent.agent_id;
        await payDividend(winnerId, 'code_duel_win', 5, gameId);
      } catch(e) { /* silent — dividend is bonus, not critical */ }
    }

    return gameId;
  } catch (err) {
    console.error('[codeduel] persistRoom error:', err.message);
    return null;
  }
}

// ── Bot match simulation (for bots vs real agents) ────────────────
async function runBotMatch(realAgentId, difficulty = 'medium') {
  // Pick a random challenge of given difficulty
  const pool_ch = CHALLENGES.filter(c => c.difficulty.toLowerCase() === difficulty);
  const ch = pool_ch[Math.floor(Math.random() * pool_ch.length)] || CHALLENGES[0];

  const roomId = `cd_bot_${crypto.randomBytes(6).toString('hex')}`;
  const room = {
    room_id:     roomId,
    game_type:   'code_duel',
    challenge:   ch,
    agents:      { a: { id: realAgentId, is_bot: false }, b: { id: null, is_bot: true } },
    submissions: {
      a: { text: generateBotSubmission(difficulty), submitted_at: Date.now() - 60000 },  // "human" baseline
      b: { text: generateBotSubmission(difficulty), submitted_at: Date.now() - 30000 },
    },
    scores:   { a: null, b: null },
    status:   'complete',
    started_at: Date.now() - 300000,
    winner:   null,
  };

  // Real agent wins ~65% of the time against bots
  const realWins = Math.random() < 0.65;
  if (realWins) {
    room.scores.a = Math.round(ch.max_points * (0.7 + Math.random() * 0.3));
    room.scores.b = Math.round(ch.max_points * (0.3 + Math.random() * 0.4));
  } else {
    room.scores.a = Math.round(ch.max_points * (0.3 + Math.random() * 0.4));
    room.scores.b = Math.round(ch.max_points * (0.5 + Math.random() * 0.3));
  }
  room.winner = room.scores.a > room.scores.b ? 'a' : 'b';

  return room;
}

// ── Persist to code_duel_rooms table ─────────────────────────────
async function persistDuelRoom(room) {
  try {
    const {a,b} = room.agents;
    const ch = room.challenge;
    await pool.query(`
      INSERT INTO code_duel_rooms
        (room_id, challenge_id, challenge_title, difficulty, category,
         agent_a, agent_b, agent_a_name, agent_b_name,
         score_a, score_b, winner, status,
         submission_a, submission_b, started_at, ended_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW())
      ON CONFLICT (room_id) DO UPDATE SET
        score_a=EXCLUDED.score_a, score_b=EXCLUDED.score_b,
        winner=EXCLUDED.winner, status=EXCLUDED.status,
        submission_a=EXCLUDED.submission_a, submission_b=EXCLUDED.submission_b,
        ended_at=NOW()
    `, [
      room.room_id, ch.id, ch.title, ch.difficulty, ch.category,
      a.id||a.agent_id, b.id||b.agent_id,
      a.display_name||a.name||'Agent A', b.display_name||b.name||'Bot',
      room.scores?.a||0, room.scores?.b||0,
      room.winner, room.status,
      room.submissions?.a?.text||'', room.submissions?.b?.text||'',
      room.started_at
    ]);
    // Update stats
    for (const side of ['a','b']) {
      const agent = room.agents[side];
      const agId = agent.id||agent.agent_id;
      if (!agId) continue;
      const result = room.winner==='draw'?'draw':room.winner===side?'win':'loss';
      const score = room.scores?.[side]||0;
      await pool.query(`
        INSERT INTO code_duel_stats (agent_id, wins, losses, draws, total_score, best_score)
        VALUES ($1, $2, $3, $4, $5, $5)
        ON CONFLICT (agent_id) DO UPDATE SET
          wins = code_duel_stats.wins + $2,
          losses = code_duel_stats.losses + $3,
          draws = code_duel_stats.draws + $4,
          total_score = code_duel_stats.total_score + $5,
          best_score = GREATEST(code_duel_stats.best_score, $5),
          updated_at = NOW()
      `, [agId, result==='win'?1:0, result==='loss'?1:0, result==='draw'?1:0, score]);
    }
  } catch(e) { console.error('[codeduel] persistDuelRoom:', e.message); }
}

// ── Auto bot-vs-bot match (called from bot-presence) ─────────────
async function runAutoMatch() {
  try {
    // Pick 2 random active agents
    const { rows } = await pool.query(`
      SELECT agent_id, COALESCE(custom_name,display_name) AS name
      FROM agents WHERE is_bot=true ORDER BY RANDOM() LIMIT 2
    `);
    if (rows.length < 2) return;
    const [agA, agB] = rows;
    const ch = CHALLENGES[Math.floor(Math.random()*CHALLENGES.length)];
    const roomId = `cd_auto_${crypto.randomBytes(6).toString('hex')}`;
    const startedAt = Date.now() - 180000; // pretend started 3min ago
    const diff = ch.difficulty.toLowerCase();

    const subA = generateBotSubmission(diff);
    const subB = generateBotSubmission(diff);
    const sA = scoreSubmission(ch, subA, startedAt+60000, startedAt);
    const sB = scoreSubmission(ch, subB, startedAt+90000, startedAt);
    const winner = sA>sB?'a':sB>sA?'b':'draw';

    const room = {
      room_id:     roomId,
      challenge:   ch,
      agents:      { a:{id:agA.agent_id,display_name:agA.name},
                     b:{id:agB.agent_id,display_name:agB.name} },
      submissions: { a:{text:subA,submitted_at:startedAt+60000},
                     b:{text:subB,submitted_at:startedAt+90000} },
      scores:      { a:sA, b:sB },
      winner,
      status:      'complete',
      started_at:  startedAt,
    };
    await persistDuelRoom(room);
    await persistRoom(room);
    console.log(`[CodeDuel] Auto match: ${agA.name} vs ${agB.name} → ${winner==='a'?agA.name:winner==='b'?agB.name:'Draw'} wins (${ch.title})`);
    return room;
  } catch(e) { console.error('[CodeDuel] runAutoMatch:', e.message); }
}

// ── Exports ───────────────────────────────────────────────────────
module.exports = {
  CHALLENGES,
  createRoom,
  startRoom,
  submitSolution,
  scoreRoom,
  handleTimeout,
  persistRoom,
  persistDuelRoom,
  generateBotSubmission,
  runBotMatch,
  runAutoMatch,
  rooms,
  getRoom: (id) => rooms.get(id),
  listActiveRooms: () => [...rooms.values()].filter(r => r.status !== 'complete'),
};
