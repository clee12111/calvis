"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { ReplayControls } from "@/components/dispatch/replay-controls";
import { IncidentQueue } from "@/components/dispatch/incident-queue";
import { IncidentDetail } from "@/components/dispatch/incident-detail";
import { SitePanel } from "@/components/dispatch/site-panel";

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
  const [incidents, setIncidents] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sites, setSites] = useState<any[]>([]);
  const eventSourceRef = useRef<EventSource | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch incidents
  const fetchIncidents = useCallback(async () => {
    try {
      const res = await fetch("/api/incidents");
      if (res.ok) {
        const data = await res.json();
        setIncidents(data);

        // Extract unique sites
        const siteMap = new Map<string, any>();
        for (const inc of data) {
          if (inc.site && !siteMap.has(inc.site.id ?? inc.siteId)) {
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
      }
    } catch {
      // Ignore fetch errors during startup
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
        // Refresh incidents list
        fetchIncidents();
      } else if (data.type === "init") {
        setSimState((prev) => ({
          ...prev,
          time: data.time,
          speed: data.speed,
        }));
      }
    };

    es.onerror = () => {
      // Reconnect after a delay
      setTimeout(connectSSE, 2000);
    };

    return () => {
      es.close();
    };
  }, [fetchIncidents]);

  // Start simulation
  const handleStart = async () => {
    const speed = simState.speed || 10;
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
      connectSSE();
      // Start polling for incidents
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(fetchIncidents, 1000);
    }
  };

  const handlePause = async () => {
    await fetch("/api/sim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "pause" }),
    });
    setSimState((prev) => ({ ...prev, running: false }));
  };

  const handleResume = async () => {
    await fetch("/api/sim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "resume", speed: simState.speed }),
    });
    setSimState((prev) => ({ ...prev, running: true }));
    connectSSE();
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(fetchIncidents, 1000);
  };

  const handleSpeedChange = async (speed: number) => {
    await fetch("/api/sim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "speed", speed }),
    });
    setSimState((prev) => ({ ...prev, speed }));
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) eventSourceRef.current.close();
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const selectedIncident = incidents.find((i: any) => i.id === selectedId) ?? null;

  return (
    <main className="flex flex-col h-screen bg-zinc-950 text-zinc-100">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800 bg-zinc-950">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-mono font-bold uppercase tracking-widest text-zinc-300">
            Calvis Dispatch
          </h1>
          <span className="text-[9px] font-mono text-zinc-600 uppercase">F0 Baseline</span>
        </div>
      </div>

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

      {/* Three-zone layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Ranked queue */}
        <div className="w-80 border-r border-zinc-800 flex flex-col shrink-0">
          <IncidentQueue
            incidents={incidents}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        </div>

        {/* Center: Incident detail */}
        <div className="flex-1 flex flex-col min-w-0">
          <IncidentDetail incident={selectedIncident} />
        </div>

        {/* Right: Sites/coverage */}
        <div className="w-64 border-l border-zinc-800 flex flex-col shrink-0">
          <SitePanel sites={sites} />
        </div>
      </div>
    </main>
  );
}
