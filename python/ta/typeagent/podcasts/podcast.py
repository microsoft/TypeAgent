# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

from dataclasses import dataclass, field
from typing import Sequence, TypedDict

from ..knowpro.importing import ConversationSettings
from ..knowpro import convindex, interfaces, kplib, secindex
from ..knowpro.interfaces import Datetime, Timedelta
from ..knowpro.serialization import write_conversation_data_to_file


@dataclass
class PodcastMessageBase(interfaces.IKnowledgeSource):
    """Base class for podcast messages."""

    speaker: str
    listeners: list[str]

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


class PodcastMessageData(TypedDict):
    textChunks: list[str]
    tags: list[str]
    timestamp: str | None


@dataclass
class PodcastMessage(interfaces.IMessage, PodcastMessageBase):
    text_chunks: list[str]
    tags: list[str] = field(default_factory=list)
    timestamp: str | None = None

    def add_timestamp(self, timestamp: str) -> None:
        self.timestamp = timestamp

    def add_content(self, content: str) -> None:
        self.text_chunks[0] += content

    def serialize(self) -> PodcastMessageData:
        return PodcastMessageData(
            textChunks=self.text_chunks,
            tags=self.tags,
            timestamp=self.timestamp,
        )


class PodcastData(interfaces.IConversationDataWithIndexes[PodcastMessageData]):
    pass


@dataclass
class Podcast(
    interfaces.IConversation[
        PodcastMessage,
        convindex.ConversationIndex,
    ]
):
    name_tag: str = ""
    messages: list[PodcastMessage] = field(default_factory=list)
    tags: list[str] = field(default_factory=list)
    semantic_refs: list[interfaces.SemanticRef] | None = field(default_factory=list)
    settings: ConversationSettings = field(default_factory=ConversationSettings)
    semantic_ref_index: convindex.ConversationIndex = field(default_factory=convindex.ConversationIndex)  # type: ignore  # TODO

    secondary_indexes: interfaces.IConversationSecondaryIndexes[PodcastMessage] = field(
        init=False
    )

    def __post_init__(self) -> None:
        # This needs self.settings, so can't use field(default_factor=...)
        self.secondary_indexes = secindex.ConversationSecondaryIndexes(self.settings.related_term_index_settings)  # type: ignore  # TODO

    def add_metadata_to_index(self) -> None:
        if self.semantic_ref_index is not None:
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
        result = await convindex.build_conversation_index(
            self, self.settings, event_handler
        )
        # build_conversation_index automatically builds standard secondary indexes.
        # Pass false here to build podcast specific secondary indexes only.
        self._build_transient_secondary_indexes(False)
        if self.secondary_indexes is not None:
            if self.secondary_indexes.threads is not None:
                await self.secondary_indexes.threads.build_index()  # type: ignore  # TODO
        return result

    def serialize(self) -> PodcastData:
        data = PodcastData(
            nameTag=self.name_tag,
            messages=[m.serialize() for m in self.messages],
            tags=self.tags,
            semanticRefs=(
                [r.serialize() for r in self.semantic_refs]
                if self.semantic_refs is not None
                else None
            ),
        )
        # Set the rest only if they aren't None.
        if self.semantic_ref_index:
            data["semanticIndexData"] = self.semantic_ref_index.serialize()
        if self.secondary_indexes.term_to_related_terms_index:
            data["relatedTermsIndexData"] = (
                self.secondary_indexes.term_to_related_terms_index.serialize()
            )
        if self.secondary_indexes.threads:
            data["threadData"] = self.secondary_indexes.threads.serialize()
        if self.secondary_indexes.message_index:
            data["messageIndexData"] = self.secondary_indexes.message_index.serialize()
        return data

    def write_to_file(self, filename: str) -> None:
        data = self.serialize()
        write_conversation_data_to_file(data, filename)

    # TODO: deserialize
    # async def deserialize(self, podcast_data: dict) -> None:
    #     self.name_tag = podcast_data["name_tag"]
    #     self.messages = []
    #     for m in podcast_data["messages"]:
    #         msg = PodcastMessage(
    #             m["speaker"],
    #             m["listeners"],
    #             m["text_chunks"],
    #             m["tags"],
    #             m["timestamp"],
    #         )
    #         self.messages.append(msg)
    #     self.semantic_refs = podcast_data["semantic_refs"]  # type: ignore  # TODO
    #     self.tags = podcast_data["tags"]

    #     if podcast_data.get("semantic_index_data"):
    #         self.semantic_ref_index = convindex.ConversationIndex(  # type: ignore  # TODO
    #             podcast_data["semantic_index_data"]
    #         )
    #     if podcast_data.get("related_terms_index_data"):
    #         self.secondary_indexes.term_to_related_terms_index.deserialize(
    #             podcast_data["related_terms_index_data"]
    #         )
    #     if podcast_data.get("thread_data"):
    #         self.secondary_indexes.threads = ConversationThreads(
    #             self.settings.thread_settings
    #         )
    #         self.secondary_indexes.threads.deserialize(podcast_data["thread_data"])
    #     if podcast_data.get("message_index_data"):
    #         self.secondary_indexes.message_index = MessageTextIndex(
    #             self.settings.message_text_index_settings
    #         )
    #         self.secondary_indexes.message_index.deserialize(
    #             podcast_data["message_index_data"]
    #         )
    #     await self._build_transient_secondary_indexes(True)

    # TODO: read_from_file
    # @staticmethod
    # async def read_from_file(
    #     dir_path: str, base_file_name: str
    # ) -> Optional["Podcast"]:  # Optional OK here
    #     podcast = Podcast()
    #     embedding_size = (
    #         podcast.settings.related_term_index_settings.embedding_index_settings.embedding_size
    #         if podcast.settings.related_term_index_settings.embedding_index_settings
    #         else None
    #     )
    #     data = await read_conversation_data_from_file(
    #         dir_path, base_file_name, embedding_size
    #     )
    #     if data:
    #         await podcast.deserialize(data)
    #     return podcast

    def _build_transient_secondary_indexes(self, build_all: bool) -> None:
        if build_all:
            secindex.build_transient_secondary_indexes(self)
        self._build_participant_aliases()
        # self._build_caches()  # TODO: term_to_related_terms_index,

    def _build_participant_aliases(self) -> None:
        aliases: ITermToRelatedTerms = self.secondary_indexes.term_to_related_terms_index.aliases  # type: ignore  # TODO
        aliases.clear()
        name_to_alias_map = self._collect_participant_aliases()
        for name in name_to_alias_map.keys():
            related_terms: list[interfaces.Term] = [
                interfaces.Term(text=alias) for alias in name_to_alias_map[name]
            ]
            aliases.add_related_term(name, related_terms)

    def _collect_participant_aliases(self):

        aliases: dict[str, set[str]] = {}

        def collect_name(participant_name: str | None):
            if participant_name:
                participant_name = participant_name.lower()
                parsed_name = split_participant_name(participant_name)
                if parsed_name and parsed_name.first_name and parsed_name.last_name:
                    # If participant_name is a full name, associate first_name with the full name.
                    aliases.setdefault(parsed_name.first_name, set()).add(
                        participant_name
                    )
                    aliases.setdefault(participant_name, set()).add(
                        parsed_name.first_name
                    )

        for message in self.messages:
            collect_name(message.speaker)
            for listener in message.listeners:
                collect_name(listener)

        return aliases

    # TODO: Implement create_term_embedding_cache() (where?)
    # def _build_caches(self) -> None:
    #     create_term_embedding_cache(
    #         self.settings.related_term_index_settings.embedding_index_settings,
    #         self.secondary_indexes.term_to_related_terms_index.fuzzy_index,
    #         64,
    #     )


# Text (such as a transcript) can be collected over a time range.
# This text can be partitioned into blocks.
# However, timestamps for individual blocks are not available.
# Assigns individual timestamps to blocks proportional to their lengths.
def timestamp_messages(
    messages: Sequence[interfaces.IMessage],
    start_time: Datetime,
    end_time: Datetime,
) -> None:
    start = start_time.timestamp()
    duration = end_time.timestamp() - start
    if duration <= 0:
        raise RuntimeError(f"{start_time} is not < {end_time}")
    message_lengths = [sum(len(chunk) for chunk in m.text_chunks) for m in messages]
    text_length = sum(message_lengths)
    seconds_per_char = duration / text_length
    for message, length in zip(messages, message_lengths):
        message.timestamp = Datetime.fromtimestamp(start).isoformat()
        start += seconds_per_char * length


@dataclass
class ParticipantName:
    first_name: str
    last_name: str | None = None
    middle_name: str | None = None


def split_participant_name(full_name: str) -> ParticipantName | None:
    parts = full_name.split(None, 2)
    match len(parts):
        case 0:
            return None
        case 1:
            return ParticipantName(first_name=parts[0])
        case 2:
            return ParticipantName(first_name=parts[0], last_name=parts[1])
        case 3:
            if parts[1].lower() == "van":
                parts[1:] = [f"{parts[1]} {parts[2]}"]
                return ParticipantName(first_name=parts[0], last_name=parts[1])
            last_name = " ".join(parts[2].split())
            return ParticipantName(
                first_name=parts[0], middle_name=parts[1], last_name=last_name
            )
        case _:
            assert False, "SHOULD BE UNREACHABLE: Full name has too many parts"
