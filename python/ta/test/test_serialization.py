# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import pytest
import numpy as np

from typeagent.knowpro.serialization import (
    serialize_object,
    deserialize_object,
    to_json,
    to_camel,
    write_conversation_data_to_file,
    read_conversation_data_from_file,
    from_conversation_file_data,
    to_conversation_file_data,
    create_file_header,
    DeserializationError,
    serialize_embeddings,
)
from typeagent.knowpro.interfaces import (
    ConversationDataWithIndexes,
    MessageTextIndexData,
    TermsToRelatedTermsIndexData,
    TextToTextLocationIndexData,
)
from typeagent.knowpro.kplib import Quantity, ConcreteEntity


@pytest.fixture
def sample_conversation_data():
    """Fixture to provide sample conversation data."""
    return {
        "relatedTermsIndexData": {
            "textEmbeddingData": {
                "embeddings": np.array([[0.1, 0.2], [0.3, 0.4]], dtype=np.float32)
            }
        },
        "messageIndexData": {
            "indexData": {
                "embeddings": np.array([[0.5, 0.6], [0.7, 0.8]], dtype=np.float32)
            }
        },
    }


def test_to_camel():
    """Test the to_camel function."""
    assert to_camel("foo_bar_baz") == "fooBarBaz"
    assert to_camel("simple") == "simple"
    assert to_camel("alreadyCamelCase") == "alreadyCamelCase"


def test_serialize_object():
    """Test the serialize_object function."""
    entity = ConcreteEntity(name="ExampleEntity", type=["ExampleType"])
    serialized = serialize_object(entity)
    assert serialized == {
        "name": "ExampleEntity",
        "type": ["ExampleType"],
        "facets": None,
    }


def test_to_json():
    """Test the to_json function."""
    obj = {"simple_key": "value", "nested_key": {"inner_key": 42}}
    json_obj = to_json(obj)
    assert json_obj == {"simpleKey": "value", "nestedKey": {"innerKey": 42}}


def test_create_file_header():
    """Test the create_file_header function."""
    header = create_file_header()
    assert header["version"] == "0.1"


def test_serialize_embeddings():
    """Test the serialize_embeddings function."""
    embeddings = np.array([[0.1, 0.2], [0.3, 0.4]], dtype=np.float32)
    serialized = serialize_embeddings(embeddings)
    assert np.array_equal(serialized, embeddings.flatten())


def test_to_conversation_file_data(sample_conversation_data):
    """Test the to_conversation_file_data function."""
    file_data = to_conversation_file_data(sample_conversation_data)
    assert "jsonData" in file_data
    assert "binaryData" in file_data
    embeddings_list = file_data["binaryData"].get("embeddingsList")
    assert embeddings_list is not None
    assert len(embeddings_list) == 2


def test_from_conversation_file_data(sample_conversation_data):
    """Test the from_conversation_file_data function."""
    # Remove messageIndexData to ensure a single embeddings array
    sample_conversation_data = ConversationDataWithIndexes(
        nameTag="mock name",
        messages=[],
        tags=[],
        semanticRefs=[],
        messageIndexData=MessageTextIndexData(
            indexData=TextToTextLocationIndexData(
                textLocations=[],
                embeddings=np.array([[0.5, 0.6], [0.7, 0.8]], dtype=np.float32),
            )
        ),
        relatedTermsIndexData=TermsToRelatedTermsIndexData(),
    )

    file_data = to_conversation_file_data(sample_conversation_data)
    conversation_data = from_conversation_file_data(file_data)
    assert conversation_data is not None
    assert conversation_data.get("relatedTermsIndexData") is not None


def test_write_and_read_conversation_data(tmp_path, sample_conversation_data):
    """Test writing and reading conversation data to and from files."""
    filename = tmp_path / "conversation"
    write_conversation_data_to_file(sample_conversation_data, str(filename))

    # Read back the data
    read_data = read_conversation_data_from_file(str(filename), embedding_size=2)
    assert read_data is not None
    assert read_data.get("relatedTermsIndexData") is not None
    assert read_data.get("messageIndexData") is not None


def test_deserialize_object():
    """Test the deserialize_object function."""
    obj = {"amount": 5.0, "units": "kg"}
    deserialized = deserialize_object(Quantity, obj)
    assert isinstance(deserialized, Quantity)
    assert deserialized.amount == 5.0
    assert deserialized.units == "kg"


def test_deserialization_error():
    """Test that DeserializationError is raised for invalid data."""
    with pytest.raises(DeserializationError, match="Missing required field 'amount'"):
        deserialize_object(Quantity, {"invalid_key": "value"})
