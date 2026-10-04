# DroidCall scoring audit

The DroidCall paper and its released scorer define different soft-accuracy
metrics. We keep both. Neither score makes the current TypeAgent run directly
comparable with Table 2 in the paper.

## Paper-described contract

The paper defines exact accuracy as the fraction of samples whose function
calls and parameters all match. It defines soft accuracy as the mean parameter
accuracy across function calls:

```text
call score = correct catalog arguments / catalog arguments
soft accuracy = sum(call scores) / gold function calls
exact accuracy = perfect samples / samples
```

It uses case-insensitive string matching and BERTScore for semantic fields. The
paper sets the semantic threshold to 0.75.

The prose is not a complete executable specification. It does not define extra
predictions, repeated calls to the same tool, default arguments, unordered
lists, malformed output, or empty argument lists. Our `paper-described` score
uses the released scorer's behavior for those cases and changes only the two
points the paper states: a 0.75 semantic threshold and a function-call mean.
It is a literal interpretation, not proof that we reproduced the authors'
unpublished evaluation logic.

## Released scorer contract

The repository's `result_checker.py` at commit
`3f7ba458bee480a86c602edff6cc7ec9cfd555db` is executable and uses:

- a 0.85 semantic threshold;
- an unweighted mean of per-sample parameter scores;
- trimmed, case-insensitive strict strings;
- unordered, equal-length lists;
- API-catalog defaults and jointly omitted optional arguments;
- a response map keyed by tool name. Repeated calls to one tool collapse to the
  last prediction;
- no penalty for extra predicted tools.

`droidCallReleased` reproduces this code path. `droidCallPaperDescribed` records
the literal paper interpretation. `droidCallAdjusted` records the TypeAgent
change in [droid-call-grader-improvement.md](droid-call-grader-improvement.md).

## Why this run is not paper-comparable

The paper evaluates 200 rows from `DroidCall_test.jsonl`. The current 1,000-row
run contains only training rows selected for multiple independent actions. It
also uses TypeAgent schemas and prompts. The paper uses DroidCall's JSON or code
prompt and a fake retriever that returns every gold tool plus random distractors
up to four candidates.

The current slice exposes 2.292 candidate tools per row on average. It contains
67 rows with repeated gold tool names, which the released scorer collapses.
These data and protocol differences are larger than the metric difference.

To reproduce the paper's reported model numbers, run the 200-row test split with
the paper's prompt, fake retriever, model settings, and output parser. Then
report the paper-described score and the released-code score side by side.
