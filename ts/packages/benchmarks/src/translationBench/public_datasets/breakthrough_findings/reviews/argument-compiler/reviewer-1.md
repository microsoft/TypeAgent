# Reviewer 1: semantic argument compiler

## Verdict: REJECT

The evidence finds a real error cluster, but it does not test the proposed compiler. At a breakthrough bar, a diagnosis without an intervention, a measured delta, or provider execution evidence is not enough.

## Evidence

I reviewed `evidence/cross-dataset-analysis.json` and verified its recorded SHA-256 hashes against the current source and DroidCall result files.

- Across eight runs of the same 1,000 cases, TypeAgent pass rate is 56.5% to 62.3%. Exact pass rate is 45.4% to 49.2%. The adjusted DroidCall scorer reports 56.2% to 58.4% exact accuracy and 88.17% to 88.95% soft accuracy. These are baselines only. No compiler delta is measured.
- `wrongValueDiagnosticSharePercent` is 75.34% to 87.32%, but its denominator is diagnostic events. It is not the share of rows a compiler can repair. A direct audit of the hashed files finds 275 to 358 failed rows per run whose diagnostics contain a wrong value and no route, missing, extra, or type error. Treating all of them as repairable gives a loose 27.5 to 35.8 point ceiling, not an effect estimate, because `wrongValue` combines wire encoding with free-form wording, ambiguity, and questionable gold.
- The non-verbatim slice is strongly associated with failure: 525 rows score 36.57% to 48.38%, while 475 verbatim rows score 76.42% to 78.53%. The analyzer defines this slice by scanning every gold string leaf for a normalized substring of the utterance. It therefore mixes MIME types and URIs with alarm labels, message bodies, contact names, and search-query wording. This correlation does not identify a compiler as the cause or remedy.
- The largest action-family failures are consistent with either the hypothesis or bad labels: `ACTION_VIEW_CONTACT` passes 17/552 evaluations, `ACTION_INSERT_EVENT` 43/464, `ACTION_SET_ALARM` 333/1448, and `ACTION_OPEN_DOCUMENT` 163/488. The report does not isolate which parameter failed or whether a contract-derived transformation could determine the gold value.
- Concrete rows expose the confound. In `droidcall-train-1047`, the tool contract requires ISO 8601, the gold value is `"this Sunday afternoon"`, and the model emits an ISO timestamp. A correct wire compiler would move away from the benchmark gold. In `droidcall-train-1204`, the gold invents `content://contacts/people/John` and `555-112-2334`, neither of which appears in the utterance. Producing them requires a lookup or fabricated fixture knowledge, not literal compilation. In `droidcall-train-1435`, `"calm"` is scored against `content://media/internal/calm`; in `droidcall-train-1551`, `"harmonious melody"` is scored against `content://media/external/audio/media/701`. No evidence shows that those resource mappings exist in an app catalog.
- The adjusted official scorer already treats `ACTION_OPEN_DOCUMENT.mime_types` as presence-only. That is scorer cleanup, and it changes exact accuracy for the first run from 57.7% under the released contract to 58.4%. It does not validate a runtime MIME compiler.

## Causality and benchmark validity

The claim overreaches in four ways.

1. There is no treatment. All outputs were produced against the current provider-shaped schemas. The study never exposes a semantic schema to the model, runs an app-owned compiler, or compares emitted provider calls before and after.
2. The evaluated set is entirely DroidCall `train`, uses case-pinned schemas, contains only independent multi-action rows, and has one generation per run. The two Luna configurations are counted as two of the eight runs even though both report the same model name. Public training rows and case-pinned routing weaken external validity.
3. The named cross-dataset evidence contains no Seal-Tools accuracy result. Seal-Tools contributes only row counts. The only dependent probe is ten DroidCall rows from one local model; TypeAgent excludes all ten from scoring, and its released exact accuracy is 10%.
4. No provider is invoked. Consequently there is no evidence that the proposed output is accepted, executes correctly, or improves user-visible behavior. For URIs and resource IDs, the missing component may be runtime entity resolution rather than compilation.

## Scope and novelty

Separating a user-facing command model from a provider DTO and mapping between them is a standard adapter or anti-corruption-layer design. It is sensible architecture, but this evidence does not establish a new technique. A breakthrough claim would need a reusable compiler contract, several unrelated providers, and a large held-out end-to-end gain without gold-specific rules.

## Is this scorer or dataset cleanup?

Substantially, yes. The evidence supports relaxing or correcting gold fields that the utterance does not determine, repairing labels that contradict their tool contract, and reporting semantic correctness separately from wire validity. A compiler may remain useful after that cleanup, but the present numbers cannot separate its value from those benchmark changes.

## Smallest falsification experiment

Use 100 held-out DroidCall `test` rows, stratified evenly across MIME/default-enum, date/time, and URI/resource cases, with the remainder covering free-form strings. Pre-register mappings from tool contracts and a mock provider catalog without reading gold answers. Run one fixed model in a paired test:

- A: current provider-shaped TypeAgent schema.
- B: semantic TypeAgent schema followed by the frozen app compiler.

Score both on source-grounded semantic intent and executable provider-wire validity. Report paired row outcomes and failures by field. Do not award gold-only literals that cannot be derived from the request, contract, or mock provider state. If B does not gain at least 10 absolute points in executable success, or if the gain disappears after removing invalid and underspecified gold, the breakthrough claim is falsified. One positive DroidCall result would justify a larger cross-provider study, not acceptance as a breakthrough by itself.
