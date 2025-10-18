// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace Microsoft.TypeChat;

/// <summary>
/// Json makes the idiomatic Javascript Json.Stringify and Json.Parse APIs available to .NET by
/// wrapping the .NET System.Text.Json serialization
/// </summary>
internal class Json
{
    /// <summary>
    /// Create default Json serialization options
    /// </summary>
    /// <returns></returns>
    public static JsonSerializerOptions DefaultOptions()
    {
        return JsonSerializerTypeValidator.DefaultOptions();
    }

    private static readonly Json s_default = new Json();
    private static readonly Json s_indented = new Json(true);

    private readonly JsonSerializerOptions _options;

    public Json(bool indented = false)
    {
        _options = DefaultOptions();
        _options.WriteIndented = indented;
    }

    /// <summary>
    /// Turn the given object into a JSON string
    /// </summary>
    /// <param name="value"></param>
    /// <param name="indented"></param>
    /// <returns></returns>
    public static string Stringify(object value, bool indented = true)
    {
        return indented ?
               s_indented.Serialize(value) :
               s_default.Serialize(value);
    }

    /// <summary>
    /// Stringify value of type T
    /// </summary>
    /// <typeparam name="T">value type</typeparam>
    /// <param name="value">value to stringify</param>
    /// <param name="indented">if true, produce indented json</param>
    /// <returns></returns>
    public static string Stringify<T>(T value, bool indented = true)
    {
        return indented ?
               s_indented.Serialize(value) :
               s_default.Serialize<T>(value);
    }

    /// <summary>
    /// Parse Json into an object of the given type
    /// </summary>
    /// <param name="json">json string</param>
    /// <param name="type">Deserialize json to this type</param>
    /// <returns></returns>
    public static object? Parse(string json, Type type)
    {
        return s_default.Deserialize(json, type);
    }

    /// <summary>
    /// Parse Json into an object of the given type
    /// </summary>
    /// <typeparam name="T">destination type</typeparam>
    /// <param name="json">json string</param>
    /// <returns></returns>
    public static T Parse<T>(string json)
    {
        return (T)Parse(json, typeof(T));
    }

    /// <summary>
    /// Parse Json from a stream into an object of the given type
    /// </summary>
    /// <typeparam name="T">destination type</typeparam>
    /// <param name="jsonStream">stream to read from</param>
    /// <returns></returns>
    public static T Parse<T>(Stream jsonStream)
    {
        return (T)s_default.Deserialize(jsonStream, typeof(T));
    }

    private string Serialize<T>(T value)
    {
        return JsonSerializer.Serialize<T>(value, _options);
    }

    private object? Deserialize(string json, Type type)
    {
        return JsonSerializer.Deserialize(json, type, _options);
    }

    private object? Deserialize(Stream jsonStream, Type type)
    {
        return JsonSerializer.Deserialize(jsonStream, type, _options);
    }

    internal static StringContent ToJsonMessage<T>(T value)
    {
        string jsonContent = Json.Stringify(value, false);
        return new StringContent(jsonContent, UnicodeEncoding.UTF8, "application/json");
    }
}
