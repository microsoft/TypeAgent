# Direct TypeAgent Explorer final verification

## Goal and final resource

Verify the built Explorer repository API and benchmark CLI after the final
cache-integrity audit. The final resources are:

- `packages/agents/explorer/dist/script/repositoryApi.js`
- `packages/exploreBench/dist/src/cli.js`
- branch `domnguyen/typeagent-explorer-lsp`

The paid random-10 comparison remains the immutable revision-14 run documented
in [`../direct-typeagent-random10-r14/evidence.md`](../direct-typeagent-random10-r14/evidence.md).
Revision 15 changes only result-resume and cached runtime-provenance validation;
it does not change prompts, repository tools, scoring, or fresh model execution.

## Environment

- Platform: macOS arm64
- Runtime: repository-installed Node and pnpm workspace dependencies
- Authentication: no provider credential or model request was used for this
  post-cohort verification
- Artifact level: Level 1 markdown

## Built final-resource proof

The compiled repository API was given a temporary TypeScript file, snapshotted,
then the live file was replaced before calling `grep`. The result came from the
immutable snapshot, and the trace proved execution by the packaged ripgrep
binary:

```text
{"matches":[{"path":"sample.ts","line":1,"text":"const needle = 1;"}],"execution":{"engine":"ripgrep","executable":"rg"},"ripgrepExecutable":"rg","ripgrepSha256":"e87c40f1044faa43588be9b8320dddd6a1437639c54eb6110df33bce81711863","snapshotPreserved":true}
exit_code=0
```

The built CLI exposes exactly the three intended arms and the one-model path:

```text
typeagent-explore-bench

Run deterministic or seeded SWE-bench Verified localization tasks through the
real GitHub Copilot CLI/SDK, comparing Copilot SDK (with explore agent),
TypeAgent, and the optional TypeAgent with LSP arm.

--model <model>               Run one allowed model instead of --matrix
--variant <name>              baseline, typeagent, or typeagent-lsp; repeatable; default first two
exit_code=0
```

## Automated gates

Explorer package:

```text
Test Suites: 5 passed, 5 total
Tests:       73 passed, 73 total
Snapshots:   0 total
```

ExploreBench package after revision-15 cache tests:

```text
tests 136
pass 136
fail 0
cancelled 0
skipped 0
todo 0
```

The new fail-closed cases prove:

```text
same-run resume rejects every stale task payload field
runtime evidence requires exact ripgrep and variant harness identity
rejects conflicting harness identity while merging resume evidence
fully cached imported rows require a verified direct source runtime artifact
rejects caches without direct runtime-source provenance
```

Final source/build aggregation uses the same sorted procedure documented in the
revision-14 evidence:

```text
sourceFiles=39
sourceDigest=83240c1dbb4a0e29fe29e43c4d6183c420559b83450f40d887242e8989a7459e
builtFiles=112
builtDigest=05a88fdf5d49eb885637f77180914b22c00b6e2cf0918c744142da782da58e12
ripgrepSha256=e87c40f1044faa43588be9b8320dddd6a1437639c54eb6110df33bce81711863
```

## Result and remaining gap

PASS. TypeAgent grep reaches the same packaged ripgrep executable used by the
baseline, operates on the immutable filtered snapshot, and persists host-owned
execution evidence. Same-run payload drift, incomplete runtime evidence,
cache-of-cache lineage, source artifact drift, and conflicting harness versions
all fail closed.

The revision-14 random-10 metrics are intentionally not rerun or relabeled as a
revision-15 cohort. The final audit hardening is outside fresh execution, and
reusing the already-observed cohort would weaken the benchmark's over-fitting
control.
