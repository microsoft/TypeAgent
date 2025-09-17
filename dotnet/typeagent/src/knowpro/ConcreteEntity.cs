// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public class ConcreteEntity : IKnowledge
{
    [JsonPropertyName("name")]
    public string Name { get; set; }
    [JsonPropertyName("type")]
    public string[] Type { get; set; }
    [JsonPropertyName("facets")]
    public Facet[] Facets { get; set; }
}

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
