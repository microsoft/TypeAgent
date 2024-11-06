# Copyright (c) Microsoft Corporation and Henry Lucco.
# Licensed under the MIT License.

from dataclasses import dataclass
from typing import List
from openai import OpenAI
import os

@dataclass
class Embedding:
    values: List[float]
    dimension: int

    @classmethod
    def from_text(cls, text: str) -> "Embedding":
        openai_api_key = os.environ.get("OPENAI_API_KEY")
        if not openai_api_key:
            raise ValueError("OPENAI_API_KEY environment variable is not set")

        openai_client = OpenAI(
            api_key=openai_api_key
        )
        text = text.strip().replace("\n", " ")

        embedding_model = os.environ.get("EMBEDDING_MODEL", "text-embedding-ada-002")

        embedding_value = openai_client.embeddings.create(
            input=[text],
            model=embedding_model
        ).data[0].embedding

        return cls(embedding_value, len(embedding_value))

    @classmethod
    def from_dict(cls, embedding_dict: dict) -> "Embedding":
        return cls(embedding_dict["values"], embedding_dict["dimension"])
    
    def to_dict(self):
        return {
            "values": self.values,
            "dimension": self.dimension
        }