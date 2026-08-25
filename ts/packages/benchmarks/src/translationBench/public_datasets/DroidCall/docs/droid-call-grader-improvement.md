# TypeAgent scoring adjustment

`officialDroidCallGrader.py` reads JSON from stdin. A payload contains `apis` and
`rows`; each row contains `answers` and `response` arrays of `{name, arguments}`.
Pass `--jsonl` for one score per input line.

Run semantic scoring with `uv run --with bert-score==0.3.13 --with transformers==4.48.1 python3 officialDroidCallGrader.py`.
Set `"contract": "typeagent-adjusted"` to select it; omitted defaults to `released`. Consumers should label it `droidCallAdjusted`.
Strict-only scoring does not load BERT. The output includes `softAccuracy`, `accuracy`, `counts`, and the selected contract.

## `ACTION_OPEN_DOCUMENT.mime_types`

The adjusted scorer checks this field by presence. Both values must be present;
their lists are not compared. If prediction omits the field, the argument fails,
including when gold also omits it.

For example, these values match:
`["application/pdf", "application/msword", "text/plain"]` and `["*/*"]`.

Both calls open a document picker. The second accepts more document types. This
is useful for TypeAgent product evaluation, but it is not part of the paper or
the released `result_checker.py`. Reports must preserve the unmodified released
score beside it.
