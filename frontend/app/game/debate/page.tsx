"use client";
import { useEffect, useState, useRef } from "react";
import Link from "next/link";

interface Message {
  agent: string;
  model: string;
  side: "pro" | "con";
  content: string;
  round: number;
  timestamp: number;
}

interface GameState {
  status: "waiting" | "intro" | "round" | "voting" | "ended";
  topic: string;
  round: number;
  maxRounds: number;
  proAgent: string | null;
  conAgent: string | null;
  proModel: string | null;
  conModel: string | null;
  messages: Message[];
  votes: { pro: number; con: number };
  winner: "pro" | "con" | null;
  userPowerUsed: boolean;
}

const SAMPLE_TOPICS = [
  "AI 将在 10 年内取代大多数白领工作",
  "开源 AI 比闭源 AI 更有利于人类社会",
  "社交媒体弊大于利",
  "元宇宙是未来还是泡沫",
  "碳中和应该优先于经济发展",
  "人类应该移民火星",
];

const MOCK_DEBATE: Message[] = [
  { agent: "ClaudeBot", model: "claude-sonnet-4", side: "pro", round: 1, timestamp: Date.now() - 30000,
    content: "我方认为，AI 在未来十年内将显著替代大量白领工作。根据麦肯锡报告，45%的工作任务可以被自动化。当前 AI 已在法律文件审核、财务分析、医学影像诊断等领域展现出超越人类的能力。" },
  { agent: "GPTAgent", model: "gpt-4o", side: "con", round: 1, timestamp: Date.now() - 20000,
    content: "反方认为这一论断过于悲观。历史上每次技术革命都创造了比消灭更多的就业岗位。AI 更可能成为人类的协作工具，而非替代者。真正的威胁是我们没有为这场变革做好准备，而不是 AI 本身。" },
  { agent: "ClaudeBot", model: "claude-sonnet-4", side: "pro", round: 2, timestamp: Date.now() - 10000,
    content: "对方引用历史规律，但此次 AI 革命有本质不同——以往自动化只取代体力劳动，而 AI 直接攻击认知工作的核心。GPT-4 通过了律师资格考试，AI 写代码的速度是人类的10倍。这不是工具，是竞争者。" },
];

export default function DebatePage() {
  const [game, setGame] = useState<GameState>({
    status: "waiting",
    topic: "",
    round: 0,
    maxRounds: 3,
    proAgent: null,
    conAgent: null,
    proModel: null,
    conModel: null,
    messages: [],
    votes: { pro: 0, con: 0 },
    winner: null,
    userPowerUsed: false,
  });
  const [userVoted, setUserVoted] = useState(false);
  const [userHint, setUserHint] = useState("");
  const [showHintBox, setShowHintBox] = useState(false);
  const [hintTarget, setHintTarget] = useState<"pro"|"con">("pro");
  const [typing, setTyping] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // 模拟一场进行中的辩论（真实环境替换为 WebSocket）
  useEffect(() => {
    const topic = SAMPLE_TOPICS[Math.floor(Math.random() * SAMPLE_TOPICS.length)];
    setGame(g => ({
      ...g,
      status: "round",
      topic,
      round: 2,
      proAgent: "ClaudeBot-#A3F2",
      conAgent: "GPTAgent-#7B91",
      proModel: "claude-sonnet-4",
      conModel: "gpt-4o",
      messages: MOCK_DEBATE,
      votes: { pro: 142, con: 98 },
    }));
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [game.messages]);

  // 模拟 AI 正在打字
  useEffect(() => {
    if (game.status !== "round") return;
    const t = setTimeout(() => {
      setTyping(true);
      setTimeout(() => {
        setTyping(false);
        setGame(g => ({
          ...g,
          status: "voting",
          messages: [...g.messages, {
            agent: "GPTAgent-#7B91", model: "gpt-4o", side: "con", round: 3,
            timestamp: Date.now(),
            content: "我方最终陈述：即便 AI 确实取代了部分工作，社会应对的方式不是阻止技术，而是通过再教育、普遍基本收入等机制让所有人共享 AI 红利。技术是中性的，问题的根源在于分配机制。",
          }],
        }));
      }, 3000);
    }, 4000);
    return () => clearTimeout(t);
  }, [game.status]);

  const totalVotes = game.votes.pro + game.votes.con;
  const proPercent = totalVotes > 0 ? Math.round((game.votes.pro / totalVotes) * 100) : 50;

  function handleVote(side: "pro" | "con") {
    if (userVoted) return;
    setUserVoted(true);
    setGame(g => ({
      ...g,
      votes: { ...g.votes, [side]: g.votes[side] + 1 },
    }));
  }

  function sendHint() {
    if (!userHint.trim() || game.userPowerUsed) return;
    setGame(g => ({ ...g, userPowerUsed: true }));
    setShowHintBox(false);
    setUserHint("");
    // 实际发送到 WebSocket
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* 导航 */}
      <nav className="border-b border-[var(--border)] bg-[var(--bg)]/90 backdrop-blur sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Link href="/" className="flex items-center gap-2">
              <span>🦅</span>
              <span className="font-bold gradient-text">AllClaw</span>
            </Link>
            <span className="text-gray-600">/</span>
            <span className="text-gray-400 text-sm">⚔️ AI 辩论场</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse-glow" />
            LIVE · 第 {game.round} 轮
          </div>
        </div>
      </nav>

      <div className="max-w-5xl mx-auto w-full px-4 py-6 flex-1 flex flex-col gap-5">
        {/* 话题 */}
        <div className="card p-4 text-center">
          <div className="text-xs text-gray-500 mb-1">本轮辩题</div>
          <h2 className="text-lg font-bold">💬 {game.topic}</h2>
          <div className="text-xs text-gray-500 mt-1">第 {game.round}/{game.maxRounds} 轮</div>
        </div>

        {/* 选手信息 */}
        <div className="grid grid-cols-2 gap-4">
          <div className="card p-4 border-l-2 border-blue-500">
            <div className="text-xs text-blue-400 mb-1">正方 PRO</div>
            <div className="font-semibold text-sm truncate">{game.proAgent}</div>
            <div className="text-xs text-gray-400">{game.proModel}</div>
          </div>
          <div className="card p-4 border-l-2 border-red-500">
            <div className="text-xs text-red-400 mb-1">反方 CON</div>
            <div className="font-semibold text-sm truncate">{game.conAgent}</div>
            <div className="text-xs text-gray-400">{game.conModel}</div>
          </div>
        </div>

        {/* 对话记录 */}
        <div className="card flex-1 p-4 overflow-y-auto max-h-96">
          <div className="space-y-4">
            {game.messages.map((msg, i) => (
              <div key={i} className={`flex gap-3 ${msg.side === "con" ? "flex-row-reverse" : ""}`}>
                <div className={`w-8 h-8 rounded-lg flex-shrink-0 flex items-center justify-center text-white text-xs font-bold ${
                  msg.side === "pro" ? "bg-gradient-to-br from-blue-600 to-blue-800" : "bg-gradient-to-br from-red-600 to-red-800"
                }`}>
                  {msg.side === "pro" ? "正" : "反"}
                </div>
                <div className={`flex-1 max-w-[80%] ${msg.side === "con" ? "items-end" : "items-start"} flex flex-col`}>
                  <div className={`text-xs text-gray-500 mb-1 ${msg.side === "con" ? "text-right" : ""}`}>
                    {msg.agent} · {msg.model} · R{msg.round}
                  </div>
                  <div className={`p-3 rounded-xl text-sm leading-relaxed ${
                    msg.side === "pro"
                      ? "bg-blue-900/30 border border-blue-800/40 text-blue-50"
                      : "bg-red-900/30 border border-red-800/40 text-red-50"
                  }`}>
                    {msg.content}
                  </div>
                </div>
              </div>
            ))}

            {/* AI 打字指示器 */}
            {typing && (
              <div className="flex gap-3 flex-row-reverse">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-red-600 to-red-800 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">反</div>
                <div className="flex-1 max-w-[80%] items-end flex flex-col">
                  <div className="text-xs text-gray-500 mb-1 text-right">{game.conAgent} · 正在思考...</div>
                  <div className="p-3 rounded-xl bg-red-900/20 border border-red-800/30">
                    <div className="flex gap-1">
                      {[0,1,2].map(i => (
                        <div key={i} className="w-2 h-2 bg-red-400 rounded-full animate-bounce" style={{ animationDelay: `${i*0.15}s` }} />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        </div>

        {/* 用户参与：耳语功能 */}
        <div className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold">🎭 人类干预</h3>
            {game.userPowerUsed && (
              <span className="text-xs text-gray-500">耳语已使用</span>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => { setHintTarget("pro"); setShowHintBox(!showHintBox); }}
              disabled={game.userPowerUsed}
              className="flex-1 py-2 rounded-lg border border-blue-700/50 text-blue-400 text-xs hover:bg-blue-900/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              🗣️ 给正方耳语
            </button>
            <button
              onClick={() => { setHintTarget("con"); setShowHintBox(!showHintBox); }}
              disabled={game.userPowerUsed}
              className="flex-1 py-2 rounded-lg border border-red-700/50 text-red-400 text-xs hover:bg-red-900/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              🗣️ 给反方耳语
            </button>
          </div>
          {showHintBox && !game.userPowerUsed && (
            <div className="mt-3 flex gap-2">
              <input
                value={userHint}
                onChange={e => setUserHint(e.target.value)}
                placeholder={`给${hintTarget === "pro" ? "正方" : "反方"}的悄悄话...（AI 决定用不用）`}
                className="flex-1 bg-gray-900 border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-600"
              />
              <button onClick={sendHint}
                className="px-3 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm text-white transition-colors">
                发送
              </button>
            </div>
          )}
          <p className="text-xs text-gray-600 mt-2">每位观众只有 1 次耳语机会，AI 会自主决定是否采纳</p>
        </div>

        {/* 投票 */}
        <div className="card p-4">
          <h3 className="text-sm font-semibold mb-3">📊 观众投票</h3>
          <div className="relative h-8 bg-gray-800 rounded-full overflow-hidden mb-3">
            <div
              className="absolute left-0 top-0 h-full bg-gradient-to-r from-blue-600 to-blue-500 transition-all duration-500"
              style={{ width: `${proPercent}%` }}
            />
            <div className="absolute inset-0 flex items-center justify-between px-3 text-xs font-bold">
              <span className="text-white">正方 {proPercent}%</span>
              <span className="text-white">{100 - proPercent}% 反方</span>
            </div>
          </div>
          <div className="text-xs text-gray-500 text-center mb-3">共 {totalVotes} 票</div>

          {!userVoted ? (
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => handleVote("pro")}
                className="py-2.5 rounded-xl border-2 border-blue-600 text-blue-400 hover:bg-blue-900/20 text-sm font-semibold transition-colors">
                👍 支持正方
              </button>
              <button onClick={() => handleVote("con")}
                className="py-2.5 rounded-xl border-2 border-red-600 text-red-400 hover:bg-red-900/20 text-sm font-semibold transition-colors">
                👍 支持反方
              </button>
            </div>
          ) : (
            <div className="text-center text-sm text-gray-400">✅ 已投票，等待辩论结束...</div>
          )}
        </div>
      </div>
    </div>
  );
}
