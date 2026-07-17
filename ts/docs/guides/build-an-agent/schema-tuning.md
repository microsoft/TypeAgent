# Schema tuning: reliable translation across turns

Practical, evidence-backed notes on tuning agent **action schemas**, **entity
shapes**, and **grammars** so the dispatcher translates natural language into the
right action reliably — especially across multi-turn conversations. Each note
names the concrete case that motivated it.

Translation quality is measured with the live "action stability" tests in
`packages/defaultAgentProvider/test/` (each utterance is translated `repeat`
times and the distribution of resulting actions is checked, not a single
sample).

## 1. Consolidate per-type actions into a few strong, well-scoped actions

The player (music) agent originally had one action per shape — `playTrack`,
`playAlbum`, `playArtist`, `playGenre`, `playRandom`, `searchTracks`, … These
overlapped and translated unstably.

They were consolidated into **`playMusic`** and **`findMusic`**, each taking a
discriminated-union `target` (`{ kind: "track" | "artist" | "album" | "genre" |
"playlist" | "description" | "any", … }`). See
`packages/agents/player/src/agent/playerSchema.ts`.

What made the result rock-solid:

- **Directive descriptions that say when to use the action _and when not to_:**
  "Start playing music now. Use this when the user wants to play / put on /
  start / listen to music… To search for or browse music WITHOUT starting
  playback, use FindMusicAction."
- **One obvious action per intent**, so the model isn't disambiguating
  near-duplicates.

Corollary: strengthening one schema this way makes neighboring agents' weaknesses
_visible_ (a strong `playMusic` no longer masks a weak list/montage
interaction) — tune them next.

## 2. Put contained data in a **facet on the owning entity**, not floating siblings

Action results publish `entities`, and those entities flow into the **next
turn's translation prompt** — rendered under "Recent entities found in chat
history" (`packages/dispatcher/dispatcher/src/context/chatHistoryPrompt.ts`).
Their _shape_ steers the model.

**Anti-pattern** — the list agent emitted a list and its items as flat peers:

```jsonc
[ { "name": "grocery", "type": ["list"] },
  { "name": "eggs",    "type": ["item"] } ]   // nothing says eggs is IN grocery
```

On the follow-up "add cheese", the model saw a loose "eggs" entity and
**re-added it**, producing two actions — `addItems{eggs}` + `addItems{cheese}`
(history "bleed" / doubling).

**Fix** — represent the list as one entity carrying its items as a facet
(`packages/agents/list/src/listActionHandler.ts`, `getEntities`):

```jsonc
[ { "name": "grocery", "type": ["list"],
    "facets": [{ "name": "items", "value": ["eggs"] }] } ]
```

Measured effect (n=10, "add cheese"): doubling **2/10 → 0/10**. Reference
resolution also got _better_ — "don't need the potatoes" resolved "the potatoes"
→ "Mashed potatoes" **10/10** straight from the enumerated facet.

Notes:

- Emit the list's **current** contents in the facet (read back after add/remove),
  not just the items the action touched.
- Dropping standalone item entities means item _values_ are no longer
  entity-resolvable references. That was fine for list ops; weigh it per agent.
- The test-history replay command (`@history insert`) must accept the entity
  shape you emit (it now accepts `facets`).

## 3. Fight cross-agent lexical priors with negatively-scoped descriptions

"add cheese" sometimes routed to **`montage.addPhotos`** — because "cheese" ↔
"say cheese" ↔ photos, and `addPhotos` is broadly described ("add photos to the
montage"). Montage is also LLM-only (no grammar), so it is always an
LLM-selection contender.

Mitigation: make the description say when _not_ to fire —
"Add photos/images to the currently open montage. Only when a montage is open and
the user is clearly asking to add PICTURES / IMAGES. Never for adding a generic
item (e.g. 'add cheese') to a list." (`packages/agents/montage/src/agent/montageActionSchema.ts`).

## 4. Continuation cues are a double-edged sword

Cues like "too" / "as well" / "now" **anchor routing** to the right agent (they
eliminated the montage misroute) but **trigger re-adding the visible prior item**
(doubling), because the model treats the item shown in context as still in play.
"too" was a stronger doubling trigger than "as well".

The mitigation isn't the phrasing (real users say all of these) — it's
prompt/description guidance that **recent list items are context to reference,
not to re-add**, combined with note #2 so there is no loose item entity to grab.

## 5. Grammar can mask the LLM — measure with grammar OFF

Authored `.agr` grammars intercept requests before the LLM: fast and
deterministic, but they can carry bugs. Example: `listSchema.agr` `<AddItems>`
**captures the determiner** — "put cheese on the list" grammar-matches with
`listName = "the"`. With grammar **off** (same phrase via the LLM) it resolves
`listName = "grocery"` from context **10/10**.

So:

- When measuring _model_ behavior, disable grammar for the step (`skipGrammar` in
  the translate tests) so grammar interception doesn't hide it.
- A grammar bug gets a `skipGrammar` stopgap in the stability tests; fixing the
  rule lets you drop the stopgap.

## Measuring

- Run stability suites live with a `repeat` count and read the **distribution**,
  not one sample.
- Toggle grammar per step (`skipGrammar`) to separate grammar vs LLM behavior.
- Phrasing sensitivity is real. Measured "add \<item\>" follow-ups after
  "add eggs to the grocery list" (facet-only entities, LLM path, n=10):

  | Phrasing                  | clean  | montage misroute | doubling |
  | ------------------------- | ------ | ---------------- | -------- |
  | "put cheese on the list"  | 10/10  | 0                | 0        |
  | "include cheese"          | 9/10   | 0                | 0        |
  | "add cheese"              | 7/10   | 3                | 0        |
  | "put cheese as well"      | 7/10   | 2                | 1        |
  | "add cheese too"          | 6/10   | 0                | 4        |

  Takeaways: bare "add cheese" is pulled toward montage; continuation cues fix
  routing but cause doubling; the cleanest phrasings need neither crutch.
