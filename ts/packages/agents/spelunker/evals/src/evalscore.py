#!/usr/bin/env python3
# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Script to manually score chunks relative to a sample question."""

import argparse
import datetime
import os
import sqlite3
import sys


EXT_TO_LANG = {
    ".py": "python",
    ".ts": "typescript",
}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "-f",
        "--folder",
        type=str,
        required=False,
        default="evals/eval-1",
        help="Path to the eval folder (default 'evals/eval-1').",
    )
    parser.add_argument(
        "-q",
        "--question",
        type=str,
        required=True,
        help=(
            "The question to score chunks against\n"
            + "(e.g. 'Describe the toplevel classes and interfaces').\n"
            + "May also be an integer question ID."
        ),
    )
    args = parser.parse_args()

    conn = sqlite3.connect(os.path.join(args.folder, "eval.db"))
    cursor = conn.cursor()

    filename_prefix = os.path.join(os.path.realpath(args.folder), "source", "")

    question = args.question
    try:
        question_id = int(question)
    except ValueError:
        question_id = get_question_id_by_text(cursor, question)
        conn.commit()
    else:
        question = get_question_by_id(cursor, question_id)

    # Score each chunk
    selection = cursor.execute(
        "SELECT chunkId, codeName, parentId, fileName FROM Chunks"
    )
    # Use fetchall() because we reuse the cursor below
    for chunk_id, code_name, parent_id, filename in selection.fetchall():
        hash_row = cursor.execute(
            "SELECT chunkHash FROM Hashes WHERE chunkId = ?",
            [chunk_id],
        ).fetchone()
        if hash_row is None:
            print(f"Skipping chunk {chunk_id} ({code_name}) because it has no hash")
            continue

        chunk_hash = hash_row[0]
        score_row = cursor.execute(
            "SELECT score FROM Scores WHERE questionId = ? AND chunkHash = ?",
            (question_id, chunk_hash),
        ).fetchone()
        if score_row is not None and score_row[0] is not None:
            print(
                f"Skipping chunk {chunk_id} ({code_name}) because it has already been scored"
            )
            continue

        if filename_prefix and filename.startswith(filename_prefix):
            filename = filename[len(filename_prefix) :]

        language = EXT_TO_LANG.get(os.path.splitext(filename)[1])
        if not language:
            print(
                f"Skipping chunk {chunk_id} ({code_name} in {os.path.basename(filename)})"
                + "because it has no supported language"
            )
            continue

        path = [code_name]
        pid = parent_id
        while pid:
            cn, pid = cursor.execute(
                "SELECT codeName, parentId FROM Chunks WHERE chunkId = ?", (pid,)
            ).fetchone()
            path.append(cn)
        path.reverse()  # E.g. "module class method"
        chunk_text = f"{filename}\n{'.'.join(path)}\n"
        chunk_text += get_chunk_text(cursor, chunk_id)
        score = score_chunk(question, chunk_text, language)

        timestamp = datetime.datetime.now().isoformat()
        cursor.execute(
            "INSERT OR REPLACE INTO Scores (questionId, chunkHash, score, timestamp) VALUES (?, ?, ?, ?)",
            (question_id, chunk_hash, score, timestamp),
        )
        conn.commit()

    conn.close()


def get_question_by_id(cursor: sqlite3.Cursor, question_id):
    row = cursor.execute(
        "SELECT question FROM Questions WHERE questionId = ?",
        [question_id],
    ).fetchone()
    if not row:
        print(f"Question ID {question_id} not found")
        return sys.exit(1)

    question = row[0]
    print(f"Existing question: {question}")
    return question


def get_question_id_by_text(cursor: sqlite3.Cursor, question):
    row = cursor.execute(
        "SELECT questionId FROM Questions WHERE question = ?",
        [question],
    ).fetchone()
    if row:
        question_id = row[0]
        print(f"Existing question ID: {question_id}")
        return question_id

    # Write the question to the database (ID is auto-generated)
    cursor.execute(
        "INSERT INTO Questions (question) VALUES (?)",
        [question],
    )

    # Retrieve the question ID from the newly inserted row
    row = cursor.execute(
        "SELECT questionId FROM Questions WHERE question = ?",
        [question],
    ).fetchone()
    if not row:
        print(f"Huh? Newly inserted question not found")
        return sys.exit(1)

    question_id = row[0]
    print(f"New question ID: {question_id}")
    return question_id


def get_chunk_text(cursor: sqlite3.Cursor, chunkid):
    text_lines = []
    for (lines,) in cursor.execute(
        "SELECT lines from Blobs WHERE chunkId = ?",
        [chunkid],
    ):
        text_lines.append(lines)
    return "\n".join(text_lines)


def score_chunk(question, chunk_text, language):
    separator = "-" * 79
    print(separator)
    pipe = os.popen(f"pygmentize -l {language} | less -FRX", "w")
    pipe.write(chunk_text)
    pipe.close()
    headlines = chunk_text.splitlines()[:2]
    for line in headlines:
        print(line)
    yes = no = False
    while not yes and not no:
        score = input(question + "\nInclude this chunk (y/n): ")
        yes = score.lower() in ("1", "y", "yes")
        no = score.lower() in ("0", "n", "no")
    assert yes != no
    return int(yes)


if __name__ == "__main__":
    main()
