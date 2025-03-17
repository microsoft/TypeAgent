# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import os
import re

import dotenv
import numpy as np
from openai import AsyncOpenAI, AsyncAzureOpenAI

dotenv.load_dotenv(os.path.expanduser("~/TypeAgent/ts/.env"))


class AsyncEmbeddingModel:
    def __init__(self):
        if os.environ.get("AZURE_OPENAI_API_KEY"):
            print("Using Azure OpenAI")
            endpoint = os.environ.get("AZURE_OPENAI_ENDPOINT_EMBEDDING_3_SMALL")
            m = re.search(r"[?,]api-version=([^,]+)$", endpoint)
            if m:
                api_version = m.group(1)
            else:
                print(endpoint)
                raise ValueError("Endpoint URL doesn't end in version=<version>")
            self.async_client = AsyncAzureOpenAI(
                api_version=api_version,
                azure_endpoint=endpoint,
            )
        else:
            print("Using OpenAI")
            async_client = AsyncOpenAI()

    async def get_embedding(self, input: str) -> list[float]:
        return self.get_embeddings([input])[0]

    async def get_embeddings(self, input: list[str]) -> list[list[float]]:
        data = (
            await self.async_client.embeddings.create(
                input=input, model="text-embedding-3-small", encoding_format="float"
            )
        ).data
        return [d.embedding for d in data]


async def main():
    async_model = AsyncEmbeddingModel()
    result = await async_model.get_embeddings(["Hello, world", "Foo bar baz"])
    print(result)


if __name__ == "__main__":
    import asyncio

    asyncio.run(main())
