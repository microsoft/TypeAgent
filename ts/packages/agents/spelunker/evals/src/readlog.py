#!/usr/bin/env python3
# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import argparse
import json
import os
import time


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "-q",
        "--questions",
        action="store_true",
        help="Show the questions only.",
        default=False,
    )
    parser.add_argument(
        "-f",
        "--follow",
        action="store_true",
        help="Follow the log file (like tail -f).",
        default=False,
    )
    args = parser.parse_args()
    questions_only = args.questions
    follow = args.follow
    with open(os.path.join(os.getenv("HOME") or "", ".spelunker.log"), "r") as f:
        while True:
            line = f.readline()
            if not line:
                if follow:
                    time.sleep(0.2)
                    continue
                else:
                    break
            try:
                data = json.loads(line)
            except json.JSONDecodeError:
                print(f"Invalid JSON: {line:.100}")
                continue
            if questions_only:
                print(data["question"])
            else:
                print()
                print("-" * 50)
                print(f"Question: {data['question']}")
                print(f"Answer: {data['answer']}")
                print(f"References: {data['references']}")


if __name__ == "__main__":
    main()
