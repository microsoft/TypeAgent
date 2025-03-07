# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

from dataclasses import dataclass, field
from datetime import datetime as Datetime, timedelta as Timedelta
import os
import re
from typing import Any, Sequence

from ..knowpro import convindex, interfaces, kplib


class PodcastMessageMeta(interfaces.IKnowledgeSource):
    """Metadata for podcast messages."""

    # Instance variables types.
    listeners: list[str]
    speaker: str

    def __init__(self, speaker: str):
        self.speaker = speaker
        self.listeners = []

    def get_knowledge(self) -> kplib.KnowledgeResponse:
        if not self.speaker:
            return kplib.KnowledgeResponse(
                entities=[],
                actions=[],
                inverse_actions=[],
                topics=[],
            )
        else:
            entities: list[kplib.ConcreteEntity] = []
            entities.append(
                kplib.ConcreteEntity(
                    name=self.speaker,
                    type=["person"],
                )
            )
            listener_entities = [
                kplib.ConcreteEntity(
                    name=listener,
                    type=["person"],
                )
                for listener in self.listeners
            ]
            entities.extend(listener_entities)
            actions = [
                kplib.Action(
                    verbs=["say"],
                    verb_tense="past",
                    subject_entity_name=self.speaker,
                    object_entity_name=listener,
                    indirect_object_entity_name="none",
                )
                for listener in self.listeners
            ]
            return kplib.KnowledgeResponse(
                entities=entities,
                actions=actions,
                inverse_actions=[],
                topics=[],
            )


def assign_message_listeners(
    msgs: Sequence[interfaces.IMessage[PodcastMessageMeta]],
    participants: set[str],
) -> None:
    for msg in msgs:
        if msg.metadata.speaker:
            listeners = [p for p in participants if p != msg.metadata.speaker]
            msg.metadata.listeners = listeners


@dataclass
class PodcastMessage(interfaces.IMessage[PodcastMessageMeta]):
    timestamp: str | None = field(init=False, default=None)
    text_chunks: list[str]
    metadata: PodcastMessageMeta
    tags: list[str] = field(default_factory=list)

    def add_timestamp(self, timestamp: str) -> None:
        self.timestamp = timestamp

    def add_content(self, content: str) -> None:
        self.text_chunks[0] += content


@dataclass
class Podcast(interfaces.IConversation[PodcastMessageMeta]):
    # Instance variables not passed to `__init__()`.
    # TODO
    # settings: ConversationSettings = field(
    #     init=False, default_factory=createConversationSettings
    # )
    semantic_ref_index: convindex.ITermToSemanticRefIndex | None = field(
        init=False, default_factory=convindex.ConversationIndex
    )
    # TODO
    # secondary_indexes: PodcastSecondaryIndexes = field(
    #     # This default factory probably doesn't work. :-(
    #     init=False, default_factory=lambda self: PodcastSecondaryIndexes(self.settings)
    # )
    # Work in progress.
    # message_index: TextToTextLocationIndexFuzzy | None = None

    # __init__() parameters (via `@dataclass`).
    name_tag: str = field(default="")
    # NOTE: `messages: list[PodcastMessage]` doesn't work because of invariance.
    messages: list[interfaces.IMessage[PodcastMessageMeta]] = field(
        default_factory=list
    )
    tags: list[str] = field(default_factory=list)
    semantic_refs: list[interfaces.SemanticRef] | None = field(default_factory=list)

    def add_metadata_to_index(self) -> None:
        if self.semantic_ref_index:
            assert self.semantic_refs is not None
            convindex.add_metadata_to_index(
                self.messages,
                self.semantic_refs,
                self.semantic_ref_index,
            )

    def generate_timestamps(
        self, start_date: Datetime, length_minutes: float = 60.0
    ) -> None:
        timestamp_messages(
            self.messages, start_date, start_date + Timedelta(minutes=length_minutes)
        )

    async def build_index(
        self,
        event_handler: interfaces.IndexingEventHandlers | None = None,
    ) -> interfaces.IndexingResults:
        self.add_metadata_to_index()
        result = await convindex.build_conversation_index(self, event_handler)
        # TODO
        # if not result.error:
        #     build_conversation_index already built all aliases.
        #     await self.build_secondary_indexes(False)
        #     await self.secondary_indexes.threads.build_index()
        return result

    # TODO
    # Work in progress. This will get merged into "build_index" soon.
    # async def build_message_index...

    # TODO: Wait unti PodcastData is implemented
    # async def serialize(self) -> PodcastData:
    #     return PodcastData(
    #         name_tag=self.name_tag,
    #         messages=self.messages,
    #         tags=self.tags,
    #         selantic_refs=self.semantic_refs,
    #         semantic_index_data=self.semantic_ref_index or self.semantic_ref_index.serialize(),
    #         related_terms_index_data=
    #             self.secondary_indexes.term_to_related_terms_index.serialize(),
    #         thread_data=self.secondary_indexes.threads.serialize(),
    #     )

    # TODO

    # async def deserialoze...

    # async def write_to_file...

    # async def read_from_file...

    # async def build_secondary_indexes...

    # def _build_participant_aliases...

    # def _collect_participant_aliases...


# TODO: Wait until secondary_indexes.py is implemented
# @dataclass
# class PodcastData(secondary_indexes.IConversationDataWithIndexes[PodcastMessage]):
#     pass


# NOTE: Doesn't need to be async (Python file I/O is synchronous)
def import_podcast(
    transcript_file_path: str,
    podcast_name: str | None = None,
    start_date: Datetime | None = None,
    lengthMinutes: float = 60.0,
) -> Podcast:
    with open(transcript_file_path, "r") as f:
        transcript_lines = f.readlines()
    if not podcast_name:
        podcast_name = os.path.basename(transcript_file_path)
    transcript_lines = [line.rstrip() for line in transcript_lines if line.strip()]
    turn_parse_regex = re.compile(r"^(?<speaker>[A-Z0-9 ]+:)?(?<speech>.*)$")
    participants: set[str] = set()
    msgs: list[interfaces.IMessage[PodcastMessageMeta]] = []
    cur_msg: PodcastMessage | None = None
    for line in transcript_lines:
        match = turn_parse_regex.match(line)
        if match:
            speaker = match.group("speaker")
            speech = match.group("speech")
            if cur_msg:
                if not speaker:
                    cur_msg.add_content("\n" + speech)
                else:
                    msgs.append(cur_msg)
                    cur_msg = None
            if not cur_msg:
                if speaker:
                    speaker = speaker.strip()
                    if speaker.endswith(":"):
                        speaker = speaker[:-1]
                    speaker = speaker.lower()  # TODO: locale
                    participants.add(speaker)
                cur_msg = PodcastMessage([speech], PodcastMessageMeta(speaker))
    if cur_msg:
        msgs.append(cur_msg)
    assign_message_listeners(msgs, participants)
    pod = Podcast(podcast_name, msgs, [podcast_name])
    if start_date:
        pod.generate_timestamps(start_date, lengthMinutes)
    # TODO: Add more tags.
    return pod


# Text (such as a transcript) can be collected over a time range.
# This text can be partitioned into blocks.
# However, timestamps for individual blocks are not available.
# Assigns individual timestamps to blocks proportional to their lengths.
# @param messages The messages to assign timestamps to
# @param start_time
# @param end_time
def timestamp_messages(
    messages: Sequence[interfaces.IMessage],
    start_time: Datetime,
    end_time: Datetime,
) -> None:
    # ticks ~~ posix timestamp
    start_ticks = start_time.timestamp()
    ticks_length = end_time.timestamp() - start_ticks
    if ticks_length <= 0:
        raise RuntimeError(f"{start_time} is not < {end_time}")

    def message_length(message: interfaces.IMessage) -> int:
        return sum(len(chunk) for chunk in message.text_chunks)

    message_lengths = [message_length(m) for m in messages]
    text_length = sum(message_lengths)
    ticks_per_char = ticks_length / text_length
    for message, length in zip(messages, message_lengths):
        message.timestamp = Datetime.fromtimestamp(start_ticks).isoformat()
        start_ticks += ticks_per_char * length
