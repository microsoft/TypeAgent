# Copyright (c) Microsoft Corporation and Henry Lucco.
# Licensed under the MIT License.

from qdrant_client import QdrantClient
from qdrant_client.models import VectorParams, Distance
from structs import Chunk
import json
import os
from dotenv import load_dotenv
from embedding import Embedding
from tqdm import tqdm

if __name__ == "__main__":
    load_dotenv("env_vars")
    uri = os.environ.get("VECTOR_DB_URI")
    if not uri:
        raise ValueError("VECTOR_DB_URI environment variable is not set")

    client = QdrantClient(uri)

    # check if the collection already exists
    chunks = []
    if not client.collection_exists("npr"):
        print("Loading chunks...") 
        with open("npr_chunks.json", "r") as f:
            chunks = [Chunk.from_dict(x) for x in json.load(f)]

        print(f"{len(chunks)} Chunks loaded")

        client.create_collection(
            "npr",
            vectors_config=VectorParams(
                size=chunks[0].embedding.dimension, 
                distance=Distance.COSINE
            ),
        )

        points = [
            {
                "id": i,
                "vector": chunk.embedding.values,
                "payload" : {
                    "speaker": chunk.speaker,
                    "content": chunk.content,
                    "episode_id": chunk.episode_id,
                    "section_id": chunk.section_id,
                    "section_title": chunk.section_title,
                    "speaker_role": chunk.speaker_role
                }
            } for i, chunk in enumerate(chunks)
        ]

        for point in tqdm(points):
            operation_info = client.upsert(
                collection_name="npr",
                wait=True,
                points=[point]
            )

        print(f"Upserted {len(points)} points")

    
    print("Collection created")
    collection_info = client.get_collection("npr")
    print(collection_info)

    """
    query_vector = Embedding.from_text("cheetah").values
    print(query_vector)
    exit()
    """

    while True:
        query = input("> ")
        if query == "exit" or query == "q" or query == "quit":
            break

        query_vector = Embedding.from_text(query).values
        results = client.search("npr", query_vector)

        terminal_size = os.get_terminal_size().columns
        print("="*terminal_size)
        for i, result in enumerate(results):
            print(f"{i + 1}. {result.id} {result.payload.get('speaker').title()} : {result.payload.get('content')} [{result.payload.get('section_title')}]")
        print("="*terminal_size)