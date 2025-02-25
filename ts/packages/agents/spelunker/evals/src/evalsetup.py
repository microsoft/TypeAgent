# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Script to set up an evaluation database for spelunker.

Usage: evalsetup.py SOURCE EVALDIR

By default SOURCE is ~/.typeagent/agents/spelunker/codeSearchDatabase.db,
and EVALDIR evals/eval-1.

EVALDIR is always a new directory; if the given directory already exists,
we create a new directory name by adding -2, -3, etc.

This script does the following:
- Copy tables Files, Chunks, Blobs from source to destination
- Create new tables EvalInfo, Hashes, Questions, Scores
- Fill in Hashes table with chunk hashes

Hashes are computed as follows:
- The first line is the filename, relative to EVALDIR/sources
- The second line is the path from the root node, e.g. "module class method"
- The remaining lines are those of the Chunk's Blobs, in order

These lines are joined with "\n", encoded to bytes, fed to md5(),
and then hex-encoded. This design allows re-indexing the sample
codebase, which assigns all new chunk IDs. (Although I don't have
a tool to do this currently.)
"""

import argparse
import hashlib
import os
import re
import sqlite3
import sys


def main():
    parser = argparse.ArgumentParser(
        description="Set up an evaluation database for spelunker."
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Overwrite the database if it already exists.",
    )
    parser.add_argument(
        "source",
        nargs="?",
        type=str,
        help="The source database file.",
        default="~/.typeagent/agents/spelunker/codeSearchDatabase.db",
    )
    parser.add_argument(
        "evaldir",
        nargs="?",
        type=str,
        help="The evaluation directory.",
        default="evals/eval-1",
    )
    args = parser.parse_args()
    source: str = os.path.expanduser(args.source)
    evaldir: str = args.evaldir

    if not os.path.exists(source):
        print(f"Source database {source} does not exist.", file=sys.stderr)
        os._exit(2)

    if not args.overwrite:
        while os.path.exists(evaldir):
            m = re.match(r"(.*?)(\d+)$", evaldir)
            if m:
                digits = m.group(2)
                num = int(digits)
                evaldir = m.group(1) + str(num + 1)
            else:
                evaldir += "-1"
    if not os.path.exists(evaldir):
        os.makedirs(evaldir)
    filename_prefix = os.path.join(os.path.realpath(evaldir), "source", "")
    print(f"Prefix: {filename_prefix}")
    dbname = os.path.join(evaldir, "eval.db")
    print(f"Database: {dbname}")

    if args.overwrite:
        # TODO: Unsafe, but okay for now
        assert "'" not in dbname, dbname  # TODO: Still not safe?
        os.system(f"rm '{dbname}'*")

    src_conn = sqlite3.connect(f"file:{source}?mode=ro", uri=True)
    src_cur = src_conn.cursor()
    dst_conn = sqlite3.connect(dbname)
    dst_cur = dst_conn.cursor()

    copy_table(src_cur, dst_cur, "Files")
    copy_table(src_cur, dst_cur, "Chunks")
    copy_table(src_cur, dst_cur, "Blobs")
    src_conn.close()

    add_new_tables(dst_cur)
    fill_in_hashes(dst_cur, filename_prefix)
    dst_conn.commit()  # Actually write the data!
    dst_conn.close()


def copy_table(src_cur, dst_cur, table_name):
    # Get CREATE TABLE SQL from the source
    create_sql = src_cur.execute(
        f"SELECT sql FROM sqlite_master WHERE type='table' AND name='{table_name}'"
    ).fetchone()[0]
    if create_sql.startswith("CREATE TABLE"):
        create_sql = create_sql.replace("CREATE TABLE", "CREATE TABLE IF NOT EXISTS")
    # print(create_sql)
    print("Creating and clearing table {table_name}")
    dst_cur.execute(create_sql)
    dst_cur.execute(f"DELETE FROM {table_name}")

    # Copy rows
    rows = src_cur.execute(f"SELECT * FROM {table_name}").fetchall()
    print(f"Inserting {len(rows)} rows with {len(rows[0])} columns into {table_name}")
    placeholders = ",".join(["?"] * len(rows[0]))
    dst_cur.executemany(f"INSERT INTO {table_name} VALUES ({placeholders})", rows)


DBSCHEMA = """
CREATE TABLE IF NOT EXISTS Hashes (
    chunkHash TEXT PRIMARY KEY,
    chunkId TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS Questions (
    questionId INTEGER PRIMARY KEY,
    question TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS Scores (
    questionId INTEGER REFERENCES Questions(id),
    chunkHash TEXT REFERENCES Hashes(chunkHash),
    score INTEGER,  -- 0 or 1,
    timestamp TEXT
);
"""
# TODO: Table to record eval runs (the eval tool can create-or-insert that)


def add_new_tables(dst_cur):
    for sql in DBSCHEMA.split(";"):
        sql = sql.strip()
        if not sql or sql.startswith("--"):
            continue
        table_name = sql.split()[5]
        print(f"Creating table {table_name} and clearing it")
        dst_cur.execute(sql)
        dst_cur.execute(f"DELETE FROM {table_name}")


def fill_in_hashes(dst_cur, prefix):
    count = 0
    # Fetch all chunks
    selection = dst_cur.execute(
        "SELECT chunkId, codeName, parentId, fileName FROM Chunks"
    )
    # Use fetchall() because we reuse the cursor below
    for chunkid, codename, parentid, filename in selection.fetchall():
        if filename.startswith(prefix):
            filename = filename[len(prefix) :]  # E.g. 'dispatcher/src/index.ts'
        else:
            print(f"Skipping chunk {chunkid} ({filename}) because it is not in {prefix}")
            continue
        input_lines = [filename]  # Start with the cleaned-up filename

        # Add the path from the root node
        path = [codename]
        pid = parentid
        while pid:
            cn, pid = dst_cur.execute(
                "SELECT codeName, parentId FROM Chunks WHERE chunkId = ?", (pid,)
            ).fetchone()
            path.append(cn)
        path.reverse()  # E.g. "module class method"
        input_lines.append(" ".join(path))

        # Add the lines of all this chunk's blobs
        for (lines,) in dst_cur.execute(
            "SELECT lines FROM Blobs WHERE chunkId = ? ORDER BY start", (chunkid,)
        ):
            input_lines.append(lines)

        data = "\n".join(input_lines).encode()
        chunkhash = hashlib.md5(data).hexdigest()
        # input(f"{data.decode()}\n{chunkhash} --> ")

        # Update the table
        # print(f"{chunkhash} {chunkid}")
        dst_cur.execute(
            "INSERT INTO Hashes (chunkHash, chunkId) VALUES (?, ?)",
            (chunkhash, chunkid),
        )
        count += 1

    print(f"Inserted {count} unique hashes into Hashes")


if __name__ == "__main__":
    main()
