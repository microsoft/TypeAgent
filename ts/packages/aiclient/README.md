# aiclient

AI Client is **sample code** for calling AI endpoints and other REST services.

The library is used by and intended only for sample agents and examples in the TypeAgent project.

Supported services:

- Open AI model endpoints, both on Azure and Open AI.
- Bing

The library includes support for getting settings needed to call these services from environment variables.

## Native decisions

`createDecisionModel({ config?, provider? })` returns a `DecisionResult<DecisionModel>`
(compatible with TypeChat `Result`). Construction validates capability/configuration
without acquiring credentials or performing inference. Use `model.decide({ state,
questions }, { signal?, timeoutMs? })` for native Azure systemone or Copilot
`/v1/decisions` requests; these are not chat models.

Questions are named `noul` (optional true/false criteria), `choice` (a value-to-description
map), or `score` (ordered labels). Responses contain validated discriminated answers,
requested/reported model identity, provider, optional normalized token usage and duration.
Malformed/missing/duplicate/refused answers invalidate the response; a valid no-fit
answer remains success. Probability maps retain supplied choice values and zero-based
score indexes, never array position.
Distribution sums must equal one within `1e-6`; no labels or mass are silently
dropped or renormalized.
Every answer can carry optional native `confidence`, validated as a finite number
in `[0, 1]` independently of its probability distribution or score.
`decisionUsage?: DecisionUsage` preserves individually reported counts normalized
to `prompt_tokens`, `completion_tokens`, `total_tokens`, and `cached_tokens`.
Input-only usage remains observable there and in telemetry; missing output counts
are never replaced with zero. Existing `usage?: CompletionUsageStats` remains
available when both input/output counts are known (total is reported or their sum).

Provider precedence is factory override → `decision.provider` → active in-memory
override → supplied `config.modelProvider` → Azure. `decision.provider: inherit`
skips the explicit decision override. Inherited OpenAI/Ollama is unavailable, not
a fallback. `providerSource` explains selection. `configGeneration` and
`getRuntimeConfigGeneration()` support cache invalidation after config/provider changes.

Azure uses the `decision.azure.deploymentKey` pool (default `decision_1`) but sends
the separate exact `deploymentName` (default `decision-1`). All pool members must
use HTTPS `/providers/microsoft/v1/systemone` and serve that same deployment name.
Copilot uses `decision.copilot.model` (default `gpt-6-luna-decisions`) and the existing
model-endpoint credential helper, refreshing once on 401/403. Neither provider falls
back to chat. Both reuse REST secret redaction, request constraints and budgets;
native fixed-shape output receives a conservative reservation and shares the
inference-attempt budget. The deadline includes credentials, retries and response
decoding. Errors carry bounded `code`, `errorCategory`, `retryable`, and optional
`httpStatus`; raw provider bodies and credentials are not returned.

Live availability and tenant permission are not established by capability construction;
they can only be verified by an authorized native request.

## Multi-region endpoint pools

Chat, embedding, and image factories resolve each model into an **endpoint pool** — a list of endpoints (one per region + variant) that the client rotates among on 429 / 5xx / timeout. The goal is to survive single-region throttling without user-visible stalls, and to keep a PTU reservation preferred when one is configured.

### How an endpoint gets into a pool

Implicit Azure chat defaults select the named `GPT_6_LUNA` pool, even when
`AZURE_OPENAI_ENDPOINT` still points to a legacy model. A missing Luna deployment
fails rather than falling back to the bare endpoint. Use explicit `azure` to
select that bare endpoint, or an explicit legacy name for compatibility.
Configured non-Azure provider defaults and explicit API settings remain honored.

Pools are discovered from env-var naming. For a model `GPT_6_LUNA`, aiclient scans:

```
AZURE_OPENAI_ENDPOINT_GPT_6_LUNA                    (legacy / bare — optional)
AZURE_OPENAI_ENDPOINT_GPT_6_LUNA_<REGION>           (e.g. _EASTUS, _SWEDENCENTRAL, _WESTUS)
AZURE_OPENAI_ENDPOINT_GPT_6_LUNA_<REGION>_PTU       (trailing _PTU marks a provisioned-throughput reservation)
```

and the matching `AZURE_OPENAI_API_KEY_GPT_6_LUNA_...` variants. Each one becomes a pool member. Embeddings use the same pattern rooted at `AZURE_OPENAI_ENDPOINT_EMBEDDING[_<REGION>]`; images at `AZURE_OPENAI_ENDPOINT_GPT_IMAGE_1_5[_<REGION>]`.

Explicit bare `azure` selection uses a single member from the legacy bare env
vars (`AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`). Implicit Azure chat
selection requires the Luna deployment instead.

### Selection algorithm

**Priority tiers, random within tier.**

- Members are grouped by `priority` (1 = preferred, 2+ = fallback). Defaults: bare/PTU suffixes → tier 1, regional PAYG suffixes → tier 2.
- The lowest-priority tier that still has at least one healthy (non-cooling-down) member wins; within that tier, one member is picked uniformly at random.
- Random-within-tier means N independent client processes spread across the regions in that tier instead of stampeding the same endpoint.

On failure:

- **429** → parse `Retry-After`, mark the member as cooling for `max(Retry-After, base × 2^consecutive_429s)`, capped at 120 s. Rotate to the next healthy member.
- **5xx / timeout / network error** → floor cooldown of 5 s. Rotate.
- **Non-transient 4xx** (e.g. 401) → return immediately without rotating. The error isn't going to get better on another endpoint.

After 3 consecutive successes the 429 multiplier resets, so a transient blip doesn't leave an endpoint penalised for the rest of the process's life.

### Overriding priority and mode

For the cases where auto-detection is wrong or you want explicit weights, set `AZURE_OPENAI_POOL_<MODEL>` to a JSON array:

```
AZURE_OPENAI_POOL_GPT_6_LUNA=[
  {"suffix":"GPT_6_LUNA_EASTUS_PTU", "priority":1, "mode":"PTU", "tpm":50000},
  {"suffix":"GPT_6_LUNA_SWEDENCENTRAL", "priority":2, "mode":"PAYG"},
  {"suffix":"GPT_6_LUNA_WESTUS", "priority":2, "mode":"PAYG"}
]
```

Only the fields you set override defaults; everything else falls back to what discovery detected. Invalid JSON is ignored (with a debug warning).

### Debug logging

Enable the `typeagent:pool` namespace to see selection, rotation, and cooldown events:

```bash
DEBUG=typeagent:pool,typeagent:rest:retry node your-app.js
```

### How pools interact with existing behavior

- The public factories (`createChatModel`, `createEmbeddingModel`, `createImageModel`) are unchanged — callers opt into pools by adding regional env vars, not by changing code.
- `getChatModelSettings(endpoint?)` still returns the preferred member's settings (the bare / tier-1 member), so callers that mutate settings (e.g. to bump `timeout`) still target what they expect.
- A pool of one is a pass-through: `fetchWithRetry` runs with the same retry budget it always did. Pool logic only activates cooldowns when there's somewhere else to rotate to.

### Provisioning more endpoints

See [`ts/tools/scripts/README.md`](../../tools/scripts/README.md) for the multi-region deploy and secret-sync tooling that populates the regional env vars described above.

## Completion limits and reasoning

OpenAI-compatible chat completions and Responses requests omit optional
`max_completion_tokens`, legacy `max_tokens`, and `max_output_tokens` limits.
Completion settings no longer accept those fields; old JavaScript settings
produce a migration error rather than being silently ignored. There is no
fifth-argument completion-limit switch. Ask for an approximate final-answer
length in the prompt, explicitly excluding reasoning and preserving required
evidence. This is guidance, not a bound on actual generation.

Provider capacity metadata (`requestConstraints.outputTokens`) remains
authoritative for local context admission and opt-in request-budget reservation,
including the full possible reasoning-plus-answer output. Missing capacity fails
budgeted admission rather than inventing a limit. Application attempts, input,
elapsed time, and aggregate safeguards remain separate from wire generation.
Anthropic Messages is the protocol exception: its mandatory native `max_tokens`
field is populated from verified provider output capacity. It is not the removed
legacy OpenAI setting; a Messages request without known capacity fails explicitly.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
