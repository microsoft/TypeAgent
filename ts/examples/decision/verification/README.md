# Browser-state verification pilot

Offline comparison of frozen page evidence. This directory does not change the decision client.

Variants:

- Deterministic explicit checks over structured node snapshots. Raw HTML is stored only as unused fixture text and is not parsed.
- Decision predicate plus sufficiency (`evidence_sufficient`, `expectation_matched`). Sufficiency below 0.35 is `insufficient`, which is abstention, not a match.
- Decision choice with exact members `matched`, `not-matched`, and `insufficient`.

`checkPageState` in `webFlowBrowserApi.mts` is the generative baseline reference (`semanticPageQuery` / `PageStateCheck`). This pilot does not call it and does not substitute a lexical heuristic for it.

False completion (trusted evidence contradicts the expectation, including negated or lookalike wording) is `not-matched`. Missing, untrusted-only, or conflicting evidence is `insufficient`.

```powershell
node --check ts/examples/decision/verification/verify.mjs
node --test ts/examples/decision/verification/verify.spec.mjs
node ts/examples/decision/verification/verify.mjs
node ts/examples/decision/verification/verify.mjs --live --limit 1 --cli-path <copilot-executable>
```

Default mode is offline. `--live` calls `gpt-6-luna-decisions` through the existing decision client. One JSON object per case goes to stdout. The summary on stderr is a call count, not a quality claim.

Not implemented: live browser sessions, HTML parser integration, generative page-state calls, and package-script wiring.
