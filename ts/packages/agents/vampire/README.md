# Vampire Agent

🧛 — A test agent that **deliberately collides** with other agents to exercise the dispatcher's [action collision detection](../../dispatcher/dispatcher/README.md#action-collision-detection) subsystem.

> Default-disabled. The vampire is registered in the default agent provider but its `schemaDefaultEnabled` and `actionDefaultEnabled` are both `false`, so it never loads in production sessions unless explicitly enabled.

## Why

Action collision detection turns silent winner-take-all routing into something observable and configurable. To evaluate the four resolution strategies (`first-match`, `score-rank`, `priority`, `user-clarify`) meaningfully, you need real collisions on real input. Synthetic `MatchResult` fixtures cover unit-test paths but don't exercise the full pipeline. The vampire fills that gap — toggle it on, issue a request, watch which agent the dispatcher picks under each strategy.

The handler is intentionally trivial (logs and returns a benign result), so the only signal of interest is **which agent won the resolution**.

## Action surface

Three categories, one per detection point so each collision flavor has a clean unit-of-test:

### 1. Exact action-name collisions (static + grammar-match)

| Action                | Collides with                  |
| --------------------- | ------------------------------ |
| `play`                | `player.play`, `video.play`    |
| `addItems`            | `list.addItems`                |
| `removeItems`         | `list.removeItems`             |
| `getList`             | `list.getList`                 |
| `createCalendarEvent` | `calendar.createCalendarEvent` |

Parameter shapes mirror the corresponding agent's, so the LLM-translation path also fires under collision.

### 2. Grammar-pattern collisions (runtime grammar/cache match)

`vampireSchema.agr` declares rules for phrases also covered by other agents:

- `play <target>` — collides with player's `<Play>` rule.
- `add <items> to my <list> list` — collides with `list.<AddItems>`.
- `remove <items> from my <list> list` — collides with `list.<RemoveItems>`.
- `what is on my <list> list` — collides with `list.<GetList>`.

These exercise multi-agent validated matches without requiring identical action names.

### 3. Synonym / semantic actions (fuzzy collision)

| Action    | Synonym for                     |
| --------- | ------------------------------- |
| `siphon`  | remove (`list.removeItems`)     |
| `summon`  | create (`list.createList`)      |
| `consume` | delete/clear (`list.clearList`) |
| `revive`  | start/play (`player.play`)      |

With the default `PlaceholderScorer` these produce no fuzzy hits (default-safe). Once a real `ActionEmbeddingScorer` is implemented, they should light up the fuzzy path.

## How to use

The vampire is registered in [defaultAgentProvider/data/config.json](../../defaultAgentProvider/data/config.json) and `config.all.json` but disabled by default.

To enable in a session via session settings:

```ts
session.updateSettings({
  schemas: { vampire: true },
  actions: { vampire: true },
  // Pair with collision detection enabled to actually observe the collisions:
  collision: {
    static: { detect: true, strategy: "warn" },
    grammarMatch: { detect: true, strategy: "user-clarify" },
    telemetry: { emit: true, debugLog: true },
  },
});
```

(A user-facing `@config agent vampire` CLI command works the same way once a session is loaded.)

### Smoke test sequence

1. Enable the vampire and `collision.static.detect`. On load, you should see ~5 duplicate-action-name entries in `lastStaticCollisions` (and a debug log line).
2. Enable `collision.grammarMatch.detect` with `strategy: "user-clarify"`. Issue `play yesterday by the beatles`. The dispatcher should produce a `ClarifyMultipleAgentMatches` listing both `player.play` and `vampire.play`.
3. Toggle the strategy through `first-match`, `score-rank`, and `priority` for the same input. Inspect `context.collisionEvents` — each strategy produces a distinguishable choice.
4. Enable `collision.fuzzy.detect` with `scorer: "placeholder"`. No collisions reported (placeholder returns 0 — wiring is inert until a real scorer lands).

## Action handler

[`vampireActionHandler.ts`](src/vampireActionHandler.ts) is deliberately a no-op: it logs the action that fired (`[vampire] fired: <schema>.<action> parameters=…`) and returns a text result. Don't add real logic here — the vampire's value is as a stunt double, not a working agent.

## Out of scope

- Persistent state, real action effects, NLP cleverness.
- Production users will never see the vampire; if it ever ends up enabled by default, that's a regression.

## TODOs

- **Per-category masking config** — the plan called for a `vampire` block in `DispatcherConfig` (e.g. `{ category: "exactName" | "grammar" | "semantic" | "all" }`) so a test scenario could isolate one collision flavor at a time without rebuilding the agent. Not yet wired; currently the agent exposes all three categories whenever it's enabled.
- **Integration spec** — `collisionVampireIntegration.spec.ts` (load vampire alongside the standard agent set, assert each strategy picks the expected winner). Not yet added; current unit tests cover the resolver in isolation. Add once a test harness can spin up an `AppAgentManager` with multiple providers cheaply.
- **Synonym actions remain inert** until `ActionEmbeddingScorer` is implemented. They're scaffolded so the fuzzy path has something real to score against the moment a real scorer is wired up.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft trademarks or logos is subject to and must follow [Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general). Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship. Any use of third-party trademarks or logos are subject to those third-party's policies.
