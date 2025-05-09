# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

from typechat import error, Result

from .convknowledge import KnowledgeExtractor
from . import kplib
# from aiclient import ChatModel
# from .conversation_index import create_knowledge_model
# from .knowledge_merge import concrete_to_merged_entities, merged_to_concrete_entity
# from .task_queue import BatchTask, run_in_batches

def create_knowledge_extractor(chat_model: ChatModel = None) -> KnowledgeExtractor:
    """Create a knowledge extractor using the given Chat Model."""
    chat_model = chat_model or create_knowledge_model()
    extractor = kplib.create_knowledge_extractor(chat_model, {
        "maxContextLength": 4096,
        # This should *ALWAYS* be False.
        # Merging is handled during indexing:
        "mergeActionKnowledge": False,
    })
    return extractor

async def extract_knowledge_from_text(
    knowledge_extractor: KnowledgeExtractor,
    text: str,
    max_retries: int,
) -> Result[kplib.KnowledgeResponse]:
    """Extract knowledge from a single text input with retries."""
    # TODO: Add a retry mechanism to handle transient errors.
    return await knowledge_extractor.extract_with_retry(text, max_retries)

async def extract_knowledge_from_text_batch(
    knowledge_extractor: KnowledgeExtractor,
    text_batch: list[str],
    concurrency: int = 2,
    max_retries: int = 3,
) -> list[Result[kplib.KnowledgeResponse]]:
    """Extract knowledge from a batch of text inputs concurrently."""
    # TODO: Use concurrency.
    results: list[Result[kplib.KnowledgeResponse]] = []
    for text in text_batch:
        result = await extract_knowledge_from_text(knowledge_extractor, text, max_retries)
        results.append(result)
    return results

def merge_concrete_entities(entities: list[kplib.ConcreteEntity]) -> list[kplib.ConcreteEntity]:
    """Merge a list of concrete entities into a single list of merged entities."""
    merged_entities = concrete_to_merged_entities(entities)

    merged_concrete_entities = []
    for merged_entity in merged_entities.values():
        merged_concrete_entities.append(merged_to_concrete_entity(merged_entity))
    return merged_concrete_entities

def merge_topics(topics: list[str]) -> list[str]:
    """Merge a list of topics into a unique list of topics."""
    merged_topics = set(topics)
    return list(merged_topics)

async def extract_knowledge_for_text_batch_q(
    knowledge_extractor: KnowledgeExtractor,
    text_batch: list[str],
    concurrency: int = 2,
    max_retries: int = 3,
) -> list[Result[kplib.KnowledgeResponse]]:
    """Extract knowledge for a batch of text inputs using a task queue."""
    task_batch = [BatchTask(task=text) for text in text_batch]

    await run_in_batches(
        task_batch,
        lambda text: extract_knowledge_from_text(knowledge_extractor, text, max_retries),
        concurrency,
    )

    results = []
    for task in task_batch:
        results.append(task.result if task.result else error("No result"))
    return results
