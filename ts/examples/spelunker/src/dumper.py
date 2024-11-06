# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import json
import sys

def main():
    data = json.load(sys.stdin)
    for chunked_file in data:
        print(f"{chunked_file['filename']}")
        print()
        for chunk in chunked_file["chunks"]:
            print(f"{chunk['id']}")
            for blob in chunk["blobs"]:
                for lineno, line in enumerate(blob["lines"], 1):
                    print(f"{blob['start'] + lineno:2d}. {line.rstrip()}")
                print()

main()
