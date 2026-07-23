"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { IncidentQueue } from "@/components/dispatch/incident-queue";
import { IncidentDetail } from "@/components/dispatch/incident-detail";
import type { ArmMetrics } from "@/lib/engine/incident-cache";

interface SimState {
  time: number;
  speed: number;
  running: boolean;
  eventsIngested: number;
  totalEvents: number;
}

function formatClock(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const displayHour = (20 + hours) % 24;
  return `${String(displayHour).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export default function DispatchPage() {
  const [simState, setSimState] = useState<SimState>({
    time: 0, speed: 10, running: false, eventsIngested: 0, totalEvents: 0,
  });
  const [allIncidents, setAllIncidents] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeArm, setActiveArm] = useState("agent");
  const [armMetrics, setArmMetrics] = useState<Record<string, ArmMetrics>>({});
  const [loading, setLoading] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Progressive reveal + dynamic sort by evidence level (highest first)
  const visibleIncidents = useMemo(() => {
    const filtered = simState.time === 0 && !simState.running
      ? allIncidents
      : allIncidents.filter((inc) => inc.createdAt <= simState.time);

    // Sort: active (E1+) first by evidence desc, then resolved (E0)
    return [...filtered].sort((a, b) => {
      const eA = a.trace?.evidenceLevel ?? a.tier ?? 0;
      const eB = b.trace?.evidenceLevel ?? b.tier ?? 0;
      // Active before resolved
      if (eA > 0 && eB === 0) return -1;
      if (eA === 0 && eB > 0) return 1;
      // Within active: higher evidence first
      if (eA !== eB) return eB - eA;
      // Same evidence: more recent first
      return b.createdAt - a.createdAt;
    });
  }, [allIncidents, simState.time, simState.running]);

  const fetchIncidents = useCallback(async () => {
    try {
      const res = await fetch("/api/incidents");
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) setAllIncidents(data);
      }
    } catch (_e) { /* ignore */ }
  }, []);

  const fetchMetrics = useCallback(async () => {
    try {
      const res = await fetch("/api/incidents?view=metrics");
      if (res.ok) {
        const data = await res.json();
        setArmMetrics(data.metrics ?? {});
        setActiveArm(data.activeArm ?? "agent");
      }
    } catch (_e) { /* ignore */ }
  }, []);

  const connectSSE = useCallback(() => {
    if (eventSourceRef.current) eventSourceRef.current.close();
    const es = new EventSource("/api/events/stream");
    eventSourceRef.current = es;
    es.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === "tick") {
        setSimState((prev) => ({ ...prev, time: data.time }));
      } else if (data.type === "incident") {
        fetchIncidents();
      } else if (data.type === "init") {
        setSimState((prev) => ({ ...prev, time: data.time, speed: data.speed }));
      }
    };
    es.onerror = () => { es.close(); setTimeout(connectSSE, 2000); };
  }, [fetchIncidents]);

  // Start
  const handleStart = async () => {
    try {
      setLoading(true);
      if (eventSourceRef.current) eventSourceRef.current.close();
      if (pollRef.current) clearInterval(pollRef.current);
      const res = await fetch("/api/sim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start", seed: 42, speed: 100 }),
      });
      const data = await res.json();
      if (data.ok) {
        setSimState((prev) => ({ ...prev, running: true, totalEvents: data.totalEvents, speed: 100 }));
        setActiveArm(data.activeArm ?? "agent");
        fetchIncidents();
        fetchMetrics();
        connectSSE();
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = setInterval(fetchIncidents, 1000);
      }
    } catch (_e) { /* ignore */ }
    finally { setLoading(false); }
  };

  // Arm switch
  const handleArmSwitch = async (arm: string) => {
    try {
      const res = await fetch("/api/sim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "switch-arm", arm }),
      });
      const data = await res.json();
      if (data.ok) {
        setActiveArm(arm);
        fetchIncidents();
        fetchMetrics();
      }
    } catch (_e) { /* ignore */ }
  };

  // Speed
  const handleSpeed = async (speed: number) => {
    try {
      await fetch("/api/sim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "speed", speed }),
      });
      setSimState((prev) => ({ ...prev, speed }));
    } catch (_e) { /* ignore */ }
  };

  // Keyboard nav
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedId((prev) => {
          const idx = visibleIncidents.findIndex((i: any) => i.id === prev);
          return visibleIncidents[Math.min(idx + 1, visibleIncidents.length - 1)]?.id ?? prev;
        });
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedId((prev) => {
          const idx = visibleIncidents.findIndex((i: any) => i.id === prev);
          return visibleIncidents[Math.max(idx - 1, 0)]?.id ?? prev;
        });
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [visibleIncidents]);

  // On mount
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/sim");
        const data = await res.json();
        if (data.running || data.totalEvents > 0) {
          setSimState({ time: data.time ?? 0, speed: data.speed ?? 10, running: data.running ?? false, eventsIngested: data.eventsIngested ?? 0, totalEvents: data.totalEvents ?? 0 });
          fetchIncidents(); fetchMetrics(); connectSSE();
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = setInterval(fetchIncidents, 1000);
        }
      } catch (_e) { /* no sim */ }
    })();
    return () => {
      if (eventSourceRef.current) eventSourceRef.current.close();
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const selectedIncident = visibleIncidents.find((i: any) => i.id === selectedId) ?? null;
  const agentMetrics = armMetrics["agent"];
  const rulesMetrics = armMetrics["rules-only"];
  const nightProgress = Math.min(100, (simState.time / (10 * 3600 * 1000)) * 100);
  const hasStarted = simState.totalEvents > 0;

  // ═══════════════════════════════════════════════════════════════
  // WELCOME SCREEN — before simulation starts
  // ═══════════════════════════════════════════════════════════════
  if (!hasStarted) {
    return (
      <main className="flex flex-col items-center justify-center h-screen bg-zinc-950 text-zinc-100 px-8">
        <div className="max-w-lg text-center space-y-6">
          <h1 className="text-2xl font-mono font-bold tracking-tight text-zinc-200">
            Calvis
          </h1>
          <p className="text-sm font-mono text-zinc-400 leading-relaxed">
            An AI agent that watches security events from 40+ sites overnight
            and decides what needs human attention. It checks priors, searches
            past incidents, adjusts probabilities, and explains its reasoning.
          </p>
          <p className="text-sm font-mono text-zinc-500 leading-relaxed">
            Click below to simulate a 10-hour night shift.
            273 incidents will stream in — the agent triages each one.
            Click any incident to see how it thinks.
          </p>
          <button
            onClick={handleStart}
            disabled={loading}
            className="px-6 py-3 text-sm font-mono font-bold uppercase tracking-wider bg-orange-600 hover:bg-orange-500 text-white rounded-lg transition-colors disabled:opacity-50"
          >
            {loading ? "Setting up night..." : "Run Demo Night"}
          </button>
          {loading && (
            <p className="text-[11px] font-mono text-zinc-600">
              Generating events, running agent on each incident... ~4 seconds
            </p>
          )}
        </div>
      </main>
    );
  }

  // ═══════════════════════════════════════════════════════════════
  // DISPATCH CONSOLE — after simulation starts
  // ═══════════════════════════════════════════════════════════════
  return (
    <main className="flex flex-col h-screen bg-zinc-950 text-zinc-100">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800">
        <div className="flex items-center gap-4">
          <h1 className="text-sm font-mono font-bold tracking-tight text-zinc-300">
            Calvis
          </h1>

          {/* Night progress */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-mono text-zinc-400 tabular-nums">
              {formatClock(simState.time)}
            </span>
            <div className="w-24 h-1 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-orange-500/60 rounded-full transition-all duration-300"
                style={{ width: `${nightProgress}%` }}
              />
            </div>
          </div>

          {/* Speed */}
          <div className="flex items-center gap-1">
            {[10, 100, 1000].map((s) => (
              <button
                key={s}
                onClick={() => handleSpeed(s)}
                className={`px-1.5 py-0.5 text-[10px] font-mono rounded transition-colors ${
                  simState.speed === s
                    ? "bg-orange-600/30 text-orange-400 border border-orange-600/50"
                    : "text-zinc-600 hover:text-zinc-400"
                }`}
              >
                {s}x
              </button>
            ))}
          </div>
        </div>

        {/* Incident count */}
        <span className="text-[10px] font-mono text-zinc-600">
          {visibleIncidents.length > 0 ? `${visibleIncidents.length} incidents` : ""}
        </span>
      </div>

      {/* Two-column layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Queue */}
        <div className="w-80 border-r border-zinc-800 flex flex-col shrink-0">
          <IncidentQueue
            incidents={visibleIncidents}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        </div>

        {/* Right: Incident detail */}
        <div className="flex-1 flex flex-col min-w-0">
          <IncidentDetail incident={selectedIncident} />
        </div>
      </div>
    </main>
  );
}
