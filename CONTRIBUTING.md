# Contributing to Orkes Watcher

Thanks for your interest in Orkes Watcher. The project is early: right now this repo holds
the product design and architecture direction, with implementation about to start. This
document will grow as the codebase does — for now it covers how to propose and discuss
changes.

## Where things stand

There's no application code yet (backend, frontend, or SDK — the SDK lives in its own
repo). If you're looking to contribute code, the most useful thing right now is opening an
issue or discussion before writing anything, so effort isn't spent on something that
doesn't fit the current direction.

## Reporting bugs / requesting features

Open a GitHub issue. Include:

- What you expected vs. what happened (for a bug)
- Steps to reproduce, if applicable
- For a feature request: the problem it solves, not just the solution

## Proposing a change

1. Open an issue or discussion first for anything non-trivial (new feature, architectural
   change, new dependency) — this avoids duplicated or wasted work.
2. Fork the repo and create a branch off `dev` (`dev` is the integration branch;
   `main` tracks releases).
3. Keep pull requests focused — one logical change per PR.
4. Write a clear PR description: what changed and why, not just what.
5. Once automated checks and CI exist, PRs will need to pass them before merge; until then,
   a maintainer review is the gate.

## Commit messages

Write commit messages that explain *why*, not just *what* — the diff already shows what
changed.

## Code of Conduct

This project follows the [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you're
expected to uphold it.

## Security

Do not open a public issue for a security vulnerability — see [SECURITY.md](SECURITY.md).
