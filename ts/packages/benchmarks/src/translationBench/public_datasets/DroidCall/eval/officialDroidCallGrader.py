#!/usr/bin/env python3
# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""DroidCall paper, released-code, and TypeAgent-adjusted scorers."""

import json
import re
import sys


_semantic_scorer = None
_semantic_scores = {}


def is_field_none(value):
    return value is None or (
        isinstance(value, str) and value.strip().lower() == "none"
    )


def decode_number_lexemes(value):
    if isinstance(value, list):
        return [decode_number_lexemes(item) for item in value]
    if isinstance(value, dict):
        if set(value) == {"__pythonNumber"}:
            source = value["__pythonNumber"]
            return int(source) if re.fullmatch(r"[+-]?\d+", source) else float(source)
        return {key: decode_number_lexemes(item) for key, item in value.items()}
    return value


def collect_semantic_pairs(left, right, match_type, pairs):
    if match_type != "semantic" or is_field_none(left) or is_field_none(right):
        return
    if type(left) is not type(right):
        return
    if isinstance(left, dict):
        if len(left) != len(right):
            return
        for key, value in left.items():
            if key in right:
                collect_semantic_pairs(value, right[key], match_type, pairs)
    elif isinstance(left, list):
        if len(left) != len(right):
            return
        for left_item in left:
            for right_item in right:
                collect_semantic_pairs(left_item, right_item, match_type, pairs)
    elif isinstance(left, str):
        pairs.add((left, right))


def prepare_semantic_scores(pairs):
    global _semantic_scorer
    missing = [pair for pair in pairs if pair not in _semantic_scores]
    if not missing:
        return
    if _semantic_scorer is None:
        from bert_score import BERTScorer

        _semantic_scorer = BERTScorer(lang="en")
    _, _, scores = _semantic_scorer.score(
        [pair[0] for pair in missing],
        [pair[1] for pair in missing],
    )
    for pair, score in zip(missing, scores):
        _semantic_scores[pair] = float(score)


def deep_compare(left, right, match_type="strict", semantic_threshold=0.85):
    if match_type == "ignore":
        return True
    if is_field_none(left) and is_field_none(right):
        return True
    if type(left) is not type(right):
        return False
    if isinstance(left, dict):
        if len(left) != len(right):
            return False
        return all(
            key in right
            and deep_compare(value, right[key], match_type, semantic_threshold)
            for key, value in left.items()
        )
    if isinstance(left, list):
        if len(left) != len(right):
            return False
        return all(
            any(deep_compare(a, b, match_type, semantic_threshold) for b in right)
            for a in left
        ) and all(
            any(deep_compare(a, b, match_type, semantic_threshold) for a in left)
            for b in right
        )
    if isinstance(left, str):
        if match_type == "strict":
            return left.strip().lower() == right.strip().lower()
        return _semantic_scores[(left, right)] > semantic_threshold
    if isinstance(left, int):
        return left == right
    return False


def resolved_arguments(answer, response, api):
    for name, spec in api["arguments"].items():
        answer_has = name in answer["arguments"]
        response_has = name in response["arguments"]
        if not answer_has and not response_has:
            continue
        if spec["required"] and not answer_has:
            continue
        default = spec.get("default")
        yield (
            answer["arguments"].get(name, default),
            response["arguments"].get(name, default),
            spec.get("match_type", "strict"),
        )


def score_payload(payload, contract_name):
    if contract_name == "paper-described":
        semantic_threshold = 0.75
        aggregation = "function-call-mean"
        mime_presence_only = False
    elif contract_name == "released":
        semantic_threshold = 0.85
        aggregation = "sample-mean"
        mime_presence_only = False
    elif contract_name == "typeagent-adjusted":
        semantic_threshold = 0.85
        aggregation = "sample-mean"
        mime_presence_only = True
    else:
        raise ValueError(f"Unknown DroidCall scoring contract: {contract_name}")

    apis = {item["name"]: item for item in payload["apis"]}
    for row in payload["rows"]:
        for response in row["response"]:
            response["arguments"] = decode_number_lexemes(response["arguments"])
    pairs = set()
    prepared = []
    for row in payload["rows"]:
        response_map = {
            item.get("name", ""): item
            for item in row["response"]
            if isinstance(item, dict) and isinstance(item.get("name", ""), str)
        }
        prepared.append(response_map)
        for answer in row["answers"]:
            response = response_map.get(answer["name"])
            if response is None:
                continue
            for left, right, match_type in resolved_arguments(
                answer, response, apis[answer["name"]]
            ):
                collect_semantic_pairs(left, right, match_type, pairs)
    prepare_semantic_scores(pairs)

    row_soft_total = 0.0
    call_soft_total = 0.0
    call_count = 0
    perfect_rows = 0
    correct_arguments = 0
    total_arguments = 0
    for row, response_map in zip(payload["rows"], prepared):
        row_correct = 0
        row_total = 0
        for answer in row["answers"]:
            api = apis[answer["name"]]
            response = response_map.get(answer["name"])
            call_correct = 0
            call_total = 0
            if response is None:
                call_total = len(api["arguments"])
                row_total += call_total
                call_soft_total += 1.0 if call_total == 0 else 0.0
                call_count += 1
                continue
            for name, spec in api["arguments"].items():
                answer_has = name in answer["arguments"]
                response_has = name in response["arguments"]
                if (
                    mime_presence_only
                    and api["name"] == "ACTION_OPEN_DOCUMENT"
                    and name == "mime_types"
                ):
                    if answer_has and response_has:
                        row_correct += 1
                        call_correct += 1
                    row_total += 1
                    call_total += 1
                    continue
                if not answer_has and not response_has:
                    row_correct += 1
                    call_correct += 1
                    row_total += 1
                    call_total += 1
                    continue
                if spec["required"] and not answer_has:
                    row_total += 1
                    call_total += 1
                    continue
                default = spec.get("default")
                if deep_compare(
                    answer["arguments"].get(name, default),
                    response["arguments"].get(name, default),
                    spec.get("match_type", "strict"),
                    semantic_threshold,
                ):
                    row_correct += 1
                    call_correct += 1
                row_total += 1
                call_total += 1
            call_soft_total += (
                1.0 if call_total == 0 else call_correct / call_total
            )
            call_count += 1
        row_score = 1.0 if row_total == 0 else row_correct / row_total
        row_soft_total += row_score
        if abs(row_score - 1.0) < 1e-6:
            perfect_rows += 1
        correct_arguments += row_correct
        total_arguments += row_total
    row_count = len(payload["rows"])
    soft_accuracy = (
        call_soft_total / call_count
        if aggregation == "function-call-mean"
        else row_soft_total / row_count
    )
    overrides = []
    if mime_presence_only:
        overrides.append(
            {
                "tool": "ACTION_OPEN_DOCUMENT",
                "argument": "mime_types",
                "comparison": "presence-only",
            }
        )
    return {
        "softAccuracy": soft_accuracy,
        "accuracy": perfect_rows / row_count,
        "counts": {
            "rows": row_count,
            "perfectRows": perfect_rows,
            "correctArguments": correct_arguments,
            "totalArguments": total_arguments,
            "functionCalls": call_count,
        },
        "contract": {
            "name": contract_name,
            "scorerRevision": "3f7ba458bee480a86c602edff6cc7ec9cfd555db",
            "bertScore": "0.3.13",
            "transformers": "4.48.1",
            "semanticThreshold": semantic_threshold,
            "softAccuracyAggregation": aggregation,
            "overrides": overrides,
        },
    }


def main():
    if "--jsonl" in sys.argv:
        for line in sys.stdin:
            try:
                payload = json.loads(line)
                contract_name = payload.pop("contract", "released")
                print(
                    json.dumps(score_payload(payload, contract_name)), flush=True
                )
            except Exception as error:
                print(json.dumps({"error": str(error)}), flush=True)
        return
    payload = json.load(sys.stdin)
    contract_name = payload.pop("contract", "released")
    print(json.dumps(score_payload(payload, contract_name)))


if __name__ == "__main__":
    main()
