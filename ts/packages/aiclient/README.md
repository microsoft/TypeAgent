# aiclient

AI Client is **sample code** for calling AI endpoints and other REST services.

The library is used by and intended only for sample agents and examples in the TypeAgent project.

Supported services:

- Open AI model endpoints, both on Azure and Open AI.
- Bing

The library includes support for getting settings needed to call these services from environment variables.

## Multi-region endpoint pools

Chat, embedding, and image factories resolve each model into an **endpoint pool** — a list of endpoints (one per region + variant) that the client rotates among on 429 / 5xx / timeout. The goal is to survive single-region throttling without user-visible stalls, and to keep a PTU reservation preferred when one is configured.

### How an endpoint gets into a pool

Pools are discovered from env-var naming. For a model `GPT_4_O`, aiclient scans:

```
AZURE_OPENAI_ENDPOINT_GPT_4_O                    (legacy / bare — optional)
AZURE_OPENAI_ENDPOINT_GPT_4_O_<REGION>           (e.g. _EASTUS, _SWEDENCENTRAL, _WESTUS)
AZURE_OPENAI_ENDPOINT_GPT_4_O_<REGION>_PTU       (trailing _PTU marks a provisioned-throughput reservation)
```

and the matching `AZURE_OPENAI_API_KEY_GPT_4_O_...` variants. Each one becomes a pool member. Embeddings use the same pattern rooted at `AZURE_OPENAI_ENDPOINT_EMBEDDING[_<REGION>]`; images at `AZURE_OPENAI_ENDPOINT_GPT_IMAGE_1_5[_<REGION>]`.

If only the legacy bare env vars are set (`AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`), the pool contains one member and behavior is byte-identical to earlier versions of this client — there's nothing to opt into, and nothing breaks when you don't.

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
AZURE_OPENAI_POOL_GPT_4_O=[
  {"suffix":"GPT_4_O_EASTUS_PTU", "priority":1, "mode":"PTU", "tpm":50000},
  {"suffix":"GPT_4_O_SWEDENCENTRAL", "priority":2, "mode":"PAYG"},
  {"suffix":"GPT_4_O_WESTUS", "priority":2, "mode":"PAYG"}
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

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
