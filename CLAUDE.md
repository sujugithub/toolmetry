# CLAUDE.md — hitrate (working title)

> Measure how well AI agents actually use your MCP server's tools — then automatically rewrite the tool descriptions and prove the improvement with before/after data.

**One-liner pitch:** "Your MCP server's tools get called correctly 61% of the time. Here's the diff that makes it 89%."

This file is the single source of truth for Claude Code sessions on this project. Read it fully before doing any work. We run this project **Scrum-style**: every work session is part of a sprint, every task traces to a backlog item, and nothing merges without meeting the Definition of Done.

---

## 1. Product Vision & Strategy

**Product Goal (Scrum):** Ship an open-source CLI that closes the loop from *detecting* agent tool-misuse to *fixing* it — the one step no existing tool (MCPJam, Braintrust, Confident AI, lastmile mcp-eval, EvalView) performs.

**Why this exists (validated 2026-07):**
- LLMs decide tool calls entirely from tool names, descriptions, and parameter specs. Bad descriptions → wrong tool, wrong args, extra calls.
- Teams (incl. GitHub's MCP team) refine descriptions **manually** after eval runs. Nobody automates the rewrite.
- Eval runners are commoditized (MCPJam owns that slot). We **compose with** them, not against them.

**Strategic rules (do not violate):**
1. **Do not build an eval runner.** Use existing runners/SDKs for measurement. Our product is the optimizer loop.
2. **Model-neutral by design.** Anthropic-first implementation, but architecture must allow OpenAI/Gemini judges and agents.
3. **Every claim ships with data.** No "improved descriptions" without a measured before/after hit-rate delta, N≥5 runs per scenario.
4. **Speed over polish until the decision gate.** PoC code may be ugly; published code may not.

---

## 2. Scrum Framework (solo + AI adaptation)

| Scrum element | How we run it |
|---|---|
| **Product Owner** | Aryan — owns backlog priority, accepts/rejects stories |
| **Developers** | Aryan + Claude Code (pair) |
| **Sprint length** | 1 week (Mon–Sun), ~20 hrs capacity |
| **Sprint Planning** | First Claude Code session of the week: pick Sprint Goal + backlog items into the Sprint Backlog (§6) |
| **Daily Scrum** | Start of every session: Claude reads §6, states what's done / next / blocked in one short summary before coding |
| **Sprint Review** | Last session of the week: demo working increment (run the CLI end-to-end), record actual metrics in §7 |
| **Retrospective** | 3 bullets max appended to §8: keep / change / try |
| **Increment** | Working, tested code on `main` — every sprint must end runnable |

**Story points:** Fibonacci (1, 2, 3, 5, 8). An 8 must be split before entering a sprint.

### Definition of Ready (story may enter a sprint when…)
- Acceptance criteria written and testable
- Dependencies identified (API keys, target server chosen, etc.)
- Sized ≤ 5 points

### Definition of Done (story is Done when…)
- Acceptance criteria pass, demonstrated by running code
- Unit tests written and green (`npm test`)
- Type-checks clean (`npm run typecheck`), lint clean
- No hardcoded secrets; config via `.env` (gitignored)
- Eval/optimization results (if any) saved under `results/` with timestamp + git SHA
- §6 sprint board updated; conventional commit pushed

---

## 3. Tech Stack & Conventions

- **Language:** TypeScript (strict), Node 20+, ESM
- **Key deps:** `@modelcontextprotocol/sdk` (client + spawning target servers), `@anthropic-ai/sdk` (agent loop + rewrite engine), `zod` (scenario schema), `yaml`, `commander` (CLI), `vitest` (tests)
- **Structure:**
  ```
  src/
    cli.ts            # entry: hitrate measure | optimize | report
    scenarios/        # YAML schema + loader (zod-validated)
    harness/          # agent loop against target MCP server, N-run sampling
    metrics/          # hit rate, arg correctness, extra-call rate, cost/latency
    optimizer/        # diagnose failures -> rewrite descriptions -> re-measure
    report/           # markdown + JSON diff reports (before/after)
  scenarios/          # scenario suites per target server
  results/            # timestamped run outputs (committed — this is our dataset)
  ```
- **Commits:** Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`)
- **Branches:** trunk-based; short-lived feature branches only if a story spans sessions
- **Costs:** default model for agent runs = cheapest capable (Haiku); judge/rewriter = Sonnet. Hard budget guard per run, configurable, default US$5.

**Non-determinism policy:** every scenario runs **N=5 times minimum**; report hit rate as mean with per-run detail. Never conclude from a single run.

---

## 4. Product Backlog (ordered)

### EPIC A — Proof of Concept *(Sprint 1 — DONE, gate passed on strict success)*
- [x] **A1 (3)** Scenario schema + loader: YAML with `prompt`, `expected_tool`, `expected_args` (partial match), `max_calls`; zod-validated with helpful errors
- [x] **A2 (5)** Measurement harness: spawn target MCP server, run agent loop via Anthropic API with server's tools, capture actual tool calls, N-run sampling (+ Fireworks provider adapter, unplanned)
- [x] **A3 (2)** Metrics: hit rate, argument correctness, extra-call rate per scenario + aggregate
- [x] **A4 (5)** Optimizer v0: feed failing scenarios + current tool descriptions to Claude → diagnosis + rewritten descriptions → patch server tool list (in-memory override) → re-measure
- [x] **A5 (2)** Pick 1 popular open-source MCP server (overlapping/confusable tools preferred); write 15–20 scenarios for it
- [x] **A6 (1)** Baseline vs optimized report (markdown table, per-scenario diff)

### EPIC B — Repeatability & Dataset *(Sprints 2–3)*
- [x] **B1 (3)** Description override without forking target server (proxy layer that rewrites `tools/list` responses)
- [ ] **B2 (5)** Run pipeline against 5–10 popular servers; commit all results
- [x] **B3 (3)** Multi-round optimization with convergence/termination criteria
- [ ] **B3.1 (3)** De-noise the rewriter: sample K candidate rewrites per round and keep the measured best, and/or seed the loop from known-good overrides (`--seed`). Motivated by 2026-07-13 finding: two independent rewrites scored +10.0 and −2.2 pts — single-shot rewriting is high-variance.
- [x] **B4 (2)** Cost tracking + budget guard per optimization run

### EPIC C — Public Release *(Sprint 4)*
- [x] **C1 (3)** Polish CLI: `npx hitrate measure ./scenarios`, `npx hitrate optimize`, good `--help`, pretty terminal output
- [x] **C2 (2)** README with quickstart GIF, results table, honest limitations
- [x] **C3 (3)** Landing page (your design skills = our unfair advantage)
- [x] **C4 (2)** Launch post draft: "I rewrote the tool descriptions of 10 popular MCP servers — before/after hit rates"
- [ ] **C5 (2)** PRs to 2–3 measured servers with eval data attached

### EPIC D — Post-signal (do NOT start before real users)
- Model-matrix runs (GPT/Gemini agents), hosted runs, GitHub Action, historical dashboards

---

## 5. Current Sprint

**Sprint 2 — Goal:** *Make the optimizer repeatable and usable without our harness: proxy-based description overrides, multi-round convergence, real cost guard.*

**Committed:** B1 (3) → B4 (2) → B3 (3) = 8 pts. Stretch: start B2 (scenario suites for 2–3 more servers).

**Sprint 1 outcome (gate PASSED, PO-ratified 2026-07-13):** strict success +10.0 pts (74.4% → 84.4%) on the filesystem server counts as passing the ≥10-pt gate; hit rate alone was ceiling-limited (94.4% baseline, +2.2 pts). PO decision: the headline metric going forward is **strict success**, with hit rate reported alongside. See §7 for data, §8 for retro.

---

## 6. Sprint Board *(Claude: update this every session)*

| ID | Story | Status | Notes |
|----|-------|--------|-------|
| B1 | tools/list rewrite proxy | Done | `hitrate proxy --overrides o.json -- <cmd…>`; integration-tested via nested MCP spawn |
| B4 | Cost tracking + per-run budget guard | Done | `--price-in/--price-out` activates the guard for any model |
| B3 | Multi-round optimization + convergence | Done | validated live: regressing round discarded, baseline kept, guard active ($0.31 spend) |
| B2 | 5–10 popular servers | 4/10 | memory +34.5, git +21.7, sqlite +66.0 strict-success pts |
| C1 | CLI polish | Done | dir input, auto setup detection, ANSI colors, help examples |
| C2 | README | Done | real results table, honest limitations; quickstart GIF still to record |
| C3 | Landing page | Done | site/index.html, single file; verified to 375px; needs hosting + GitHub URL swap (USER placeholder) |
| C4 | Launch post draft | Done | docs/launch-post.md; tone pass + URL swap pending |
| C5 | PRs to measured servers | To Do | description diffs ready in results/; needs PO GitHub account + rotated keys |

**Blocked/decisions needed:**
- Re-validate Sprint 1 numbers on Haiku 4.5 once Anthropic credit exists (`-m claude-haiku-4-5`, same command).
- Rotate both API keys (pasted in chat) before publishing anything.
- PO to ratify (carried over): sandbox reset as CLI flag (`--setup <cmd>`) rather than a scenario-schema field.

---

## 7. Metrics Log *(append per Sprint Review)*

| Date | Server | Scenarios | Baseline hit rate | Optimized hit rate | Δ | Cost |
|------|--------|-----------|-------------------|--------------------|---|------|
| 2026-07-13 | @modelcontextprotocol/server-filesystem | 18 × N=5 | 94.4% | 96.7% | +2.2 pts | ~$0 (Fireworks credits; pricing untracked) |
| 2026-07-13 | @modelcontextprotocol/server-filesystem (Haiku 4.5 + Sonnet 5, canonical stack) | 18 × N=5 | 94.4% | 94.4% | +0.0 pts | ~$1.95 |
| 2026-07-13 | @modelcontextprotocol/server-memory | 11 × N=5 | 80.0% | 100.0% | +20.0 pts | $0.37 |
| 2026-07-13 | mcp-server-git | 12 × N=5 | 100.0% | 100.0% | +0.0 pts | $0.55 |
| 2026-07-13 | mcp-server-sqlite | 10 × N=5 | 100.0% | 100.0% | +0.0 pts | $0.27 |

**2026-07-13 B2 sweep (strict success, the ratified headline; agent gpt-oss-120b, rewriter kimi-k2p6, ≤2 rounds):** memory 61.8% → 96.4% (**+34.5**, converged); git 75.0% → 96.7% (**+21.7**, r2 regression discarded); sqlite 34.0% → 100.0% (**+66.0**, all-passing). With filesystem: 4 servers, 51 scenarios, every server improved, no regression ever kept. Failure archetypes covered: wrong-tool confusion (memory), extra-call padding (git, sqlite), deprecated-alias trap (filesystem).

**2026-07-13 Haiku 4.5 re-validation (canonical stack, streaming fix in place):** strict success 84.4% → 86.7% (**+2.2 pts**, round 1 kept; round 2 regressed and was discarded by the B3 loop). Hit rate flat at 94.4%. Cross-model insight: Haiku's *baseline* (84.4%) ≈ gpt-oss-120b's *optimized* score — more capable agents are less sensitive to bad descriptions, so the value of optimization scales inversely with agent quality. Both models improved, no regression ever shipped. Best Haiku overrides: `results/2026-07-13T01-55-41-filesystem-overrides-r1.json`.

**2026-07-13 detail (agent: gpt-oss-120b on Fireworks — NOT Haiku, see caveat):** strict success 74.4% → 84.4% (**+10.0 pts**), extra-call rate 25.6% → 15.6% (−10.0 pts), arg correctness 100% → 100%. Hit rate was ceiling-limited: baseline already 94.4%, max possible Δ was +5.6 pts. The one wrong-tool scenario (compare-two-configs) went 0% → 40% hit. Caveat: run on an open model because both Anthropic accounts had no credit; re-validate on Haiku 4.5 before publishing. Full data: `results/2026-07-12T14-*`.

---

## 8. Retrospective Log

*(3 bullets per sprint: keep / change / try)*

**Sprint 1 (2026-07-13):**
- **Keep:** fixture-server + scripted-model integration tests — the whole pipeline was verified before spending a single API token; the only live failure (rewriter max_tokens truncation) was found and fixed in one iteration because baseline results were reusable via `--baseline`.
- **Change:** the decision-gate metric. Raw hit rate saturates on capable models (baseline 94.4% left max +5.6 pts of headroom); strict success (hit + args + no extra calls) is the honest headline — it moved exactly +10.0 pts. PO must ratify re-framing the gate before Epic B.
- **Try:** scenario suites deliberately built for headroom (more confusable-cluster prompts like compare-two-configs, which went 0%→40%), and a weaker/cheaper agent model as the default measurement target.

---

## 9. Working Agreements for Claude Code

1. **Session start:** read §5–6 and §10 (installed skills), give a one-paragraph Daily Scrum summary, confirm which story you're picking up. One story at a time.
2. **Ask before:** adding dependencies, changing the scenario schema, or any change that invalidates prior `results/` data.
3. **Never fabricate results.** If a run fails or data is missing, say so — this project's entire credibility is measured data.
4. **Tests first for `metrics/` and `scenarios/`** (pure logic); harness/optimizer may be integration-tested against a fixture MCP server in `test/fixtures/`.
5. **Keep API costs visible:** print estimated cost after every measured run.
6. **Session end:** update §6, commit with conventional message, note anything for the next Daily Scrum.

---

## 10. Skills

Only skills that earn their place are installed. Do not add others without PO approval.

| Skill | Source | When Claude Code must use it |
|---|---|---|
| **graphify** | [Graphify-Labs/graphify](https://github.com/Graphify-Labs/graphify) | Before writing scenarios for any new target MCP server: run `/graphify <repo-url>` on the server's repo and query the graph to find its tools, overlapping functionality, and confusable naming — this is how we pick which tools to test. Also re-run with `--update` on our own repo when the codebase grows past trivial size. |
| **mcp-builder** | [anthropics/skills](https://github.com/anthropics/skills) → `skills/mcp-builder` | Any work touching the MCP protocol: the harness's MCP client (A2), the fixture server in `test/fixtures/`, and the tools/list rewrite proxy (B1). It also encodes what makes tool descriptions good for LLMs — read it before writing the optimizer's rewrite prompt (A4), since description quality is literally our product domain. |
| **claude-api** | [anthropics/skills](https://github.com/anthropics/skills) → `skills/claude-api` | Any code using `@anthropic-ai/sdk`: the agent loop, tool-use handling, token counting, model selection, and cost estimation (A2, A4, B4). Never answer model/pricing/param questions from memory — read this first. |
| **test-driven-development** | [obra/superpowers](https://github.com/obra/superpowers) → `skills/test-driven-development` | Implementing `metrics/` and `scenarios/` (working agreement #4): red → green → refactor. |
| **systematic-debugging** | [obra/superpowers](https://github.com/obra/superpowers) → `skills/systematic-debugging` | Any harness flakiness, nondeterministic failures, or MCP transport issues. Do not guess-and-patch. |
| **verification-before-completion** | [obra/superpowers](https://github.com/obra/superpowers) → `skills/verification-before-completion` | Before marking any story Done and before recording any number in §7. Enforces working agreement #3: never fabricate results. |

**Deferred until Sprint 4 (Epic C):** `frontend-design` from anthropics/skills — install only when starting the landing page (C3). Not before.

### Install

```bash
# graphify (registers its own skill with Claude Code)
uv tool install graphifyy && graphify install

# project-level skills → .claude/skills/
mkdir -p .claude/skills && cd /tmp
git clone --depth 1 https://github.com/anthropics/skills.git
git clone --depth 1 https://github.com/obra/superpowers.git
cd - > /dev/null
cp -r /tmp/skills/skills/mcp-builder .claude/skills/
cp -r /tmp/skills/skills/claude-api .claude/skills/
cp -r /tmp/superpowers/skills/test-driven-development .claude/skills/
cp -r /tmp/superpowers/skills/systematic-debugging .claude/skills/
cp -r /tmp/superpowers/skills/verification-before-completion .claude/skills/
```

Commit `.claude/skills/` to the repo so every session (and any machine) has them.
