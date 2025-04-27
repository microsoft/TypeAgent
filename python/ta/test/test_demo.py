# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import argparse
import asyncio
import os
import textwrap
import time

from typeagent.aitools import auth
from typeagent.knowpro.importing import ConversationSettings
from typeagent.podcasts import podcast

from fixtures import needs_auth

tests_dir = os.path.dirname(__file__)
root_dir = os.path.dirname(tests_dir)
DEFAULT_FILE = os.path.join(root_dir, "testdata", "Episode_53_AdrianTchaikovsky_index")

parser = argparse.ArgumentParser()
parser.add_argument(
    "filename",
    nargs="?",
    type=str,
    default=DEFAULT_FILE,
)


def test_main(needs_auth):
    # auth is needed because we use embeddings.
    # TODO: Only use the embeddings loaded from the file and cached.
    asyncio.run(main(DEFAULT_FILE))


async def main(filename: str):
    print("Create conversation settings ...")
    settings = ConversationSettings()
    print(f"Loading {filename} ...")
    t0 = time.time()
    pod = podcast.Podcast.read_from_file(filename, settings)
    t1 = time.time()
    print(f"Loading took {t1-t0:.3f} seconds")
    if pod is None:
        print("Failed to read podcast")
        return

    term = "book"
    print(f"\nSearching {pod.name_tag!r} for term {term!r} ...")
    book_list = pod.semantic_ref_index.lookup_term(term)
    if book_list is not None:
        for scored_ord in book_list:
            ord = scored_ord.semantic_ref_ordinal
            assert 0 <= ord < len(pod.semantic_refs)
            sref = pod.semantic_refs[ord]
            assert sref.semantic_ref_ordinal == ord
            print(f"\n{ord}: Term {term!r} has knowledge", end=" ")
            print(f"of type {sref.knowledge_type!r} at {sref.range}:")
            print("    ", sref.knowledge)
            # Now dig up the messages
            start_msg_ord = sref.range.start.message_ordinal
            end_msg_ord = sref.range.end.message_ordinal if sref.range.end else None
            messages = pod.messages[start_msg_ord:end_msg_ord]
            for message, msg_ord in zip(
                messages, range(start_msg_ord, (end_msg_ord or start_msg_ord) + 1)
            ):
                text = " ".join(message.text_chunks).strip()
                wrapped = textwrap.wrap(text)
                for line in wrapped:
                    print(f"  {line}")

    print(f"\nChecking that serialize -> deserialize -> serialize is 'idempotent' ...")
    ser1 = pod.serialize()
    pod2 = podcast.Podcast(settings=settings)
    pod2.deserialize(ser1)
    ser2 = pod.serialize()
    if ser2 != ser1:
        print("Serialized data does not match original")
    else:
        print("Serialized data matches original")


if __name__ == "__main__":
    args = parser.parse_args()
    needs_auth()
    asyncio.run(main(args.filename))
