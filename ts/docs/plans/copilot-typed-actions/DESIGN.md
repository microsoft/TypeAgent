<!-- Copyright (c) Microsoft Corporation.
     Licensed under the MIT License. -->

# Letting Copilot run TypeAgent actions directly

**Status:** first version built and working. The
[open questions](#open-questions-for-discussion) are genuinely open — that is
what this document is for.
**Area:** `ts/packages/copilot-plugin/` (MCP mode), with a shared helper in
`ts/packages/dispatcher/types/` also used by `ts/packages/commandExecutor/`

## In one sentence

If Copilot already knows exactly which TypeAgent action it wants to run, it can
now run it — instead of writing an English sentence and asking TypeAgent to
figure out what it meant.

## Background: the two things in play

**TypeAgent's job** is to turn human language into a typed action. You say
"play some jazz," and TypeAgent produces a structured action:
`player.playMusic({ target: { kind: "genre", genre: "jazz" } })`. It then runs
it. Translation is the valuable part, and TypeAgent is good at it.

**Copilot's plugin** lets Copilot CLI reach TypeAgent. Until now it could only
hand over English. Copilot passed along the user's words, and TypeAgent
translated them.

That works well when a human wrote the words. The problem shows up when nobody
did.

## The problem, as a story

Copilot is working through a multi-step task. It has just assembled a list of 20
songs — pulled from a file, or from the results of earlier steps. Now it wants to
save them as a playlist. It already knows precisely what it wants:

```
player.createPlaylist({
    name: "Deep Focus",
    songs: [
        { trackName: "Kind of Blue", artist: "Miles Davis" },
        { trackName: "Naima", artist: "John Coltrane" },
        ... 18 more
    ]
})
```

But the only door available took English. So Copilot had to write a sentence
describing all of it:

> "create a playlist called Deep Focus with Kind of Blue by Miles Davis, Naima by
> John Coltrane, ..."

TypeAgent then translated that sentence back into the action Copilot started
with. Two things go wrong:

1. **It costs a model call** to do a translation that was not needed. Copilot
   already had the answer.
2. **It can corrupt the data.** Twenty exact track and artist names have to
   survive being flattened into a sentence and parsed back out. Long lists,
   identifiers, and file paths are exactly the things that get dropped,
   truncated, or subtly misspelled on that round trip.

The deeper point: translation exists to interpret human intent. When there is no
human sentence — when a machine composed the step — there is nothing to
interpret. The translation step is doing no useful work, but it can still do
damage.

## What we built

Two new MCP tools, alongside the existing one.

| Tool                        | What it does                                                            |
| --------------------------- | ----------------------------------------------------------------------- |
| `typeagent-processCommand`  | **Unchanged, still the default.** Send English, TypeAgent translates it |
| `typeagent-executeAction`   | Run one action directly by name and parameters                          |
| `typeagent-discoverActions` | Look up which actions exist and what parameters they take               |

`executeAction` hands the action straight to the dispatcher, which validates it
against the schema and runs it. No translation step in the middle.

## The value

Three things, and it is worth being precise about them:

- **Fidelity.** A track list, file path, or record ID that Copilot already has
  reaches the action intact. It never gets flattened into prose and parsed back.
- **Determinism.** The same request runs the same action every time. There is no
  interpretation step that could land somewhere different.
- **Composability.** Copilot can use TypeAgent actions as steps inside a larger
  plan it is executing, which is the direction agent work is going.

### What it is _not_

**It is not faster for normal user requests, and we should not present it that
way.** This matters, because it is the obvious thing to assume.

TypeAgent remembers translations. Once it has seen "play some jazz," it
recognizes that phrase again and produces the action with **no model call at
all**. Nothing here beats that. An early version of this work claimed it avoided
"paying for translation on every request" — that was simply wrong, and the
correction is why the framing is narrower now.

So: for anything a person typed, the existing path is as fast or faster. The new
path is for the case where no person typed anything.

## When each path is used

The question is not _what the request does_. It is **where the request came
from**.

> Words a human typed → translation.
> Structure Copilot already has → direct.

| Situation                                                       | Path                     |
| --------------------------------------------------------------- | ------------------------ |
| User types "play some jazz music"                               | `processCommand`         |
| User types anything starting with `learn:`, `dev:` or `record:` | `processCommand`, always |
| Request is conversational, vague, or multi-step                 | `processCommand`         |
| User typed it, and Copilot cannot name the action               | `processCommand`         |
| Copilot planned this step itself                                | `executeAction`          |
| Copilot already knows the action and parameters                 | `executeAction`          |

### Two scenarios, side by side

**Scenario A — a person asks for something.**
The user types "tidy up my desktop and put on some focus music." This goes to
`processCommand`. A human wrote it, it covers several steps, and TypeAgent is
better at breaking it apart than Copilot guessing. If the user has said something
like this before, it resolves with no model call.

**Scenario B — Copilot composed the step.**
Copilot is six steps into a task it planned. Step four gathers a set of tracks
from earlier results and saves them as a playlist. Nobody ever said that step out
loud, and the track list came from data rather than from a sentence. This goes to
`executeAction`, carrying all twenty entries exactly as gathered.

### The mistake to avoid

The tempting wrong move is: user asks for something → Copilot looks up the action
with `discoverActions` → Copilot runs it with `executeAction`.

That is the **most expensive** option available. It spends extra Copilot turns to
avoid a translation that would likely have been free. The instructions we ship to
the model say this explicitly. Discovery is for looking up something Copilot will
use repeatedly — not for answering a sentence the user already typed.

## Cost, concretely

Copilot takes its turn either way, so _choosing_ the direct tool costs nothing
extra. Looking things up first does.

| What happens                           | Copilot turns | TypeAgent model calls |
| -------------------------------------- | ------------- | --------------------- |
| `processCommand`, phrase already known | 1             | 0                     |
| `processCommand`, new phrase           | 1             | 1                     |
| `executeAction`, action already known  | 1             | 0                     |
| `discoverActions` then `executeAction` | 2-3           | 0                     |

Note the last row is the worst one. That is why the guidance pushes against it.

Also worth knowing: when Copilot runs several actions in a row, it looks up the
contract **once** and reuses it. The lookup cost is paid per task, not per
action.

## Does this undermine TypeAgent's purpose?

A fair question, and worth addressing head-on, because "skip the translation"
sounds like "skip TypeAgent."

It is not. Two reasons.

**First, it skips translation, not execution.** The action still goes through the
dispatcher. Permission checks, multi-step action chaining, linking results to
known entities, recording to memory, cancellation, and confirmation prompts all
work exactly as they do for a normal request.

**Second, it feeds the translation cache rather than starving it.** When the
user's words do match the action one-for-one, Copilot passes those words along
too. TypeAgent learns the phrasing, so next time that sentence resolves with no
model call. The direct path makes the normal path smarter over time.

## Will this scale?

MCP has a known scaling trap: if you expose 400 capabilities as 400 tools, all
400 descriptions sit in the model's context on **every single turn**, whether
relevant or not. TypeAgent has roughly 418 actions today and is designed for far
more, so that approach would not survive.

We avoided it. **We added two tools, not one per action.** The actions live
_behind_ a tool rather than _as_ tools. Nothing about the action list is in
context until something asks for it, and that stays true at any number of
actions.

Lookup is also layered — agents, then one agent's actions, then one action's
parameters — and there is deliberately no "list everything" call.

## What is missing today

Honest list of gaps. None are blocking, all are documented in the code.

| Gap                               | What it means                                                                                                                               |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| No memory of earlier turns        | "Play it again" cannot work on the direct path — pass real values                                                                           |
| No automatic retry via reasoning  | If an action fails, the error comes back rather than being retried                                                                          |
| Cannot answer follow-up questions | If an agent asks the user to pick something, the tool reports the question instead of pretending it finished                                |
| Lookup results are not paginated  | Fine at today's size; the agent list will outgrow it before any single agent's action list does                                             |
| A new connection per call         | Each call opens and closes its own connection — already true of the existing path, but it is the main slowdown when running several actions |

We also fixed three real bugs along the way, independent of the new tools:

- Lookup could advertise actions that would then refuse to run, because it
  checked the wrong "is this enabled" flag.
- The other MCP server filtered enabled actions at the wrong level.
- The other MCP server corrupted any phrase containing an apostrophe.

## Open questions for discussion

These are the ones worth arguing about, and the reason this is a discussion
document rather than a finished decision.

1. **Is the agent-composed case common enough to justify this?**
   The whole value rests on Copilot running TypeAgent actions as steps in plans
   it made itself. If that stays rare, this is two tools of surface area for
   little return. This is the central question.

2. **Will the model follow the guidance?**
   "Prefer the English path for user requests" is written instruction, not an
   enforced rule. If the model over-uses the direct path, TypeAgent sees fewer
   phrases, learns less, and the fast path slowly gets worse. We should measure
   the ratio rather than assume.

3. **Should we cache lookups on the server?**
   It would cut latency without putting anything extra in the model's context.
   Worth doing if chained actions become common.

4. **Should the direct path get memory of earlier turns?**
   It would close the most surprising gap. But it needs an answer to "what does
   the previous turn mean when the caller is a machine, not a person?"

5. **Do we need a connection pool?**
   Only matters if chains are common — but it is the dominant cost if they are.

## Related

- `ts/packages/copilot-plugin/README.md` — the operational detail: exact routing
  rules, cost table, scaling notes.
- [Dispatcher](../../architecture/core/dispatcher.md) — the translation and
  execution pipeline this sits in front of.
- [Action grammar](../../architecture/core/actionGrammar.md) — the cache that
  makes the normal path fast.
