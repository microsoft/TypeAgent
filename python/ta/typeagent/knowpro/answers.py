# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

from dataclasses import asdict
from typing import Any, cast

import black
import typechat

from ..aitools import utils
from .answer_context_schema import AnswerContext, RelevantKnowledge, RelevantMessage
from .answer_response_schema import AnswerResponse
from .convknowledge import create_typechat_model
from .interfaces import IConversation, IMessage, ITermToSemanticRefIndex, Topic
from .kplib import ConcreteEntity
from .search import ConversationSearchResult


async def generate_answers(
    translator: typechat.TypeChatJsonTranslator[AnswerResponse],
    search_results: list[ConversationSearchResult],
    conversation: IConversation,
    orig_query_text: str,
) -> tuple[list[AnswerResponse], AnswerResponse]:  # (all answers, combined answer)
    all_answers: list[AnswerResponse] = []
    good_answers: list[str] = []
    for i, search_result in enumerate(search_results):
        for j, result in enumerate(search_results):
            answer = await generate_answer(translator, result, conversation)
            all_answers.append(answer)
            match answer.type:
                case "Answered":
                    assert answer.answer is not None, "Answered answer must not be None"
                    good = answer.answer.strip()
                    if good:
                        good_answers.append(good)
                case "NoAnswer":
                    pass
                case _:
                    raise ValueError(f"Unexpected answer type: {answer.type}")
    combined_answer: AnswerResponse | None = None
    if len(good_answers) >= 2:
        combined_answer = await combine_answers(
            translator, good_answers, orig_query_text
        )
    elif len(good_answers) == 1:
        combined_answer = AnswerResponse(type="Answered", answer=good_answers[0])
    else:
        combined_answer = AnswerResponse(
            type="NoAnswer", whyNoAnswer="No good answers found."
        )
    return all_answers, combined_answer


# TODO: Pass typechat model in as an argument to avoid creating it every time.
async def generate_answer[TMessage: IMessage, TIndex: ITermToSemanticRefIndex](
    translator: typechat.TypeChatJsonTranslator[AnswerResponse],
    search_result: ConversationSearchResult,
    conversation: IConversation[TMessage, TIndex],
) -> AnswerResponse:
    assert search_result.raw_query_text is not None, "Raw query text must not be None"
    request = f"{create_question_prompt(search_result.raw_query_text)}\n\n{create_context_prompt(make_context(search_result, conversation))}"
    result = await translator.translate(request)
    if isinstance(result, typechat.Failure):
        return AnswerResponse(type="NoAnswer", answer=None, whyNoAnswer=result.message)
    else:
        return result.value


def create_question_prompt(question: str) -> str:
    prompt = [
        "The following is a user question:",
        "===",
        question,
        "===",
        "- The included [ANSWER CONTEXT] contains information that MAY be relevant to answering the question.",
        "- Answer the user question PRECISELY using ONLY relevant topics, entities, actions, messages and time ranges/timestamps found in [ANSWER CONTEXT].",
        "- Return 'NoAnswer' if unsure or if the topics and entity names/types in the question are not in [ANSWER CONTEXT].",
        "- Use the 'name', 'type' and 'facets' properties of the provided JSON entities to identify those highly relevant to answering the question.",
        "- When asked for lists, ensure the the list contents answer the question and nothing else.",
        "E.g. for the question 'List all books': List only the books in [ANSWER CONTEXT].",
        "- Use direct quotes only when needed or asked. Otherwise answer in your own words.",
        "- Your answer is readable and complete, with appropriate formatting: line breaks, numbered lists, bullet points etc.",
    ]
    return "\n".join(prompt)


def create_context_prompt(context: AnswerContext) -> str:
    # TODO: Use a more compact representation of the context than JSON.
    prompt = [
        "[ANSWER CONTEXT]",
        "===",
        black.format_str(str(dictify(context)), mode=black.FileMode(line_length=200)),
        "===",
    ]
    return "\n".join(prompt)


def dictify(object: object) -> Any:
    """Convert an object to a dictionary, recursively."""
    # NOTE: Can't use dataclasses.asdict() because not every object is a dataclass.
    if ann := getattr(object.__class__, "__annotations__", None):
        return {
            k: dictify(v) for k in ann if (v := getattr(object, k, None)) is not None
        }
    elif isinstance(object, dict):
        return {k: dictify(v) for k, v in object.items() if v is not None}
    elif isinstance(object, list):
        return [dictify(item) for item in object]
    elif hasattr(object, "__dict__"):
        return {
            k: dictify(v) for k, v in object.__dict__.items() if v is not None
        }  #  if not k.startswith("_")
    else:
        if isinstance(object, float) and object.is_integer():
            return int(object)
        else:
            return object


def make_context[TMessage: IMessage, TIndex: ITermToSemanticRefIndex](
    search_result: ConversationSearchResult,
    conversation: IConversation[TMessage, TIndex],
) -> AnswerContext:
    answer_context = AnswerContext([], [], [])
    answer_context.entities = []
    answer_context.topics = []
    answer_context.messages = []
    # TODO: TopK
    for scored_msg_ord in search_result.message_matches:
        msg = conversation.messages[scored_msg_ord.message_ordinal]
        answer_context.messages.append(
            RelevantMessage(  # TODO: type-safety
                from_=msg.speaker,  # type: ignore  # It's a PodcastMessage
                to=msg.listeners,  # type: ignore  # It's a PodcastMessage
                timestamp=msg.timestamp,  # type: ignore  # It's a PodcastMessage
                messageText=" ".join(msg.text_chunks),
            )
        )
    # TODO: merge, then TopK
    for ktype, knowledge in search_result.knowledge_matches.items():
        assert conversation.semantic_refs is not None, "Semantic refs must not be None"
        match ktype:
            case "entity":
                for scored_sem_ref_ord in knowledge.semantic_ref_matches:
                    sem_ref = conversation.semantic_refs[
                        scored_sem_ref_ord.semantic_ref_ordinal
                    ]
                    entity = cast(ConcreteEntity, sem_ref.knowledge)
                    answer_context.entities.append(
                        RelevantKnowledge(
                            knowledge=asdict(entity),
                            origin=None,
                            audience=None,
                            timeRange=None,
                        )
                    )
            case "topic":
                topic = cast(Topic, knowledge)
                answer_context.topics.append(
                    RelevantKnowledge(
                        knowledge=asdict(topic),
                        origin=None,
                        audience=None,
                        timeRange=None,
                    )
                )
            case _:
                pass  # TODO: Actions and topics too???
    return answer_context


async def combine_answers(
    translator: typechat.TypeChatJsonTranslator[AnswerResponse],
    answers: list[str],
    original_query_text: str,
) -> AnswerResponse:
    """Combine multiple answers into a single answer."""
    if not answers:
        return AnswerResponse(type="NoAnswer", whyNoAnswer="No answers provided.")
    if len(answers) == 1:
        return AnswerResponse(type="Answered", answer=answers[0])
    request_parts = [
        "The following are multiple partial answers to the same question.",
        "Combine the partial answers into a single answer to the original question.",
        "Don't just concatenate the answers, but blend them into a single accurate and precise answer.",
        "",
        "*** Original Question ***",
        original_query_text,
        "*** Partial answers ***",
        "===",
    ]
    for answer in answers:
        request_parts.append(answer.strip())
        request_parts.append("===")
    request = "\n".join(request_parts)
    result = await translator.translate(request)
    if isinstance(result, typechat.Failure):
        return AnswerResponse(type="NoAnswer", whyNoAnswer=result.message)
    else:
        return result.value
