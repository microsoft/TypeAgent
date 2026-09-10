# TypeAgent scoring adjustment

`officialDroidCallGrader.ts` exports the native TypeScript scorer. Call
`scoreDroidCallContract(rows, apis, contract)` after building the benchmarks
package; `DroidCallContractGrader` preserves the runner API.

The scorer supports `paper-described`, `released`, and `typeagent-adjusted`.
The default semantic comparison is deterministic token overlap. Consumers may
inject a model-backed semantic scorer through `DroidCallContractGrader`.
Strict-only scoring does not load a model. The result includes `softAccuracy`,
`accuracy`, `counts`, and the selected contract.

## `ACTION_OPEN_DOCUMENT.mime_types`

The adjusted scorer checks this field by presence. Both values must be present;
their lists are not compared. If prediction omits the field, the argument fails,
including when gold also omits it.

Both calls open a document picker. The second accepts more document types. This
is useful for TypeAgent product evaluation, but it is not part of the released
DroidCall scorer. Reports must preserve the unmodified released score beside it.
