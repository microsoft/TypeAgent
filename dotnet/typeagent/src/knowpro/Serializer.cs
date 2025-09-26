// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public class Serializer
{
    static JsonSerializerOptions s_optionsIndent;
    static JsonSerializerOptions s_options;

    static Serializer()
    {
        var facetConvertor = new FacetValueJsonConverter();
        s_options = Json.DefaultOptions();
        s_options.Converters.Add(facetConvertor);

        s_optionsIndent = Json.DefaultOptions();
        s_optionsIndent.Converters.Add(facetConvertor);
        s_optionsIndent.WriteIndented = true;
    }

    public static JsonSerializerOptions Options => s_options;

    public static string ToJson<T>(T value)
    {
        return JsonSerializer.Serialize<T>(value, s_options);
    }

    public static string ToJson(object value, Type type)
    {
        return JsonSerializer.Serialize(value, type, s_options);
    }

    public static string ToJsonIndented<T>(T value)
    {
        return JsonSerializer.Serialize<T>(value, s_optionsIndent);
    }

    public static JsonElement ToJsonElement<T>(T value)
    {
        return JsonSerializer.SerializeToElement<T>(value, s_options);
    }

    public static T FromJson<T>(string json)
    {
        return JsonSerializer.Deserialize<T>(json, s_options);
    }

    public static object? FromJson(string json, Type type)
    {
        return JsonSerializer.Deserialize(json, type, s_options);
    }

    public static T FromJsonElement<T>(JsonElement json)
    {
        return json.Deserialize<T>( s_options);
    }
}
