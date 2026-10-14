# Minimal generative client

This is a small existing-API baseline, not a new framework or provider SDK.
It reuses `@typeagent/aiclient` and `@typeagent/config`; there are no new
dependencies, keys, or configuration changes.

```js
import { stopCopilotClient } from "@typeagent/aiclient";
import { createGenerativeClient, getConfig } from "./client.mjs";

const client = createGenerativeClient(getConfig(), {
  model: "gpt-5-mini",
  cliPath: process.env.COPILOT_CLI_PATH,
});
try {
  const result = await client.generate(task, evidence, schema);
  // The caller checks its exact output shape and allowed values before use.
} finally {
  await stopCopilotClient();
}
```

Stable interface: `createGenerativeClient(config, {model, cliPath} = {}, chatModel)`
returns a client with `async generate(task, evidence, schema)`. Its result is
`{value, usage, latencyMs, requestedModel}`. `value` is strictly `JSON.parse`
of the model's successful response, without markdown repair or a general schema
validator. The optional third argument injects a chat model for tests. The
requested model defaults to the runtime Copilot default, then `gpt-5-mini`.
The cached `getConfig()` helper uses the same runtime loader and workspace root
as the existing decision entry points. Cleanup belongs to the caller.

The schema is explicitly included in prompt context and passed to
`complete(promptSections, usageCallback, {name, strict: true, schema})`.
Existing aiclient handles chat/responses endpoint conventions. Provider failures
are reported as `generative_provider_failed`; invalid JSON is
`generative_invalid_json`. Neither prints credentials or provider bodies.

## NanoTests patterns

Read-only reference: the local `typeagentNanoTests` checkout under
`OneDrive - Microsoft/Documents/GitHub`, specifically
`src/shared/model-translator.js`, `src/shared/grammar-first-translator.js`, and
`docs/prompt-api-schema-calling-convention.md`.
The adopted patterns are visible schema guidance in addition to constrained
output, validation before execution, and a fast-path/fallback pairing with
separate timings. This demo does not run Chrome Nano, import NanoTests code,
copy its implementation, or claim constrained JSON ensures semantic correctness.

See [generative shopping](../web-shopping-generative/README.md) and
[hybrid shopping](../web-shopping-hybrid/README.md) for executable examples.
