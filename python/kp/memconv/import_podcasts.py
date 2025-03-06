# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

from dataclasses import dataclass, field
from datetime import datetime as Datetime, timedelta as Timedelta
from typing import Any, Sequence

from ..knowpro import interfaces, kplib


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
    settings: Any = field(init=False, default=None)  # ConversationSettings
    semanticRefIndex: Any = field(init=False, default=None)  # ConversationIndex
    secondaryIndexes: Any = field(init=False, default=None)  # PodcastSecondaryIndexes

    # __init__ parameters
    name_tag: str = field(default="")
    messages: list[PodcastMessage] = field(default_factory=list)
    tags: list[str] = field(default_factory=list)
    semantic_refs: list[interfaces.SemanticRef] | None = field(default_factory=list)

    def add_metadata_to_index(self) -> None:
        raise NotImplementedError
        # if self.semantic_ref_index:
        #     add_metadata_to_index(
        #         self.messages,
        #         self.semantic_refs,
        #         self.semantic_ref_index,
        #     )

    def generate_timestamps(self, start_date: Datetime, length_minutes: float = 60.0) -> None:
        timestamp_messages(self.messages, start_date, start_date + Timedelta(minutes=length_minutes))

    async def build_index(
            self,
            event_handler: interfaces.IndexingEventHandlers | None = None,
    ) -> None:
        self.add_metadata_to_index()
        result = await build_conversation_index(self, event_handler)
        if not result.error:
            await self.build_secondary_indexes(False)
            await self.secondary_indexes.threads.build_index()
        return result
    
    async def serialize(self) -> PodcastData:
        return PodcastData(
            name_tag=self.name_tag,
            messages=self.messages,
            tags=self.tags,
            selantic_refs=self.semantic_refs,
            semantic_index_data=self.semantic_ref_index or self.semantic_ref_index.serialize(),
            related_terms_index_data=
                self.secondary_indexes.term_to_related_terms_index.serialize(),
            thread_data=self.secondary_indexes.threads.serialize(),
        )






@dataclass
class PodcastData(interfaces.IConversationDataWithIndexes[PodcastMessage]):
    pass



