# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import os
import re

import dotenv
import numpy as np
from numpy.typing import NDArray
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
                raise ValueError("Endpoint URL doesn't end in version=<version>")
            self.async_client = AsyncAzureOpenAI(
                api_version=api_version,
                azure_endpoint=endpoint,
            )
        else:
            print("Using OpenAI")
            async_client = AsyncOpenAI()

    async def get_embedding(self, input: str) -> NDArray[np.float32]:
        return self.get_embeddings([input])[0]

    async def get_embeddings(self, input: list[str]) -> NDArray[np.float32]:
        data = (
            await self.async_client.embeddings.create(
                input=input,
                model="text-embedding-3-small",  ##encoding_format="float"
            )
        ).data
        return np.array([d.embedding for d in data], dtype=np.float32)


async def main():
    async_model = AsyncEmbeddingModel()
    inputs = ["Hello, world", "Foo bar baz"]
    embeddings = await async_model.get_embeddings(inputs)
    for input, embedding in zip(inputs, embeddings, strict=True):
        print(f"{input}: {len(embedding)} {embedding[:5]}...{embedding[-5:]}")


if __name__ == "__main__":
    import asyncio

    asyncio.run(main())
