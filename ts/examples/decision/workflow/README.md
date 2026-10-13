# Workflow advice pilot

Compares explicit deterministic rules with a four-way decision choice on frozen tool-result traces. Actions are exactly `continue`, `retry`, `stop`, and `handoff`. Missing or conflicting evidence is `no-fit`, not a guessed action.

Advice is advisory only. The runner does not retry, mutate, or hand off work. Instructions inside `toolMessage` are ignored by the rules.

Low decision sufficiency (below 0.35) sets `noFit` while still recording the four-way choice when the API returns one. An unknown choice is an explicit failure.

```powershell
node --check ts/examples/decision/workflow/advise.mjs
node --test ts/examples/decision/workflow/advise.spec.mjs
node ts/examples/decision/workflow/advise.mjs
node ts/examples/decision/workflow/advise.mjs --live --limit 1 --cli-path <copilot-executable>
```

Default mode is offline. `--live` calls `gpt-6-luna-decisions` through the existing decision client. Stdout is JSONL. Stderr summary counts calls only.

Not implemented: tool execution, real workflow integration, and package-script wiring.
