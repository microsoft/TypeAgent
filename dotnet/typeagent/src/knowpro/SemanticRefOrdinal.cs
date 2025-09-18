// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

[JsonConverter(typeof(SemanticRefOrdinalJsonConverter))]
public struct SemanticRefOrdinal
{
    [JsonConstructor]
    public SemanticRefOrdinal(int value)
    {
        ArgumentVerify.ThrowIfLessThan(value, 0, nameof(value));
        Value = value;
    }

    public int Value { get; set; }

    public static implicit operator SemanticRefOrdinal(int value) { return new SemanticRefOrdinal(value); }
    public static implicit operator int(SemanticRefOrdinal value) { return value.Value; }
}

public class SemanticRefOrdinalJsonConverter : JsonConverter<SemanticRefOrdinal>
{
    public override SemanticRefOrdinal Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Number && reader.TryGetInt32(out int value))
        {
            return new SemanticRefOrdinal(value);
        }
        throw new JsonException();
    }

    public override void Write(Utf8JsonWriter writer, SemanticRefOrdinal value, JsonSerializerOptions options)
    {
        writer.WriteNumberValue(value.Value);
    }
}
