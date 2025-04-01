# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import functools
import json
from types import GenericAlias, UnionType
from typing import Any, NotRequired, cast, overload, TypedDict

import numpy as np

from ..aitools.embeddings import NormalizedEmbeddings
from .interfaces import (
    IConversationDataWithIndexes,
    Tag,
    Topic,
)
from . import kplib


# -------------------
# Shared definitions
# -------------------


DATA_FILE_SUFFIX = "_data.json"
EMBEDDING_FILE_SUFFIX = "_embeddings.bin"


class FileHeader(TypedDict):
    version: str


# Needed to create a TypedDict.
def create_file_header() -> FileHeader:
    return FileHeader(version="0.1")


class EmbeddingFileHeader(TypedDict):
    relatedCount: NotRequired[int | None]
    messageCount: NotRequired[int | None]


class EmbeddingData(TypedDict):
    embeddings: NormalizedEmbeddings | None


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


# --------------
# Serialization
# ---------------


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
        # f.write(repr(file_data["jsonData"]))
        json.dump(file_data["jsonData"], f)


def serialize_embeddings(embeddings: NormalizedEmbeddings) -> NormalizedEmbeddings:
    return np.concatenate(embeddings)


def to_conversation_file_data[IMessageData](
    conversation_data: IConversationDataWithIndexes[IMessageData],
) -> ConversationFileData:
    file_header = create_file_header()
    embedding_file_header = EmbeddingFileHeader()

    buffer = bytearray()

    related_terms_index_data = conversation_data.get("relatedTermsIndexData")
    if related_terms_index_data is not None:
        text_embedding_data = related_terms_index_data.get("textEmbeddingData")
        if text_embedding_data is not None:
            embeddings = text_embedding_data.get("embeddings")
            if embeddings is not None:
                buffer.extend(embeddings)
                text_embedding_data["embeddings"] = None
                embedding_file_header["relatedCount"] = len(embeddings)

    message_index_data = conversation_data.get("messageIndexData")
    if message_index_data is not None:
        text_embedding_data = message_index_data.get("indexData")
        if text_embedding_data is not None:
            index_embeddings = text_embedding_data.get("embeddings")
            if index_embeddings is not None:
                embeddings = index_embeddings.get("embeddings")
                if embeddings is not None:
                    buffer.extend(embeddings)
                    index_embeddings["embeddings"] = None
                    embedding_file_header["messageCount"] = len(embeddings)

    binary_data = ConversationBinaryData(embeddings=buffer)
    json_data = ConversationJsonData(
        **conversation_data,
        fileHeader=file_header,
        embeddingFileHeader=embedding_file_header,
    )
    file_data = ConversationFileData(
        jsonData=json_data,
        binaryData=binary_data,
    )

    return file_data


# This converts any vanilla class instance to a dict, recursively,
# with field named converted to camelCase.
@overload
def serialize_object(arg: None) -> None: ...
@overload
def serialize_object(arg: object) -> Any:
    # NOTE: Actually this only takes objects with a __dict__.
    ...


def serialize_object(arg: Any) -> Any | None:
    if arg is None:
        return None
    assert hasattr(arg, "__dict__"), f"Cannot serialize knowledge of type {type(arg)}"
    result = to_json(arg)
    assert isinstance(result, dict), f"Serialized knowledge is not a dict: {result}"
    return result


def to_json(obj: Any) -> Any:
    if obj is None:
        return None
    d = getattr(obj, "__dict__", None)
    if d is not None:
        obj = d
    tp = type(obj)
    if tp is dict:
        return {to_camel(key): to_json(value) for key, value in obj.items()}
    if tp is list:
        return [to_json(value) for value in obj]
    if tp in (str, int, float, bool, None):
        return obj
    raise TypeError(f"Cannot jsonify {tp}: {obj!r}")


@functools.cache
def to_camel(name: str):
    assert isinstance(name, str), f"Cannot convert {name!r} to camel case"
    # Name must be of the form lowercase_words_separated_by_underscores.
    # Response will be lowercaseWordsSeparatedByUnderscores.
    # Don't pass edge cases.
    parts = name.split("_")
    return parts[0] + "".join(part.capitalize() for part in parts[1:])


# ----------------
# Deserialization
# -----------------


# No exceptions are caught; they just bubble out.
async def read_conversation_data_from_file(
    filename: str, embedding_size: int | None = None
) -> IConversationDataWithIndexes | None:
    with open(filename + DATA_FILE_SUFFIX) as f:
        json_data: ConversationJsonData = json.load(f)
    if json_data is None:
        # A serialized None -- file contained exactly "null".
        return None
    # TODO: validate json_data.
    embeddings: NormalizedEmbeddings | None = None
    if embedding_size:
        with open(filename + EMBEDDING_FILE_SUFFIX, "rb") as f:
            embeddings = np.fromfile(f, dtype=np.float32).reshape((-1, embedding_size))
    else:
        embeddings = None
    file_data = ConversationFileData(
        jsonData=json_data,
        binaryData=ConversationBinaryData(
            embeddings=None if embeddings is None else bytearray(embeddings.tobytes())
        ),
    )
    if json_data.get("fileHeader") is None:
        json_data["fileHeader"] = create_file_header()
    return from_conversation_file_data(file_data)


def from_conversation_file_data(
    file_data: ConversationFileData,
) -> IConversationDataWithIndexes | None:
    json_data = file_data["jsonData"]
    binary_data = file_data["binaryData"]
    if binary_data:
        embeddings = binary_data.get("embeddings")
        if embeddings:
            embeddings = np.frombuffer(embeddings, dtype=np.float32)
    else:
        embeddings = None
    # TODO: proper return value, and remove '| None' from return type.


TYPE_MAP = {
    "entity": kplib.ConcreteEntity,
    "action": kplib.Action,
    "topic": Topic,
    "tag": Tag,
}


# Looks like this only works for knowledge...
def deserialize_knowledge(knowledge_type: str, obj: Any) -> Any:
    typ = TYPE_MAP[knowledge_type]
    return deserialize_object(typ, obj)


type TypeForm = GenericAlias | UnionType | type | None

PRIMITIVE_TYPES = (type(None), bool, int, float, str)  # Used with isinstance().


# TODO: This should also fully validate.
# TODO: Factor in smaller functions.
def deserialize_object(typ: TypeForm, obj: object) -> Any:
    if typ is None:
        return deserialize_none(obj)
    if isinstance(typ, UnionType):
        return deserialize_union(typ.__args__, obj)
    if isinstance(typ, GenericAlias) and  typ.__origin__ is list:
           return deserialize_list(typ.__parameters__[0], obj)
    if isinstance(typ, type):
        return deserialize_class(typ, obj)
    

def deserialize_none(obj: object) -> None:
    if obj is not None:
        raise TypeError(f"Expected None, got {obj!r}")
    return None


def deserialize_union(typs: tuple[TypeForm, ...], obj: object) -> Any:
    for typ in typs:
        if typ_matches_obj(typ, obj):
            return deserialize_object(typ, obj)
    raise TypeError(f"Expected one of {typs}, but {obj!r} appears to be not one of those")


def typ_matches_obj(typ: TypeForm, obj: object) -> bool:
    if typ is None:
        return obj is None
    if typ in PRIMITIVE_TYPES:
        return isinstance(obj, typ)
    if isinstance(typ, GenericAlias) and typ.__origin__ is list:
        return type(obj) is list
    


    if obj is None:
        # Anything can be None. (TODO: Even if the schema disallows it?)
        return None
    if isinstance(typ, type):
        if isinstance(obj, typ) and isinstance(obj, (bool, int, float, str)):
            # Expected primitive JSON type.
            return obj
    annotations = getattr(typ, "__annotations__", None)
    if annotations is None:
        raise TypeError(f"No __annotations__ found on {typ}")
    args = {}
    for var_name, var_type in annotations.items():
        key = to_camel(var_name)
        value = obj.get(key)
        if isinstance(value, (type(None), bool, int, float, str)):
            args[var_name] = value
            continue
        if isinstance(value, list):
            item_type = get_list_item_type(var_type)
            if item_type is None:
                raise TypeError(f"No list type found in type {var_type}")
            value = [deserialize_object(item_type, item) for item in value]
        else:
            # TODO: dict
            raise NotImplementedError(f"Cannot deserialize dict {value}")


def get_list_item_type(typ: TypeForm) -> TypeForm | None:
    # typ must be list, a generic alias whose origin is a list,
    # or a union containing either of those.
    if typ is list:
        return object
    if isinstance(typ, GenericAlias) and typ.__origin__ is list:
        return typ.__parameters__[0]
    if isinstance(typ, UnionType):
        for item in typ.__args__:
            t = get_list_item_type(item)
            if t is not None:
                return t
    return None


def match_union(typ: UnionType, value: obj) -> 