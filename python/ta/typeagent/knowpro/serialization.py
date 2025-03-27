# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import json
from typing import Any, NotRequired, TypedDict, cast

from .interfaces import IConversationDataWithIndexes

import numpy as np
from numpy.typing import NDArray

Float32Array = NDArray[np.float32]

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
    embeddings: NDArray[np.float32]


class ConversationJsonData(IConversationDataWithIndexes):
    fileHeader: NotRequired[FileHeader | None]
    embeddingFileHeader: NotRequired[EmbeddingFileHeader | None]


class ConversationBinaryData(TypedDict):
    embeddings: NotRequired[list[Float32Array] | None]


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
            buffer = serialize_embeddings(embeddings)
            with open(filename + EMBEDDING_FILE_SUFFIX, "wb") as f:
                f.write(buffer)
    with open(filename + DATA_FILE_SUFFIX, "w") as f:
        json.dump(file_data["jsonData"], f)


def serialize_embeddings(embeddings: list[Float32Array]) -> bytes:
    return np.concatenate(embeddings).tobytes()


def to_conversation_file_data(
    conversation_data: IConversationDataWithIndexes,
) -> ConversationFileData:
    file_header = create_file_header()
    embedding_file_header = EmbeddingFileHeader()

    json_data = cast(ConversationJsonData, conversation_data.copy())
    json_data["fileHeader"] = file_header
    json_data["embeddingFileHeader"] = embedding_file_header

    binary_data = ConversationBinaryData()

    related_terms_index_data = conversation_data.get("textEmbeddingData")
    embedding_file_header["relatedCount"] = add_embeddings_to_binary_data(
        binary_data,
        (
            related_terms_index_data.get("indexData")
            if related_terms_index_data is not None
            else None
        ),
    )

    message_index_data = conversation_data.get("messageIndexData")
    embdata = (
        message_index_data.get("indexData") if message_index_data is not None else None
    )

    embedding_file_header["messageCount"] = add_embeddings_to_binary_data(
        binary_data,
        (
            embdata.get("embeddings").get("embeddings")
            if embdata and embdata.get("embeddings")
            else None
        ),
    )

    file_data = ConversationFileData(
        jsonData=json_data,
        binaryData=binary_data,
    )

    return file_data


def add_embeddings_to_binary_data(
    binary_data: ConversationBinaryData,
    embedding_data: EmbeddingData | None = None,
) -> int | None:
    if embedding_data is not None:
        embeddings = embedding_data.get("embeddings")
        embeddings = embedding_data["embeddings"]
        if binary_data.get("embeddings") is None:
            binary_data.setdefault("embeddings", [])
        bde = binary_data.get("embeddings")
        assert bde is not None
        bde.extend(embeddings)
        count = len(embeddings)
        embedding_data["embeddings"] = []
        return count
    return None
