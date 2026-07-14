# Toolmetry

> Measure how well AI agents actually use your MCP server's tools — then automatically rewrite the tool descriptions and **prove** the improvement with before/after data.

Agents choose tools using nothing but your tool **names, descriptions, and schemas**. When descriptions overlap, overpromise, or under-specify, agents pick the wrong tool, pass the wrong arguments, or pad every task with wasteful extra calls — and your server gets blamed for it.

`toolmetry` closes the loop that every eval tool leaves open: it doesn't just *detect* misuse, it *fixes* the descriptions and re-measures to prove the fix.

## Measured results

Every number below is committed to [`results/`](results/) with per-run detail (N=5 runs per scenario, agent: `gpt-oss-120b`, rewriter: `kimi-k2p6`, ≤2 optimization rounds):

| MCP server | strict success† before → after | Δ | what was wrong |
|---|---|---|---|
| [server-sqlite](https://github.com/modelcontextprotocol/servers-archived/tree/main/src/sqlite) | 34.0% → **100%** | **+66.0 pts** | agents ritually inspected schema before every query |
| [server-memory](https://github.com/modelcontextprotocol/servers/tree/main/src/memory) | 61.8% → **96.4%** | **+34.5 pts** | `create_entities` vs `add_observations` confusion; hit rate 80% → 100% |
| [mcp-server-git](https://github.com/modelcontextprotocol/servers/tree/main/src/git) | 75.0% → **96.7%** | **+21.7 pts** | perfect tool choice, but constant extra `git_status`/`git_log` padding |
| [server-filesystem](https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem) | 74.4% → **91.1%** | **+16.7 pts** | deprecated `read_file` alias trap + `list_allowed_directories` ritual; best result via `--candidates 3 --seed` |

† *strict success* = right tool **and** right arguments **and** no extra calls, averaged over N=5 runs per scenario.

The same optimization on a stronger agent (Claude Haiku 4.5) moved filesystem from 84.4% → 86.7%: **more capable agents are less hurt by bad descriptions — description quality matters most for the cheap, fast agents people actually deploy at scale.**

## Quickstart

![toolmetry measuring the official sqlite MCP server — per-scenario hit rate, extra calls, and strict success, with estimated cost](https://raw.githubusercontent.com/sujugithub/toolmetry/main/docs/quickstart.svg)

```bash
npm install && npm run build

# 1. Write scenarios for your server (see scenarios/*/ for examples)
#    Each scenario: a realistic prompt + the tool you expect + (optionally) its args.

# 2. Measure the baseline (N=5 runs per scenario)
export ANTHROPIC_API_KEY=...
npx mcp-toolmetry measure scenarios/sqlite/sqlite.yaml

# 3. Optimize: diagnose failures → rewrite descriptions → re-measure → report
npx mcp-toolmetry optimize scenarios/sqlite/sqlite.yaml --rounds 2

# 4. Ship the winning descriptions WITHOUT forking the server:
npx mcp-toolmetry proxy --overrides results/<timestamp>-overrides-r1.json \
  -- uvx mcp-server-sqlite --db-path ./my.db
# point your MCP client config at that command instead of the server itself
```

A `setup-sandbox.sh` next to a suite YAML runs automatically before every run, so mutating scenarios (writes, moves, commits) always start from a clean fixture.

### Scenario format

```yaml
suite: sqlite
server:
  command: uvx
  args: ["mcp-server-sqlite", "--db-path", "/tmp/hitrate-sqlite.db"]
scenarios:
  - id: count-rows
    prompt: How many users are in the database?
    expected_tool: read_query        # the tool a well-described server elicits
  - id: table-schema
    prompt: What columns does the users table have?
    expected_tool: describe_table
    expected_args: { table_name: users }   # partial match, nested-object aware
    # max_calls: 2                   # allow a bounded look-before-you-act
```

### Models

- Anthropic model ids (default agent `claude-haiku-4-5`, rewriter `claude-sonnet-5`) use `ANTHROPIC_API_KEY`.
- `accounts/fireworks/...` ids route to Fireworks.ai's OpenAI-compatible API via `FIREWORKS_API_KEY` — useful for open-model agents.
- Every run prints estimated cost; a hard USD budget guard (default $5) aborts runaway runs. For models without built-in pricing, pass `--price-in/--price-out` to keep the guard active.

## How it works

```
scenarios/*.yaml ──▶ harness: spawn target server over stdio, hand its tools
                     to the agent, record ACTUAL tool calls (N runs each)
                └──▶ metrics: hit rate · arg correctness · extra-call rate · strict success
                └──▶ optimizer: failing scenarios + current descriptions → LLM rewriter
                     (structured output) → in-memory description override → re-measure
                └──▶ keep-best loop: regressing rewrites are DISCARDED, never shipped
                └──▶ report: markdown before/after diff, per-scenario deltas
```

The optimizer never edits your server. Overrides live in a JSON file; `toolmetry proxy` serves them by rewriting `tools/list` responses on the fly.

## Honest limitations

- **N=5 is a floor, not statistical certainty.** Per-scenario rates quantize to 20-point steps; small deltas (< ~5 pts) are noise. Judge aggregate movement, not single scenarios.
- **Rewrites are high-variance.** Two independent rewrite attempts on the same baseline scored **+10.0** and **−2.2** points. The keep-best loop discards regressions, and `--candidates K` samples K rewrites per round, screens them on the failing scenarios, and full-measures only the winner — on filesystem this turned the +10.0 single-shot best into **+16.7** (74.4% → 91.1%, hit rate 100%). `--seed known-good.json` starts the loop from previously winning overrides.
- **Results are agent-specific.** Deltas measured on a weak agent shrink on stronger ones (see the Haiku comparison above). Measure with the agent tier you actually serve.
- **Scenarios encode the ground truth.** If your scenario's `expected_tool` is debatable, the metric is too. Keep scenarios unambiguous; use `max_calls` to allow legitimate look-before-you-act patterns.
- **Description-only lever.** Some failures live in tool *design* (overlapping capabilities, missing parameters) — no description rewrite fixes those. The report tells you which scenarios stayed broken.

## Commands

| command | what it does |
|---|---|
| `toolmetry measure <suite-or-dir>` | N-run measurement, per-scenario + aggregate metrics, saved to `results/` |
| `toolmetry optimize <suite>` | baseline → diagnose → rewrite → re-measure loop (`--rounds`), report |
| `toolmetry report <a.json> <b.json>` | markdown diff between any two saved runs |
| `toolmetry proxy --overrides <o.json> -- <server cmd…>` | serve a server with rewritten descriptions, no fork |

MIT licensed. Built with the [MCP SDK](https://github.com/modelcontextprotocol/typescript-sdk).
