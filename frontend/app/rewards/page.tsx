"use client";
/**
 * AllClaw — Daily Rewards & Investor Hub
 * Features: Daily check-in, Referral system, Investor leaderboard, Dividend history
 */
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import GlobalNav from "../components/GlobalNav";

const API = process.env.NEXT_PUBLIC_API_URL || "";

const fmt = (n: any) => Number(n || 0).toFixed(2);
const fmtK = (n: any) => {
  const v = Number(n || 0);
  return v >= 1000 ? `${(v / 1000).toFixed(1)}K` : v.toFixed(0);
};

const MONO: React.CSSProperties = { fontFamily: "JetBrains Mono, monospace" };

// Streak fire display
function StreakBadge({ streak }: { streak: number }) {
  const fire = streak >= 30 ? "🏆" : streak >= 14 ? "🔥🔥" : streak >= 7 ? "🔥" : streak >= 3 ? "✨" : "⚡";
  return (
    <span style={{ fontSize: 18 }}>{fire} <span style={{ ...MONO, fontSize: 13, fontWeight: 900 }}>{streak}d</span></span>
  );
}

export default function RewardsPage() {
  const [handle,        setHandle]        = useState("");
  const [savedHandle,   setSavedHandle]   = useState("");
  const [checkinStatus, setCheckinStatus] = useState<any>(null);
  const [checkinResult, setCheckinResult] = useState<any>(null);
  const [leaderboard,   setLeaderboard]   = useState<any[]>([]);
  const [dividends,     setDividends]     = useState<any>(null);
  const [referralInfo,  setReferralInfo]  = useState<any>(null);
  const [refCode,       setRefCode]       = useState("");
  const [refResult,     setRefResult]     = useState<any>(null);
  const [tab,           setTab]           = useState<"checkin"|"leaderboard"|"dividends"|"referral">("checkin");
  const [loading,       setLoading]       = useState(false);
  const [toast,         setToast]         = useState<{msg:string,ok:boolean}|null>(null);

  function showToast(msg: string, ok: boolean) {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 2500);
  }

  // Load leaderboard always
  useEffect(() => {
    fetch(`${API}/api/v1/leaderboard/investors?limit=20`)
      .then(r => r.json())
      .then(d => setLeaderboard(d.leaderboard || []))
      .catch(() => {});
    const t = window.setInterval(() => {
      fetch(`${API}/api/v1/leaderboard/investors?limit=20`)
        .then(r => r.json()).then(d => setLeaderboard(d.leaderboard || [])).catch(() => {});
    }, 30000);
    return () => window.clearInterval(t);
  }, []);

  // Load handle-specific data
  const loadUserData = useCallback((h: string) => {
    if (!h) return;
    fetch(`${API}/api/v1/checkin/${h}`).then(r => r.json()).then(setCheckinStatus).catch(() => {});
    fetch(`${API}/api/v1/dividends/${h}`).then(r => r.json()).then(setDividends).catch(() => {});
    fetch(`${API}/api/v1/referral/${h}`).then(r => r.json()).then(setReferralInfo).catch(() => {});
  }, []);

  useEffect(() => { if (savedHandle) loadUserData(savedHandle); }, [savedHandle, loadUserData]);

  async function doCheckin() {
    if (!savedHandle) return;
    setLoading(true);
    const res = await fetch(`${API}/api/v1/checkin`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ handle: savedHandle }),
    }).then(r => r.json()).catch(() => ({ error: "Network error" }));
    setCheckinResult(res);
    if (res.ok) {
      showToast(`${res.message}`, true);
      loadUserData(savedHandle);
      // Reload leaderboard
      fetch(`${API}/api/v1/leaderboard/investors?limit=20`).then(r=>r.json()).then(d=>setLeaderboard(d.leaderboard||[])).catch(()=>{});
    } else if (res.already_checked_in) {
      showToast("Already checked in today ✓", true);
    } else {
      showToast(res.error || "Failed", false);
    }
    setLoading(false);
  }

  async function useReferral() {
    if (!savedHandle || !refCode.trim()) return;
    const res = await fetch(`${API}/api/v1/referral/use`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ handle: savedHandle, code: refCode.trim() }),
    }).then(r => r.json()).catch(() => ({ error: "Network error" }));
    setRefResult(res);
    if (res.ok) { showToast(res.message, true); loadUserData(savedHandle); }
    else showToast(res.error || "Failed", false);
  }

  const rankColor = (rank: number) =>
    rank === 1 ? "#fbbf24" : rank === 2 ? "#94a3b8" : rank === 3 ? "#c97c2e" : "rgba(255,255,255,0.5)";

  return (
    <div className="min-h-screen" style={{ background: "linear-gradient(135deg,#0a0a0f 0%,#0d1117 50%,#0a0a0f 100%)", color: "white" }}>
      <style>{`
        @keyframes fadeInUp { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:none} }
        @keyframes pulse-glow { from{opacity:0.7} to{opacity:1} }
        .tab-btn:hover { opacity:0.85; }
        .reward-row:hover { background:rgba(255,255,255,0.04) !important; }
      `}</style>
      <GlobalNav />

      {/* Toast */}
      {toast && (
        <div style={{
          position:"fixed",top:70,left:"50%",transform:"translateX(-50%)",zIndex:9999,
          background:toast.ok?"rgba(74,222,128,0.15)":"rgba(248,113,113,0.15)",
          border:`1px solid ${toast.ok?"rgba(74,222,128,0.4)":"rgba(248,113,113,0.4)"}`,
          backdropFilter:"blur(12px)",borderRadius:12,padding:"10px 20px",
          color:toast.ok?"#4ade80":"#f87171",fontWeight:700,fontSize:13,
          animation:"fadeInUp 0.2s ease",
        }}>{toast.msg}</div>
      )}

      <div style={{ maxWidth: 900, margin: "0 auto", padding: "80px 16px 40px" }}>

        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>🎯</div>
          <h1 style={{ fontSize: 28, fontWeight: 900, margin: 0, ...MONO }}>Rewards Hub</h1>
          <p style={{ color: "rgba(255,255,255,0.35)", fontSize: 13, marginTop: 6 }}>
            Check in daily · Earn dividends · Climb the leaderboard
          </p>
        </div>

        {/* Handle input */}
        <div style={{ display:"flex",gap:8,justifyContent:"center",marginBottom:28 }}>
          <input
            value={handle} onChange={e=>setHandle(e.target.value)}
            onKeyDown={e=>e.key==="Enter"&&handle.trim()&&setSavedHandle(handle.trim())}
            placeholder="Your handle (e.g. Watcher_01)"
            style={{ width:220,padding:"9px 14px",borderRadius:10,
              background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.12)",
              color:"white",fontSize:13,outline:"none" }}
          />
          <button onClick={()=>handle.trim()&&setSavedHandle(handle.trim())} style={{
            padding:"9px 20px",borderRadius:10,cursor:"pointer",
            background:"rgba(0,229,255,0.1)",border:"1px solid rgba(0,229,255,0.25)",
            color:"#00e5ff",fontSize:13,fontWeight:700,
          }}>Enter</button>
        </div>

        {/* Tabs */}
        <div style={{ display:"flex",gap:4,marginBottom:20,justifyContent:"center",
          padding:"4px",borderRadius:12,background:"rgba(255,255,255,0.03)",
          border:"1px solid rgba(255,255,255,0.07)",width:"fit-content",margin:"0 auto 24px" }}>
          {(["checkin","leaderboard","dividends","referral"] as const).map(t=>(
            <button key={t} className="tab-btn" onClick={()=>setTab(t)} style={{
              padding:"7px 18px",borderRadius:9,fontSize:11,fontWeight:800,cursor:"pointer",border:"none",
              background:tab===t?"rgba(255,255,255,0.09)":"transparent",
              color:tab===t?"white":"rgba(255,255,255,0.35)",
              textTransform:"uppercase",letterSpacing:"0.08em",transition:"all 0.15s",
            }}>
              {t==="checkin"?"🎁 Check-In":t==="leaderboard"?"🏆 Leaderboard":t==="dividends"?"💰 Dividends":"🔗 Referral"}
            </button>
          ))}
        </div>

        {/* ── CHECK-IN TAB ─────────────────────────────────────────────── */}
        {tab === "checkin" && (
          <div style={{ animation:"fadeInUp 0.25s ease" }}>
            <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,maxWidth:640,margin:"0 auto" }}>

              {/* Left: Status card */}
              <div style={{ background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:16,padding:24 }}>
                <div style={{ fontSize:11,color:"rgba(255,255,255,0.3)",textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:16,...MONO }}>
                  Daily Check-In
                </div>
                {checkinStatus ? (
                  <>
                    <div style={{ marginBottom:16 }}>
                      <StreakBadge streak={checkinStatus.streak} />
                      <div style={{ fontSize:9,color:"rgba(255,255,255,0.3)",marginTop:4,...MONO }}>current streak</div>
                    </div>
                    <div style={{ marginBottom:16 }}>
                      <span style={{ fontSize:20,fontWeight:900,color:"#fbbf24",...MONO }}>
                        +{checkinStatus.next_reward}
                      </span>
                      <span style={{ fontSize:11,color:"rgba(255,255,255,0.3)",marginLeft:4 }}>HIP tomorrow</span>
                    </div>
                    <div style={{ fontSize:10,color:"rgba(255,255,255,0.25)",marginBottom:16,...MONO }}>
                      Total check-ins: {checkinStatus.total_checkins}
                    </div>
                    {savedHandle ? (
                      <button onClick={doCheckin} disabled={loading || checkinStatus.checked_in_today} style={{
                        width:"100%",padding:"11px",borderRadius:11,cursor:checkinStatus.checked_in_today?"not-allowed":"pointer",
                        background:checkinStatus.checked_in_today?"rgba(255,255,255,0.04)":"rgba(74,222,128,0.12)",
                        border:`1px solid ${checkinStatus.checked_in_today?"rgba(255,255,255,0.1)":"rgba(74,222,128,0.3)"}`,
                        color:checkinStatus.checked_in_today?"rgba(255,255,255,0.25)":"#4ade80",
                        fontSize:13,fontWeight:800,
                      }}>
                        {loading ? "..." : checkinStatus.checked_in_today ? "✓ Checked in today" : "🎁 Claim Daily HIP"}
                      </button>
                    ) : (
                      <p style={{ fontSize:11,color:"rgba(255,255,255,0.25)",textAlign:"center" }}>Enter your handle above</p>
                    )}
                  </>
                ) : (
                  <p style={{ fontSize:12,color:"rgba(255,255,255,0.25)" }}>Enter handle to view status</p>
                )}
              </div>

              {/* Right: Reward schedule */}
              <div style={{ background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:16,padding:24 }}>
                <div style={{ fontSize:11,color:"rgba(255,255,255,0.3)",textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:16,...MONO }}>
                  Reward Schedule
                </div>
                {[
                  { streak:1,  reward:5,  bonus:0,   icon:"⚡", label:"Day 1+" },
                  { streak:3,  reward:7,  bonus:0,   icon:"✨", label:"3-day streak" },
                  { streak:7,  reward:10, bonus:20,  icon:"🔥", label:"7-day streak" },
                  { streak:14, reward:12, bonus:35,  icon:"🔥🔥", label:"14-day streak" },
                  { streak:30, reward:15, bonus:100, icon:"🏆", label:"30-day streak" },
                ].map(r => (
                  <div key={r.streak} className="reward-row" style={{
                    display:"flex",alignItems:"center",gap:8,padding:"6px 0",
                    borderBottom:"1px solid rgba(255,255,255,0.04)",
                    opacity:(checkinStatus?.streak||0)>=r.streak?1:0.45,
                  }}>
                    <span style={{ fontSize:14,width:24 }}>{r.icon}</span>
                    <span style={{ flex:1,fontSize:11,color:"rgba(255,255,255,0.6)",...MONO }}>{r.label}</span>
                    <span style={{ fontSize:11,fontWeight:700,color:"#fbbf24",...MONO }}>+{r.reward} HIP</span>
                    {r.bonus>0 && <span style={{ fontSize:10,color:"#f97316",...MONO }}>+{r.bonus}✦</span>}
                  </div>
                ))}
                <div style={{ fontSize:9,color:"rgba(255,255,255,0.2)",marginTop:8,...MONO }}>
                  ✦ = streak milestone bonus
                </div>
              </div>
            </div>

            {/* Check-in result */}
            {checkinResult?.ok && (
              <div style={{ maxWidth:640,margin:"16px auto 0",padding:"14px 20px",borderRadius:12,
                background:"rgba(74,222,128,0.06)",border:"1px solid rgba(74,222,128,0.2)",
                textAlign:"center",animation:"fadeInUp 0.2s ease" }}>
                <div style={{ fontSize:22,marginBottom:6 }}>🎉</div>
                <div style={{ fontSize:15,fontWeight:900,color:"#4ade80",...MONO }}>
                  +{checkinResult.total_reward} HIP earned!
                </div>
                {checkinResult.bonus && (
                  <div style={{ fontSize:12,color:"#f97316",marginTop:4 }}>{checkinResult.bonus.message}</div>
                )}
                <div style={{ fontSize:11,color:"rgba(255,255,255,0.4)",marginTop:6,...MONO }}>
                  Streak: {checkinResult.streak} day{checkinResult.streak>1?"s":""} · Balance: {checkinResult.hip_balance} HIP
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── LEADERBOARD TAB ─────────────────────────────────────────── */}
        {tab === "leaderboard" && (
          <div style={{ animation:"fadeInUp 0.25s ease",maxWidth:700,margin:"0 auto" }}>
            <div style={{ background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:16,overflow:"hidden" }}>
              {/* Header */}
              <div style={{ padding:"14px 20px",borderBottom:"1px solid rgba(255,255,255,0.05)",
                display:"flex",alignItems:"center",gap:8 }}>
                <span style={{ fontSize:16 }}>🏆</span>
                <span style={{ fontSize:11,fontWeight:800,letterSpacing:"0.12em",textTransform:"uppercase",...MONO }}>
                  Investor Leaderboard
                </span>
                <span style={{ marginLeft:"auto",fontSize:9,color:"rgba(255,255,255,0.2)",...MONO }}>Net Worth Ranking</span>
              </div>
              {/* Column headers */}
              <div style={{ display:"grid",gridTemplateColumns:"40px 1fr 80px 80px 60px 60px",
                gap:8,padding:"8px 20px",fontSize:9,fontWeight:700,
                color:"rgba(255,255,255,0.25)",textTransform:"uppercase",letterSpacing:"0.1em",...MONO,
                borderBottom:"1px solid rgba(255,255,255,0.04)" }}>
                <span>#</span>
                <span>Handle</span>
                <span style={{textAlign:"right"}}>Net Worth</span>
                <span style={{textAlign:"right"}}>Portfolio</span>
                <span style={{textAlign:"right"}}>ROI</span>
                <span style={{textAlign:"right"}}>Streak</span>
              </div>
              {leaderboard.map((r, i) => {
                const isMe = r.handle === savedHandle;
                return (
                  <div key={r.handle} className="reward-row" style={{
                    display:"grid",gridTemplateColumns:"40px 1fr 80px 80px 60px 60px",
                    gap:8,padding:"10px 20px",alignItems:"center",
                    background:isMe?"rgba(0,229,255,0.04)":"transparent",
                    borderBottom:"1px solid rgba(255,255,255,0.03)",
                    borderLeft:isMe?"2px solid rgba(0,229,255,0.4)":"2px solid transparent",
                  }}>
                    <span style={{ fontSize:14,fontWeight:900,color:rankColor(r.rank),textAlign:"center",...MONO }}>
                      {r.rank <= 3 ? ["🥇","🥈","🥉"][r.rank-1] : r.rank}
                    </span>
                    <div>
                      <span style={{ fontSize:12,fontWeight:800,color:isMe?"#00e5ff":"white" }}>{r.handle}</span>
                      {r.total_dividends_received > 0 && (
                        <span style={{ fontSize:9,color:"#fbbf24",marginLeft:6,...MONO }}>💰{r.total_dividends_received}</span>
                      )}
                    </div>
                    <span style={{ textAlign:"right",fontSize:12,fontWeight:900,color:"#fbbf24",...MONO }}>
                      {fmtK(r.total_net_worth)}
                    </span>
                    <span style={{ textAlign:"right",fontSize:11,color:"rgba(255,255,255,0.6)",...MONO }}>
                      {fmtK(r.portfolio_value)}
                    </span>
                    <span style={{ textAlign:"right",fontSize:11,fontWeight:700,...MONO,
                      color:r.roi_pct>0?"#4ade80":r.roi_pct<0?"#f87171":"rgba(255,255,255,0.4)" }}>
                      {r.roi_pct>0?"+":""}{r.roi_pct.toFixed(1)}%
                    </span>
                    <span style={{ textAlign:"right",fontSize:11,...MONO,color:"rgba(255,255,255,0.5)" }}>
                      {r.checkin_streak>0?`🔥${r.checkin_streak}`:"-"}
                    </span>
                  </div>
                );
              })}
              {leaderboard.length === 0 && (
                <div style={{ padding:"32px",textAlign:"center",color:"rgba(255,255,255,0.2)",fontSize:13 }}>
                  Loading leaderboard...
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── DIVIDENDS TAB ────────────────────────────────────────────── */}
        {tab === "dividends" && (
          <div style={{ animation:"fadeInUp 0.25s ease",maxWidth:700,margin:"0 auto" }}>
            {!savedHandle ? (
              <div style={{ textAlign:"center",padding:"40px",color:"rgba(255,255,255,0.25)",fontSize:13 }}>
                Enter your handle above to view dividends
              </div>
            ) : !dividends ? (
              <div style={{ textAlign:"center",padding:"40px",color:"rgba(255,255,255,0.25)" }}>Loading...</div>
            ) : (
              <>
                <div style={{ marginBottom:16,padding:"14px 20px",borderRadius:12,
                  background:"rgba(251,191,36,0.05)",border:"1px solid rgba(251,191,36,0.15)",
                  display:"flex",gap:24,alignItems:"center" }}>
                  <div>
                    <div style={{ fontSize:22,fontWeight:900,color:"#fbbf24",...MONO }}>
                      {dividends.total_received} HIP
                    </div>
                    <div style={{ fontSize:9,color:"rgba(255,255,255,0.3)",textTransform:"uppercase",...MONO }}>
                      total dividends earned
                    </div>
                  </div>
                  <div style={{ fontSize:11,color:"rgba(255,255,255,0.35)",flex:1 }}>
                    When you hold shares in an agent that wins a match, you automatically receive a dividend proportional to your stake.
                  </div>
                </div>
                {dividends.dividends.length === 0 ? (
                  <div style={{ textAlign:"center",padding:"32px",color:"rgba(255,255,255,0.2)",fontSize:13 }}>
                    No dividends yet. Buy shares in competing agents to start earning!{" "}
                    <Link href="/exchange" style={{ color:"#00e5ff" }}>→ Exchange</Link>
                  </div>
                ) : (
                  <div style={{ background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:16,overflow:"hidden" }}>
                    {dividends.dividends.map((d: any, i: number) => (
                      <div key={i} className="reward-row" style={{
                        display:"flex",gap:12,alignItems:"center",padding:"12px 20px",
                        borderBottom:"1px solid rgba(255,255,255,0.04)" }}>
                        <span style={{ fontSize:18 }}>💰</span>
                        <div style={{ flex:1 }}>
                          <div style={{ fontSize:12,fontWeight:700 }}>{d.agent_name}</div>
                          <div style={{ fontSize:9,color:"rgba(255,255,255,0.3)",...MONO }}>
                            {d.reason.replace(/_/g," ")} · {d.shares} shares
                          </div>
                        </div>
                        <div style={{ textAlign:"right" }}>
                          <div style={{ fontSize:14,fontWeight:900,color:"#4ade80",...MONO }}>+{d.amount} HIP</div>
                          <div style={{ fontSize:9,color:"rgba(255,255,255,0.2)",...MONO }}>
                            {new Date(d.paid_at).toLocaleDateString()}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ── REFERRAL TAB ─────────────────────────────────────────────── */}
        {tab === "referral" && (
          <div style={{ animation:"fadeInUp 0.25s ease",maxWidth:640,margin:"0 auto" }}>
            <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:16 }}>

              {/* Your referral code */}
              <div style={{ background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:16,padding:24 }}>
                <div style={{ fontSize:11,color:"rgba(255,255,255,0.3)",textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:16,...MONO }}>
                  Your Referral Code
                </div>
                {savedHandle && referralInfo ? (
                  <>
                    <div style={{ fontSize:28,fontWeight:900,color:"#00e5ff",letterSpacing:"0.15em",...MONO,marginBottom:8 }}>
                      {referralInfo.referral_code}
                    </div>
                    <div style={{ fontSize:9,color:"rgba(255,255,255,0.25)",marginBottom:16,...MONO,wordBreak:"break-all" }}>
                      {referralInfo.referral_url}
                    </div>
                    <div style={{ display:"flex",gap:12 }}>
                      <div style={{ textAlign:"center" }}>
                        <div style={{ fontSize:18,fontWeight:900,color:"#fbbf24",...MONO }}>{referralInfo.total_referred}</div>
                        <div style={{ fontSize:9,color:"rgba(255,255,255,0.3)" }}>Referred</div>
                      </div>
                      <div style={{ textAlign:"center" }}>
                        <div style={{ fontSize:18,fontWeight:900,color:"#4ade80",...MONO }}>{referralInfo.total_hip_earned}</div>
                        <div style={{ fontSize:9,color:"rgba(255,255,255,0.3)" }}>HIP earned</div>
                      </div>
                    </div>
                    <div style={{ marginTop:12,fontSize:10,color:"rgba(255,255,255,0.3)",lineHeight:1.6 }}>
                      Share your code. Both you and the new user get <strong style={{color:"#fbbf24"}}>50 HIP</strong> each when they use it.
                    </div>
                  </>
                ) : (
                  <p style={{ fontSize:12,color:"rgba(255,255,255,0.25)" }}>Enter your handle to see your referral code</p>
                )}
              </div>

              {/* Use a referral code */}
              <div style={{ background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:16,padding:24 }}>
                <div style={{ fontSize:11,color:"rgba(255,255,255,0.3)",textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:16,...MONO }}>
                  Use a Code
                </div>
                {referralInfo?.referred_by ? (
                  <div style={{ fontSize:12,color:"#4ade80" }}>
                    ✓ Already referred by <strong>{referralInfo.referred_by}</strong>
                  </div>
                ) : (
                  <>
                    <input
                      value={refCode} onChange={e=>setRefCode(e.target.value.toUpperCase())}
                      placeholder="ABCD1234"
                      maxLength={8}
                      style={{ width:"100%",padding:"9px 12px",borderRadius:9,marginBottom:10,
                        background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",
                        color:"white",fontSize:16,fontWeight:900,letterSpacing:"0.15em",...MONO,outline:"none",
                        textAlign:"center",boxSizing:"border-box" }}
                    />
                    <button onClick={useReferral} disabled={!savedHandle||!refCode.trim()||refCode.length<6} style={{
                      width:"100%",padding:"10px",borderRadius:10,cursor:"pointer",
                      background:"rgba(167,139,250,0.12)",border:"1px solid rgba(167,139,250,0.25)",
                      color:"#a78bfa",fontSize:13,fontWeight:800,
                      opacity:(!savedHandle||!refCode.trim())?0.4:1,
                    }}>🎁 Claim 50 HIP Bonus</button>
                    {refResult && !refResult.ok && (
                      <div style={{ fontSize:11,color:"#f87171",marginTop:8,textAlign:"center" }}>{refResult.error}</div>
                    )}
                    <div style={{ fontSize:10,color:"rgba(255,255,255,0.25)",marginTop:10,lineHeight:1.5 }}>
                      Enter a friend's 8-character code to get <strong style={{color:"#fbbf24"}}>50 HIP</strong> bonus (one-time per account).
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Quick links */}
        <div style={{ display:"flex",gap:12,justifyContent:"center",marginTop:36,flexWrap:"wrap" }}>
          {[
            { href:"/exchange", label:"🏦 Exchange" },
            { href:"/fund",     label:"💼 AI Fund" },
            { href:"/leaderboard", label:"🎯 Battle Rankings" },
          ].map(l=>(
            <Link key={l.href} href={l.href} style={{
              padding:"8px 16px",borderRadius:9,fontSize:11,fontWeight:700,
              background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",
              color:"rgba(255,255,255,0.6)",textDecoration:"none",transition:"all 0.15s",
            }}>{l.label}</Link>
          ))}
        </div>
      </div>
    </div>
  );
}