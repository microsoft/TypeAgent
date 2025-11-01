// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public interface IActionParam
{

}

public class ActionParam : IActionParam
{
    [JsonPropertyName("name")]
    public string Name { get; set; }

    [JsonPropertyName("value")]
    public string Value { get; set; }
};

public class StringActionParam : IActionParam
{
    public string Value { get; set; }

    public override string ToString() => Value;
}

/// <summary>
/// Custom JsonConverter for IActionParam, similar to FacetValueJsonConverter.
/// Handles ActionParam and StringActionParam types.
/// </summary>
public class ActionParamJsonConverter : JsonConverter<IActionParam>
{
    public override IActionParam? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        switch (reader.TokenType)
        {
            default:
                break;

            case JsonTokenType.String:
                // Deserialize as StringActionParam
                var value = reader.GetString() ?? "";
                return new StringActionParam { Value = value };

            case JsonTokenType.StartObject:
                // Use JsonDocument to inspect properties
                using (var doc = JsonDocument.ParseValue(ref reader))
                {
                    var root = doc.RootElement;
                    if (root.TryGetProperty("name", out var nameProp) &&
                        root.TryGetProperty("value", out var valueProp) &&
                        nameProp.ValueKind == JsonValueKind.String &&
                        valueProp.ValueKind == JsonValueKind.String)
                    {
                        return new ActionParam
                        {
                            Name = nameProp.GetString() ?? "",
                            Value = valueProp.GetString() ?? ""
                        };
                    }
                    // Fallback: try to deserialize as StringActionParam
                    if (root.TryGetProperty("value", out var strValueProp) &&
                        strValueProp.ValueKind == JsonValueKind.String)
                    {
                        return new StringActionParam
                        {
                            Value = strValueProp.GetString() ?? ""
                        };
                    }
                }
                break;
        }
        return null;
    }

    public override void Write(Utf8JsonWriter writer, IActionParam value, JsonSerializerOptions options)
    {
        switch (value)
        {
            case ActionParam ap:
                writer.WriteStartObject();
                writer.WriteString("name", ap.Name);
                writer.WriteString("value", ap.Value);
                writer.WriteEndObject();
                break;
            case StringActionParam sap:
                writer.WriteStringValue(sap.Value);
                break;
            default:
                throw new JsonException("Unknown IActionParam type.");
        }
    }
}
