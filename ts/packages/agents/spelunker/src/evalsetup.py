"""Script to set up an evaluation database for spelunker.

Usage: evalsetup.py SOURCE EVALDIR

By default SOURCE is ~/.typeagent/agents/spelunker/codeSearchDatabase.db,
and EVALDIR ./test-data/evals/eval-1/.
"""

import argparse
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
        default=os.path.expanduser(
            "~/.typeagent/agents/spelunker/codeSearchDatabase.db"
        ),
    )
    parser.add_argument(
        "evaldir",
        nargs="?",
        type=str,
        help="The evaluation directory.",
        default="./test-data/evals/eval-1",
    )
    args = parser.parse_args()
    source: str = args.source
    evaldir: str = args.evaldir.rstrip(os.sep) or os.sep

    if not os.path.exists(source):
        print(f"Source database {source} does not exist.", file=sys.stderr)
        os.exit(2)

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


if __name__ == "__main__":
    main()
