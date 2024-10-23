# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Display the tree structure of a given directory tree."""

import binascii
import os
import sys
import time

rootdir = "\\data\\code"


def main():
    global rootdir
    # TODO: argparse
    if sys.argv[1:]:
        assert not sys.argv[2:], "Too many arguments."  # TODO
        rootdir = sys.argv[1]
    rootdir = os.path.normpath(rootdir)
    while True:
        if os.name == "nt":
            # Get screen width on Windows
            import ctypes
            handle = ctypes.windll.kernel32.GetStdHandle(-11)
            info = ctypes.create_string_buffer(22)
            ctypes.windll.kernel32.GetConsoleScreenBufferInfo(handle, info)
            rows = int.from_bytes(info[0x10:0x12], "little")
            columns = int.from_bytes(info[0x12:0x14], "little")
        else:
            # Get screen width on Unix
            rows, columns = map(int, os.popen("stty size", "r").read().split())
        print_tree(rootdir, rows, columns)
        time.sleep(1)


CLEAR_SCREEN = "\x1b[H\x1b[2J\x1b[3J"

def print_tree(rootdir, screenheight, screenwidth):
    output = [CLEAR_SCREEN]
    # output.append(f"{screenheight, screenwidth}\n")  # Debug
    output.append(f"Rootdir: {rootdir}\n")
    for dirpath, dirnames, filenames in os.walk(rootdir):
        dirnames.sort()
        filenames.sort()
        if dirpath.startswith(rootdir):
            dirpath = dirpath[len(rootdir):]
        if dirpath.startswith(os.sep):
            dirpath = dirpath[1:]
        if not dirpath:
            continue
        parts = dirpath.split(os.sep)
        assert parts
        output.append(f"{'    '*(len(parts)-1)}{parts[-1]}{os.sep}\n")
        for filename in filenames:
            fullpath = os.path.join(rootdir, dirpath, filename)
            try:
                with open(fullpath, "rb") as f:
                    contents = f.read()
            except OSError as err:
                output.append(f"{'    '*len(parts)}{filename}: {err!r}\n")
                continue
            length = len(contents)
            try:
                contents = contents.decode("utf-8")
                contents = ascii(contents)
            except UnicodeDecodeError:
                contents = binascii.hexlify(contents, " ").decode("ascii")
            head = f"{'    '*len(parts)}{filename}, {length} bytes: "
            tail = f"{contents:.{screenwidth - len(head)}s}\n"
            output.append(head + tail)
    print("".join(output))


if __name__ == "__main__":
    main()
