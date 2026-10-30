# orkes trace contract

**Contract version: 1.0** · Status: agreed 2026-10-26 · Last change: 2026-10-30 (§2.6 `final_state`)

How an [orkes](https://github.com/hfahrudin/orkes) graph sends its run traces to Orkes Watcher:
what a sender sends, when, and how the watcher answers.

- **orkes is the master; the watcher follows.** Field names, units and status strings are
  orkes's own (snake_case, seconds, `FINISHED` / `FAILED`). The watcher doesn't rename them.
- orkes's `WatcherSink` is the reference sender. Anything else that sends this format (another
  SDK, a script) is treated the same way.
- Changes follow the bump rules in §2.8. Every change is listed in §5.

Contents: [1. Sender behaviour](#1-sender-behaviour) ·
[2. Wire format](#2-wire-format) ·
[3. How the watcher reads it](#3-how-the-watcher-reads-it) ·
[4. Testing a sender](#4-testing-a-sender) ·
[5. Changes](#5-changes)

---

## 1. Sender behaviour

### 1.1 `WatcherSink`

- **Constructor:** `WatcherSink(api_key, base_url, redact=None)`. `base_url` is the watcher
  **backend's** address (default deploy: `http://<host>:8000`), not the dashboard's (`:8080`).
  The dashboard's web server does not forward API calls.
- **Non-blocking:** `on_run_start` / `on_edge` only add to an in-memory queue; one background
  thread per sink instance does the HTTP. Queue limit 10 000 events; when it's full, new
  events are dropped and one `WARNING` is logged per run.
- **Several runs at once:** one sink instance may serve many graphs and threads in parallel.
  It groups queued events by `run_id` and never mixes runs in one request.
- **Flush on run end:** `on_run_end` waits for that run's queue to finish sending,
  **up to 3 seconds**, then returns, so short scripts don't exit before `run_end` is sent. An
  `atexit` handler gives any remaining queue one last flush (also capped at 3 s). This is the
  only place the sink may delay the caller. Under `arun()`, orkes calls `on_run_end` via
  `asyncio.to_thread` so the wait never blocks the event loop.
- **Size limits:** before queuing, any single field larger than 256 KB once serialized
  (typically `state_snapshot`, `final_state`, `return_value`, LLM `messages`) is replaced with
  `{"_truncated": true, "size": <bytes>}`. Batches are split so no request body exceeds 5 MB.
- **JSON-safe values:** non-JSON objects are sent as strings, `NaN` / `Infinity` as `null`, and
  anything nested deeper than 64 levels becomes a `_truncated` marker (see §2.1).
- **Redaction:** if `redact` is set, it's called as `redact(event: dict) -> dict` on each
  event and on the node list before queuing; whatever it returns is what gets sent. Off by
  default: **state, prompts and LLM replies are sent verbatim unless redacted.** (orkes doesn't
  put LLM API keys or request headers into traces.)
- **Turning itself off:** after a `400` (unsupported version), `401` or `403`, the sink logs
  one `WARNING` and sends nothing more for the rest of the process.

Known limitations in 1.0: edges are sent only after their node finishes (no "in progress"
step in the live view), and parallel-branch edges arrive before their parent edge (the
receiver orders by `edge_run_number`).

---

## 2. Wire format

### 2.1 Transport

| Item | Value |
|---|---|
| Endpoint | `POST {base_url}/ingest/events`, where `base_url` is the watcher backend (§1.1) |
| Auth | `Authorization: Bearer <project ingest key>` (key scope must be `ingest`) |
| Body | JSON, UTF-8, snake_case keys |
| Limits | At most 5000 events **and** 5 MB per request; at most 256 KB per field (§1.1) |
| Delivery | At-most-once: no retries, no deduplication, no offline queue |
| Units | Time in **seconds (float)**; timestamps are **Unix seconds (float)** |
| Numbers | Finite only: `NaN` / `Infinity` anywhere in the body (even inside `state_snapshot`) gets `422`. Durations (`elapsed`, `node_elapsed`, `elapsed_time`) must be 0 to 1 year; timestamps (`started_at`, `start_time`) between 1970 and 2100 |
| Nesting | At most 64 levels of JSON nesting, counted from the envelope (`422` otherwise) |

### 2.2 Run lifecycle

```
on_run_start  ──►  batch 1: envelope + nodes, events: []      → run shows as "running"
on_edge (×N)  ──►  batch 2..k: envelope + edge events          → live view updates
on_run_end    ──►  last batch: remaining edges + one run_end   → run finalized
```

- The sink sends whenever it has 50 events queued for a run or 0.5 s have passed, whichever
  comes first (a sink detail, adjustable).
- Exactly **one** `run_end` per run, and it's the last event sent. Anything after it gets `409`.
- **Any batch can be lost**, including the first one. Whichever batch the watcher receives
  first creates the run. The watcher stores `nodes` / `graph_description` from the first batch
  that contains them; if none ever does, the run still works and the inspector uses node names
  seen in edges.
- **Abandoned runs:** if no event arrives for a `running` run for **30 minutes** (a
  per-project setting), the watcher marks it `failed` with
  `error = "abandoned: no run_end received"`. A `run_end` that arrives later gets `409`.
- **Run times come from the sender's clock** (`start_time`, `elapsed_time` in `run_end`).
  Until `run_end` arrives (or for an abandoned run), the watcher uses the time it first saw
  the run.

### 2.3 Envelope (every request)

| Field | Type | Required | Notes |
|---|---|---|---|
| `contract_version` | string `"MAJOR.MINOR"` | yes | Version of this contract the sender follows (§2.8). Currently `"1.0"` |
| `sdk` | `{ "name": "orkes", "version": "0.1.4" }` | yes | Sending package and its version, stored on the run for debugging |
| `run_id` | string (UUID4) | yes | Unique per `run()` / `arun()` call |
| `graph_name` | string | yes | `TracesSchema.graph_name` |
| `graph_description` | string \| null | sent in the first batch | Watcher keeps the first value it receives |
| `nodes` | `Node[]` | sent in the first batch | Every node in the graph definition, visited or not. Watcher keeps the first list it receives |
| `events` | `(EdgeEvent \| RunEndEvent)[]` | yes | May be empty |

### 2.4 `Node` (from `NodeTrace`)

| Field | Type | Notes |
|---|---|---|
| `node_id` | string | Random per graph build: **not stable across processes** |
| `node_name` | string | Stable identity; the watcher keys stats on it. Start and end nodes are `"START"` / `"END"` |
| `node_description` | string \| null | Docstring of the node function |
| `meta` | object | e.g. `{"type": "function_node"}`; values not a fixed set |

### 2.5 `EdgeEvent` = `EdgeTrace` + `kind`

| Field | Type | Notes |
|---|---|---|
| `kind` | `"edge"` | Added by the sink |
| `edge_id` | string | Same value on every traversal of that structural edge. A repeat within a run counts as a loop |
| `edge_run_number` | int | **Starts at 1**, unique within a run, increases per traversal. **The ordering key.** The receiver must not assume there are no gaps (lost batches) |
| `from_node` | string | Source node name |
| `to_node` | string \| string[] | List for `__parallel__` edges. `"N/A"` means no destination was chosen (e.g. the run failed before a conditional's gate picked a branch) and must not be drawn as a node |
| `edge_type` | string | `__forward__` / `__conditional__` / `__parallel__` (more may be added) |
| `passes_left` | int | Always present; not by itself a loop signal |
| `started_at` | float \| null | When the edge started (Unix seconds, same clock as `start_time`) |
| `elapsed` | float | Seconds: source node run time (+ gate for conditional, + all branches for parallel) |
| `node_elapsed` | float \| null | Seconds spent in the source node's function only (excludes the gate and parallel branches). **What node timing stats use.** `null` only if the node never finished (failure) |
| `state_snapshot` | object | State **before** the source node ran (deep copy). May be a `_truncated` marker |
| `meta` | object | Passed through |
| `function_traces` | object[] | `FunctionTraceSchema` as-is, passed through |
| `llm_traces` | object[] | `LLMTraceSchema` as-is, passed through |

Any field may be replaced by `{"_truncated": true, "size": <bytes>}` (§1.1). The receiver shows
it as "truncated (N KB)" and never fails on it.

### 2.6 `RunEndEvent`

| Field | Type | Notes |
|---|---|---|
| `kind` | `"run_end"` | |
| `status` | `"FINISHED"` \| `"FAILED"` | orkes's own strings |
| `start_time` | float | `TracesSchema.start_time` |
| `elapsed_time` | float | `TracesSchema.elapsed_time` |
| `error` | string \| null | `"<ExceptionType>: <message>"`, then a newline and the traceback, the whole string capped at 8 KB (traceback cut from the top). `null` when `FINISHED` |
| `failed_node` | string \| null | Source node of the edge in progress when the exception was raised, **even if the failure was in a conditional's gate function** (`error` says what actually failed). `null` when `FINISHED` |
| `final_state` | object \| null \| `_truncated` marker | Graph state when the run ended: the output (what `run()` / `arun()` returned) for `FINISHED`, the state at the failure for `FAILED`. **Optional:** missing from older SDKs. Passed through `redact` and the 256 KB limit like `state_snapshot` |

`final_state` was added within 1.0 (§5). A watcher that doesn't know it ignores it; one that
does shows "Not recorded" when it's missing (older SDK) or the run was abandoned (no `run_end`).

Example:

```json
{
  "kind": "run_end",
  "status": "FINISHED",
  "start_time": 1793318979.82,
  "elapsed_time": 0.00019,
  "error": null,
  "failed_node": null,
  "final_state": {"n": 2}
}
```

### 2.7 Responses (how the sink handles each)

| Code | Meaning | Sink action |
|---|---|---|
| `202` | Accepted | — |
| `400` + `{"error": "unsupported_contract_version", "supported": ["1"]}` | Watcher doesn't support this contract major | Log `WARNING` once, turn off for the rest of the process |
| `401` / `403` | Bad, revoked or wrong-scope key | Log `WARNING` once, turn off for the rest of the process |
| `409` | Run already finalized (or marked abandoned), or the `run_id` belongs to a different project | Log `WARNING`, drop |
| `413` | Request over 5 MB | Log `WARNING`, drop (means the sink's batch splitting has a bug) |
| `422` | Body doesn't match the contract | Log `WARNING` with the response body, drop |
| `5xx` / network error | Watcher unavailable | Log `WARNING`, drop (no retry) |

### 2.8 Versioning

Three separate versions. Only the **contract version** decides compatibility; the two package
versions just record which releases implement which contract.

| Version | Owner | Format | Where it's visible |
|---|---|---|---|
| Contract | this doc | `MAJOR.MINOR`, starts at `1.0` | `contract_version` in every request; `GET /version` on the watcher |
| orkes | orkes repo | PEP 440, can have 4 parts; git tag `v` + version (e.g. `v0.1.4`) | `sdk.version` in every request |
| watcher | this repo | SemVer `X.Y.Z`, backend + frontend share one number; git tag `vX.Y.Z` (one release per push to `main`) | `GET /version`; shown in the dashboard sidebar |

**Contract bump rules**
- **MINOR** (`1.0` → `1.1`): additions only, such as a new event `kind` or a new field the
  watcher relies on. Older watchers still accept it: unknown fields and kinds are stored and
  forwarded, just not used. A newer watcher must still accept older minors.
- **Optional field within the same version:** a field the receiver may treat as missing
  (like `final_state`) can be added without a bump, as long as it's listed in §5.
- **MAJOR** (`1.x` → `2.0`): anything that breaks: renaming or removing a field, changing a
  type, unit, limit or lifecycle rule. Needs this doc updated first.
- A watcher release supports its **current major and the previous one** (N and N-1), so users
  can upgrade the watcher first and the SDK later.

**Watcher discovery endpoint** (no auth): `GET {base_url}/version` returns

```json
{ "watcher_version": "0.1.0", "contract": { "supported_majors": [1], "latest": "1.0" } }
```

The sink calls it once per process before its first send. If its own major isn't in
`supported_majors`, it logs one `WARNING` and turns itself off. The `400` above is the
backstop if this check is skipped.

**Compatibility matrix**

| Contract | orkes (min) | watcher (min) | Notes |
|---|---|---|---|
| `1.0` | `0.1.4` | `0.1.0` | Initial integration |
| `1.0` + `final_state` | `0.1.4.1` | `0.1.0` | Optional field; either side may be older |

---

## 3. How the watcher reads it

- **Events come back exactly as sent.** `GET /runs/:id/events` and the live WebSocket return
  trace events in snake_case with every field the sender included, known or not. (The rest of
  the dashboard API is camelCase.)
- **Only a few fields are checked**; everything else is stored and forwarded untouched:
  - envelope: `contract_version` (`"N.N"`), `sdk.name` + `sdk.version`, `run_id` (UUID), `graph_name`
  - `edge`: `edge_id`, `edge_run_number`, `from_node`, `to_node`, `elapsed` are **required**.
    `node_elapsed`, `started_at`, `passes_left`, `edge_type` are optional to the watcher, but
    node timing stats need `node_elapsed`
  - `run_end`: `status` must be exactly `FINISHED` or `FAILED`, and `run_end` must be the last
    event in its batch
  - an unknown event `kind` is stored and forwarded, not rejected
- **Visited nodes** = distinct `from_node` and `to_node` names, ignoring `"N/A"`.
- **Loops** = repeat traversals of the same `edge_id` within a run. Re-entering a node through
  a *different* edge isn't counted (accepted for 1.0).
- **Node time** = `node_elapsed`, credited to `from_node`. Edges where it's `null` are skipped,
  so parallel branches are never counted twice and conditional gates aren't counted as node time.
- **Status** `FINISHED` / `FAILED` is shown as `finished` / `failed`.
- **Run times:** `started_at` = `start_time`, `finished_at` = `start_time + elapsed_time`.
- **Final state:** `final_state` is shown on the run page as "Output" (finished) or "State at
  failure" (failed). It's returned by `GET /runs/:id` only, not by the runs list.

## 4. Testing a sender

**Run a watcher locally** (from this repo):

```bash
cp .env.example .env && docker compose up -d --build
# dashboard http://localhost:8080 (admin@orkes.local / changeme): create a project, then on
# its Keys page create a key with scope "ingest" and copy the secret (shown only once)
curl http://localhost:8000/version
```

`base_url` for the sink is `http://localhost:8000`.

A `422` response body lists exactly which field failed, which is the quickest way to debug a
payload.

**Reference client:** this repo has working senders to compare payloads against:

- [`backend/scripts/seed_example_traces.py`](../../backend/scripts/seed_example_traces.py): four
  realistic runs (parallel branch, retry loop, crash in a gate with `"N/A"`, simple), sent as
  first batch → edges → `run_end`.
- [`backend/tests/orkes_sim.py`](../../backend/tests/orkes_sim.py): `FakeWatcherSink`, the
  batching rules from §1.1 / §2.2 in about 60 lines.

**Send in batches, not one request per edge.** Every request pays for an API-key check; the
§2.2 flush rule (every 50 events or 0.5 s) keeps that cheap, and one request per edge would not.

## 5. Changes

| Date | Contract | Change |
|---|---|---|
| 2026-10-30 | 1.0 | `run_end.final_state` added (optional): the run's output, or the state at the failure (§2.6) |
| 2026-10-26 | 1.0 | First version |
