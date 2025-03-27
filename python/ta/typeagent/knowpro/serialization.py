# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import json
from typing import Any, NotRequired, TypedDict, cast

from ..aitools.embeddings import NormalizedEmbeddings
from .interfaces import IConversationDataWithIndexes

import numpy as np
from numpy.typing import NDArray

DATA_FILE_SUFFIX = "_data.json"
EMBEDDING_FILE_SUFFIX = "_embeddings.bin"


class FileHeader(TypedDict):
    version: str


def create_file_header() -> FileHeader:
    return FileHeader(version="0.1")


class EmbeddingFileHeader(TypedDict):
    relatedCount: NotRequired[int | None]
    messageCount: NotRequired[int | None]


class EmbeddingData(TypedDict):
    embeddings: bytes | None


class ConversationJsonData(IConversationDataWithIndexes):
    fileHeader: NotRequired[FileHeader | None]
    embeddingFileHeader: NotRequired[EmbeddingFileHeader | None]


class ConversationBinaryData(TypedDict):
    embeddings: NotRequired[bytearray | None]


class ConversationFileData(TypedDict):
    # This data goes into a JSON text file
    jsonData: ConversationJsonData
    # This goes into a single binary file
    binaryData: ConversationBinaryData


def write_conversation_data_to_file(
    conversation_data: IConversationDataWithIndexes,
    filename: str,
) -> None:
    file_data = to_conversation_file_data(conversation_data)
    binary_data = file_data["binaryData"]
    if binary_data:
        embeddings = binary_data.get("embeddings")
        if embeddings:
            with open(filename + EMBEDDING_FILE_SUFFIX, "wb") as f:
                f.write(embeddings)
    with open(filename + DATA_FILE_SUFFIX, "w") as f:
        json.dump(file_data["jsonData"], f)


def serialize_embeddings(embeddings: NormalizedEmbeddings) -> bytes:
    return np.concatenate(embeddings).tobytes()


def to_conversation_file_data[IMessageData](
    conversation_data: IConversationDataWithIndexes[IMessageData],
) -> ConversationFileData:
    file_header = create_file_header()
    embedding_file_header = EmbeddingFileHeader()

    json_data = cast(ConversationJsonData, conversation_data.copy())
    json_data["fileHeader"] = file_header
    json_data["embeddingFileHeader"] = embedding_file_header

    buffer = bytearray()

    related_terms_index_data = conversation_data.get("textEmbeddingData")
    if related_terms_index_data is not None:
        index_data = related_terms_index_data.get("indexData")
        if index_data is not None:
            embeddings = index_data.get("embeddings")
            if embeddings is not None:
                buffer.extend(embeddings)
                index_data["embeddings"] = None
                embedding_file_header["relatedCount"] = len(embeddings)

    message_index_data = conversation_data.get("messageIndexData")
    if message_index_data is not None:
        index_data = message_index_data.get("indexData")
        if index_data is not None:
            index_embeddings = index_data.get("embeddings")
            if index_embeddings is not None:
                embeddings = index_embeddings.get("embeddings")
                if embeddings is not None:
                    buffer.extend(embeddings)
                    index_embeddings["embeddings"] = None
                    embedding_file_header["messageCount"] = len(embeddings)

    binary_data = ConversationBinaryData(embeddings=buffer)

    file_data = ConversationFileData(
        jsonData=json_data,
        binaryData=binary_data,
    )

    return file_data


def add_embeddings_to_binary_data(
    buffer: bytearray,
    embedding_data: EmbeddingData | None = None,
) -> int | None:
    if embedding_data is not None:
        embeddings = embedding_data.get("embeddings")
        if embeddings is not None:
            buffer.extend(embeddings)
            embedding_data["embeddings"] = None
            return len(embeddings)
    return None
