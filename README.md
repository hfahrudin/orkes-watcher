# Orkes Watcher

Orkes Watcher is an observability platform for agent graphs — it traces how a graph-based
agent actually executed: which nodes ran, which edges were traversed, how many times a loop
re-entered, and what the state snapshot looked like at each step.

Instrument a graph with the `tracer` SDK, point it at a project's ingest endpoint, and every
run becomes an inspectable trace:

```python
from orkes.watcher import tracer

tracer.init(api_key="ok_live_...", project="support-triage")

graph = build_graph()
run = tracer.run(graph, inputs)  # traced
```

## Core concepts

- **Project** — an ingest namespace (e.g. one per app or environment: production, staging,
  local). Traces sent with a project's API key land in that project.
- **Run / trace** — one execution of a graph. Identified by a run ID, with a status
  (finished, failed, running), an elapsed time, and a full record of node and edge
  traversals.
- **Graph** — the node/edge structure a run traversed: entry (`START`) and terminal (`END`)
  nodes, branches, parallel splits, and loops that can re-enter a node multiple times before
  exiting.
- **Trace inspector** — a visual graph view of a single run, where selecting a node or edge
  shows its metadata, state snapshot, and any function calls traced on that step.
- **API keys** — scoped to one project, with an ingest or read-only scope; used by the SDK
  to authenticate traces.
- **Access / roles** — Admin, Developer, and Viewer roles control who can create projects,
  manage keys, and view traces, with per-project grants for non-admins.

## Status

This repository currently holds the product design only (`design-src/`) — an HTML/CSS
mockup of the dashboard (projects, dashboard, traces, trace inspector, settings, keys,
members) built on the Nocturne design system. No application code has been implemented yet.
