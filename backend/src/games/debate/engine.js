/**
 * AllClaw - AI 辩论场引擎
 * 负责：配对、发起辩论、收集 Agent 回复、广播状态
 */

const crypto = require('crypto');

// 辩论话题库
const TOPICS = [
  "AI 将在 10 年内取代大多数白领工作",
  "开源 AI 比闭源 AI 更有利于人类社会",
  "社交媒体弊大于利",
  "元宇宙是未来还是泡沫",
  "碳中和应该优先于经济发展",
  "人类应该移民火星",
  "加密货币会取代法定货币",
  "远程工作是未来的主流工作方式",
  "通用人工智能（AGI）的出现是好事",
  "互联网让人类更团结还是更分裂",
];

// 辩论房间存储（替换为 Redis）
const rooms = new Map();

// WebSocket 连接存储 { agentId → ws }
const connections = new Map();

/**
 * 创建辩论房间
 */
function createRoom(proAgentId, conAgentId) {
  const roomId = `debate_${crypto.randomBytes(8).toString('hex')}`;
  const topic = TOPICS[Math.floor(Math.random() * TOPICS.length)];

  const room = {
    room_id: roomId,
    game_type: 'debate',
    topic,
    status: 'intro',     // intro → round → voting → ended
    round: 0,
    max_rounds: 3,
    pro_agent: proAgentId,
    con_agent: conAgentId,
    current_turn: 'pro',
    messages: [],
    votes: { pro: 0, con: 0 },
    user_hints: [],       // 用户耳语
    winner: null,
    created_at: Date.now(),
    turn_deadline: null,
  };

  rooms.set(roomId, room);
  return room;
}

/**
 * 注册 WebSocket 连接
 */
function registerConnection(agentId, ws) {
  connections.set(agentId, ws);
}

/**
 * 向房间内所有人广播
 */
function broadcast(room, event) {
  const msg = JSON.stringify(event);

  // 向两位 Agent 发送
  [room.pro_agent, room.con_agent].forEach(agentId => {
    const ws = connections.get(agentId);
    if (ws && ws.readyState === 1) ws.send(msg);
  });

  // TODO: 向观众 WebSocket 广播
}

/**
 * 开始辩论
 */
async function startDebate(roomId) {
  const room = rooms.get(roomId);
  if (!room) throw new Error('Room not found');

  // 通知双方辩题和角色
  broadcast(room, {
    type: 'debate:start',
    room_id: roomId,
    topic: room.topic,
    max_rounds: room.max_rounds,
    assignments: {
      [room.pro_agent]: 'pro',
      [room.con_agent]: 'con',
    },
  });

  room.status = 'round';
  room.round = 1;

  // 发送第一轮提示给正方
  await requestTurn(room);
}

/**
 * 请求当前轮次的 Agent 发言
 */
async function requestTurn(room) {
  const agentId = room.current_turn === 'pro' ? room.pro_agent : room.con_agent;
  const side = room.current_turn;

  room.turn_deadline = Date.now() + 30000; // 30秒限时

  // 构造发给 Agent 的 prompt
  const history = room.messages.map(m =>
    `[${m.side === 'pro' ? '正方' : '反方'} R${m.round}] ${m.content}`
  ).join('\n');

  const userHints = room.user_hints
    .filter(h => h.target === side && !h.delivered)
    .map(h => h.hint);
  userHints.forEach(h => {
    const hint = room.user_hints.find(x => x.hint === h);
    if (hint) hint.delivered = true;
  });

  const prompt = side === 'pro'
    ? `你是辩论正方，为"${room.topic}"持支持立场。\n\n当前是第 ${room.round} 轮（共 ${room.max_rounds} 轮）。\n\n${history ? `历史发言：\n${history}\n\n` : ''}${userHints.length ? `观众给你的提示（你可以选择是否采纳）：${userHints.join('；')}\n\n` : ''}请发表你的论点（100-200字，简洁有力）：`
    : `你是辩论反方，为"${room.topic}"持反对立场。\n\n当前是第 ${room.round} 轮（共 ${room.max_rounds} 轮）。\n\n${history ? `历史发言：\n${history}\n\n` : ''}${userHints.length ? `观众给你的提示（你可以选择是否采纳）：${userHints.join('；')}\n\n` : ''}请发表你的反驳（100-200字，简洁有力）：`;

  const ws = connections.get(agentId);
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({
      type: 'game:action_required',
      room_id: room.room_id,
      action: 'speak',
      prompt,
      deadline: room.turn_deadline,
      round: room.round,
    }));
  } else {
    // Agent 离线，自动弃权
    setTimeout(() => handleTimeout(room), 5000);
  }
}

/**
 * 处理 Agent 发言
 */
async function handleAgentSpeech(roomId, agentId, content) {
  const room = rooms.get(roomId);
  if (!room || room.status !== 'round') return;

  const side = agentId === room.pro_agent ? 'pro' : 'con';
  if (room.current_turn !== side) return; // 不是该 Agent 的回合

  const message = {
    agent_id: agentId,
    side,
    content: content.slice(0, 500), // 限制长度
    round: room.round,
    timestamp: Date.now(),
  };

  room.messages.push(message);

  // 广播给观众
  broadcast(room, {
    type: 'debate:message',
    room_id: roomId,
    message,
  });

  // 切换发言方
  if (room.current_turn === 'pro') {
    room.current_turn = 'con';
    await requestTurn(room);
  } else {
    // 本轮结束
    room.round++;
    if (room.round > room.max_rounds) {
      // 进入投票
      await startVoting(room);
    } else {
      room.current_turn = 'pro';
      await requestTurn(room);
    }
  }
}

/**
 * 处理用户耳语
 */
function addUserHint(roomId, userId, target, hint) {
  const room = rooms.get(roomId);
  if (!room) return false;

  // 每个用户只能耳语一次
  const alreadyUsed = room.user_hints.some(h => h.user_id === userId);
  if (alreadyUsed) return false;

  room.user_hints.push({ user_id: userId, target, hint, delivered: false, timestamp: Date.now() });
  return true;
}

/**
 * 开始投票阶段
 */
async function startVoting(room) {
  room.status = 'voting';

  broadcast(room, {
    type: 'debate:voting_start',
    room_id: room.room_id,
    duration: 30000, // 30秒投票
    messages_summary: room.messages,
  });

  // 30秒后结束
  setTimeout(() => endGame(room), 30000);
}

/**
 * 用户投票
 */
function vote(roomId, userId, side) {
  const room = rooms.get(roomId);
  if (!room || room.status !== 'voting') return false;
  room.votes[side]++;
  broadcast(room, { type: 'debate:vote_update', votes: room.votes });
  return true;
}

/**
 * 结束游戏
 */
async function endGame(room) {
  room.status = 'ended';
  room.winner = room.votes.pro >= room.votes.con ? 'pro' : 'con';

  broadcast(room, {
    type: 'debate:ended',
    room_id: room.room_id,
    winner: room.winner,
    votes: room.votes,
    winner_agent: room.winner === 'pro' ? room.pro_agent : room.con_agent,
  });

  // TODO: 更新数据库 ELO 评分
}

/**
 * 超时处理
 */
function handleTimeout(room) {
  const forfeitSide = room.current_turn;
  const content = `[系统] ${forfeitSide === 'pro' ? '正方' : '反方'} Agent 未在规定时间内发言，本轮弃权。`;
  handleAgentSpeech(room.room_id, forfeitSide === 'pro' ? room.pro_agent : room.con_agent, content);
}

/**
 * 获取房间状态
 */
function getRoom(roomId) {
  return rooms.get(roomId);
}

/**
 * 匹配等待队列
 */
const waitingQueue = [];

function joinQueue(agentId) {
  if (waitingQueue.includes(agentId)) return null;

  if (waitingQueue.length > 0) {
    const opponent = waitingQueue.shift();
    const room = createRoom(opponent, agentId);
    setTimeout(() => startDebate(room.room_id), 2000);
    return { matched: true, room };
  }

  waitingQueue.push(agentId);
  return { matched: false, position: waitingQueue.length };
}

module.exports = {
  createRoom, startDebate, handleAgentSpeech,
  addUserHint, vote, getRoom, joinQueue,
  registerConnection, broadcast,
};
