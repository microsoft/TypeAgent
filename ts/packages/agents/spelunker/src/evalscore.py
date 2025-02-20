# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Script to manually score chunks relative to a sample question."""

import argparse
import datetime
import os
import sqlite3


EXT_TO_LANG = {
    ".py": "python",
    ".ts": "typescript",
}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--db",
        type=str,
        required=True,
        help="Path to the SQLite database file.",
    )
    parser.add_argument(
        "--question",
        type=str,
        required=True,
        help="The question to score chunks against.",
    )
    args = parser.parse_args()

    conn = sqlite3.connect(args.db)
    cursor = conn.cursor()

    question_row = cursor.execute(
        "SELECT questionId FROM questions WHERE question = ?",
        [args.question],
    ).fetchone()
    if question_row:
        question_id = question_row[0]
        print(f"Existing question ID: {question_id}")
    else:
        # Write the question to the database (unique key auto-generated)
        cursor.execute(
            "INSERT INTO questions (question) VALUES (?)",
            [args.question],
        )
        conn.commit()
        [question_id] = cursor.execute(
            "SELECT questionId FROM questions WHERE question = ?",
            [args.question],
        ).fetchone()
        assert question_id, question_id
        print(f"New question ID: {question_id}")

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
            "SELECT score FROM ManualScores WHERE questionId = ? AND chunkHash = ?",
            (question_id, chunk_hash),
        ).fetchone()
        if score_row is not None and score_row[0] is not None:
            print(f"Skipping chunk {chunk_id} ({code_name}) because it has already been scored")
            continue

        if filename.startswith(os.getenv("HOME") + os.sep):
            filename = "~" + filename[len(os.getenv("HOME")) :]

        language = EXT_TO_LANG.get(os.path.splitext(filename)[1])
        if not language:
            print(f"Skipping chunk {chunk_id} ({code_name} in {os.path.basename(filename)})" +
                  "because it has no supported language")
            continue

        path = [code_name]
        pid = parent_id
        while pid:
            cn, pid = cursor.execute(
                "SELECT codeName, parentId FROM Chunks WHERE chunkId = ?", (pid,)
            ).fetchone()
            path.append(cn)
        path.reverse()  # E.g. "module class method"
        chunk_text = f"{filename}\n{' '.join(path)}\n"
        chunk_text += get_chunk_text(cursor, chunk_id)
        score = score_chunk(args.question, chunk_text, language)

        timestamp = datetime.datetime.now().isoformat()
        cursor.execute(
            "INSERT OR REPLACE INTO ManualScores (questionId, chunkHash, score, timestamp) VALUES (?, ?, ?, ?)",
            (question_id, chunk_hash, score, timestamp),
        )
        conn.commit()

    conn.close()


def get_chunk_text(cursor: sqlite3.Cursor, chunkid):
    text_lines = []
    for (lines,) in cursor.execute(
        "SELECT lines from Blobs WHERE chunkId = ?",
        [chunkid],
    ):
        text_lines.append(lines)
    return "\n".join(text_lines)


def score_chunk(question, chunk_text, language):
    separator = "-" * 50
    print(separator)
    pipe = os.popen(f"pygmentize -l {language}", "w")
    pipe.write(chunk_text)
    pipe.close()
    print(separator)
    yes = no = False
    while not yes and not no:
        score = input("Score: ")
        yes = score.lower() in ("1", "y", "yes")
        no = score.lower() in ("0", "n", "no")
    assert yes != no
    return int(yes)


if __name__ == "__main__":
    main()
