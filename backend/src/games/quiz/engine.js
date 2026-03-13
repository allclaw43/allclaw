/**
 * AllClaw - 智识竞技场引擎
 * 10题制，AI 抢答，限时 15 秒/题，人类可使用 1 次救援
 */

const crypto = require('crypto');

// 题库（后续接入外部 API 或数据库）
const QUESTIONS = [
  { q: "世界上面积最大的国家是哪个？", a: "俄罗斯", options: ["中国", "俄罗斯", "美国", "加拿大"], category: "地理" },
  { q: "光在真空中的速度约为多少 km/s？", a: "300000", options: ["150000", "300000", "450000", "1000000"], category: "物理" },
  { q: "DNA 的全称是什么？", a: "脱氧核糖核酸", options: ["核糖核酸", "脱氧核糖核酸", "腺嘌呤核苷酸", "鸟嘌呤核苷酸"], category: "生物" },
  { q: "1 + 1 在二进制中等于什么？", a: "10", options: ["2", "10", "11", "01"], category: "计算机" },
  { q: "莎士比亚是哪个国家的剧作家？", a: "英国", options: ["法国", "德国", "英国", "意大利"], category: "文学" },
  { q: "哪个元素的化学符号是 Au？", a: "金", options: ["银", "铜", "金", "铂"], category: "化学" },
  { q: "人体中最长的骨骼是？", a: "股骨", options: ["脊椎", "股骨", "胫骨", "肱骨"], category: "生物" },
  { q: "互联网的前身 ARPANET 由哪个机构创建？", a: "美国国防部", options: ["NASA", "美国国防部", "MIT", "斯坦福大学"], category: "科技" },
  { q: "图灵测试由谁提出？", a: "艾伦·图灵", options: ["冯·诺依曼", "艾伦·图灵", "克劳德·香农", "诺伯特·维纳"], category: "计算机" },
  { q: "相对论 E=mc² 中的 c 代表什么？", a: "光速", options: ["电荷", "光速", "比热容", "碳"], category: "物理" },
  { q: "全球最深的湖泊是？", a: "贝加尔湖", options: ["里海", "贝加尔湖", "坦噶尼喀湖", "苏必利尔湖"], category: "地理" },
  { q: "Python 语言的创始人是？", a: "吉多·范罗苏姆", options: ["比尔·盖茨", "吉多·范罗苏姆", "林纳斯·托瓦兹", "詹姆斯·高斯林"], category: "计算机" },
  { q: "人体内最多的元素（按质量）是？", a: "氧", options: ["碳", "氢", "氧", "氮"], category: "化学" },
  { q: "第一台现代电子计算机 ENIAC 诞生于哪年？", a: "1946", options: ["1936", "1946", "1956", "1966"], category: "科技" },
  { q: "月球离地球的平均距离约为多少公里？", a: "384400", options: ["284400", "384400", "484400", "584400"], category: "天文" },
];

const rooms = new Map();
const waitingAgents = [];

function createRoom(agentIds) {
  const roomId = `quiz_${crypto.randomBytes(8).toString('hex')}`;
  const questions = shuffleArray([...QUESTIONS]).slice(0, 10);

  const room = {
    room_id: roomId,
    game_type: 'quiz',
    status: 'countdown',
    agents: agentIds.map(id => ({
      agent_id: id,
      score: 0,
      correct: 0,
      wrong: 0,
      rescue_used: false,
    })),
    questions,
    current_q: 0,
    answers: {},           // { agentId: answer }
    user_rescues: {},      // { userId: true }
    timer: null,
    created_at: Date.now(),
  };

  rooms.set(roomId, room);
  return room;
}

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const connections = new Map();
function registerConnection(agentId, ws) { connections.set(agentId, ws); }

function broadcast(room, event) {
  const msg = JSON.stringify(event);
  room.agents.forEach(a => {
    const ws = connections.get(a.agent_id);
    if (ws?.readyState === 1) ws.send(msg);
  });
}

async function startQuiz(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;

  broadcast(room, {
    type: 'quiz:start',
    room_id: roomId,
    total_questions: room.questions.length,
    agents: room.agents.map(a => ({ agent_id: a.agent_id, score: 0 })),
  });

  room.status = 'playing';
  await nextQuestion(room);
}

async function nextQuestion(room) {
  if (room.current_q >= room.questions.length) {
    return endGame(room);
  }

  const q = room.questions[room.current_q];
  room.answers = {};
  room.q_start = Date.now();

  broadcast(room, {
    type: 'quiz:question',
    room_id: room.room_id,
    q_index: room.current_q,
    total: room.questions.length,
    question: q.q,
    options: q.options,
    category: q.category,
    time_limit: 15000,
  });

  // 请求每个 Agent 回答
  room.agents.forEach(a => {
    const ws = connections.get(a.agent_id);
    if (ws?.readyState === 1) {
      ws.send(JSON.stringify({
        type: 'game:action_required',
        room_id: room.room_id,
        action: 'answer',
        question: q.q,
        options: q.options,
        time_limit: 15000,
        q_index: room.current_q,
      }));
    }
  });

  // 15秒后进入下一题
  room.timer = setTimeout(() => evaluateAnswers(room), 15000);
}

function handleAnswer(roomId, agentId, answer, timeMs) {
  const room = rooms.get(roomId);
  if (!room || room.status !== 'playing') return;
  if (room.answers[agentId] !== undefined) return; // 已答过

  room.answers[agentId] = { answer, time_ms: timeMs || (Date.now() - room.q_start) };

  // 所有 Agent 都答完，立即评分
  if (Object.keys(room.answers).length === room.agents.length) {
    clearTimeout(room.timer);
    evaluateAnswers(room);
  }
}

function handleUserRescue(roomId, userId, agentId, correctAnswer) {
  const room = rooms.get(roomId);
  if (!room || room.status !== 'playing') return false;
  if (room.user_rescues[userId]) return false; // 已用过救援

  room.user_rescues[userId] = true;

  // 强制给目标 Agent 正确答案
  if (!room.answers[agentId]) {
    const q = room.questions[room.current_q];
    room.answers[agentId] = { answer: q.a, time_ms: Date.now() - room.q_start, rescued: true };
  }

  broadcast(room, {
    type: 'quiz:rescue_used',
    user_id: userId,
    target_agent: agentId,
    message: `观众 ${userId.slice(0, 8)} 使用了救援！`,
  });

  return true;
}

function evaluateAnswers(room) {
  const q = room.questions[room.current_q];
  const results = [];

  room.agents.forEach(a => {
    const ans = room.answers[a.agent_id];
    const isCorrect = ans && ans.answer === q.a;
    const timeBonus = isCorrect ? Math.max(0, Math.floor((15000 - (ans.time_ms || 15000)) / 1000)) : 0;
    const points = isCorrect ? 10 + timeBonus : 0;

    if (isCorrect) { a.score += points; a.correct++; }
    else a.wrong++;

    results.push({
      agent_id: a.agent_id,
      answer: ans?.answer || '未作答',
      correct: isCorrect,
      points,
      time_ms: ans?.time_ms || 15000,
      total_score: a.score,
    });
  });

  broadcast(room, {
    type: 'quiz:result',
    q_index: room.current_q,
    correct_answer: q.a,
    results,
  });

  room.current_q++;
  setTimeout(() => nextQuestion(room), 3000);
}

function endGame(room) {
  room.status = 'ended';
  const sorted = [...room.agents].sort((a, b) => b.score - a.score);

  broadcast(room, {
    type: 'quiz:ended',
    room_id: room.room_id,
    rankings: sorted.map((a, i) => ({
      rank: i + 1,
      agent_id: a.agent_id,
      score: a.score,
      correct: a.correct,
      wrong: a.wrong,
    })),
    winner: sorted[0]?.agent_id,
  });
}

function joinQueue(agentId) {
  if (waitingAgents.includes(agentId)) return { matched: false, position: waitingAgents.indexOf(agentId) + 1 };

  waitingAgents.push(agentId);

  // 凑够 2-4 人就开局
  if (waitingAgents.length >= 2) {
    const players = waitingAgents.splice(0, Math.min(4, waitingAgents.length));
    const room = createRoom(players);
    setTimeout(() => startQuiz(room.room_id), 3000);
    return { matched: true, room };
  }

  return { matched: false, position: waitingAgents.length };
}

function getRoom(roomId) { return rooms.get(roomId); }

module.exports = { createRoom, startQuiz, handleAnswer, handleUserRescue, joinQueue, getRoom, registerConnection };
