# Why we score API calls only, not parameters

## The problem case

Case `sealtools-dev-difficult-202`.

Instruction:

> I need information about the capacity of a warehouse with ID 44. Then I want to
> retrieve the layout and design of the Fiction section on the third floor of the
> Central Library. Finally, I would like to obtain metadata associated with the
> library's digital resources, specifically the author information based on the
> publication year filter criteria.

Gold answer (from `seal-tools-validation.jsonl`):

```json
[
  { "actionName": "getWarehouseCapacity", "parameters": { "warehouse_id": 44 } },
  { "actionName": "getLibraryLayout", "parameters": { "library_name": "Central Library", "floor": 3, "section": "Fiction" } },
  { "actionName": "getLibraryMetadata", "parameters": { "library_id": "TnqvLnDp", "metadata_type": "author", "filter_criteria": "publication year" } }
]
```

## Where `TnqvLnDp` comes from

It comes from the Seal-Tools gold answer, not the instruction. `getLibraryMetadata`
requires `library_id`, but the instruction never gives one — it only says "the
library's digital resources." The Seal-Tools authors filled the required argument
with a random identifier (`TnqvLnDp`) when they generated the data, then wrote an
instruction that never surfaces that value.

The instruction text does not contain the string. No model can recover it. Every
model we ran produced the only value the prompt supports — `library_id:
"Central Library"` — and every model was marked wrong on that parameter.

## Why this makes parameter scoring unfair

`library_id` is a phantom value: a required parameter whose gold value has no
anchor in the instruction. Any model loses that parameter through no fault of its
own. Case-insensitive matching does not help, because the miss is content, not
case (`Central Library` vs `TnqvLnDp`).

This is not a one-off. Seal-Tools generates argument values first and writes
instructions second, so unanchored required-parameter values recur across the set.
Parameter precision and recall punish the model for the dataset's gaps rather than
for the model's output.

## Decision

We assess the API call only. The score counts tool selection — did the model pick
the right APIs — and does not assess parameters. Parameter precision, recall, and
F1 are dropped from the reported score.

This keeps the benchmark measuring what the instruction can actually support and
removes the phantom-parameter penalty from every model equally.
