# AGENTS.md — Vedras Reiche

## Purpose

This file contains standing instructions for Codex in this repository. Keep it compact. Do not duplicate the full game rules or restate this file in task reports.

## Source of truth

Use this precedence when information conflicts:

1. The user's current task / work package.
2. `docs/rules/Vedras Reiche.docx` for canonical game rules.
3. Explicitly documented rule decisions in `OPEN_QUESTIONS.md` and project documentation.
4. Existing tested domain behavior in `packages/game-core`.
5. UI/debug behavior in `apps/web`.

Do not invent gameplay rules, balancing values, tie-breakers, defaults, geometry semantics, or hidden-information rules.

If a required gameplay rule is genuinely ambiguous:
- search the repository for an existing decision first;
- isolate only that unresolved point in `OPEN_QUESTIONS.md`;
- continue all work that does not depend on it.

Do not edit the canonical Word rulebook unless the task explicitly requests it.

## Repository architecture

This is a TypeScript npm-workspaces project.

Important areas:

- `packages/game-core`: authoritative, headless game domain.
- `apps/web`: React/Vite visual/debug client; must remain a thin client over the core.
- `apps/server`: reserved for the future authoritative multiplayer server.
- `docs/`: architecture and rule documentation.
- `OPEN_QUESTIONS.md`: unresolved or explicitly resolved rule decisions.

The long-term architecture is:

`Client -> authoritative Server -> Game Core`

During local development, `apps/web` may call the Game Core directly. Do not mistake this development shortcut for the future multiplayer trust boundary.

## Domain rules for implementation

- Gameplay logic belongs in `packages/game-core`, not React components.
- UI code must not independently decide legality, winners, costs, bonuses, ownership, phase changes, or geometry validity.
- State changes must go through domain actions/functions.
- Invalid actions must not mutate the input state.
- Prefer pure functions and immutable state updates.
- Do not use `Math.random()` for game decisions. Use the repository's `RandomSource`.
- Use `CardSource` for card-dependent random behavior where applicable.
- `GameState.map` is the authoritative geometry when present.
- Territory area, adjacency, borders, and cell ownership must be derived from map geometry rather than maintained as competing truths.
- POIs and settlement/city features are cell-bound; their territorial ownership follows their cell after geometry changes.
- Territory-card properties remain card-bound.
- Hidden information must be removed from player-facing projections such as `createGameViewForPlayer`; never rely on CSS or client-side hiding of secret values.
- Reuse existing domain workflows and geometry/split utilities instead of creating parallel implementations.

## Dependency discipline

Keep dependencies minimal.

Before adding a production dependency:
1. verify the task cannot be solved cleanly with the current stack or platform APIs;
2. prefer small, established dependencies;
3. document the reason briefly in the final report.

Do not introduce frameworks or architectural layers merely for abstraction.

## Context-efficiency rules

Minimize unnecessary repository reading and tool use.

At the start of a task:
1. inspect `git status` / current branch if relevant;
2. inspect only files directly related to the requested subsystem;
3. use search (`rg`, targeted file search) before opening large files;
4. follow imports/references only as needed.

Do NOT:
- recursively read the whole repository by default;
- repeatedly reopen unchanged files in the same task;
- reread the full Word rulebook unless the requested rule requires it;
- regenerate broad repository summaries unless asked;
- inspect generated output, lockfiles, `dist`, or `node_modules` unless directly relevant;
- run the complete QA suite after every small edit.

For large work packages:
- identify the minimal affected modules first;
- implement in coherent local steps;
- run targeted tests while developing;
- run the full required QA once near completion;
- fix failures and rerun only the affected checks, followed by one final full pass.

Prefer extending existing fixtures/tests/helpers over creating duplicate infrastructure.

## Testing and QA

Repository-root commands:

```bash
npm run dev
npm run dev:core
npm run build
npm run typecheck
npm test
```

Current root behavior:
- `npm run dev` builds `@vedras/game-core` and starts the web client.
- `npm run dev:core` starts the core TypeScript watch mode.
- `npm run build` builds core and web.
- `npm run typecheck` checks core and web.
- `npm test` runs the Game Core tests.

During implementation:
- run the narrowest relevant test first where practical;
- do not disable or weaken tests merely to make them pass;
- preserve existing tests unless behavior intentionally changed under a documented rule/task;
- add regression tests for bugs and domain invariants.

Before declaring a substantial work package complete, run:

```bash
npm run build
npm run typecheck
npm test
```

If the task changes visible web behavior, also perform one focused browser smoke test.

Do not repeatedly run the browser manually for changes that can be verified by unit tests.

## Documentation

Update documentation only when behavior, architecture, setup, or a rule decision actually changed.

Avoid duplicating the same explanation across multiple files.

Use:
- `README.md` for current project usage and concise feature/status information;
- `docs/ARCHITECTURE.md` for architectural contracts and lifecycle descriptions;
- `OPEN_QUESTIONS.md` only for genuine rule questions or explicitly recorded rule decisions.

Do not turn `AGENTS.md` into a changelog or implementation-status document. Determine current status from the code, tests, README, and git history.

## Web client

`apps/web` is primarily a visual/debug client until multiplayer is introduced.

Requirements:
- visible UI text may be German;
- internal code/types may remain English;
- React state may contain UI-only state such as selection or open panels;
- gameplay state must remain the Game Core's responsibility;
- debug fixtures must be clearly separated from canonical rules;
- a debug scenario must not silently become a new rule.

## Map and geometry

The canonical digital board is an orthogonal grid.

When modifying map behavior:
- preserve orthogonal connectivity;
- diagonal contact alone is not adjacency;
- respect map-format minimum territory size;
- derive shared borders and neighbors from cells;
- never approximate a geometric rule using only an abstract `area` number when exact cells are available.

Use existing map/geometry utilities before writing new algorithms.

## Working style

When given a work package:
- implement it rather than rewriting the specification;
- inspect current code first because earlier work packages may already provide part of the solution;
- preserve working architecture and naming conventions;
- avoid unrelated refactors;
- do not stop for confirmation unless an external blocker makes progress impossible;
- if one isolated rule is ambiguous, document it and complete everything else.

When fixing a bug:
1. reproduce or identify the failing invariant;
2. add or adjust a focused test where appropriate;
3. fix the root cause;
4. run the relevant tests;
5. perform the final QA required by the scope.

## Completion report

Keep the final Codex report concise. Include only:

- implemented changes;
- important files/modules changed;
- tests/build/typecheck results;
- genuine open rule questions;
- remaining technical risks;
- sensible next step.

Do not repeat the full work-package prompt, repository structure, or already-known rules in the completion report.

## Maintaining this file

Update `AGENTS.md` only for instructions that should apply to many future tasks.

Do not add:
- temporary work-package requirements;
- one-off bug details;
- current task progress;
- long rule explanations already available elsewhere.

If the same mistake or correction occurs repeatedly, add one short rule here so future sessions do not need the same explanation again.
