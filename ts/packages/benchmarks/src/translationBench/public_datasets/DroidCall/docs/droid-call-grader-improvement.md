# TypeAgent scoring adjustment

`droidCallAdjusted` starts with the released DroidCall scorer and changes one
argument.

## `ACTION_OPEN_DOCUMENT.mime_types`

The adjusted scorer checks this field by presence. If gold and prediction both
contain `mime_types`, the argument passes. It does not compare the lists. If the
prediction omits the field, the argument fails.

For example, these values match under the adjusted contract:

```json
["application/pdf", "application/msword", "text/plain"]
```

```json
["*/*"]
```

Both calls open a document picker. The second accepts more document types. This
is useful for TypeAgent product evaluation, but it is not part of the paper or
the released `result_checker.py`. Reports must label it as adjusted and must
preserve the unmodified released score beside it.
