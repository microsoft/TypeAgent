# Seal-Tools parameter scoring

The benchmark reports tool and parameter metrics. API-only scoring is not the
current contract.

The primary Seal-aligned metrics preserve the upstream corpus-level counters for
format accuracy, tool precision/recall/F1, and parameter precision/recall/F1.
The local variant compares API names, parameter names, and nested string values
without regard to case. The official case-sensitive metrics remain available for
reference.

The supplemental TypeAgent pass score handles known source-data problems at the
row level. It excludes unresolved `API_call_*` dependencies and audited rows that
cannot be answered from the request and five candidate APIs. It also supports
narrow expected-action and parameter overrides where the source contract proves
that the original gold is wrong or under-specified.

See [grader-seal-vs-this-report.md](grader-seal-vs-this-report.md) for the full
scoring contract.
