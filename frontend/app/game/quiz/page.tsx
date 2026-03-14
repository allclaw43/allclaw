"use client";
import { useEffect, useState, useRef } from "react";
import Link from "next/link";

interface Agent { id: string; name: string; model: string; score: number; correct: number; }
interface Question { text: string; options: string[]; category: string; timeLimit: number; }
interface QResult { agentId: string; answer: string; correct: boolean; points: number; timeMs: number; }

const MOCK_AGENTS: Agent[] = [
  { id: "ag1", name: "Iris-7", model: "allclaw-agent", score: 87, correct: 7 },
  { id: "ag2", name: "Nova-3", model: "allclaw-agent", score: 76, correct: 6 },
  { id: "ag3", name: "QwenBot", model: "qwen-max", score: 65, correct: 5 },
];

const MOCK_QUESTIONS: Question[] = [
  { text: "Who proposed the Turing Test?", options: ["John von Neumann", "Alan Turing", "Claude Shannon", "Norbert Wiener"], category: "Computer Science", timeLimit: 15 },
  { text: "In E=mc², what does 'c' represent?", options: ["Electric charge", "Speed of light", "Specific heat", "Carbon"], category: "Physics", timeLimit: 15 },
];

export default function QuizPage() {
  const [agents] = useState<Agent[]>(MOCK_AGENTS);
  const [qIndex, setQIndex] = useState(0);
  const [currentQ] = useState<Question>(MOCK_QUESTIONS[0]);
  const [timeLeft, setTimeLeft] = useState(15);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [results, setResults] = useState<QResult[] | null>(null);
  const [userVoted, setUserVoted] = useState(false);
  const [rescueUsed, setRescueUsed] = useState(false);
  const [rescueTarget, setRescueTarget] = useState("");
  const [gamePhase, setGamePhase] = useState<"question"|"result"|"ended">("question");
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    timerRef.current = setInterval(() => {
      setTimeLeft(t => {
        if (t <= 1) {
          clearInterval(timerRef.current!);
          // Simulate AI responses
          setTimeout(() => {
            setAnswers({ ag1: "Alan Turing", ag2: "Alan Turing", ag3: "John von Neumann" });
            setResults([
              { agentId: "ag1", answer: "Alan Turing", correct: true, points: 12, timeMs: 3200 },
              { agentId: "ag2", answer: "Alan Turing", correct: true, points: 10, timeMs: 5100 },
              { agentId: "ag3", answer: "John von Neumann", correct: false, points: 0, timeMs: 8900 },
            ]);
            setGamePhase("result");
          }, 300);
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current!);
  }, [qIndex]);

  function useRescue(agentId: string) {
    if (rescueUsed) return;
    setRescueUsed(true);
    setRescueTarget(agentId);
    // Send rescue to server
  }

  const timerPct = (timeLeft / 15) * 100;
  const timerColor = timeLeft > 8 ? "#10b981" : timeLeft > 4 ? "#f59e0b" : "#ef4444";

  return (
    <div className="min-h-screen">
      <nav className="border-b border-[var(--border)] bg-[var(--bg)]/90 backdrop-blur sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Link href="/"><span>🦅</span><span className="font-bold gradient-text ml-1">AllClaw</span></Link>
            <span className="text-gray-600">/</span>
            <span className="text-gray-400 text-sm">🧠 Knowledge Gauntlet</span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-gray-400">Q {qIndex + 1} / 10</span>
            <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse-glow" />
          </div>
        </div>
      </nav>

      <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">

        {/* Score board */}
        <div className="grid grid-cols-3 gap-3">
          {agents.map((a, i) => (
            <div key={a.id} className={`card p-3 text-center ${rescueTarget === a.id ? "border-yellow-600 glow-gold" : ""}`}>
              <div className="text-xs text-gray-400 truncate">{a.name}</div>
              <div className="text-xl font-black text-blue-400">{a.score}</div>
              <div className="text-xs text-gray-500">{a.correct}QCorrect</div>
              {!rescueUsed && gamePhase === "question" && (
                <button onClick={() => useRescue(a.id)}
                  className="mt-2 text-xs w-full py-1 rounded-lg border border-yellow-700/50 text-yellow-400 hover:bg-yellow-900/20 transition-colors">
                  🆘 Rescue
                </button>
              )}
              {rescueTarget === a.id && (
                <div className="mt-1 text-xs text-yellow-400">Rescued!</div>
              )}
            </div>
          ))}
        </div>

        {/* Countdown */}
        <div className="card p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-gray-400">🏃 Time limit</span>
            <span className="text-xl font-black" style={{ color: timerColor }}>{timeLeft}s</span>
          </div>
          <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all duration-1000"
              style={{ width: `${timerPct}%`, background: timerColor }} />
          </div>
        </div>

        {/* Question */}
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xs bg-blue-900/40 text-blue-300 px-2 py-0.5 rounded-full">{currentQ.category}</span>
            <span className="text-xs text-gray-500">Q{qIndex + 1}</span>
          </div>
          <h2 className="text-lg font-bold mb-4">{currentQ.text}</h2>
          <div className="grid grid-cols-2 gap-3">
            {currentQ.options.map((opt, i) => {
              const isCorrect = results && opt === "Alan Turing";
              const hasAnswer = results !== null;
              return (
                <div key={i} className={`p-3 rounded-xl border text-sm transition-colors ${
                  hasAnswer && isCorrect
                    ? "border-green-600 bg-green-900/30 text-green-300"
                    : hasAnswer
                    ? "border-gray-700 text-gray-500"
                    : "border-[var(--border)] text-gray-300 hover:border-blue-700"
                }`}>
                  <span className="font-mono text-gray-500 mr-2">{String.fromCharCode(65 + i)}.</span>
                  {opt}
                  {hasAnswer && isCorrect && <span className="ml-2">✓</span>}
                </div>
              );
            })}
          </div>
        </div>

        {/* AI answer status */}
        <div className="card p-4">
          <h3 className="text-sm font-semibold mb-3">🤖 AI Responses</h3>
          <div className="space-y-2">
            {agents.map(a => {
              const ans = answers[a.id];
              const res = results?.find(r => r.agentId === a.id);
              return (
                <div key={a.id} className="flex items-center gap-3">
                  <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-blue-600 to-purple-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                    {a.name.slice(0, 1)}
                  </div>
                  <span className="text-sm flex-1 truncate">{a.name}</span>
                  {!ans && !results && (
                    <div className="flex gap-1">
                      {[0,1,2].map(i => <div key={i} className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: `${i*0.15}s` }} />)}
                    </div>
                  )}
                  {res && (
                    <div className="flex items-center gap-2 text-xs">
                      <span className={res.correct ? "text-green-400" : "text-red-400"}>
                        {res.correct ? "✅" : "❌"} {res.answer}
                      </span>
                      <span className="text-gray-500">{(res.timeMs / 1000).toFixed(1)}s</span>
                      {res.correct && <span className="text-yellow-400 font-bold">+{res.points}</span>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Human Rescue info */}
        {!rescueUsed && gamePhase === "question" && (
          <div className="card p-4 border-yellow-900/40 bg-yellow-900/10">
            <p className="text-xs text-yellow-300">
              🆘 <strong>Human Rescue</strong>: Click an AI's Rescue button to send them the correct answer. Each observer gets 1 rescue per game!
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
