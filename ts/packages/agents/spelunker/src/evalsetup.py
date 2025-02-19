"""Script to set up an evaluation database for spelunker.

Usage: evalsetup.py SOURCE EVALDIR

By default SOURCE is ~/.typeagent/agents/spelunker/codeSearchDatabase.db,
and EVALDIR ./test-data/evals/eval-1/.
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
        default="./test-data/evals/eval-1",
    )
    args = parser.parse_args()
    source: str = os.path.expanduser(args.source)
    evaldir: str = args.evaldir

    if not os.path.exists(source):
        print(f"Source database {source} does not exist.", file=sys.stderr)
        os._exit(2)

    while os.path.exists(evaldir):
        m = re.match(r"(.*?)(\d+)$", evaldir)
        if m:
            digits = m.group(2)
            num = int(digits)
            evaldir = m.group(1) + str(num + 1)
        else:
            evaldir += "-1"
    os.makedirs(evaldir)
    dbname = os.path.join(evaldir, "eval.db")
    print(f"Database: {dbname}")

    src_conn = sqlite3.connect(f"file:{source}?mode=ro", uri=True)
    src_cur = src_conn.cursor()
    dst_conn = sqlite3.connect(dbname)
    dst_cur = dst_conn.cursor()

    copy_table(src_cur, dst_cur, "Files")
    copy_table(src_cur, dst_cur, "Chunks")
    copy_table(src_cur, dst_cur, "Blobs")
    add_new_tables(dst_cur)
    fill_in_hashes(dst_cur)

    dst_conn.commit()  # Actually write the data!
    dst_conn.close()
    src_conn.close()


def copy_table(src_cur, dst_cur, table_name):
    # Get CREATE TABLE SQL from the source
    create_sql = src_cur.execute(
        f"SELECT sql FROM sqlite_master WHERE type='table' AND name='{table_name}'"
    ).fetchone()[0]
    # print(create_sql)
    dst_cur.execute(create_sql)

    # Copy rows
    rows = src_cur.execute(f"SELECT * FROM {table_name}").fetchall()
    print(f"Inserting {len(rows)} rows with {len(rows[0])} columns into {table_name}")
    placeholders = ",".join(["?"] * len(rows[0]))
    dst_cur.executemany(f"INSERT INTO {table_name} VALUES ({placeholders})", rows)


DBSCHEMA = """
CREATE TABLE EvalInfo (  -- Only one row
    startDate TEXT,
    endDate TEXT,
    notes TEXT
);
CREATE TABLE Hashes (
    chunkHash TEXT PRIMARY KEY,
    chunkId TEXT NOT NULL UNIQUE
);
CREATE TABLE Questions (
    questionId INTEGER PRIMARY KEY,
    question TEXT NOT NULL
);
CREATE TABLE ManualScores (
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
        if not sql:
            continue
        print(f"Creating table {sql.split()[2]}")
        dst_cur.execute(sql)


def fill_in_hashes(dst_cur):
    count = 0
    # Fetch all chunks
    selection = dst_cur.execute("SELECT chunkId, codeName, parentId, fileName FROM Chunks")
    for chunkid, codename, parentid, filename in selection.fetchall():
        if filename.startswith(os.getenv("HOME") + os.sep):
            filename = "~" + filename[len(os.getenv("HOME")) : ]
        input = [filename]  # Start with the cleaned-up filename

        # Add the path from the root node
        path = [codename]
        pid = parentid
        while pid:
            cn, pid = dst_cur.execute(
                "SELECT codeName, parentId FROM Chunks WHERE chunkId = ?", (pid,)
            ).fetchone()
            path.append(cn)
        path.reverse()  # E.g. "module class method"
        input.append(" ".join(path))

        # Add the lines of all this chunk's blobs
        for lines in dst_cur.execute(
            "SELECT lines FROM Blobs WHERE chunkId = ? ORDER BY start", (chunkid,)
        ):
            input.append(lines[0].rstrip())

        chunkhash = hashlib.md5("\n".join(input).encode()).hexdigest()

        # Update the table
        dst_cur.execute(
            "INSERT INTO Hashes (chunkHash, chunkId) VALUES (?, ?)",
            (chunkhash, chunkid),
        )
        count += 1

    print(f"Inserted {count} unique hashes into Hashes")


if __name__ == "__main__":
    main()
