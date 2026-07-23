"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { ReplayControls } from "@/components/dispatch/replay-controls";
import { IncidentQueue } from "@/components/dispatch/incident-queue";
import { IncidentDetail } from "@/components/dispatch/incident-detail";
import { SitePanel } from "@/components/dispatch/site-panel";
import { BoardLoad } from "@/components/dispatch/board-load";
import { ArmSelector } from "@/components/dispatch/arm-selector";
import { SessionMetrics } from "@/components/dispatch/session-metrics";
import { LearningPanel } from "@/components/dispatch/learning-panel";
import { HelpButton } from "@/components/dispatch/help-overlay";
import type { ArmMetrics } from "@/lib/engine/incident-cache";

interface SimState {
  time: number;
  speed: number;
  running: boolean;
  eventsIngested: number;
  totalEvents: number;
}

export default function DispatchPage() {
  const [simState, setSimState] = useState<SimState>({
    time: 0,
    speed: 10,
    running: false,
    eventsIngested: 0,
    totalEvents: 0,
  });
  const [allIncidents, setAllIncidents] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sites, setSites] = useState<any[]>([]);
  const [boardLoad, setBoardLoad] = useState(0);
  const [activeArm, setActiveArm] = useState("agent");
  const [availableArms, setAvailableArms] = useState<string[]>([]);
  const [armMetrics, setArmMetrics] = useState<Record<string, ArmMetrics>>({});
  const [agentError, setAgentError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recentIncidentTimestamps = useRef<number[]>([]);

  // Progressive reveal: filter incidents by sim clock time
  const visibleIncidents = useMemo(() => {
    if (simState.time === 0 && !simState.running) return allIncidents;
    return allIncidents.filter((inc) => inc.createdAt <= simState.time);
  }, [allIncidents, simState.time, simState.running]);

  // Extract unique sites from visible incidents
  useEffect(() => {
    const siteMap = new Map<string, any>();
    for (const inc of visibleIncidents) {
      if (inc.site) {
        const siteId = inc.site.id ?? inc.siteId;
        const existing = siteMap.get(siteId);
        siteMap.set(siteId, {
          id: siteId,
          name: inc.site.name ?? siteId,
          criticalityTier: inc.site.criticalityTier ?? 1,
          activeIncidents: (existing?.activeIncidents ?? 0) + (inc.status === "open" ? 1 : 0),
          guardCount: 0,
        });
      }
    }
    setSites(Array.from(siteMap.values()));
  }, [visibleIncidents]);

  // Board load: count incidents surfaced in the last 10-min sim window
  useEffect(() => {
    const windowMs = 10 * 60 * 1000;
    const cutoff = simState.time - windowMs;
    const count = visibleIncidents.filter(
      (inc) => inc.createdAt >= cutoff && inc.createdAt <= simState.time && (inc.tier ?? 0) >= 1
    ).length;
    setBoardLoad(count);
  }, [visibleIncidents, simState.time]);

  // Fetch incidents from cache
  const fetchIncidents = useCallback(async () => {
    try {
      const res = await fetch("/api/incidents");
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          setAllIncidents(data);
        }
      }
    } catch (_e) {
      // Ignore fetch errors during startup
    }
  }, []);

  // Fetch arm metrics
  const fetchMetrics = useCallback(async () => {
    try {
      const res = await fetch("/api/incidents?view=metrics");
      if (res.ok) {
        const data = await res.json();
        setArmMetrics(data.metrics ?? {});
        setAvailableArms(data.availableArms ?? []);
        setActiveArm(data.activeArm ?? "agent");
      }
    } catch {
      // Ignore
    }
  }, []);

  // Connect to SSE
  const connectSSE = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const es = new EventSource("/api/events/stream");
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      const data = JSON.parse(event.data);

      if (data.type === "tick") {
        setSimState((prev) => ({ ...prev, time: data.time }));
      } else if (data.type === "event") {
        setSimState((prev) => ({
          ...prev,
          eventsIngested: prev.eventsIngested + 1,
        }));
      } else if (data.type === "incident") {
        fetchIncidents();
      } else if (data.type === "init") {
        setSimState((prev) => ({
          ...prev,
          time: data.time,
          speed: data.speed,
        }));
      }
    };

    es.onerror = (_e) => {
      es.close();
      setTimeout(connectSSE, 2000);
    };

    return () => {
      es.close();
    };
  }, [fetchIncidents]);

  // Start simulation
  const handleStart = async () => {
    try {
      const speed = simState.speed || 10;
      if (eventSourceRef.current) eventSourceRef.current.close();
      if (pollRef.current) clearInterval(pollRef.current);

      const res = await fetch("/api/sim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start", seed: 42, speed }),
      });
      const data = await res.json();
      if (data.ok) {
        setSimState((prev) => ({
          ...prev,
          running: true,
          totalEvents: data.totalEvents,
          speed,
        }));
        setActiveArm(data.activeArm ?? "agent");
        setAvailableArms(data.availableArms ?? []);
        if (data.agentError) {
          setAgentError(data.agentError);
        }
        fetchIncidents();
        fetchMetrics();
        connectSSE();
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = setInterval(fetchIncidents, 1000);
      }
    } catch (err) {
      console.error("Start sim error:", err);
    }
  };

  const handlePause = async () => {
    try {
      await fetch("/api/sim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "pause" }),
      });
      setSimState((prev) => ({ ...prev, running: false }));
    } catch (_e) { /* ignore */ }
  };

  const handleResume = async () => {
    try {
      await fetch("/api/sim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resume", speed: simState.speed }),
      });
      setSimState((prev) => ({ ...prev, running: true }));
      connectSSE();
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(fetchIncidents, 1000);
    } catch (_e) { /* ignore */ }
  };

  const handleSpeedChange = async (speed: number) => {
    try {
      await fetch("/api/sim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "speed", speed }),
      });
      setSimState((prev) => ({ ...prev, speed }));
    } catch (_e) { /* ignore */ }
  };

  // Arm switching
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

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedId((prev) => {
          const idx = visibleIncidents.findIndex((i: any) => i.id === prev);
          const next = Math.min(idx + 1, visibleIncidents.length - 1);
          return visibleIncidents[next]?.id ?? prev;
        });
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedId((prev) => {
          const idx = visibleIncidents.findIndex((i: any) => i.id === prev);
          const next = Math.max(idx - 1, 0);
          return visibleIncidents[next]?.id ?? prev;
        });
      } else if (e.key === "a") {
        // Quick approve
        if (selectedId) {
          fetch("/api/override", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ incidentId: selectedId, action: "approve" }),
          });
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [visibleIncidents, selectedId]);

  // On mount: check if sim is already running
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/sim");
        const data = await res.json();
        if (data.running || data.totalEvents > 0) {
          setSimState({
            time: data.time ?? 0,
            speed: data.speed ?? 10,
            running: data.running ?? false,
            eventsIngested: data.eventsIngested ?? 0,
            totalEvents: data.totalEvents ?? 0,
          });
          fetchIncidents();
          fetchMetrics();
          connectSSE();
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = setInterval(fetchIncidents, 1000);
        }
      } catch (_e) { /* no sim running */ }
    })();

    return () => {
      if (eventSourceRef.current) eventSourceRef.current.close();
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const selectedIncident = visibleIncidents.find((i: any) => i.id === selectedId) ?? null;
  const currentMetrics = armMetrics[activeArm] ?? null;

  return (
    <main className="flex flex-col h-screen bg-zinc-950 text-zinc-100">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800 bg-zinc-950">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-mono font-bold uppercase tracking-widest text-zinc-300">
            Calvis Dispatch
          </h1>
          <span className="text-[9px] font-mono text-zinc-600 uppercase">F4.6 Console</span>
        </div>
        <div className="flex items-center gap-4">
          <ArmSelector
            activeArm={activeArm}
            availableArms={availableArms}
            onSwitch={handleArmSwitch}
          />
          <BoardLoad load={boardLoad} threshold={6} />
          <HelpButton />
        </div>
      </div>

      {/* Agent error banner */}
      {agentError && (
        <div className="px-4 py-2 bg-red-900/30 border-b border-red-800/50 text-[11px] font-mono text-red-400">
          Agent arm failed: {agentError}
        </div>
      )}

      {/* Replay controls */}
      <ReplayControls
        time={simState.time}
        speed={simState.speed}
        running={simState.running}
        eventsIngested={simState.eventsIngested}
        totalEvents={simState.totalEvents}
        onStart={handleStart}
        onPause={handlePause}
        onResume={handleResume}
        onSpeedChange={handleSpeedChange}
      />

      {/* Session metrics strip */}
      <SessionMetrics
        metrics={currentMetrics}
        activeArm={activeArm}
        boardLoad={boardLoad}
        boardThreshold={6}
        visibleCount={visibleIncidents.filter((i: any) => (i.tier ?? 0) >= 1).length}
      />

      {/* Three-zone layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Ranked queue */}
        <div className="w-80 border-r border-zinc-800 flex flex-col shrink-0">
          <IncidentQueue
            incidents={visibleIncidents}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        </div>

        {/* Center: Incident detail */}
        <div className="flex-1 flex flex-col min-w-0">
          <IncidentDetail incident={selectedIncident} />
        </div>

        {/* Right: Sites/coverage + Learning */}
        <div className="w-64 border-l border-zinc-800 flex flex-col shrink-0">
          <div className="flex-1 overflow-y-auto">
            <SitePanel sites={sites} />
          </div>
          <LearningPanel />
        </div>
      </div>
    </main>
  );
}
