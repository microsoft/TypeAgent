# Cached tokens usage shape (LiteLLM + OpenAI/Azure)

Date: 2026-08-07  
Proxy: local LiteLLM `http://127.0.0.1:4627`  
Related PR: https://github.com/microsoft/TypeAgent/pull/2826  
OpenAI docs: https://developers.openai.com/api/docs/guides/prompt-caching

## Summary

| Wire API | Endpoint | Cache field location | Top-level `cached_tokens`? |
|---|---|---|---|
| Chat Completions | `/v1/chat/completions` | `usage.prompt_tokens_details.cached_tokens` | **No** (OpenAI always nests) |
| Responses | `/v1/responses` | `usage.input_tokens_details.cached_tokens` | **No** |
| Anthropic Messages | `/v1/messages` | (when caching works) `usage.cache_read_input_tokens` | N/A — different schema |

**Canonical internal field after normalize:** `CompletionUsageStats.cached_tokens`  
(subset of prompt/input tokens when the provider reports a cache hit)

---

## OpenAI / Azure Chat Completions

Per [OpenAI prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching), cache hits are **always** under `prompt_tokens_details`:

```json
{
  "usage": {
    "prompt_tokens": 2006,
    "completion_tokens": 300,
    "total_tokens": 2306,
    "prompt_tokens_details": {
      "cached_tokens": 1920,
      "cache_write_tokens": 0
    },
    "completion_tokens_details": {
      "reasoning_tokens": 0,
      "accepted_prediction_tokens": 0,
      "rejected_prediction_tokens": 0
    }
  }
}
```

Notes:
- `cached_tokens` is a **subset** of `prompt_tokens` (already counted in prompt).
- Live probes often show `"cached_tokens": 0` even when the details object is present (no hit yet).
- Do **not** expect top-level `usage.cached_tokens` from OpenAI/Azure chat.

### Live probe (LiteLLM) — azure/gpt-5.6-\*

Models: `azure/gpt-5.6-luna`, `azure/gpt-5.6-sol`, `azure/gpt-5.6-terra`  
API: `--api chat` → `/v1/chat/completions`  
Result: HTTP 200, shape:

```json
{
  "completion_tokens": 5,
  "prompt_tokens": 819,
  "total_tokens": 824,
  "prompt_tokens_details": {
    "audio_tokens": 0,
    "cached_tokens": 0
  },
  "completion_tokens_details": { "...": "..." }
}
```

Same nested path for all three azure models (call 1 and 2).

### Live probe — raw `gpt-5.6-luna` (no `azure/` prefix)

| Call | Routed group | API base | Usage cache path |
|---|---|---|---|
| chat ×2 | **`azure/gpt-5.6-luna`** | Azure Foundry EUS | `prompt_tokens_details.cached_tokens` |
| responses ×2 | **`gpt-5.6-luna`** | GitHub Copilot enterprise | `input_tokens_details.cached_tokens` |

Chat still nested under `prompt_tokens_details` (value 0 on short probes).  
Responses used Copilot backend with `input_tokens_details.cached_tokens: 0`.

---

## OpenAI / Azure Responses API

Different token field names; cache under **`input_tokens_details`**:

```json
{
  "usage": {
    "input_tokens": 819,
    "input_tokens_details": {
      "audio_tokens": null,
      "cached_tokens": 0,
      "text_tokens": null,
      "cache_write_tokens": 0
    },
    "output_tokens": 5,
    "output_tokens_details": {
      "reasoning_tokens": 0,
      "text_tokens": null
    },
    "total_tokens": 824
  }
}
```

Live probes confirmed this for:
- `azure/gpt-5.6-luna|sol|terra` via `--api responses`
- raw `gpt-5.6-luna` via `--api responses` (Copilot route)

aiclient maps:
- `input_tokens` → `prompt_tokens`
- `output_tokens` → `completion_tokens`
- `input_tokens_details.cached_tokens` → `cached_tokens`

---

## Anthropic Messages (`/v1/messages`)

Probed via LiteLLM `--api anthropic`:

| Request model | Backend routed | usage returned |
|---|---|---|
| `claude-haiku-4-5` | `github_copilot/claude-haiku-4.5` | flat only |
| `claude-sonnet-5` | `github_copilot/claude-sonnet-5` | flat only |
| `claude-sonnet-4-5` | fell through to **haiku** | flat only |

```json
{
  "usage": {
    "input_tokens": 900,
    "output_tokens": 4,
    "total_tokens": 904
  }
}
```

- No `cached_tokens`, no `prompt_tokens_details`, no Anthropic `cache_read_input_tokens`.
- Retry with explicit `cache_control: { "type": "ephemeral" }` on a large system block still returned only flat `input_tokens` / `output_tokens` (and suspiciously low `input_tokens: 12` — system/cache_control likely stripped on Copilot path).

Native Anthropic (when prompt caching is enabled) typically uses:

```json
{
  "usage": {
    "input_tokens": ...,
    "output_tokens": ...,
    "cache_creation_input_tokens": ...,
    "cache_read_input_tokens": ...
  }
}
```

That path is **out of scope** for the current chat/responses flatten in PR 2826.

---

## Why eval showed Cached = N/A

1k disambig eval (`azure/gpt-5.6-*`) reported usage with only:

- `promptTokens`
- `completionTokens`
- `estimatedCostUsd`

Root cause: aiclient `extractUsage` returned the provider block **without** lifting `prompt_tokens_details.cached_tokens` (chat) or `input_tokens_details.cached_tokens` (responses) into `CompletionUsageStats.cached_tokens`. Report code treated missing cache as N/A / zero.

Even when the field is present with value `0`, after flatten the column can show `0` instead of N/A.

---

## aiclient contract (PR 2826)

**Public:**

```ts
type CompletionUsageStats = {
  completion_tokens: number;
  prompt_tokens: number;
  total_tokens: number;
  cached_tokens?: number; // subset of prompt when reported
};
```

**Flatten rules:**

| Source wire | Read from | Write to |
|---|---|---|
| `chat_completions` | `usage.prompt_tokens_details.cached_tokens` | `cached_tokens` |
| `responses` | `usage.input_tokens_details.cached_tokens` | `cached_tokens` |
| `messages` (Anthropic) | not flattened in this PR | — |

No separate public “OpenAICompatible” type — provider nesting stays local to the wire adapter.

---

## How to re-probe

From `ai-agents-setup` repo:

```bash
# Chat (Azure OpenAI shape)
bun .agents/skills/debug-litellm-e2e/scripts/query-litellm.ts \
  --api chat --model azure/gpt-5.6-luna \
  --prompt "Reply with OK only."

# Responses
bun .agents/skills/debug-litellm-e2e/scripts/query-litellm.ts \
  --api responses --model azure/gpt-5.6-luna \
  --prompt "Reply with OK only."

# Anthropic messages
bun .agents/skills/debug-litellm-e2e/scripts/query-litellm.ts \
  --api anthropic --model claude-haiku-4-5 \
  --prompt "Reply with OK only."

# Raw alias (may route azure or copilot depending on API)
bun .agents/skills/debug-litellm-e2e/scripts/query-litellm.ts \
  --api chat --model gpt-5.6-luna \
  --prompt "Reply with OK only."
```

Inspect response body `usage` for nested `*_details.cached_tokens`.

---

## Implications for cost reporting

- Cache hits reduce **billable** input on providers that discount cached tokens; `prompt_tokens` still includes them.
- Cost estimators should use `cached_tokens` when present (cheaper rate), not treat all `prompt_tokens` as full price.
- `cached_tokens === 0` means “details reported, no hit”; `cached_tokens === undefined` means “provider did not report cache stats.”
