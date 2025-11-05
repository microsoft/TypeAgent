// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.Common;

public abstract class OneOrManyItem
{
    [JsonIgnore]
    public abstract bool IsSingle { get; }

    public static OneOrManyItem<T>? Create<T>(T? value)
    {
        return value is not null ? new SingleItem<T>(value) : null;
    }

    public static OneOrManyItem<T>? Create<T>(IList<T>? value)
    {
        return value.IsNullOrEmpty()
            ? null
            : value.Count == 1
            ? new SingleItem<T>(value[0])
            : new ListItem<T>(value);
    }
}

[JsonConverter(typeof(OneOrManyJsonConverterFactory))]
public abstract class OneOrManyItem<T> : OneOrManyItem
{
}

public class SingleItem<T> : OneOrManyItem<T>
{
    public SingleItem() { }

    public SingleItem(T value)
    {
        Value = value;
    }

    [JsonIgnore]
    public override bool IsSingle => true;

    public T Value { get; set; }

    public static implicit operator T(SingleItem<T> item)
    {
        return item.Value;
    }
}

public class ListItem<T> : OneOrManyItem<T>
{
    public ListItem()
    {

    }

    public ListItem(IList<T> value)
    {
        Value = value;
    }

    [JsonIgnore]
    public override bool IsSingle => false;

    public IList<T> Value { get; set; }
}

public class OneOrManyJsonConverterFactory : JsonConverterFactory
{
    public override bool CanConvert(Type typeToConvert) => true;

    public override JsonConverter? CreateConverter(Type typeToConvert, JsonSerializerOptions options)
    {
        var elementType = typeToConvert.GetGenericArguments()[0];
        var converterType = typeof(OneOrManyJsonConverter<>).MakeGenericType(elementType);
        return (JsonConverter)Activator.CreateInstance(converterType)!;
    }
}

public class OneOrManyJsonConverter<T> : JsonConverter<OneOrManyItem<T>>
{
    public override OneOrManyItem<T>? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Null)
        {
            return null;
        }

        if (reader.TokenType == JsonTokenType.StartArray)
        {
            var list = JsonSerializer.Deserialize<List<T>>(ref reader, options);
            return new ListItem<T>()
            {
                Value = list
            };
        }

        T value = JsonSerializer.Deserialize<T>(ref reader, options);
        return new SingleItem<T>
        {
            Value = value
        };
    }

    public override void Write(Utf8JsonWriter writer, OneOrManyItem<T> value, JsonSerializerOptions options)
    {
        if (value is ListItem<T> list)
        {
            JsonSerializer.Serialize(writer, list.Value, options);
        }
        else if (value is SingleItem<T> item)
        {
            JsonSerializer.Serialize(writer, item.Value, options);
        }
    }
}
