# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import asyncio
import os

import dotenv

from typeagent.knowpro import convknowledge


async def main():
    dotenv.load_dotenv(os.path.join(os.path.dirname(__file__), "../../ts/.env"))  # TODO: Only works in dev tree
    # for k, v in os.environ.items():
    #     print(f"{k}={v!r}")
    ke = convknowledge.KnowledgeExtractor()
    print(await ke.extract("There is a book about hobbits called the Lord of the Rings."))


asyncio.run(main())
