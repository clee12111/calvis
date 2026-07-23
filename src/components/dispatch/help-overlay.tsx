"use client";

import { useState } from "react";

export function HelpButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="text-[10px] font-mono text-zinc-600 hover:text-zinc-300 transition-colors px-1.5 py-0.5 rounded border border-zinc-800 hover:border-zinc-600"
        title="Help &amp; keyboard shortcuts"
      >
        ?
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={() => setOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Help and keyboard shortcuts"
        >
          <div
            className="bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl max-w-xl w-full max-h-[80vh] overflow-y-auto m-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between">
              <h2 className="text-sm font-mono font-bold uppercase tracking-widest text-zinc-300">
                Calvis Dispatch
              </h2>
              <button
                onClick={() => setOpen(false)}
                className="text-zinc-500 hover:text-zinc-300 text-lg leading-none"
              >
                &times;
              </button>
            </div>

            <div className="px-5 py-4 space-y-5 text-[11px] font-mono">
              {/* What this is */}
              <section>
                <h3 className="text-[10px] uppercase tracking-wider text-zinc-500 mb-2">What this is</h3>
                <p className="text-zinc-400 leading-relaxed">
                  A dispatch console for physical security operations. An AI agent watches
                  sensor events from 40+ sites overnight — motion detectors, door sensors,
                  panic buttons, license plate readers — and decides what needs human
                  attention and what can be suppressed.
                </p>
              </section>

              {/* The three arms */}
              <section>
                <h3 className="text-[10px] uppercase tracking-wider text-zinc-500 mb-2">Three strategies compared</h3>
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <span className="text-orange-400 font-bold shrink-0 w-16">Agent</span>
                    <span className="text-zinc-400">LLM reasons about each incident — calls tools, checks priors, adjusts probabilities, explains what would change its mind. Two-tier model routing: fast model triages, strong model handles ambiguous or high-consequence cases.</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-blue-400 font-bold shrink-0 w-16">Scripted</span>
                    <span className="text-zinc-400">Fixed protocol: ask 5 system questions, then human questions if ambiguous. The emergency dispatch standard (ProQA/MPDS) — used for 50 years. Zero model calls.</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-zinc-400 font-bold shrink-0 w-16">Rules</span>
                    <span className="text-zinc-400">Static scorer: severity &times; site criticality &times; hour &times; zone. No investigation, no reasoning. The cheapest baseline.</span>
                  </div>
                </div>
              </section>

              {/* Evidence levels */}
              <section>
                <h3 className="text-[10px] uppercase tracking-wider text-zinc-500 mb-2">Evidence levels (ANSI/TMA AVS-01)</h3>
                <div className="space-y-1">
                  <div className="flex gap-2">
                    <span className="text-zinc-500 w-6">E0</span>
                    <span className="text-zinc-500">Nothing to act on — benign or equipment issue</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-blue-400 w-6">E1</span>
                    <span className="text-zinc-400">Something happened — intent unknown</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-yellow-400 w-6">E2</span>
                    <span className="text-zinc-400">Human presence confirmed — intent unknown</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-orange-400 w-6">E3</span>
                    <span className="text-zinc-400">Threat to property confirmed</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-red-400 w-6">E4</span>
                    <span className="text-zinc-400">Threat to life confirmed</span>
                  </div>
                </div>
              </section>

              {/* How the agent learns */}
              <section>
                <h3 className="text-[10px] uppercase tracking-wider text-zinc-500 mb-2">How the agent learns</h3>
                <p className="text-zinc-400 leading-relaxed">
                  The system maintains P(real) — the probability that an event type at a
                  specific site is a real incident vs. a false alarm. When you override a
                  decision, the prior updates via Bayesian inference. The agent sees the
                  observation count <span className="text-zinc-300">n</span> — it trusts
                  priors backed by 50 observations more than hand-set guesses at n=0.
                </p>
              </section>

              {/* Cost model */}
              <section>
                <h3 className="text-[10px] uppercase tracking-wider text-zinc-500 mb-2">Cost model</h3>
                <p className="text-zinc-400 leading-relaxed">
                  <span className="text-zinc-300">Response cost</span> = guard + operator time to respond.{" "}
                  <span className="text-zinc-300">Harm cost</span> = penalty for under-responding to real incidents (convex: E4 miss costs 100&times; more than E1 miss).{" "}
                  <span className="text-zinc-300">Flood penalty</span> = surcharge when &gt;6 items/10min hit the operator (EEMUA 191).
                </p>
              </section>

              {/* Keyboard shortcuts */}
              <section>
                <h3 className="text-[10px] uppercase tracking-wider text-zinc-500 mb-2">Keyboard shortcuts</h3>
                <div className="grid grid-cols-2 gap-1">
                  <div className="flex gap-2">
                    <kbd className="px-1.5 py-0.5 bg-zinc-800 border border-zinc-700 rounded text-zinc-400 text-[10px]">J</kbd>
                    <span className="text-zinc-400">Next incident</span>
                  </div>
                  <div className="flex gap-2">
                    <kbd className="px-1.5 py-0.5 bg-zinc-800 border border-zinc-700 rounded text-zinc-400 text-[10px]">K</kbd>
                    <span className="text-zinc-400">Previous incident</span>
                  </div>
                  <div className="flex gap-2">
                    <kbd className="px-1.5 py-0.5 bg-zinc-800 border border-zinc-700 rounded text-zinc-400 text-[10px]">A</kbd>
                    <span className="text-zinc-400">Approve selected</span>
                  </div>
                  <div className="flex gap-2">
                    <kbd className="px-1.5 py-0.5 bg-zinc-800 border border-zinc-700 rounded text-zinc-400 text-[10px]">?</kbd>
                    <span className="text-zinc-400">This help</span>
                  </div>
                </div>
              </section>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
