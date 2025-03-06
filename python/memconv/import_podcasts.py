# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

from ..knowpro import interfaces, kplib


class PodcastMessagesMeta(interfaces.IKnowledgeSource):
    """Metadata for podcast messages."""

    # Instance variables types.
    listeners: list[str]
    speaker: str

    def __init__(self, speaker: str):
        self.speaker = speaker
        self.listeners = []

    def get_knowledge(self) -> kplib.KnowledgeResponse:
        if self.speaker is None:
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
    