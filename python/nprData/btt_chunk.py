# Copyright (c) Microsoft Corporation and Henry Lucco.
# Licensed under the MIT License.

from structs import Episode
from dotenv import load_dotenv
from concurrent.futures import ThreadPoolExecutor, as_completed
from structs import Chunk
from qdrant_client import QdrantClient
from qdrant_client.models import VectorParams, Distance
from embedding import Embedding
from generate_chunks import process_turn
import json
import os
from tqdm import tqdm

# TODO move these to argparser
EPISODE_PATH = "btt_podcast.txt"
COLLECTION_NAME = "btt_llm_generic"
CHUNK_PATH = "btt_chunks_llm_generic.json"
USE_LLM = True

if __name__ == "__main__":
    load_dotenv("./env_vars")

    episode_data = Episode.from_text_file(EPISODE_PATH)
    use_llm = USE_LLM

    if not os.path.exists(CHUNK_PATH):
        chunks = []
        for turn in tqdm(episode_data.sections[0].transcript):
            chunk = process_turn(episode_data.id, episode_data.sections[0], turn, use_llm)
            chunks.append(chunk)

        # Removed concurrent processing due to rate limiting from LLM API
        # if wanting to generate chunks where use_llm = False, uncomment the following block 
        """
        with ThreadPoolExecutor() as executor:
            futures = []
            for section in episode_data.sections:
                print(f"Section: {section.title}")
                for turn in section.transcript:
                    futures.append(executor.submit(process_turn, episode_data.id, section, turn, use_llm))

                for future in tqdm(as_completed(futures), total=len(futures)):
                    chunks.append(future.result())
        """

        with open(CHUNK_PATH, "w") as f:
            json.dump([chunk.to_dict() for chunk in chunks], f, indent=4)

    uri = os.environ.get("VECTOR_DB_URI")
    if not uri:
        raise ValueError("VECTOR_DB_URI environment variable is not set")

    client = QdrantClient(uri)

    # check if the collection already exists
    chunks = []
    if not client.collection_exists(COLLECTION_NAME):
        print("Loading chunks...") 
        with open(CHUNK_PATH, "r") as f:
            chunks = [Chunk.from_dict(x) for x in json.load(f)]

        print(f"{len(chunks)} Chunks loaded")

        client.create_collection(
            COLLECTION_NAME,
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
                collection_name=COLLECTION_NAME,
                wait=True,
                points=[point]
            )

        print(f"Upserted {len(points)} points")

    
    print("Collection created")
    collection_info = client.get_collection(COLLECTION_NAME)
    print(collection_info)

    while True:
        query = input("> ")
        if query == "exit" or query == "q" or query == "quit":
            break

        query_vector = Embedding.from_text(query).values
        results = client.search(COLLECTION_NAME, query_vector)

        terminal_size = os.get_terminal_size().columns
        print("="*terminal_size)
        for i, result in enumerate(results):
            print(f"{i + 1}. {result.id} {result.payload.get('speaker').title()} : {result.payload.get('content')} [{result.payload.get('section_title')}]")
        print("="*terminal_size)