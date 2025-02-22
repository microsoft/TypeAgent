# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import os
import json


def main():
    with open(os.path.join(os.getenv("HOME") or "", ".spelunker.log"), "r") as f:
        for line in f:
            try:
                data = json.loads(line)
            except json.JSONDecodeError:
                print(f"Invalid JSON: {line:.100}")
                continue
            print()
            print("-" * 50)
            print(f"Question: {data['question']}")
            print(f"Answer: {data['answer']}")
            print(f"References: {data['references']}")


if __name__ == "__main__":
    main()
