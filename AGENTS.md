# Coding-agent workflow

## ProjectAtlas — repository intelligence

ProjectAtlas is the preferred navigation layer for coding-agent work in this repository.

1. If `atlas_*` MCP tools are available, start a code task with one `atlas_session_brief` using the task as `query` and `compact: true`. If this checkout is not indexed yet, run `atlas_init` first.
2. Refresh with `atlas_watch_once` or `atlas_scan` only when the index may be stale after edits; do not rescan by habit.
3. Follow the selectors and typed next call returned by ProjectAtlas. Read the smallest exact source slice needed instead of broadly opening files.
4. Use broad repository search/read only when Atlas is unavailable or its focused result is insufficient.
5. For structural cleanup or refactors, use `atlas_health` and `atlas_lint` before considering the task complete.
6. `.projectatlas/` is checkout-local runtime state (database, generated MCP configs and telemetry) and must never be committed.
7. ProjectAtlas is an accelerator, not a blocker: if it is unavailable, continue with normal repository tools.
