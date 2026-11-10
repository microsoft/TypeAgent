# modular: the interface-first method

This directory is an experiment in an interface-first way of building
software with agents. A human and a design agent agree on interfaces whose
rules are exact enough to test. Fresh agents then implement them, and the
contracts, scenarios and adversaries check the result. The circles app is
the worked example: shapes, a view, layout and event distribution, and the
app's behavior as scenarios.

Where things stand now, and what has been deferred, is in `STATE.md`.

## Goals

- **Shared understanding.** The human and the agents agree on the
  architecture through interfaces whose rules are exact enough to test.
- **Interchangeable parts.** Each interface can have several
  implementations, each passing the same contracts.
- **A general tool.** The procedure and its tooling (`task.ts`,
  `adversaries.ts`, `catalog.ts`) should work for projects other than this
  one.

## The method

- `method.md` is the procedure in brief: phase 1 (agree), 1b (challenge),
  2 (generate), platform subsets, scenarios and tasks.
- `moduleTooling.md` is the full version: roles, files, commands, the rule
  format, each phase step by step, and why the procedure looks like this.
- `impl-specs.md` holds the implementation tasks by round, with their
  Outputs, Imports, Binds and Hidden fields.
- `observer-tables.md` holds the observer tables for the stateful interfaces.

Read `method.md` first, then the parts of `moduleTooling.md` that the task
needs.

## Constraints

- **Enforce, don't only specify.** Every restriction on an agent or an
  implementation gets a mechanical check, so the system's information flow
  can be reasoned about. Examples: `task.ts` makes read-only, hashed
  workspaces and lints the outputs; Hidden fields stop a task from reading
  its own reference part; test doubles stop an implementation from using
  platform members outside the platform subset. When you add a rule for
  agents, add the check that enforces it too.
- **Dependencies.** Ask before adding any dependency. Keep `.npmrc` as it
  is: install scripts off, releases at least 30 days old, exact versions,
  no git dependencies. Implementations import no npm packages and no Node
  built-ins; scripts may use Node built-ins.
- **Phases are the human's call.** Don't start phase 1b or a phase 2 run
  without the human's go-ahead. Phase 1 decisions are made with the human,
  not by the design agent alone.
- **Design agents don't write implementations.** In phase 1 the design
  agent writes interfaces, rules, vocabulary, contracts, test doubles,
  reference parts, scenarios and adversaries. Implementations come from
  fresh phase 2 agents.
- **Every adversary is a real fault.** If an adversary escapes, decide
  whether the fault is real. If it is, strengthen the test, often with a
  focused property for a boundary the random generators rarely reach. If it
  isn't, remove the adversary and record why.

## Conventions

- **Runtime.** Node 26 runs `.ts` files directly; there is no build step.
  TypeScript 7 with `erasableSyntaxOnly`, so no parameter properties, enums
  or namespaces: declare fields explicitly.
- **Package manager.** This directory uses npm and its own `package.json`
  and `.npmrc`, not the monorepo's pnpm setup. Commands are in
  `moduleTooling.md` under "Commands": `npm test`, `npm run typecheck`,
  `npm run adversaries`, `npm run catalog`, `npm run task`.
- **Formatting.** LF line endings. The human's files (`geometry.ts`,
  `shape.ts`, `color.ts`) use 4-space indentation; the rest use 2. Match
  the file you're editing.
- **Rules.** `@requires`, `@ensures`, `@invariant`, `@valid`, `@abstract`,
  `@budget` or `@deferred`, each with a slug and a headline. `rules.ts`
  says what each tag means; there is no tag for an untested rule. A
  rule's ID is `Interface.member.slug`, and the test that checks it
  has that ID as its name.
- **Files by role.**
  - Interfaces: `<name>.ts`.
  - Vocabulary: `<name>.vocab.ts`, one per interface file.
  - Contracts: `<name>.contract.ts`.
  - Test doubles and reference parts: `*kit.ts`, one reference part per
    file.
  - Wiring: `<impl>.test.ts`.
  - Platform subsets: `canvas.ts` and `dom.ts`, checked against the real
    platform types in `platform/`.
- **Adversaries.** `adversaries/<RuleID>--<variant>.adversary.ts`. Each is
  caught or escapes. Shared adversary code lives in `adversaries/_*.ts`.
  Check new adversaries on seeds 1–3 (`FC_SEED`).
- **Writing.** Doc comments and markdown use plain, direct sentences.
  Headers on implementations follow the header rules in `impl-specs.md`.
