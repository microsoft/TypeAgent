// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public class FacetValueJsonConverter : JsonConverter<IFacetValue>
{
    public override IFacetValue? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Null)
        {
            return null;
        }

        switch (reader.TokenType)
        {
            default:
                break;

            case JsonTokenType.String:
                return new StringFacetValue(reader.GetString() ?? "");

            case JsonTokenType.Number:
                return new NumberFacetValue(reader.GetDouble());
            case JsonTokenType.True:
            case JsonTokenType.False:
                return new BooleanFacetValue(reader.GetBoolean());
            case JsonTokenType.StartObject:
                // Try to parse as Quantity
                using (var doc = JsonDocument.ParseValue(ref reader))
                {
                    var root = doc.RootElement;
                    if (root.TryGetProperty("amount", out var amountProp) &&
                        root.TryGetProperty("units", out var unitsProp) &&
                        amountProp.ValueKind == JsonValueKind.Number &&
                        unitsProp.ValueKind == JsonValueKind.String)
                    {
                        return new Quantity(amountProp.GetDouble(), unitsProp.GetString()!);
                    }
                }
                break;
        }
        return null;
    }

    public override void Write(Utf8JsonWriter writer, IFacetValue value, JsonSerializerOptions options)
    {
        switch (value)
        {
            case StringFacetValue s:
                writer.WriteStringValue(s.Value);
                break;
            case NumberFacetValue n:
                writer.WriteNumberValue(n.Value);
                break;
            case BooleanFacetValue b:
                writer.WriteBooleanValue(b.Value);
                break;
            case Quantity q:
                writer.WriteStartObject();
                writer.WriteNumber("amount", q.Amount);
                writer.WriteString("units", q.Units);
                writer.WriteEndObject();
                break;
            default:
                throw new JsonException("Unknown IFacetValue type.");
        }
    }
}