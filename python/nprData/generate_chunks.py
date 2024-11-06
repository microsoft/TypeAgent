# Copyright (c) Microsoft Corporation and Henry Lucco.
# Licensed under the MIT License.

import json
from structs import Episode, Chunk, Turn, Section
from embedding import Embedding
from tqdm import tqdm
from dotenv import load_dotenv
from concurrent.futures import ThreadPoolExecutor, as_completed
from llm_util import LLMChat
from prompts import typeagent_entity_extraction_system_full, generic_chunk_prompt

def generate_chunk_content(content: str) -> str:
    chat = LLMChat()
    # this for experimenting with how an embedding of a json string performs
    # prompt = typeagent_entity_extraction_system_full(content)
    # more state of the art typical prose prompt
    prompt = generic_chunk_prompt(content)
    response_turn = chat.send_message("user", prompt)
    return response_turn.content

def process_turn(
        episode_id: str, 
        section: Section, 
        turn: Turn, 
        use_llm: bool = False
    ) -> Chunk:
    cleaned_title = section.title.split("<")[-1].strip()

    content = turn.content
    if use_llm:
        content = generate_chunk_content(content)

    embedding = Embedding.from_text(content)
    
    # print(f"Generated embedding of size {embedding.dimension} for {turn.id}")

    chunk = Chunk(
        id=turn.id,
        episode_id=episode_id,
        section_title=cleaned_title,
        section_id=section.id,
        speaker=turn.speaker,
        content=content,
        speaker_role=turn.speaker_role,
        embedding=embedding
    )
    return chunk

def generate_chunks(in_file: str, out_file: str):
    with open(in_file, "r") as f:
        data = json.load(f)
        print(len(data))
        episodes = [Episode.from_dict(episode) for episode in data]
        chunks = []

        with ThreadPoolExecutor() as executor:
            futures = []

            for episode in tqdm(episodes):
                for section in episode.sections:
                    for turn in section.transcript:
                        futures.append(executor.submit(process_turn, episode.id, section, turn))


            for future in tqdm(as_completed(futures), total=len(futures)):
                chunks.append(future.result())

        with open(out_file, "w") as f:
            json.dump([chunk.to_dict() for chunk in chunks], f, indent=4)

if __name__ == "__main__":
    load_dotenv("./env_vars")
    generate_chunks(
        in_file="npr.json",
        out_file="npr_chunks.json"
    )