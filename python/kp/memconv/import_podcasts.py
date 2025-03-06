# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

from dataclasses import dataclass, field
from typing import Sequence

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
