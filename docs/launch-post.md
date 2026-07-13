# I let an LLM rewrite the tool descriptions of 4 popular MCP servers. Here's the before/after data.

*(Draft — v1, 2026-07-13. Target: personal blog + HN/lobste.rs + r/mcp. Numbers are final; tone pass pending.)*

Agents don't read your server's code. They pick tools using three strings: the tool's **name**, its **description**, and its **parameter schema**. That's the entire interface. If two descriptions overlap, the agent guesses. If a description doesn't say "this creates parent directories too," the agent calls it four times. Every one of those mistakes looks like *your server being flaky*.

I built [Toolmetry](https://github.com/sujugithub/toolmetry) to answer a simple question: **if you change nothing but the descriptions, how much better do agents get?**

## The method

- Write 10–18 realistic scenarios per server (a prompt + the tool a well-designed server should elicit + expected args).
- Run each scenario **5 times** against the live server with a real agent loop; record every actual tool call.
- Score three things: **hit rate** (right tool?), **arg correctness**, and **extra calls** (did it pad the task with unnecessary calls?). "Strict success" = all three at once.
- Feed the failures + current descriptions to an LLM rewriter. Apply the rewritten descriptions **in-memory** — the server is never modified.
- Re-measure. Keep the rewrite only if it measurably improved. Discard regressions.

Agent: `gpt-oss-120b` (a deliberately mid-tier agent — more on why below). Rewriter: Kimi K2. Total API spend for everything in this post: **about $4**.

## The results

| server | strict success | Δ |
|---|---|---|
| official sqlite server | 34.0% → **100%** | +66.0 |
| official memory server | 61.8% → **96.4%** | +34.5 |
| official git server | 75.0% → **96.7%** | +21.7 |
| official filesystem server | 74.4% → **84.4%** | +10.0 |

Three different failure archetypes showed up, and description rewrites fixed all three:

**1. Wrong-tool confusion (memory server).** The knowledge-graph memory server has `create_entities`, `add_observations`, `search_nodes`, `open_nodes` — and the baseline agent confused them 20% of the time. The rewriter added explicit "use X instead when…" cross-references. Hit rate went **80% → 100%**.

**2. Ritual extra calls (sqlite, git).** The sqlite agent called `list_tables` + `describe_table` before *two-thirds* of queries — even "how many users are there?". One added sentence ("Do not call this merely to check that a table exists before querying it") took the extra-call rate from 66% to zero. Strict success: **34% → 100%**.

**3. Deprecated-alias traps (filesystem).** The filesystem server ships a deprecated `read_file` whose description still reads like the primary tool. Agents kept walking into it. The fix: make the deprecation the *first word* and name the replacement.

## The part that surprised me

I ran the same optimization with **Claude Haiku 4.5** as the agent instead. Its *baseline* (84.4%) roughly equaled the mid-tier model's *optimized* score — and optimization only moved it +2.2 pts.

**Better agents route around your bad descriptions. Weaker agents can't.** Which means description quality is a tax on exactly the agents people deploy for high-volume work — the cheap, fast ones. If your MCP server is "flaky with cheap models," this might be why, and it's fixable for under a dollar.

The other honest finding: **LLM rewrites are high-variance.** Two independent rewrite attempts on the same baseline scored +10.0 and −2.2 points. You cannot one-shot this — you have to measure, and you have to be willing to throw a rewrite away. (Toolmetry's loop does this automatically; it discarded regressions twice during these runs.)

## Ship it without forking

The rewritten descriptions live in a JSON file. `toolmetry proxy` wraps any MCP server and rewrites its `tools/list` responses on the fly:

```bash
npx toolmetry proxy --overrides best.json -- uvx mcp-server-sqlite --db-path ./my.db
```

Point your MCP client at that instead of the server. No fork, no patch, reversible in one line.

## Caveats, because data without caveats is marketing

- N=5 per scenario quantizes rates to 20-pt steps; trust the aggregates, not individual scenario deltas.
- Scenarios encode ground truth; a debatable `expected_tool` makes a debatable metric. All 51 scenarios are in the repo — judge them yourself.
- Deltas are agent-specific (see the Haiku result). Measure with the agent tier you actually serve.
- Some failures are tool-*design* problems no description can fix. The per-scenario report shows you which.

All code, scenarios, per-run results, and the winning description diffs: [github.com/sujugithub/toolmetry](https://github.com/sujugithub/toolmetry). I'd love PRs with scenario suites for your favorite server — and if you maintain one of the measured servers, the description diffs are yours for the taking.
