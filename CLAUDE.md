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

### EPIC A — Proof of Concept *(Sprint 1 — decision gate)*
- [ ] **A1 (3)** Scenario schema + loader: YAML with `prompt`, `expected_tool`, `expected_args` (partial match), `max_calls`; zod-validated with helpful errors
- [ ] **A2 (5)** Measurement harness: spawn target MCP server, run agent loop via Anthropic API with server's tools, capture actual tool calls, N-run sampling
- [ ] **A3 (2)** Metrics: hit rate, argument correctness, extra-call rate per scenario + aggregate
- [ ] **A4 (5)** Optimizer v0: feed failing scenarios + current tool descriptions to Claude → diagnosis + rewritten descriptions → patch server tool list (in-memory override) → re-measure
- [ ] **A5 (2)** Pick 1 popular open-source MCP server (overlapping/confusable tools preferred); write 15–20 scenarios for it
- [ ] **A6 (1)** Baseline vs optimized report (markdown table, per-scenario diff)

### EPIC B — Repeatability & Dataset *(Sprints 2–3)*
- [ ] **B1 (3)** Description override without forking target server (proxy layer that rewrites `tools/list` responses)
- [ ] **B2 (5)** Run pipeline against 5–10 popular servers; commit all results
- [ ] **B3 (3)** Multi-round optimization with convergence/termination criteria
- [ ] **B4 (2)** Cost tracking + budget guard per optimization run

### EPIC C — Public Release *(Sprint 4)*
- [ ] **C1 (3)** Polish CLI: `npx hitrate measure ./scenarios`, `npx hitrate optimize`, good `--help`, pretty terminal output
- [ ] **C2 (2)** README with quickstart GIF, results table, honest limitations
- [ ] **C3 (3)** Landing page (your design skills = our unfair advantage)
- [ ] **C4 (2)** Launch post draft: "I rewrote the tool descriptions of 10 popular MCP servers — before/after hit rates"
- [ ] **C5 (2)** PRs to 2–3 measured servers with eval data attached

### EPIC D — Post-signal (do NOT start before real users)
- Model-matrix runs (GPT/Gemini agents), hosted runs, GitHub Action, historical dashboards

---

## 5. Current Sprint

**Sprint 1 — Goal:** *Answer the kill question: can rewriting descriptions alone lift hit rate ≥10 points on one real MCP server?*

**Committed:** A5 → A1 → A2 → A3 → A4 → A6 (18 pts)

**Decision gate at Sprint Review:**
- Delta ≥ +10 pts → proceed to Epic B
- Delta < +10 pts → retro, one pivot attempt on methodology, else kill and document findings publicly (the write-up still has portfolio value)

---

## 6. Sprint Board *(Claude: update this every session)*

| ID | Story | Status | Notes |
|----|-------|--------|-------|
| A5 | Target server + scenarios | Done | `@modelcontextprotocol/server-filesystem`, 18 scenarios + `setup-sandbox.sh` fixture reset |
| A1 | Scenario schema | Done | zod strict, kebab-case ids, partial-match args |
| A2 | Harness | Done | `McpTarget` + manual tool-use loop + N-run runner + budget guard; integration-tested vs fixture server with a scripted model client |
| A3 | Metrics | Done | hit rate / arg correctness / extra-call rate / strict success |
| A4 | Optimizer v0 | Done (code) | Sonnet 5 rewriter, forced structured output, hallucinated tool names dropped; **live E2E not yet run — blocked on API key** |
| A6 | Report | Done | markdown before/after diff, headline hit-rate delta; `hitrate report <a.json> <b.json>` |

**Blocked/decisions needed:**
- `ANTHROPIC_API_KEY` is not set on this machine (no `ant` CLI either). The Sprint-Review baseline/optimize run — the §7 numbers and the decision gate — is blocked on it. Everything else is verified by 40 green tests + typecheck. When the key is available:
  ```bash
  export ANTHROPIC_API_KEY=...
  npx tsx src/cli.ts optimize scenarios/filesystem/filesystem.yaml \
    --setup 'sh scenarios/filesystem/setup-sandbox.sh'
  ```
- PO to ratify: sandbox reset is a CLI flag (`--setup <cmd>`), not a scenario-schema field — chosen to avoid changing the schema without approval (working agreement #2).

---

## 7. Metrics Log *(append per Sprint Review)*

| Date | Server | Scenarios | Baseline hit rate | Optimized hit rate | Δ | Cost |
|------|--------|-----------|-------------------|--------------------|---|------|
| — | — | — | — | — | — | — |

---

## 8. Retrospective Log

*(3 bullets per sprint: keep / change / try)*

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
