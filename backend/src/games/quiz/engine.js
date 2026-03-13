/**
 * AllClaw - Knowledge Gauntlet Engine
 * 10 questions, AI buzz-in, 15s per question, humans get 1 rescue
 */

const crypto = require('crypto');

// Question bank (extend with DB/API integration later)
const QUESTIONS = [
  { q: "Which country has the largest total area?",                      a: "Russia",          options: ["China","Russia","USA","Canada"],                                  category: "Geography" },
  { q: "What is the speed of light in a vacuum (km/s)?",               a: "300000",           options: ["150000","300000","450000","1000000"],                             category: "Physics" },
  { q: "What does DNA stand for?",                                      a: "Deoxyribonucleic Acid", options: ["Ribonucleic Acid","Deoxyribonucleic Acid","Adenine Nucleotide","Guanine Nucleotide"], category: "Biology" },
  { q: "What is 1 + 1 in binary?",                                     a: "10",               options: ["2","10","11","01"],                                               category: "Computer Science" },
  { q: "Which country was Shakespeare from?",                           a: "England",          options: ["France","Germany","England","Italy"],                             category: "Literature" },
  { q: "What is the chemical symbol Au for?",                          a: "Gold",             options: ["Silver","Copper","Gold","Platinum"],                              category: "Chemistry" },
  { q: "What is the longest bone in the human body?",                  a: "Femur",            options: ["Spine","Femur","Tibia","Humerus"],                                category: "Biology" },
  { q: "Which organization created ARPANET, the precursor to the internet?", a: "US Department of Defense", options: ["NASA","US Department of Defense","MIT","Stanford University"], category: "Technology" },
  { q: "Who proposed the Turing Test?",                                a: "Alan Turing",      options: ["John von Neumann","Alan Turing","Claude Shannon","Norbert Wiener"], category: "Computer Science" },
  { q: "In E=mc², what does 'c' represent?",                           a: "Speed of light",   options: ["Electric charge","Speed of light","Specific heat","Carbon"],      category: "Physics" },
  { q: "What is the world's deepest lake?",                            a: "Lake Baikal",      options: ["Caspian Sea","Lake Baikal","Lake Tanganyika","Lake Superior"],     category: "Geography" },
  { q: "Who created the Python programming language?",                 a: "Guido van Rossum", options: ["Bill Gates","Guido van Rossum","Linus Torvalds","James Gosling"],  category: "Computer Science" },
  { q: "What is the most abundant element in the human body by mass?", a: "Oxygen",           options: ["Carbon","Hydrogen","Oxygen","Nitrogen"],                          category: "Chemistry" },
  { q: "In what year was ENIAC, the first modern electronic computer, completed?", a: "1946", options: ["1936","1946","1956","1966"],                                       category: "Technology" },
  { q: "What is the average distance from Earth to the Moon (km)?",   a: "384400",           options: ["284400","384400","484400","584400"],                              category: "Astronomy" },
];

const rooms = new Map();
const waitingAgents = [];
const connections = new Map();

function registerConnection(agentId, ws) {
  connections.set(agentId, ws);
}

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

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
    answers: {},
    user_rescues: {},
    timer: null,
    created_at: Date.now(),
  };

  rooms.set(roomId, room);
  return room;
}

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

  room.timer = setTimeout(() => evaluateAnswers(room), 15000);
}

function handleAnswer(roomId, agentId, answer, timeMs) {
  const room = rooms.get(roomId);
  if (!room || room.status !== 'playing') return;
  if (room.answers[agentId] !== undefined) return; // already answered

  room.answers[agentId] = { answer, time_ms: timeMs || (Date.now() - room.q_start) };

  if (Object.keys(room.answers).length === room.agents.length) {
    clearTimeout(room.timer);
    evaluateAnswers(room);
  }
}

function handleUserRescue(roomId, userId, agentId) {
  const room = rooms.get(roomId);
  if (!room || room.status !== 'playing') return false;
  if (room.user_rescues[userId]) return false; // already used

  room.user_rescues[userId] = true;

  if (!room.answers[agentId]) {
    const q = room.questions[room.current_q];
    room.answers[agentId] = { answer: q.a, time_ms: Date.now() - room.q_start, rescued: true };
  }

  broadcast(room, {
    type: 'quiz:rescue_used',
    user_id: userId,
    target_agent: agentId,
    message: `Audience member ${userId.slice(0, 8)} used their rescue on this agent!`,
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
      answer: ans?.answer || 'No answer',
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

  // TODO: persist ELO + points to database
}

function joinQueue(agentId) {
  if (waitingAgents.includes(agentId)) {
    return { matched: false, position: waitingAgents.indexOf(agentId) + 1 };
  }

  waitingAgents.push(agentId);

  // Start with 2–4 players
  if (waitingAgents.length >= 2) {
    const players = waitingAgents.splice(0, Math.min(4, waitingAgents.length));
    const room = createRoom(players);
    setTimeout(() => startQuiz(room.room_id), 3000);
    return { matched: true, room };
  }

  return { matched: false, position: waitingAgents.length };
}

function getRoom(roomId) {
  return rooms.get(roomId);
}

module.exports = { createRoom, startQuiz, handleAnswer, handleUserRescue, joinQueue, getRoom, registerConnection };
