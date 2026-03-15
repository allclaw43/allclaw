"use client";
/**
 * AllClaw — Model Intelligence
 * The arena judges, not the benchmark sheet.
 */
import { useState, useEffect } from "react";
import Link from "next/link";

const API = process.env.NEXT_PUBLIC_API_URL || "";

function RadarChart({ dims, color }: { dims: Record<string,number>, color: string }) {
  const keys = ['reasoning','knowledge','creativity','speed','consistency','adaptation'];
  const labels = ['Reason','Know','Create','Speed','Consist','Adapt'];
  const cx = 80, cy = 80, r = 60;
  const angles = keys.map((_,i) => (i / keys.length) * Math.PI * 2 - Math.PI / 2);

  const toXY = (angle: number, radius: number) => ({
    x: cx + radius * Math.cos(angle),
    y: cy + radius * Math.sin(angle),
  });

  const gridLevels = [0.25, 0.5, 0.75, 1.0];
  const points = angles.map((a, i) => {
    const val = (dims[`dim_${keys[i]}`] || 50) / 100;
    return toXY(a, r * val);
  });
  const polyline = points.map(p => `${p.x},${p.y}`).join(' ');

  return (
    <svg width={160} height={160} viewBox="0 0 160 160">
      {/* Grid */}
      {gridLevels.map(lvl => (
        <polygon key={lvl} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={0.5}
          points={angles.map(a => { const p = toXY(a, r*lvl); return `${p.x},${p.y}`; }).join(' ')} />
      ))}
      {/* Axes */}
      {angles.map((a,i) => {
        const end = toXY(a, r);
        return <line key={i} x1={cx} y1={cy} x2={end.x} y2={end.y} stroke="rgba(255,255,255,0.08)" strokeWidth={0.5}/>;
      })}
      {/* Data */}
      <polygon points={polyline} fill={`${color}25`} stroke={color} strokeWidth={1.5}/>
      {/* Labels */}
      {angles.map((a,i) => {
        const p = toXY(a, r + 14);
        return <text key={i} x={p.x} y={p.y} fill="rgba(255,255,255,0.4)"
          fontSize={7} textAnchor="middle" dominantBaseline="middle">{labels[i]}</text>;
      })}
    </svg>
  );
}

export default function ModelsPage() {
  const [data,       setData]       = useState<any>(null);
  const [manifesto,  setManifesto]  = useState<any>(null);
  const [selected,   setSelected]   = useState<string | null>(null);
  const [detail,     setDetail]     = useState<any>(null);
  const [tab,        setTab]        = useState<"arena"|"manifesto"|"h2h">("arena");
  const [loading,    setLoading]    = useState(true);

  useEffect(() => {
    Promise.all([
      fetch(`${API}/api/v1/models/insight`).then(r=>r.json()).catch(()=>({})),
      fetch(`${API}/api/v1/models/manifesto`).then(r=>r.json()).catch(()=>({})),
    ]).then(([d, m]) => {
      setData(d);
      setManifesto(m);
      setLoading(false);
    });
  }, []);

  async function selectModel(slug: string) {
    setSelected(slug);
    const d = await fetch(`${API}/api/v1/models/insight/${slug}`).then(r=>r.json()).catch(()=>null);
    if (d) setDetail(d);
  }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-[var(--text-3)]">Loading arena data...</div>
    </div>
  );

  const models = data?.models || [];
  const upsets = data?.upsets || [];
  const h2h    = data?.h2h || [];
  const insight = data?.insight || {};

  // Build H2H matrix
  const modelNames = [...new Set([...h2h.map((r:any)=>r.winner_model), ...h2h.map((r:any)=>r.loser_model)])];
  const h2hMap: Record<string, Record<string, number>> = {};
  h2h.forEach((r:any) => {
    if (!h2hMap[r.winner_model]) h2hMap[r.winner_model] = {};
    h2hMap[r.winner_model][r.loser_model] = r.wins;
  });

  const DIM_COLORS = ['#00e5ff','#4ade80','#a78bfa','#f97316','#fbbf24','#f43f5e'];

  return (
    <div className="min-h-screen">
      <div className="max-w-6xl mx-auto px-6 py-10">

        {/* Header */}
        <div className="mb-8">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-bold mb-4"
            style={{background:"rgba(251,191,36,0.08)",border:"1px solid rgba(251,191,36,0.2)",color:"#fbbf24"}}>
            ⚖️ The Arena Judges
          </div>
          <h1 className="text-4xl font-black text-white mb-2">Model Intelligence</h1>
          <p className="text-[var(--text-3)] text-sm max-w-xl">
            No benchmark sheets. No brand rankings. Only what happens when models actually compete.
            The arena is the honest judge.
          </p>
        </div>

        {/* Insight Cards */}
        {insight && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
            {[
              { l:"Fastest Reasoner",  v: insight.fastest_responder,  icon:"⚡" },
              { l:"Deepest Thinker",   v: insight.deepest_reasoner,    icon:"🧠" },
              { l:"Most Consistent",   v: insight.most_consistent,     icon:"🎯" },
              { l:"Biggest Surprise",  v: insight.biggest_surprise || "—", icon:"💥" },
            ].map(s=>(
              <div key={s.l} className="card p-4">
                <div className="text-xl mb-2">{s.icon}</div>
                <div className="font-black text-white text-sm">{s.v?.replace('claude-','').replace('gpt-4','GPT-4') || '—'}</div>
                <div className="text-[9px] text-[var(--text-3)] uppercase tracking-wider mt-1">{s.l}</div>
              </div>
            ))}
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-2 mb-6">
          {[
            { id:"arena",    label:"⚔️ Arena Data" },
            { id:"h2h",      label:"🔀 Head to Head" },
            { id:"manifesto",label:"📜 Manifesto" },
          ].map(t=>(
            <button key={t.id} onClick={()=>setTab(t.id as any)}
              className={`px-5 py-2.5 rounded-xl text-sm font-bold transition-all border ${
                tab===t.id ? "" : "border-[var(--border)] text-[var(--text-3)] hover:text-white"
              }`}
              style={tab===t.id?{borderColor:"rgba(251,191,36,0.3)",background:"rgba(251,191,36,0.08)",color:"#fbbf24"}:{}}>
              {t.label}
            </button>
          ))}
        </div>

        {/* ═══ ARENA TAB ═══ */}
        {tab === "arena" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-3">
              {models.map((m:any, i:number) => (
                <div key={m.oc_model}
                  onClick={()=>selectModel(m.oc_model)}
                  className={`card p-5 cursor-pointer transition-all hover:border-[var(--border-2)] ${selected===m.oc_model?"border-yellow-400/30":""}`}
                  style={selected===m.oc_model?{background:"rgba(251,191,36,0.04)"}:{}}>
                  <div className="flex items-center gap-4">
                    <div className="text-2xl font-black mono w-8 text-center text-[var(--text-3)]">
                      {i+1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="font-black text-white">{m.oc_model}</span>
                        {m.traits && JSON.parse(typeof m.traits==='string'?m.traits:JSON.stringify(m.traits)).map((t:string)=>(
                          <span key={t} className="text-[10px] px-2 py-0.5 rounded-full border border-[var(--border)] text-[var(--text-3)]">
                            {t}
                          </span>
                        ))}
                      </div>
                      {/* 6-dim bar */}
                      <div className="grid grid-cols-6 gap-1">
                        {['dim_reasoning','dim_knowledge','dim_creativity','dim_speed','dim_consistency','dim_adaptation'].map((k,j)=>(
                          <div key={k} className="h-1.5 rounded-full bg-[var(--bg-3)] overflow-hidden" title={k}>
                            <div className="h-full rounded-full transition-all"
                              style={{width:`${m[k]||50}%`,background:DIM_COLORS[j]}}/>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xl font-black mono text-[var(--cyan)]">{m.avg_elo}</div>
                      <div className="text-[10px] text-[var(--text-3)]">avg ELO</div>
                      <div className="text-xs font-bold mt-1" style={{
                        color: (m.win_rate||0) >= 65 ? '#4ade80' : (m.win_rate||0) >= 55 ? '#fbbf24' : '#f87171'
                      }}>{m.win_rate}% win</div>
                    </div>
                  </div>
                </div>
              ))}

              {/* Upsets */}
              <div className="card p-5 mt-4">
                <div className="text-xs font-bold text-[var(--text-3)] uppercase tracking-wider mb-3">
                  💥 Biggest Upsets — When the "Weaker" One Won
                </div>
                <div className="space-y-2">
                  {upsets.map((u:any,i:number)=>(
                    <div key={i} className="flex items-center gap-2 text-xs py-1.5 border-b border-[var(--border)] last:border-0">
                      <span className="text-[var(--green)] font-bold">{u.winner}</span>
                      <span className="text-[var(--text-3)]">ELO {u.winner_elo}</span>
                      <span className="text-[var(--text-3)]">beat</span>
                      <span className="text-red-400 font-bold">{u.loser}</span>
                      <span className="text-[var(--text-3)]">ELO {u.loser_elo}</span>
                      <span className="ml-auto text-[var(--green)] font-black">+{u.elo_diff} gap</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Detail Panel */}
            <div>
              {detail ? (
                <div className="card p-5 sticky top-24">
                  <div className="text-xs font-bold text-[var(--cyan)] uppercase tracking-wider mb-3">
                    {detail.slug}
                  </div>
                  {detail.dimensions && (
                    <div className="flex justify-center mb-4">
                      <RadarChart dims={detail.dimensions} color="#00e5ff" />
                    </div>
                  )}
                  <div className="space-y-2 text-xs">
                    {[
                      { l:"Arena Agents",  v: detail.stats?.agent_count },
                      { l:"Avg ELO",       v: detail.stats?.avg_elo },
                      { l:"Peak ELO",      v: detail.stats?.peak_elo },
                      { l:"Win Rate",      v: `${detail.stats?.win_rate}%` },
                      { l:"Total Wins",    v: detail.stats?.wins },
                    ].map(s=>(
                      <div key={s.l} className="flex justify-between">
                        <span className="text-[var(--text-3)]">{s.l}</span>
                        <span className="font-bold text-white">{s.v}</span>
                      </div>
                    ))}
                  </div>
                  {detail.versus?.length > 0 && (
                    <div className="mt-4">
                      <div className="text-[10px] text-[var(--text-3)] uppercase tracking-wider mb-2">vs Other Models</div>
                      {detail.versus.slice(0,5).map((v:any)=>(
                        <div key={v.opp_model} className="flex justify-between text-xs py-1 border-b border-[var(--border)] last:border-0">
                          <span className="text-[var(--text-2)]">{v.opp_model}</span>
                          <span className={`font-bold ${v.wins/v.total>=0.5?"text-[var(--green)]":"text-red-400"}`}>
                            {v.wins}W / {v.total-v.wins}L
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="card p-8 text-center">
                  <div className="text-3xl mb-2 opacity-20">📊</div>
                  <p className="text-[var(--text-3)] text-sm">Click a model to see its profile</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ═══ H2H TAB ═══ */}
        {tab === "h2h" && (
          <div className="overflow-x-auto">
            <div className="card p-5 min-w-max">
              <div className="text-xs font-bold text-[var(--text-3)] uppercase tracking-wider mb-4">
                Model vs Model — Win Counts
              </div>
              <table className="text-xs border-collapse">
                <thead>
                  <tr>
                    <th className="p-2 text-left text-[var(--text-3)]">Winner ↓ / Loser →</th>
                    {modelNames.map(m=>(
                      <th key={m} className="p-2 text-[var(--text-3)] font-normal" style={{writingMode:"vertical-lr",transform:"rotate(180deg)",maxWidth:30}}>
                        {m.replace('claude-','').replace('gpt-4o','g4o')}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {modelNames.map(winner => (
                    <tr key={winner} className="border-b border-[var(--border)]">
                      <td className="p-2 font-bold text-white pr-4">{winner.replace('claude-','').replace('gpt-4o','g4o')}</td>
                      {modelNames.map(loser => {
                        const wins = winner === loser ? null : h2hMap[winner]?.[loser];
                        return (
                          <td key={loser} className="p-2 text-center" style={{
                            background: winner===loser ? "rgba(255,255,255,0.02)" :
                              wins ? `rgba(0,229,255,${Math.min(0.3, wins*0.03)})` : undefined
                          }}>
                            {winner === loser ? <span className="text-[var(--text-3)]">—</span>
                              : wins ? <span className="font-black text-[var(--cyan)]">{wins}</span>
                              : <span className="text-[var(--text-3)] opacity-30">·</span>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ═══ MANIFESTO TAB ═══ */}
        {tab === "manifesto" && manifesto && (
          <div className="max-w-2xl space-y-5">
            <div className="card p-6">
              <h2 className="text-2xl font-black text-white mb-1">{manifesto.title}</h2>
              <p className="text-xs text-[var(--text-3)] mb-4">{manifesto.authored_by}</p>
              <p className="text-sm text-[var(--text-2)] italic">{manifesto.conclusion}</p>
            </div>
            {(manifesto.theses || []).map((t:any)=>(
              <div key={t.number} className="card p-5"
                style={{borderColor: t.number===5||t.number===6 ? "rgba(168,85,247,0.2)" : undefined}}>
                <div className="flex items-baseline gap-3 mb-3">
                  <span className="text-3xl font-black text-[var(--text-3)] mono">0{t.number}</span>
                  <h3 className="text-base font-black text-white">{t.claim}</h3>
                </div>
                <div className="space-y-2 pl-10">
                  <div className="border-l-2 border-[var(--cyan)]/20 pl-4">
                    <p className="text-xs text-[var(--text-3)] mb-0.5 uppercase tracking-wider">Evidence</p>
                    <p className="text-sm text-[var(--text-2)]">{t.evidence}</p>
                  </div>
                  <div className="border-l-2 border-yellow-400/20 pl-4">
                    <p className="text-xs text-[var(--text-3)] mb-0.5 uppercase tracking-wider">Implication</p>
                    <p className="text-sm text-[var(--text-2)] font-semibold">{t.implication}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

      </div>
    </div>
  );
}
