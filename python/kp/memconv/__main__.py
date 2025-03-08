#!/usr/bin/env python3.13
# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import argparse
from datetime import datetime as Datetime
import sys

assert sys.version_info >= (3, 13), "Requires Python 3.13 or later"

from kp.memconv.import_podcasts import import_podcast


def main():
    parser = argparse.ArgumentParser(description="Import a podcast")
    parser.add_argument("filename", help="The filename to import")
    # TODO: Add more arguments for the import_podcast function.
    args = parser.parse_args()
    pod = import_podcast(args.filename, None, Datetime.now(), 3.0)
    print("Name-Tag:", pod.name_tag)
    print("Tags:", ", ".join(pod.tags))
    for msg in pod.messages:
        print()
        print(msg)


if __name__ == "__main__":
    main()
