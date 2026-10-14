# Local WebMCP-style grocery comparison

Isolated pilot under `ts/examples/decision/webmcp-commerce`. It does not replace
the MCP routing pilot or the local shopping selector demo, and it does not change
shared packages, lockfiles, workspace config, or the decision client.

## Review evidence

Reviewed pages, not executed:

- [System One explainer](https://system-one-explainer.netlify.app/) and its
  [source README](https://github.com/sdras/system-one-explainer). The README
  states that classification, threshold, and workflow instruments use
  illustrative probabilities and timing, not measurements. The WebMCP replay
  uses synthetic routing probabilities. The 164 ms label reproduces an extension
  README example and is not a benchmark. The source note reviewed September 20,
  2026 says no demo makes model requests.
- Case-study mapping used here: tool names and enums become choice questions,
  booleans become predicates, and free text must be an exact span of the
  original user input. Missing arguments stay a manual handoff. A prediction
  does not authorize execution.
- [Basketful shopping demo](https://shopping-webmcp-demo.netlify.app/). The page
  says stores are made up and nothing is charged. Its hosted JavaScript bundle
  was reviewed read-only on 2026-10-13: tools register through
  `document.modelContext.registerTool`, with `inputSchema` and read-only or
  consequential annotations. `search_products` has optional string `query`,
  department enum, dietary enum array, and numeric `max_price`. Other tools
  include `choose_store`, cart/staples operations, recipe planning, order
  status, and checkout. Checkout tools are enabled according to page state;
  delivery address also uses declarative form attributes. The built-in voice
  assistant uses Gemini, not Jev. No public tool was invoked, and native
  WebMCP was unavailable in the review browser. Schema inspection is not an
  interoperability test. This folder's original Lane & Rye contract is
  deliberately narrower, with span objects and a separate organic predicate;
  it is not a hosted Basketful adapter.

## Why hybrid is a separate instance

1. Generative planner: rewrites or decomposes the request into at most three
   read-only intent strings. It does not execute and cannot add product ids,
   permissions, secrets, selectors, or tool arguments. Intents may use only
   words from the original request plus a small planning vocabulary.
2. Decision binding: the same schema-derived choice and predicate questions used
   by the decision-only lane. Free text is chosen from bounded literal spans of
   the original user input, including `no_span`, not from the planner rewrite.
3. Deterministic execution: the host validates the bound call and may run only
   `search_products` or `get_product_details`. Mocked `add_to_cart` and
   `checkout` are removed before questions are built, and the executor declines
   them again. There is no execution retry and no mutation counter increment.

Decision-only refuses a request that asks for both a search and a detail lookup.
That request is the hybrid fixture, so the lanes are not the same entrypoint.

`document.modelContext.registerTool` is preferred when available, with
`navigator.modelContext.registerTool` as a compatibility fallback.
Otherwise the page reports `local-registry-adapter` and does not claim native
WebMCP. Headless tests exercise the adapter and injected registration surface,
not a native browser implementation. Native invocation remains unverified:
the local executor requires original-input provenance for span validation;
successful registration alone does not establish that a native agent supplies
that context. The hosted site was not used as a browser adapter.

The fit threshold is 0.5 and is not calibrated. One live call is not a
benchmark and is not a confidence guarantee. Label mismatch is reported, not
tuned.

## Commands

From the repository root in PowerShell:

```powershell
node --test --test-concurrency=1 ts/examples/decision/webmcp-commerce/commerce.spec.mjs ts/examples/decision/webmcp-commerce/browser.spec.mjs
Get-ChildItem ts/examples/decision/webmcp-commerce -Recurse -Filter *.mjs | ForEach-Object { node --check $_.FullName }
node ts/examples/decision/webmcp-commerce/main.mjs
node ts/examples/decision/webmcp-commerce/hybrid.mjs
node ts/examples/decision/webmcp-commerce/main.mjs --live --limit 1 --cli-path '<existing Copilot executable>'
node ts/examples/decision/webmcp-commerce/hybrid.mjs --live --limit 1 --cli-path '<existing Copilot executable>' --chat-model '<existing chat model>'
node ts/node_modules/prettier/bin/prettier.cjs --check ts/examples/decision/webmcp-commerce
```

Default offline mode makes no model calls. `--live` runs one case. Hybrid live
imports `../generative/client.mjs` only on that path. If the
`createGenerativeClient` export is absent, hybrid live exits 2 with
`generative-client-unavailable` and does not invent a plan. Tests inject a mock
generator, so they do not require that file.

`--gen-only` without `--live` records the comparison contract as unavailable
unless a client is injected. It never executes the proposed tool.

No new dependencies, Stagehand, or Jev SDK are used. Complex argument checks are
narrow field, enum, array, deduplication, span, and length checks for these
owned tools. Parent repository gates and docs stay outside this folder.

## Live smoke, 2026-10-13

One decision case and one hybrid case, serial, not a benchmark.

Decision-only `gf-bakery` called `gpt-6-luna-decisions` once. It chose
`search_products`, department `bakery`, dietary `gluten-free`, and exact span
`gluten-free rolls` (`span:4:21`). Fit was 0.13, so the uncalibrated 0.5 gate
returned `no_fit` and executed nothing. `organic_specified` was 0.68 even though
the request does not mention organic. That predicate was not applied because
the fit gate stopped first. Exit code 0 means the call completed, not that the
label was executed.

Hybrid `hybrid-plan` called generative `claude-haiku-4.5` once (config default
chat model, about 3.5 s). The plan was two intents, `find gluten-free bakery food`
and `show details for Millet Roll`, with no extra ids, permissions, or stores.
The first decision call chose `search_products` and exact span `gluten-free`
(`span:5:16`) but fit was 0.39, so the host stopped. The second subtask was not
called and there was no retry. Nothing executed or mutated. The planner output
was usable; the decision fit gate still blocked the read-only binding.

These two calls do not establish recall, calibration, or a latency improvement.
Hosted schemas were inspected but native invocation remains unverified. The headless page used
`local-registry-adapter` because neither model-context registration surface was available.
