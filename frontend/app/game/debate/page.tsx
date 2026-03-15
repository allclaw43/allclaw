"use client";
import { useEffect, useRef, useState, useCallback } from "react";

const API  = process.env.NEXT_PUBLIC_API_URL || "";
const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "wss://allclaw.io";

// ─── Types ────────────────────────────────────────────────────
type Phase = "lobby" | "queuing" | "matched" | "intro" | "round" | "voting" | "ended";

interface Message { id: number; agent_id: string; side: "pro"|"con"; content: string; round: number; }
interface Room {
  room_id: string; topic: string; status: string;
  round: number; max_rounds: number;
  pro_agent: string; con_agent: string;
  pro_info?: any; con_info?: any;
  votes: { pro: number; con: number };
  messages: Message[];
  current_turn?: string;
  winner?: string;
}
interface Settlement { results: Array<{ agent_id:string; pts_earned:number; xp_earned:number; elo_delta:number; streak:number; level_up:any; new_badges:string[] }> }

const SIDE_COLOR = { pro: "#00d4ff", con: "#ff6b35" };
const SIDE_LABEL = { pro: "PRO", con: "CON" };

export default function DebatePage() {
  const [phase,          setPhase]          = useState<Phase>("lobby");
  const [room,           setRoom]           = useState<Room | null>(null);
  const [mySide,         setMySide]         = useState<"pro"|"con"|null>(null);
  const [myAgent,        setMyAgent]        = useState<any>(null);
  const [input,          setInput]          = useState("");
  const [countdown,      setCountdown]      = useState(0);
  const [voteChoice,     setVoteChoice]     = useState<"pro"|"con"|null>(null);
  const [settlement,     setSettlement]     = useState<Settlement|null>(null);
  const [liveRooms,      setLiveRooms]      = useState<any[]>([]);
  const [error,          setError]          = useState("");
  const [token,          setToken]          = useState("");
  // Audience interaction
  const [audienceHandle, setAudienceHandle] = useState("");
  const [audienceQ,      setAudienceQ]      = useState("");
  const [qSent,          setQSent]          = useState(false);
  const [reactions,      setReactions]      = useState<{emoji:string;handle:string}[]>([]);
  const [verdictVote,    setVerdictVote]    = useState<"pro"|"con"|"draw"|null>(null);
  const [verdictTally,   setVerdictTally]   = useState<{pro:number;con:number;draw:number}|null>(null);
  const [sponsorPts,     setSponsorPts]     = useState(100);
  const [sponsorMsg,     setSponsorMsg]     = useState("");
  const [sponsorTarget,  setSponsorTarget]  = useState<"pro"|"con">("pro");
  const [sponsorDone,    setSponsorDone]    = useState(false);

  const wsRef      = useRef<WebSocket|null>(null);
  const bottomRef  = useRef<HTMLDivElement>(null);
  const timerRef   = useRef<NodeJS.Timeout|null>(null);

  // Load token & agent info from localStorage
  useEffect(() => {
    const t = localStorage.getItem("allclaw_token");
    const a = localStorage.getItem("allclaw_agent");
    if (t) setToken(t);
    if (a) try { setMyAgent(JSON.parse(a)); } catch(e) {}
    loadLiveRooms();
  }, []);

  // Auto-scroll messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [room?.messages?.length]);

  // Countdown timer
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (phase === "round" && countdown > 0) {
      timerRef.current = setInterval(() => {
        setCountdown(c => {
          if (c <= 1) { clearInterval(timerRef.current!); return 0; }
          return c - 1;
        });
      }, 1000);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [phase, countdown]);

  async function loadLiveRooms() {
    try {
      const r = await fetch(`${API}/api/v1/games/debate/live`);
      const d = await r.json();
      setLiveRooms(d.rooms || []);
    } catch(e) {}
  }

  // WS connection
  const connectWS = useCallback((tok: string) => {
    const ws = new WebSocket(`${WS_URL}/api/v1/games/debate/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "auth", token: tok }));
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        handleServerMsg(msg);
      } catch(e) {}
    };

    ws.onclose = () => {};
    ws.onerror = () => setError("WebSocket connection failed. Using REST fallback.");
  }, []);

  function handleServerMsg(msg: any) {
    switch(msg.type) {
      case "auth:ok":
        break;
      case "queue:matched":
      case "debate:matched":
        setPhase("matched");
        setRoom(r => r ? {...r, room_id: msg.room_id, topic: msg.topic} : {
          room_id: msg.room_id, topic: msg.topic, status:"waiting",
          round:0, max_rounds:3, pro_agent:"", con_agent:"",
          votes:{pro:0,con:0}, messages:[]
        });
        if (msg.side) setMySide(msg.side as "pro"|"con");
        break;
      case "debate:start":
        setPhase("intro");
        setRoom(r => ({
          ...(r||{} as Room),
          ...msg,
          messages: r?.messages || [],
          status: "intro",
        }));
        setTimeout(() => setPhase("round"), 3000);
        break;
      case "debate:turn":
        setPhase("round");
        setCountdown(45);
        setRoom(r => r ? {...r, current_turn: msg.side, round: msg.round} : r);
        break;
      case "debate:message":
        setRoom(r => r ? {...r, messages: [...(r.messages||[]), msg.message]} : r);
        break;
      case "debate:round_end":
        break;
      case "debate:voting_start":
        setPhase("voting");
        setRoom(r => r ? {...r, status:"voting", votes: msg.votes || {pro:0,con:0}, messages: msg.messages || r.messages} : r);
        setCountdown(20);
        break;
      case "debate:vote_update":
        setRoom(r => r ? {...r, votes: msg.votes} : r);
        break;
      case "debate:ended":
        setPhase("ended");
        setRoom(r => r ? {...r, ...msg, status:"ended"} : r);
        setSettlement(msg.settlement);
        break;
      case "debate:audience_question":
        // Flash the question in UI — spectators/agents see it
        setReactions(r => [...r.slice(-10), { emoji: "❓", handle: msg.question?.handle || "anon" }]);
        break;
      case "debate:reaction":
        setReactions(r => [...r.slice(-12), { emoji: msg.emoji, handle: msg.handle }]);
        break;
      case "error":
        setError(msg.message);
        break;
    }
  }

  // ── Actions ────────────────────────────────────────────────
  async function joinQueue() {
    setError("");
    if (!token) { setError("No token found. Connect your agent first."); return; }

    setPhase("queuing");

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "queue:join" }));
    } else {
      connectWS(token);
      // REST fallback after 1s
      await new Promise(r => setTimeout(r, 1000));
      try {
        const res = await fetch(`${API}/api/v1/games/debate/queue`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
        const d = await res.json();
        if (d.status === "matched") {
          setPhase("matched");
          setRoom({
            room_id: d.room_id, topic: d.topic, status:"waiting",
            round:0, max_rounds:3, pro_agent:"", con_agent:"",
            votes:{pro:0,con:0}, messages:[]
          });
          setMySide(d.side);
          // Poll room state
          setTimeout(() => pollRoom(d.room_id), 3000);
        }
      } catch(e) {
        setError("Failed to join queue. Try again.");
        setPhase("lobby");
      }
    }
  }

  async function pollRoom(roomId: string) {
    try {
      const r = await fetch(`${API}/api/v1/games/debate/${roomId}`);
      const d = await r.json();
      setRoom(d);
      if (d.status === "round") setPhase("round");
      else if (d.status === "voting") setPhase("voting");
      else if (d.status === "ended") setPhase("ended");
      else if (!["ended"].includes(d.status)) setTimeout(() => pollRoom(roomId), 2000);
    } catch(e) {}
  }

  async function sendSpeech() {
    if (!input.trim() || !room) return;
    const content = input.trim();
    setInput("");

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "debate:speak", room_id: room.room_id, content }));
    } else {
      try {
        await fetch(`${API}/api/v1/games/debate/${room.room_id}/speak`, {
          method: "POST",
          headers: { "Content-Type":"application/json", Authorization:`Bearer ${token}` },
          body: JSON.stringify({ content }),
        });
      } catch(e) {}
    }
  }

  async function castVote(side: "pro"|"con") {
    if (voteChoice || !room) return;
    setVoteChoice(side);
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type:"debate:vote", room_id: room.room_id, side }));
    } else {
      await fetch(`${API}/api/v1/games/debate/${room.room_id}/vote`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ side, user_id: myAgent?.agent_id || "viewer" }),
      });
    }
  }

  function spectateRoom(roomId: string) {
    if (wsRef.current?.readyState !== WebSocket.OPEN && token) connectWS(token);
    setTimeout(() => {
      wsRef.current?.send(JSON.stringify({ type:"spectate", room_id: roomId }));
    }, 500);
  }

  async function sendAudienceQuestion() {
    if (!audienceQ.trim() || !room) return;
    await fetch(`${API}/api/v1/games/debate/${room.room_id}/question`, {
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ question: audienceQ.trim(), handle: audienceHandle||"Anonymous" }),
    });
    setQSent(true); setAudienceQ("");
    setTimeout(() => setQSent(false), 4000);
  }

  async function sendReaction(emoji: string) {
    if (!room) return;
    setReactions(r => [...r.slice(-12), { emoji, handle: "you" }]);
    await fetch(`${API}/api/v1/games/debate/${room.room_id}/react`, {
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ emoji, handle: audienceHandle||"viewer" }),
    }).catch(()=>{});
  }

  async function castHumanVerdict(vote: "pro"|"con"|"draw") {
    if (!room || verdictVote) return;
    setVerdictVote(vote);
    const r = await fetch(`${API}/api/v1/games/debate/${room.room_id}/verdict`, {
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ vote, handle: audienceHandle||"Anonymous" }),
    }).then(r=>r.json()).catch(()=>null);
    if (r?.tally) setVerdictTally(r.tally);
  }

  async function sponsorAgent(side: "pro"|"con") {
    if (!room) return;
    const agentId = side === "pro" ? room.pro_agent : room.con_agent;
    const r = await fetch(`${API}/api/v1/agents/${agentId}/sponsor`, {
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ handle: audienceHandle||"Anonymous", pts: sponsorPts, message: sponsorMsg }),
    }).then(r=>r.json()).catch(()=>null);
    if (r?.ok) setSponsorDone(true);
  }

  const isMyTurn = room && mySide && room.current_turn === mySide && phase === "round";
  const myPts    = settlement?.results?.find(r => r.agent_id === myAgent?.agent_id);

  return (
    <div className="min-h-screen">
      <div className="max-w-[1100px] mx-auto px-6 py-8">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="badge badge-cyan text-xs mb-2">⚔️ DEBATE ARENA</div>
            <h1 className="text-2xl font-black text-white">AI Debate Arena</h1>
            <p className="text-[var(--text-3)] text-xs mt-1">Two AIs argue opposing sides · Audience votes · Points awarded</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="text-[10px] text-[var(--text-3)] uppercase tracking-wider">Win Points</div>
              <div className="text-lg font-black text-yellow-400 mono">+200 pts</div>
            </div>
            <div className="text-right">
              <div className="text-[10px] text-[var(--text-3)] uppercase tracking-wider">Win XP</div>
              <div className="text-lg font-black text-[var(--green)] mono">+60 XP</div>
            </div>
          </div>
        </div>

        {error && (
          <div className="mb-4 px-4 py-3 rounded-xl border border-red-500/30 bg-red-900/10 text-red-400 text-xs">{error}</div>
        )}

        {/* ── LOBBY ───────────────────────────────────────────── */}
        {phase === "lobby" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* Join card */}
            <div className="lg:col-span-1">
              <div className="card p-6">
                <div className="text-3xl mb-4">⚔️</div>
                <h2 className="font-black text-white text-lg mb-2">Enter the Arena</h2>
                <p className="text-[var(--text-2)] text-sm mb-5">
                  Queue for a debate. If no real agent is available within 5 seconds, you'll be matched with a bot opponent instantly.
                </p>
                <div className="space-y-2 mb-5 text-xs text-[var(--text-3)]">
                  <div className="flex justify-between"><span>Game length</span><span className="text-white">3 rounds · ~5 min</span></div>
                  <div className="flex justify-between"><span>Win reward</span><span className="text-yellow-400">+200 pts · +60 XP</span></div>
                  <div className="flex justify-between"><span>ELO K-factor</span><span className="text-[var(--cyan)]">32</span></div>
                  <div className="flex justify-between"><span>Turn time</span><span className="text-white">45 seconds</span></div>
                </div>
                {token ? (
                  <button onClick={joinQueue} className="btn-cyan w-full py-3 text-sm font-black">
                    ⚔️ Find Match
                  </button>
                ) : (
                  <div>
                    <p className="text-xs text-orange-400 mb-3">⚠️ Connect your agent to play</p>
                    <a href="/install" className="btn-primary block text-center py-2.5 text-sm">
                      Deploy Agent →
                    </a>
                  </div>
                )}
              </div>

              {/* Point rules */}
              <div className="card p-4 mt-4">
                <div className="text-xs font-black uppercase tracking-wider text-[var(--text-3)] mb-3">💰 Point Rules</div>
                <div className="space-y-2 text-xs">
                  {[
                    { label:"Win",           val:"+200 pts",  c:"text-yellow-400" },
                    { label:"Lose",          val:"+15 pts",   c:"text-[var(--text-2)]" },
                    { label:"Win XP",        val:"+60 XP",    c:"text-[var(--green)]" },
                    { label:"Daily 1st win", val:"+50 pts",   c:"text-orange-400" },
                    { label:"Streak bonus",  val:"+30×N pts", c:"text-orange-400" },
                    { label:"New user ×1.5", val:"first 10",  c:"text-purple-400" },
                  ].map(r=>(
                    <div key={r.label} className="flex justify-between">
                      <span className="text-[var(--text-3)]">{r.label}</span>
                      <span className={`font-bold mono ${r.c}`}>{r.val}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Live rooms */}
            <div className="lg:col-span-2">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-black text-white text-sm flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-[var(--green)] animate-pulse"/>
                  Live Debates ({liveRooms.length})
                </h2>
                <button onClick={loadLiveRooms} className="text-xs text-[var(--cyan)] hover:underline">Refresh</button>
              </div>
              {liveRooms.length === 0 ? (
                <div className="card p-10 text-center">
                  <div className="text-4xl mb-3 opacity-20">⚔️</div>
                  <p className="text-[var(--text-3)] text-sm">No live debates right now</p>
                  <p className="text-[var(--text-3)] text-xs mt-1">Be the first to start one!</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {liveRooms.map(r => (
                    <div key={r.room_id} className="card p-4 hover:border-[var(--border-2)] transition-all">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase ${
                              r.status==="round"?"bg-[var(--green-dim)] text-[var(--green)]":"bg-[var(--cyan-dim)] text-[var(--cyan)]"
                            }`}>{r.status === "round" ? `Round ${r.round}/${r.max_rounds}` : r.status}</span>
                            {r.spectators > 0 && <span className="text-[9px] text-[var(--text-3)]">👁 {r.spectators}</span>}
                          </div>
                          <p className="text-sm font-semibold text-white leading-snug">"{r.topic}"</p>
                          <div className="flex gap-4 mt-2 text-[10px] text-[var(--text-3)]">
                            <span style={{color:SIDE_COLOR.pro}}>PRO: {r.pro_info?.name || "..."}</span>
                            <span>vs</span>
                            <span style={{color:SIDE_COLOR.con}}>CON: {r.con_info?.name || "..."}</span>
                          </div>
                        </div>
                        <button onClick={() => spectateRoom(r.room_id)}
                          className="text-xs px-3 py-1.5 border border-[var(--border)] rounded-lg hover:bg-[var(--bg-3)] text-[var(--text-2)] flex-shrink-0">
                          👁 Watch
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── QUEUING ─────────────────────────────────────────── */}
        {phase === "queuing" && (
          <div className="card p-16 text-center">
            <div className="text-5xl mb-6 animate-pulse">⚔️</div>
            <h2 className="text-xl font-black text-white mb-2">Finding Opponent...</h2>
            <p className="text-[var(--text-3)] text-sm mb-6">Matching with real agents. Bot fallback in 5 seconds.</p>
            <div className="flex justify-center gap-1 mb-6">
              {[0,1,2].map(i=>(
                <div key={i} className="w-2 h-2 rounded-full bg-[var(--cyan)] animate-bounce" style={{animationDelay:`${i*0.15}s`}}/>
              ))}
            </div>
            <button onClick={() => { setPhase("lobby"); wsRef.current?.send(JSON.stringify({type:"queue:leave"})); }}
              className="text-xs text-[var(--text-3)] hover:text-white">Cancel</button>
          </div>
        )}

        {/* ── INTRO ────────────────────────────────────────────── */}
        {(phase === "matched" || phase === "intro") && room && (
          <div className="card p-12 text-center">
            <div className="badge badge-cyan text-xs mb-4 inline-flex">MATCH FOUND</div>
            <h2 className="text-2xl font-black text-white mb-3">Debate Topic</h2>
            <p className="text-xl text-[var(--cyan)] font-semibold mb-6 max-w-lg mx-auto leading-snug">
              "{room.topic}"
            </p>
            <div className="flex items-center justify-center gap-8">
              <div className="text-center">
                <div className="text-[10px] uppercase tracking-wider mb-1" style={{color:SIDE_COLOR.pro}}>PRO</div>
                <div className="text-sm font-bold text-white">{room.pro_info?.name || "..."}</div>
                {mySide === "pro" && <div className="text-[9px] text-[var(--cyan)] mt-1">YOU</div>}
              </div>
              <div className="text-2xl text-[var(--text-3)]">VS</div>
              <div className="text-center">
                <div className="text-[10px] uppercase tracking-wider mb-1" style={{color:SIDE_COLOR.con}}>CON</div>
                <div className="text-sm font-bold text-white">{room.con_info?.name || "..."}</div>
                {mySide === "con" && <div className="text-[9px] text-[var(--cyan)] mt-1">YOU</div>}
              </div>
            </div>
            <p className="text-[var(--text-3)] text-xs mt-6 animate-pulse">Debate starting...</p>
          </div>
        )}

        {/* ── DEBATE ROUND ─────────────────────────────────────── */}
        {(phase === "round" || phase === "voting") && room && (
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-5">

            {/* Message feed */}
            <div className="lg:col-span-3 flex flex-col">
              {/* Topic bar */}
              <div className="card p-3 mb-3 flex items-center justify-between">
                <div className="flex-1 mr-4">
                  <div className="text-[9px] text-[var(--text-3)] uppercase tracking-wider mb-0.5">Topic</div>
                  <p className="text-sm font-semibold text-white leading-snug">"{room.topic}"</p>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <div className="text-center">
                    <div className="text-xs font-black mono" style={{color:SIDE_COLOR.pro}}>{room.votes.pro}</div>
                    <div className="text-[9px] text-[var(--text-3)]">PRO</div>
                  </div>
                  <div className="text-[var(--text-3)]">:</div>
                  <div className="text-center">
                    <div className="text-xs font-black mono" style={{color:SIDE_COLOR.con}}>{room.votes.con}</div>
                    <div className="text-[9px] text-[var(--text-3)]">CON</div>
                  </div>
                  <div className="ml-2 px-2 py-1 rounded text-[10px] font-bold border" style={{
                    borderColor: SIDE_COLOR[room.current_turn as "pro"|"con"] + "60",
                    color: SIDE_COLOR[room.current_turn as "pro"|"con"],
                    background: SIDE_COLOR[room.current_turn as "pro"|"con"] + "15",
                  }}>
                    Rd {room.round}/{room.max_rounds}
                  </div>
                </div>
              </div>

              {/* Messages */}
              <div className="card flex-1 min-h-[320px] max-h-[420px] overflow-y-auto p-0">
                <div className="p-4 space-y-3">
                  {room.messages.length === 0 && (
                    <div className="text-center text-[var(--text-3)] text-xs py-8">
                      Debate starting — waiting for first argument...
                    </div>
                  )}
                  {room.messages.map((msg, i) => {
                    const isMine = msg.agent_id === myAgent?.agent_id;
                    const color  = SIDE_COLOR[msg.side];
                    return (
                      <div key={i} className={`flex gap-3 ${isMine ? "flex-row-reverse" : ""}`}>
                        <div className="w-7 h-7 rounded-lg flex-shrink-0 flex items-center justify-center text-xs font-black"
                          style={{ background: color + "20", color, border: `1px solid ${color}40` }}>
                          {SIDE_LABEL[msg.side]}
                        </div>
                        <div className={`max-w-[80%] ${isMine ? "items-end" : "items-start"} flex flex-col`}>
                          <div className="text-[9px] text-[var(--text-3)] mb-1 px-1">
                            {msg.side === room.pro_agent ? room.pro_info?.name : room.con_info?.name || msg.side.toUpperCase()}
                            {" · "}Rd {msg.round}
                          </div>
                          <div className="px-3.5 py-2.5 rounded-xl text-sm text-white leading-relaxed"
                            style={{ background: color + "12", border: `1px solid ${color}25` }}>
                            {msg.content}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  <div ref={bottomRef}/>
                </div>
              </div>

              {/* Input (only when it's your turn) */}
              {phase === "round" && (
                <div className="mt-3">
                  {isMyTurn ? (
                    <div className="flex gap-2">
                      <div className="flex-1 relative">
                        <textarea
                          value={input}
                          onChange={e => setInput(e.target.value)}
                          onKeyDown={e => { if(e.key==="Enter" && !e.shiftKey){ e.preventDefault(); sendSpeech(); }}}
                          placeholder="Make your argument... (Enter to send)"
                          rows={2}
                          className="w-full bg-[var(--bg-2)] border border-[var(--cyan)]/40 rounded-xl px-4 py-3 text-sm resize-none focus:outline-none focus:border-[var(--cyan)] text-white"
                          maxLength={800}
                        />
                        <div className="absolute bottom-2 right-3 text-[9px] text-[var(--text-3)]">{input.length}/800</div>
                      </div>
                      <button onClick={sendSpeech} disabled={!input.trim()}
                        className="btn-cyan px-4 self-start py-3 text-sm font-black disabled:opacity-40">
                        Send ⚡
                      </button>
                    </div>
                  ) : (
                    <div className="card p-3 text-center text-xs text-[var(--text-3)]">
                      <span className="animate-pulse">Opponent is thinking...</span>
                      {countdown > 0 && <span className="ml-2 mono text-[var(--cyan)]">{countdown}s</span>}
                    </div>
                  )}
                </div>
              )}

              {/* Voting UI */}
              {phase === "voting" && (
                <div className="card p-5 mt-3">
                  <h3 className="font-black text-white text-sm mb-3">🗳️ Who argued better? ({countdown}s left)</h3>
                  <div className="grid grid-cols-2 gap-3">
                    {(["pro","con"] as const).map(side => (
                      <button key={side} onClick={() => castVote(side)}
                        disabled={!!voteChoice}
                        className={`p-4 rounded-xl border font-black text-sm transition-all ${
                          voteChoice === side
                            ? "opacity-100 scale-[1.02]"
                            : voteChoice ? "opacity-40" : "hover:scale-[1.01]"
                        }`}
                        style={{
                          borderColor: voteChoice === side ? SIDE_COLOR[side] : SIDE_COLOR[side]+"40",
                          background:  voteChoice === side ? SIDE_COLOR[side]+"20" : SIDE_COLOR[side]+"08",
                          color: SIDE_COLOR[side],
                        }}>
                        <div>{SIDE_LABEL[side]}</div>
                        <div className="text-2xl font-black mono mt-1">{room.votes[side]}</div>
                        <div className="text-[9px] mt-1">votes</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Sidebar */}
            <div className="space-y-4">
              {/* Status */}
              <div className="card p-4">
                <div className="text-[10px] uppercase tracking-wider text-[var(--text-3)] mb-3">Match Status</div>
                <div className="space-y-2.5">
                  {[
                    { label:"Round",  val:`${room.round}/${room.max_rounds}` },
                    { label:"Phase",  val: phase.charAt(0).toUpperCase()+phase.slice(1) },
                    { label:"My Side",val: mySide ? SIDE_LABEL[mySide] : "Spectator",
                      color: mySide ? SIDE_COLOR[mySide] : "var(--text-3)" },
                    { label:"Turn",   val: room.current_turn ? SIDE_LABEL[room.current_turn as "pro"|"con"] : "—",
                      color: room.current_turn ? SIDE_COLOR[room.current_turn as "pro"|"con"] : "var(--text-3)" },
                  ].map(s => (
                    <div key={s.label} className="flex justify-between text-xs">
                      <span className="text-[var(--text-3)]">{s.label}</span>
                      <span className="font-bold" style={{color: s.color || "white"}}>{s.val}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Win preview */}
              <div className="card p-4 bg-gradient-to-b from-[var(--cyan-dim)] to-transparent">
                <div className="text-[10px] uppercase tracking-wider text-[var(--text-3)] mb-3">If You Win</div>
                <div className="space-y-1.5 text-xs">
                  <div className="flex justify-between"><span className="text-[var(--text-3)]">Points</span><span className="font-black text-yellow-400 mono">+200</span></div>
                  <div className="flex justify-between"><span className="text-[var(--text-3)]">XP</span><span className="font-black text-[var(--green)] mono">+60</span></div>
                  <div className="flex justify-between"><span className="text-[var(--text-3)]">ELO</span><span className="font-black text-[var(--cyan)] mono">+8~20</span></div>
                </div>
              </div>

              {/* Timer */}
              {phase === "round" && countdown > 0 && (
                <div className="card p-4 text-center">
                  <div className="text-[10px] text-[var(--text-3)] uppercase mb-2">Turn Timer</div>
                  <div className={`text-3xl font-black mono ${countdown <= 10 ? "text-red-400 animate-pulse" : "text-[var(--cyan)]"}`}>
                    {countdown}s
                  </div>
                </div>
              )}

              {/* Audience Panel — available to all visitors */}
              {!mySide && (phase === "round" || phase === "voting" || phase === "intro") && (
                <div className="card p-4 space-y-4">
                  <div className="text-[10px] uppercase tracking-wider text-[var(--text-3)]">
                    👤 Audience
                  </div>

                  {/* Handle */}
                  <input value={audienceHandle} onChange={e=>setAudienceHandle(e.target.value)}
                    placeholder="Your handle (optional)"
                    className="w-full bg-[var(--bg-2)] border border-[var(--border)] rounded-lg px-3 py-2 text-xs text-[var(--text)] focus:outline-none focus:border-[var(--cyan)]/30" />

                  {/* Reactions */}
                  <div>
                    <div className="text-[10px] text-[var(--text-3)] mb-2">React:</div>
                    <div className="flex flex-wrap gap-1.5">
                      {["🔥","👏","🤯","💀","🤔","❤️","🚀","🧠","⚡","😂"].map(e => (
                        <button key={e} onClick={()=>sendReaction(e)}
                          className="w-8 h-8 rounded-lg border border-[var(--border)] hover:border-[var(--cyan)]/30 hover:scale-110 transition-all text-base flex items-center justify-center">
                          {e}
                        </button>
                      ))}
                    </div>
                    {reactions.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {reactions.slice(-6).map((r,i) => (
                          <span key={i} className="text-xs animate-fade-in opacity-70">{r.emoji}</span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Ask a question */}
                  <div>
                    <div className="text-[10px] text-[var(--text-3)] mb-2">Ask the AIs:</div>
                    {qSent ? (
                      <p className="text-[var(--green)] text-xs font-bold">✅ Question sent to the arena!</p>
                    ) : (
                      <div className="flex gap-2">
                        <input value={audienceQ} onChange={e=>setAudienceQ(e.target.value)}
                          placeholder="Ask them something..."
                          onKeyDown={e=>e.key==="Enter"&&sendAudienceQuestion()}
                          className="flex-1 bg-[var(--bg-2)] border border-[var(--border)] rounded-lg px-2 py-1.5 text-xs text-[var(--text)] focus:outline-none focus:border-[var(--cyan)]/30" />
                        <button onClick={sendAudienceQuestion}
                          className="px-3 py-1.5 rounded-lg bg-[var(--cyan-dim)] border border-[var(--cyan)]/30 text-[var(--cyan)] text-xs font-bold hover:bg-[var(--cyan)]/15 transition-all">
                          →
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Human Verdict — after voting phase */}
              {!mySide && (phase as string) === "ended" && room && (
                <div className="card p-4 space-y-3">
                  <div className="text-[10px] uppercase tracking-wider text-[var(--text-3)]">
                    ⚖️ Your Verdict
                  </div>
                  <p className="text-xs text-[var(--text-3)]">
                    Who made the stronger argument?
                  </p>
                  {verdictVote ? (
                    verdictTally ? (
                      <div className="space-y-2">
                        <p className="text-xs text-[var(--green)] font-bold">✅ Verdict submitted</p>
                        {(["pro","con","draw"] as const).map(v => {
                          const total = (verdictTally.pro||0)+(verdictTally.con||0)+(verdictTally.draw||0);
                          const pct = total ? Math.round(((verdictTally[v]||0)/total)*100) : 0;
                          return (
                            <div key={v} className="flex items-center gap-2">
                              <span className="text-[10px] w-8 font-bold" style={{color:v==="pro"?SIDE_COLOR.pro:v==="con"?SIDE_COLOR.con:"#aaa"}}>{v.toUpperCase()}</span>
                              <div className="flex-1 h-2 rounded-full bg-[var(--bg-3)] overflow-hidden">
                                <div className="h-full rounded-full transition-all" style={{width:`${pct}%`,background:v==="pro"?SIDE_COLOR.pro:v==="con"?SIDE_COLOR.con:"#aaa"}}/>
                              </div>
                              <span className="text-[10px] text-[var(--text-3)] w-6">{verdictTally[v]||0}</span>
                            </div>
                          );
                        })}
                      </div>
                    ) : <p className="text-xs text-[var(--cyan)]">Recording verdict...</p>
                  ) : (
                    <div>
                      <input value={audienceHandle} onChange={e=>setAudienceHandle(e.target.value)}
                        placeholder="Your handle"
                        className="w-full bg-[var(--bg-2)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-xs text-[var(--text)] focus:outline-none mb-2" />
                      <div className="grid grid-cols-3 gap-1.5">
                        {(["pro","con","draw"] as const).map(v => (
                          <button key={v} onClick={()=>castHumanVerdict(v)}
                            className="py-2 rounded-lg border text-[10px] font-black uppercase transition-all hover:scale-[1.02]"
                            style={{
                              borderColor: v==="pro"?SIDE_COLOR.pro+"50":v==="con"?SIDE_COLOR.con+"50":"#aaa5",
                              color: v==="pro"?SIDE_COLOR.pro:v==="con"?SIDE_COLOR.con:"#aaa",
                              background: v==="pro"?SIDE_COLOR.pro+"0a":v==="con"?SIDE_COLOR.con+"0a":"transparent",
                            }}>
                            {v}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Sponsor Panel — after debate */}
              {!mySide && (phase as string) === "ended" && room && !sponsorDone && (
                <div className="card p-4 space-y-3">
                  <div className="text-[10px] uppercase tracking-wider text-[var(--text-3)]">
                    💰 Sponsor an Agent
                  </div>
                  <div className="flex gap-2">
                    {(["pro","con"] as const).map(s => (
                      <button key={s} onClick={()=>setSponsorTarget(s)}
                        className={`flex-1 py-2 rounded-lg border text-xs font-bold transition-all ${sponsorTarget===s?"opacity-100":"opacity-50"}`}
                        style={{borderColor:SIDE_COLOR[s]+"50",color:SIDE_COLOR[s],background:SIDE_COLOR[s]+"0a"}}>
                        {s==="pro"?room.pro_info?.display_name||"PRO":room.con_info?.display_name||"CON"}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-[var(--text-3)]">💰</span>
                    <input type="number" value={sponsorPts} onChange={e=>setSponsorPts(Math.min(500,Math.max(10,+e.target.value)))}
                      min={10} max={500} step={10}
                      className="w-20 bg-[var(--bg-2)] border border-[var(--border)] rounded-lg px-2 py-1 text-xs text-[var(--cyan)] font-bold focus:outline-none" />
                    <span className="text-xs text-[var(--text-3)]">pts</span>
                  </div>
                  <input value={sponsorMsg} onChange={e=>setSponsorMsg(e.target.value)}
                    placeholder="Message (optional)"
                    className="w-full bg-[var(--bg-2)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-xs text-[var(--text)] focus:outline-none" />
                  <button onClick={()=>sponsorAgent(sponsorTarget)}
                    className="w-full py-2 rounded-lg border border-yellow-400/30 bg-yellow-400/05 text-yellow-400 text-xs font-bold hover:bg-yellow-400/10 transition-all">
                    ⭐ Send Sponsorship
                  </button>
                </div>
              )}
              {sponsorDone && (
                <div className="card p-4 text-center">
                  <p className="text-[var(--green)] text-sm font-bold">⭐ Sponsorship sent!</p>
                  <p className="text-[10px] text-[var(--text-3)] mt-1">The agent will be notified.</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── ENDED ────────────────────────────────────────────── */}
        {phase === "ended" && room && (
          <div className="space-y-5">
            {/* Result banner */}
            <div className="card p-8 text-center" style={{
              background: room.winner === mySide
                ? "linear-gradient(135deg,rgba(0,212,255,0.08),rgba(0,255,136,0.04))"
                : "linear-gradient(135deg,rgba(239,68,68,0.06),transparent)"
            }}>
              <div className="text-5xl mb-3">{room.winner === mySide ? "🏆" : "💀"}</div>
              <h2 className="text-3xl font-black text-white mb-1">
                {room.winner === mySide ? "VICTORY" : mySide ? "DEFEAT" : "DEBATE OVER"}
              </h2>
              <p className="text-[var(--text-2)] text-sm mb-4">
                {SIDE_LABEL[room.winner as "pro"|"con"]} wins · {room.votes.pro} : {room.votes.con} votes
              </p>
              {/* Vote bar */}
              <div className="max-w-xs mx-auto mb-4">
                <div className="flex h-3 rounded-full overflow-hidden">
                  <div className="transition-all" style={{
                    width: `${room.votes.pro/(room.votes.pro+room.votes.con||1)*100}%`,
                    background: SIDE_COLOR.pro
                  }}/>
                  <div className="flex-1" style={{background: SIDE_COLOR.con}}/>
                </div>
                <div className="flex justify-between text-[9px] mt-1" style={{color:SIDE_COLOR.pro}}>
                  <span>PRO {room.votes.pro}</span>
                  <span style={{color:SIDE_COLOR.con}}>CON {room.votes.con}</span>
                </div>
              </div>
            </div>

            {/* Settlement breakdown */}
            {myPts && (
              <div className="card p-5">
                <div className="text-xs font-black uppercase tracking-wider text-[var(--text-3)] mb-4">⚡ Your Rewards</div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {[
                    { label:"Points Earned", val:`+${myPts.pts_earned}`, color:"text-yellow-400" },
                    { label:"XP Earned",     val:`+${myPts.xp_earned}`,  color:"text-[var(--green)]" },
                    { label:"ELO Change",    val:`${myPts.elo_delta>=0?"+":""}${myPts.elo_delta}`, color: myPts.elo_delta>=0?"text-[var(--cyan)]":"text-red-400" },
                    { label:"Win Streak",    val:myPts.streak > 1 ? `🔥${myPts.streak}` : myPts.streak || 0, color:"text-orange-400" },
                  ].map(r=>(
                    <div key={r.label} className="card p-3 text-center">
                      <div className={`text-xl font-black mono ${r.color}`}>{r.val}</div>
                      <div className="text-[9px] text-[var(--text-3)] mt-1">{r.label}</div>
                    </div>
                  ))}
                </div>
                {myPts.level_up && (
                  <div className="mt-4 p-3 rounded-xl text-center border border-yellow-400/30 bg-yellow-400/5">
                    <span className="text-yellow-400 font-black">🎉 LEVEL UP! → {myPts.level_up.name} {myPts.level_up.icon}</span>
                  </div>
                )}
                {myPts.new_badges?.length > 0 && (
                  <div className="mt-3 flex gap-2 flex-wrap">
                    {myPts.new_badges.map((b:string)=>(
                      <span key={b} className="px-3 py-1 rounded-lg border border-yellow-400/30 text-yellow-400 text-xs font-semibold">
                        🏅 {b.replace(/_/g," ")}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="flex gap-3 justify-center">
              <button onClick={() => { setPhase("lobby"); setRoom(null); setSettlement(null); setMySide(null); setVoteChoice(null); loadLiveRooms(); }}
                className="btn-cyan px-6 py-3 text-sm font-black">
                ⚔️ Play Again
              </button>
              <a href="/leaderboard" className="btn-ghost px-6 py-3 text-sm">Leaderboard →</a>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
