# FRONTIER.md — Bar for Calvis Dispatch Agent

Set 2026-07-20 by `frontier-bar` (independent context, no implementation read).
Two axes only per D-011. Not applied to CRUD, scaffolding, schema, or UI.

**Bar confidence:** best-published; true frontier unknown. Where domain practice is
proprietary (commercial alarm-monitoring center performance, guard-company SOPs),
marked `proprietary-unknown` rather than guessed.

**Honest ceiling:** proposer and bar-setter share the same training data and web index.
Separation kills the self-serving bar, not the knowledge bar. Every tier below is
"best published as of July 2026."

---

## Axis A — Learning-Loop Mechanism

> How should a dispatch agent improve from observed outcomes, at a scale of
> hundreds-to-thousands of labeled events, in a domain where every decision must
> remain auditable?

### A.1 Approach landscape

Seven families are relevant. The builder's plan (D-007) explicitly selects
{1, 2, 3, 4} and rejects {7}. Families {5, 6} are partially present (confidence
gating, operator override) but not formalized. Family {5b} (the proper
decision-theoretic framing of the cost ladder itself) is absent.

| # | Family | What it is | Frontier fit for these constraints | Builder status |
|---|--------|-----------|-----------------------------------|----------------|
| 1 | **Bayesian priors** | Beta-Binomial conjugate on `P(real \| type, site, hour)`, hierarchical/empirical Bayes to share strength across sparse sites | Excellent at small scale; conjugate updates are fully auditable and interpretable; hierarchical sharing is critical with <1000 events per site-type cell | **Planned** (D-007 §1) |
| 2 | **Episodic / precedent retrieval** | k-NN case-based reasoning over `(situation → action → outcome)` tuples; retrieve at decision time | Well-suited — CBR has a long track record in emergency dispatch and is inherently explainable ("last 4 times this fired…") | **Planned** (D-007 §2) |
| 3 | **Reliability models** | EWMA of per-guard ack rate, per-robot false-positive rate | Standard signal processing; appropriate | **Planned** (D-007 §3) |
| 4 | **Reflection → rule promotion** | Batch job proposes playbook rules from overrides/misses; operator approves; becomes versioned policy | Human-in-the-loop rule curation — mirrors alarm rationalization practice (ISA-18.2 lifecycle) | **Planned** (D-007 §4) |
| 5 | **Selective prediction / abstention** | Formal framework for "when to defer to human" — Chow's reject option [^1], SelectiveNet [^2], conformal prediction sets [^3], learning-to-defer [^4] | **Frontier for this problem.** The builder has confidence × reversibility gating (D-004) but treats it as a heuristic. The formal framework — learning a deferral policy that optimizes joint human+AI cost — is the published frontier. Conformal prediction gives finite-sample coverage guarantees on the agent's uncertainty sets. | **Partial** — heuristic gating exists, formal framework absent |
| 5b | **Cost-sensitive ordinal decision theory** | Choosing a rung on a cost ladder under uncertainty is a cost-sensitive ordinal classification problem with asymmetric utilities. Proper framing: policy learning with asymmetric counterfactual utilities [^5]; Bayes-optimal decision rules under asymmetric costs; cost curves [^6]. | **This is the proper name for what the builder is doing.** The builder frames it as "tier selection" but does not cite or implement the decision-theoretic machinery. The exchange rate between miss and noise (D-005) is a Bayes risk parameter. | **Absent** — the concept is present intuitively, the formalism is not |
| 6 | **Human-in-the-loop policy learning** | Learning complementary policies where the system routes to human or AI based on instance-level competence [^4][^7]. Active learning to strategically request labels on uncertain events. | Directly applicable — the override signal is a training signal for a deferral policy, not just a rule-promotion trigger. | **Partial** — overrides feed rules, not a deferral model |
| 7 | **Model-level training (fine-tuning/RL)** | Fine-tune or RLHF on domain data | Correctly rejected at this scale and auditability requirement (D-007) | **Rejected** ✓ |

#### What the builder did not consider

1. **The TMA-AVS-01-2024 standard** [^8]. The alarm industry ratified a five-tier
   alarm validation scoring standard in 2024, adopted by IACP. Its five levels
   (L0: no dispatch → L4: confirmed threat to life) are structurally identical to
   the builder's cost ladder. This is not coincidence — it is the same problem.
   The standard defines how to score alarm severity using historical and real-time
   data, manually or via automation. The builder should cite it and align tier
   definitions. **This is the single most important finding: the builder's core
   abstraction already exists as a ratified ANSI standard.**

2. **EEMUA 191 / ISA-18.2 alarm management** [^9][^10]. The mature discipline of
   industrial alarm management defines benchmarks the builder never cites:
   - Normal: ≤1 alarm per 10 minutes per operator
   - Manageable: 1–2 per 10 min
   - Overloaded: >2 per 10 min
   - Alarm flood: >10 alarms in 10 min
   - Standing alarms target: <10
   - Nuisance alarm target: <5% of total
   - ISA-TR18.2.3-2024 provides updated guidance on alarm design to minimize
     nuisance alarms and prevent operator overload.
   These numbers are the domain's published benchmarks for "is the operator
   drowning?" — the very thing the builder's system optimizes. They should be
   cited as design targets and measured in the eval.

3. **Enhanced Call Verification (ECV)** [^11]. ANSI/CSAA CS-V-01 requires ≥2 calls
   to ≥2 numbers before dispatching on an intrusion signal. ECV reduces false
   dispatches by ~60% in measured studies. This is the industry's mechanical
   baseline for false alarm reduction — the agent should beat it.

4. **NFPA 72 hard constraints** [^26]. The National Fire Alarm and Signaling Code
   specifies that certain alarm types (fire, panic/duress) **cannot be suppressed**
   regardless of false alarm history. This is a hard floor the agent must respect
   — the builder's "never auto-dial 911" rule (D-004) is necessary but may not
   be sufficient. The standard also defines signal processing time limits for
   central stations.

5. **Contextual bandits as an alternative framing** [^12]. Thompson sampling or
   LinUCB over the tier-selection action space would give exploration guarantees
   and regret bounds. The builder's approach learns from observed outcomes but
   has no mechanism for strategic exploration (trying a different tier to learn
   whether it would have been safe). At small scale, this matters — the
   explore/exploit tradeoff is real. Constraint: safety requires conservative
   exploration (never explore by under-tiering a real threat). Thompson sampling
   with safety constraints [^13] addresses this directly.

6. **Conformal prediction for calibrated uncertainty** [^3]. Semantic entropy and
   conformal prediction applied to LLM outputs (TACL 2025 survey; Nature 2024)
   give distribution-free coverage guarantees. The builder plans Brier-score
   calibration (D-005) but does not mention conformal methods, which would give
   the agent's confidence intervals a formal validity guarantee rather than
   post-hoc calibration assessment.

### A.2 Consequence map

Being median on this axis means: the agent learns *something* from outcomes but
the learning mechanism is ad hoc, the uncertainty quantification is informal, and
a sharp reviewer can ask "how do you know the right tier boundary?" without getting
a principled answer. The cost:

- **Reviewer confidence:** a reviewer who knows decision theory will see Bayesian
  priors + episodic memory as "reasonable engineering" but not the frontier. They
  will ask: "is this a contextual bandit? Why isn't it formulated as one?" and
  "where are your confidence guarantees?"
- **Real units:** without formal abstention/deferral, the system cannot say "I am
  40% likely to be wrong here, deferring" with a coverage guarantee. It can say
  "my confidence is 0.6" but that number has no formal backing. In production,
  this is the difference between "the agent thinks it's probably fine" and "the
  agent guarantees <5% error on events it handles autonomously."
- **Missed standard:** not citing TMA-AVS-01 means the builder independently
  reinvented an existing standard without knowing it. A reviewer who knows the
  alarm industry will notice.

### A.3 Tiers

#### Median

- Bayesian priors (flat, per-type, not hierarchical) + simple episodic retrieval
- Confidence as a raw model output or heuristic score, uncalibrated
- Rule promotion from operator overrides, unversioned
- No formal uncertainty framework; no deferral policy; no alarm-management
  standards cited
- "It learns" is a claim supported by a chart going in the right direction

#### Industry

- Hierarchical Bayesian priors sharing strength across sites for sparse cells
- Episodic retrieval with structured similarity (not just embedding distance)
- Calibrated confidence (Brier < 0.15, reliability diagram close to diagonal)
- Versioned policy rules with operator approval workflow
- Alarm-rate benchmarks from EEMUA 191 / ISA-18.2 cited and measured
- TMA-AVS-01 tier definitions acknowledged; ECV baseline cited
- Autonomy gating as a principled threshold on calibrated confidence ×
  reversibility, with the threshold justified by the asymmetric cost ratio
- `measure:` Brier score on held-out set; alarm rate per 10-min window vs
  EEMUA 191 targets; false dispatch rate vs ECV baseline [^9][^10][^11]

#### Frontier

All of Industry, plus:
- **Formal deferral policy** via learning-to-defer [^4] or policy learning with
  abstention [^14]: the system learns *when* to handle autonomously vs defer,
  optimizing joint human+AI cost, with doubly-robust regret guarantees
- **Conformal prediction sets** on the agent's tier recommendations, providing
  finite-sample coverage guarantees (e.g., "the true appropriate tier is in
  this set with ≥95% probability") [^3]
- **Cost-sensitive ordinal classification** formalized: the tier selection is
  framed as minimizing Bayes risk under the stated asymmetric cost function,
  with the cost ratio as an explicit parameter [^5][^6]
- **Strategic exploration** via Thompson sampling with safety constraints: the
  system occasionally tries a less-costly tier on low-stakes events to gather
  label signal, with formal safety guarantees preventing under-tiering on
  high-risk events [^13]
- **Alarm management KPIs** measured continuously: alarms/10min, standing alarm
  count, nuisance rate — the operator-load metrics from ISA-18.2 [^10]
- `measure:` coverage guarantee on conformal sets (target ≥0.95); regret bound
  on deferral policy vs oracle; Bayes risk under stated cost function; alarm
  rate vs EEMUA 191 thresholds [^3][^6][^9][^14]

### A.4 Divergence log — Axis A

| Builder plan | Frontier | Consequence |
|---|---|---|
| Confidence × reversibility as heuristic gate (D-004) | Formal deferral policy (L2D) with coverage guarantees | Builder's gate works but is unjustified — the threshold is a magic number. A reviewer can ask "why 0.7?" and there's no principled answer. |
| Bayesian priors, unspecified structure (D-007 §1) | Hierarchical Bayes with site-type-hour cells, conjugate for auditability | If priors are flat per-type without hierarchy, sparse cells (rare event at small site) will be dominated by prior and never update. Hierarchical sharing fixes this. |
| Cost ratio stated but not formalized (D-005) | Bayes-optimal tier selection under asymmetric loss | The cost ratio is "defended in the writeup" but not used as a formal decision parameter. It should be the operating point on a cost curve. |
| No mention of alarm standards | TMA-AVS-01, EEMUA 191, ISA-18.2, ECV | Reinventing existing standards without citing them is a credibility risk with domain-aware reviewers. |
| No exploration mechanism | Safety-constrained Thompson sampling | Without exploration, the system can only learn from tiers it already selects — a feedback loop that entrenches initial biases. At small scale, this is a real cost. |

### A.5 Flags

- `bar confidence: proprietary-unknown` — real commercial alarm monitoring center
  performance (catch rate, false dispatch rate, operator load under production
  conditions) is proprietary. Published standards give targets, not measured
  actuals from operating centers.
- `verify` — Thompson sampling with safety constraints for ordinal action spaces
  at this specific scale: the Meta paper [^13] addresses contextual bandits with
  safety constraints but not ordinal tiers specifically. Application to ordinal
  cost ladders is a reasonable extension but not directly published.

---

## Axis B — Evaluation Design

> How do you honestly demonstrate that an agent got smarter, when the agent's
> own past decisions determined which outcomes you got to observe?

### B.0 The load-bearing problem — state it first

**The builder's three-arm design (D-006) is naive to the selective labels
problem, and this is the most important finding in this document.**

When the agent suppresses an event (tier 0), no one investigates, so no outcome
label arrives. When it dispatches (tier 3–4), a label does. The labels the
evaluator sees are a function of the policy being evaluated. This is:

- **The selective labels problem** (Lakkaraju, Kleinberg, Leskovec, Ludwig &
  Mullainathan, KDD 2017) [^15]: "evaluating algorithmic predictions in the
  presence of unobservables" — outcomes are observed only for individuals who
  received certain decisions.
- **The apple tasting problem** (Helmbold, Littlestone & Long, 2000) [^21]:
  the learner classifies items but only observes the true label when it predicts
  positive. Structurally isomorphic — the agent only gets ground truth when it
  dispatches. Recent tight bounds: Busa-Fekete et al. (2023) [^21].
- **Censored / bandit feedback**: the agent only observes the outcome of the
  action it took, never the counterfactual. Yang, Payani & Naghizadeh (2024)
  [^22] characterize generalization error bounds under censored feedback,
  showing that existing bounds that ignore censoring fail.
- **Missing Not At Random (MNAR)**: the missingness of labels is caused by the
  agent's own decisions, not by random chance.

**However:** the builder's eval design runs all three arms on the **same seeded
synthetic stream** where the simulator knows ground truth for every event
regardless of the agent's decision. This sidesteps the selective labels problem
for the *evaluation comparison* — but only because the simulator has an oracle.
The honest claim is: "on this synthetic distribution, arm C outperforms arm A."
The claim that cannot be made: "the agent's learned policy generalizes to
production, where labels are selectively observed." This distinction must be
stated in the writeup or a sharp reviewer will find it.

### B.1 Approach landscape

| Method family | What it does | Relevance |
|---|---|---|
| **Simulator-oracle evaluation** | All arms see same seeded stream; simulator provides ground truth for every event regardless of agent action | What the builder plans (D-006). Valid for comparing arms on a shared distribution. Not valid for production claims. |
| **Off-policy evaluation (OPE)** | Estimate performance of a new policy using data logged under an old one. IPS [^16], doubly robust [^17], SWITCH estimator. | Needed if the builder wants to claim "policy version N+1 is better than version N" from production logs where policy N generated the labels. Not needed for the seeded-stream comparison but essential for production learning. |
| **Selective labels / contraction** | Lakkaraju et al.'s contraction technique [^15] uses quasi-random variation in decision-maker leniency to compare algorithmic vs human performance under selective observation. | Directly applicable: operator overrides provide variation in "leniency" (the operator sometimes escalates what the agent suppressed). This variation is the lever for bounding counterfactual performance. |
| **Partial identification / bounds** | When labels are MNAR, point-identify the policy value only under assumptions. Otherwise, compute bounds. Manski bounds, IV-based bounds, sensitivity analysis. | Honest practice: state what assumptions are needed for point identification, and what bounds hold without them. |
| **Counterfactual risk assessment** | Policy learning with asymmetric counterfactual utilities [^5] — evaluate by the *worst-case harm* of the policy's actions relative to an alternative. | Frontier framing: "what's the worst-case cost of the agent's suppressions, if some fraction of suppressed events were real?" This is the question a reviewer should ask. |

### B.2 Consequence map

Being median on this axis means: the builder reports "arm C beats arm A on the
seeded stream" without addressing whether the gain survives outside the
simulator, and without stating the honest scope of the claim. The cost:

- **Reviewer confidence:** a reviewer who knows causal inference or OPE will ask
  "what happens when the agent suppresses a real event and you never find out?"
  If the writeup doesn't address selective labels, the central claim ("it gets
  smarter") is an honest claim on synthetic data but an unstated overreach if
  applied to production.
- **Real units:** the "learning curve" showing improvement over time is measured
  on events where the simulator knows ground truth. In production, the curve
  would be measured only on events the agent chose to act on — which is a
  biased sample. The gap between these two curves is the selective-labels bias,
  and it's unquantified.
- **Reproducibility risk:** N≥3 runs with fixed seeds is the builder's plan.
  Recent work shows LLM agents produce 2.0–4.2 distinct action sequences per
  10 runs [^18]. Kapoor et al. (2024) [^23] found that across 23 runs of a
  single agent benchmark, scores ranged from 57.9% to 76.8% (SD 5.4pp, spread
  18.9pp). N=3 is the minimum; it may not be enough to distinguish signal
  from noise, especially if the learning gain is small.

### B.3 Tiers

#### Median

- Three-arm comparison on a seeded stream with N=3 runs
- Report mean metric ± std across runs
- No mention of selective labels, OPE, or claim scope
- Held-out set exists but its distribution match to "production" is unexamined
- Calibration via Brier score, reliability diagram
- "It got smarter" supported by a chart

#### Industry

- All of Median, plus:
- **Honest claim scope** stated explicitly: "this comparison is valid within the
  simulator's distributional assumptions; production generalization requires
  [these additional validations]"
- **Selective labels acknowledged**: the writeup discusses what happens when the
  agent suppresses events — the missing-label problem — and explains why the
  simulator-oracle design sidesteps it for eval purposes
- **N≥5 runs** with bootstrap confidence intervals; a gain that overlaps the
  noise band at 95% CI is reported as "not demonstrated" rather than claimed
- **Held-out scenario set** with distributional controls: the held-out set
  includes the same event-type distribution and rare-event coverage as the
  training set, verified explicitly
- **Ablation** that isolates each mechanism's contribution (priors alone,
  episodic alone, rules alone, combined)
- **Cost curve** [^6] or equivalent showing performance across the full range of
  cost ratios, not just a single operating point
- `measure:` bootstrap 95% CI on cost-weighted error across N≥5 runs;
  ablation Δ per mechanism with CI; Brier score [^6]

#### Frontier

All of Industry, plus:
- **Off-policy evaluation** of policy versions: when comparing policy V(n+1) to
  V(n) using data logged under V(n), use doubly-robust estimators [^17] with
  stated assumptions. Report the IPS estimate alongside the direct estimate to
  diagnose propensity issues.
- **Selective labels quantification**: bound the worst-case error on suppressed
  events using partial identification (Manski-style bounds) or sensitivity
  analysis: "if up to X% of suppressed events were real, the cost-weighted
  error would be at most Y" [^15][^19]
- **Reproducibility protocol**: N≥10 runs, intraclass correlation coefficient
  (ICC) reported [^18], bootstrap CIs, and a pre-registered eval specification
  (the eval code is frozen before results are generated)
- **Simulator validity statement**: explicit enumeration of distributional
  assumptions the simulator makes (event arrival rates, correlation structure,
  outcome probabilities), and a sensitivity analysis varying each
- **Cost-weighted proper scoring** using the full cost curve [^6] across
  cost-ratio sweep, not a single point — shows the agent dominates (or doesn't)
  across the range of reasonable cost ratios
- **Counterfactual harm bound** [^5]: for every suppressed event, bound the
  probability it was real and the expected cost of the miss, aggregated across
  the eval run
- `measure:` DR-OPE estimate ± CI for policy comparison; Manski bounds on
  suppression error; ICC across N≥10 runs; cost-curve area; counterfactual
  harm bound [^5][^6][^15][^17][^18]

### B.4 Divergence log — Axis B

| Builder plan | Frontier | Consequence |
|---|---|---|
| Three-arm seeded stream comparison (D-006) | Valid, but claim scope must be explicitly bounded to the simulator distribution | Without scope statement, the central claim is overreach. With it, it's an honest and strong result. |
| N≥3 runs, variance reported (D-006) | N≥10, ICC, bootstrap CIs | N=3 may not distinguish a real gain from noise, especially for the learning mechanisms with highest variance (episodic retrieval, rule promotion). |
| Cost-weighted error at a single cost ratio (D-005) | Cost curve across cost-ratio sweep | A single ratio produces a single number. A reviewer who disagrees with the ratio dismisses the result. A cost curve shows robustness. |
| No mention of selective labels | Acknowledge + bound | The writeup must at minimum state why the simulator-oracle design avoids the problem for eval, and what would be needed for production claims. |
| No OPE for policy versioning | DR-OPE for production learning loop | The learning loop updates priors/rules, producing a new policy. Comparing V(n+1) to V(n) from V(n)'s data is OPE by definition. Not doing it means the "learning curve" is measured against simulator oracle, not against logged production data. |
| Ablation planned (D-006) | Ablation with per-mechanism CIs | Ablation without CIs can show mechanism A contributed 0.02 — but if the CI is ±0.03, that's noise. |

### B.5 Flags

- `verify` — Manski-style bounds applied specifically to alarm-suppression
  counterfactuals: the framework is well-established but published application
  to alarm triage specifically is not found. The extension is straightforward.
- `bar confidence: proprietary-unknown` — how commercial alarm monitoring
  centers evaluate their own false-negative rate (missed real events that were
  suppressed) is proprietary. Published standards define process requirements
  (UL 827 signal handling in 90 seconds [^20]) but not outcome metrics.

---

## References

[^1]: Chow, C.K. (1970). "On optimum recognition error and reject tradeoff."
IEEE Trans. Information Theory 16(1), 41–46.

[^2]: Geifman, Y. & El-Yaniv, R. (2019). "SelectiveNet: A Deep Neural Network
with an Integrated Reject Option." ICML 2019. arXiv:1901.09192.

[^3]: Quach, V. et al. (2025). "Conformal Prediction for Natural Language
Processing: A Survey." TACL 2025. Also: Kuhn et al. (2024). "Semantic Entropy."
Nature 2024.

[^4]: Mozannar, H. & Sontag, D. (2020). "Consistent Estimators for Learning to
Defer to an Expert." ICML 2020. Updated: Mozannar et al. (2023). "Who Should
Predict? Exact Algorithms for Learning to Defer to Humans."

[^5]: Imai, K. & Li, M. (2024). "Policy Learning with Asymmetric Counterfactual
Utilities." JASA 119(548), 2024. arXiv:2206.10479.

[^6]: Drummond, C. & Holte, R.C. (2006). "Cost Curves: An Improved Method for
Visualizing Classifier Performance." Machine Learning 65(1), 95–130.

[^7]: Gao, R. et al. (2023). "Learning Complementary Policies for Human-AI
Teams." UT Austin. Also: Wilder, B. et al. (2021).

[^8]: ANSI/TMA-AVS-01-2024. "Alarm Validation Scoring Standard." The Monitoring
Association, ratified by IACP November 2024. Five-tier classification:
L0 (no dispatch) through L4 (confirmed threat to life).

[^9]: EEMUA Publication 191, Edition 4 (November 2024). "Alarm Systems — A Guide
to Design, Management and Procurement." Benchmarks: ≤1 alarm/10min (acceptable),
>2/10min (overloaded), >10/10min (flood).

[^10]: ANSI/ISA-18.2. "Management of Alarm Systems for the Process Industries."
ISA-TR18.2.3-2024: updated guidance on alarm design and nuisance alarm
minimization.

[^11]: ANSI/CSAA CS-V-01-2016. "Enhanced Call Verification." ≥2 calls to ≥2
numbers before dispatch. ~60% false dispatch reduction in measured studies.

[^12]: Li, L. et al. (2010). "A Contextual-Bandit Approach to Personalized News
Article Recommendation." WWW 2010. LinUCB.

[^13]: Kazerouni, A. et al. / Meta AI. "Thompson Sampling for Contextual Bandit
Problems with Auxiliary Safety Constraints."

[^14]: Liu, Z. et al. (2026). "Policy Learning with Abstention."
arXiv:2510.19672. Doubly-robust regret guarantees, O(1/n) rates.

[^15]: Lakkaraju, H., Kleinberg, J., Leskovec, J., Ludwig, J. & Mullainathan, S.
(2017). "The Selective Labels Problem: Evaluating Algorithmic Predictions in the
Presence of Unobservables." KDD 2017.

[^16]: Horvitz, D.G. & Thompson, D.J. (1952). IPS estimator. Applied to bandits:
Li, L. et al. (2011). "Unbiased Offline Evaluation of Contextual-Bandit-Based
News Article Recommendation Systems." WSDM 2011.

[^17]: Dudík, M., Langford, J. & Li, L. (2011). "Doubly Robust Policy Evaluation
and Learning." ICML 2011.

[^18]: "How Consistent Are LLM Agents? Measuring Behavioral Reproducibility in
Multi-Step Tool-Calling Pipelines." arXiv:2605.28840, June 2025. Finding:
2.0–4.2 distinct action sequences per 10 runs. Also: "Stochasticity in Agentic
Evaluations: Quantifying Inconsistency with Intraclass Correlation."
arXiv:2512.06710, December 2025.

[^19]: Manski, C.F. (2003). "Partial Identification of Probability
Distributions." Springer. Bounds under incomplete data.

[^20]: UL 827. "Standard for Central-Station Alarm Services." Signal verification
within 90 seconds; dispatch protocol; operator training and staffing requirements.

[^21]: Helmbold, D., Littlestone, N. & Long, P. (2000). "Apple Tasting."
Information and Computation 161(2), 85–139. Agent only observes true label when
it predicts positive — isomorphic to dispatch-only labeling. Updated: Busa-Fekete
et al. (2023). "Apple Tasting: Combinatorial Dimensions and Minimax Rates."

[^22]: Yang, Z., Payani, A. & Naghizadeh, P. (2024). "Generalization Error Bounds
for Learning under Censored Feedback." arXiv:2404.09247. Shows standard
generalization bounds fail under censored feedback; extends DKW inequality to
non-IID censored data.

[^23]: Kapoor, S. et al. (2024). "AI Agents That Matter." arXiv:2407.01502.
Scores across 23 runs ranged 57.9%–76.8% (SD 5.4pp). Single-run evaluations are
unrepresentative. Recommends bootstrap CIs with ≥10,000 replicates.

[^24]: Rosenbaum, P. (2002). "Observational Studies." Springer. Gamma sensitivity
parameter bounds unmeasured confounding — applicable to bounding error on
suppressed events.

[^25]: Hand, D.J. (2009). "Measuring Classifier Performance: A Coherent
Alternative to the Area Under the ROC Curve." Machine Learning 77, 103–123.
H-measure: integrates over a Beta distribution of cost ratios rather than a
uniform one.

[^26]: NFPA 72 (2022 edition). "National Fire Alarm and Signaling Code." Section
26: supervising station alarm systems. Signal processing time limits; alarm
verification procedures; non-suppressible alarm types (fire, duress/panic).

[^27]: Elkan, C. (2001). "The Foundations of Cost-Sensitive Learning." IJCAI 2001.
Proves Bayes-optimal threshold shifts from 0.5 to c_FP/(c_FP+c_FN) under
asymmetric costs — the formal basis for cost-adjusted tier selection.
