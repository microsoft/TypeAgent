// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public class Facet
{
    public string Name { get; set; }
    public IFacetValue Value { get; set; }
}

public interface IFacetValue
{
    [JsonIgnore]
    FacetValueType ValueType { get; }
}

public enum FacetValueType
{
    String,
    Number,
    Boolean,
    Quantity
}

public readonly struct StringFacetValue : IFacetValue
{
    public string Value { get; }

    [JsonConstructor]
    public StringFacetValue(string value)
    {
        Value = value;
    }

    [JsonIgnore]
    public FacetValueType ValueType => FacetValueType.String;

    public override string ToString() => Value;
}

public readonly struct NumberFacetValue : IFacetValue
{
    public double Value { get; }

    [JsonConstructor]
    public NumberFacetValue(double value)
    {
        Value = value;
    }

    [JsonIgnore]
    public FacetValueType ValueType => FacetValueType.Number;

    public override string ToString() => Value.ToString("g");
}

public readonly struct BooleanFacetValue : IFacetValue
{
    public bool Value { get; }

    [JsonConstructor]
    public BooleanFacetValue(bool value)
    {
        Value = value;
    }

    [JsonIgnore]
    public FacetValueType ValueType => FacetValueType.Boolean;

    public override string ToString() => Value.ToString();
}

public readonly struct Quantity : IFacetValue
{
    public double Amount { get; }
    public string Units { get; }

    [JsonConstructor]
    public Quantity(double amount, string units)
    {
        Amount = amount;
        Units = units;
    }

    [JsonIgnore]
    public FacetValueType ValueType => FacetValueType.Quantity;

    public override string ToString() => $"{Amount} {Units}";
}


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