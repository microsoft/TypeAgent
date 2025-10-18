// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace Microsoft.TypeChat;

/// <summary>
/// A Json Validator that uses the .NET Json Serializer to validate that the given json
/// conforms to the target schema
/// </summary>
public class JsonSerializerTypeValidator
{
    /// <summary>
    /// Create default serialization options used by the validator
    /// </summary>
    /// <returns></returns>
    public static JsonSerializerOptions DefaultOptions()
    {
        var options = new JsonSerializerOptions
        {
            IncludeFields = true,
            IgnoreReadOnlyFields = true,
            AllowTrailingCommas = true,
            ReadCommentHandling = JsonCommentHandling.Skip,
            DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        };

        options.Converters.Add(new JsonStringEnumConverter());
        return options;
    }

    private static readonly JsonSerializerOptions s_defaultOptions = DefaultOptions();
    private readonly JsonSerializerOptions _options;

    /// <summary>
    /// Create a new type validator
    /// </summary>
    /// <param name="options">options to use during serialization</param>
    public JsonSerializerTypeValidator(JsonSerializerOptions? options = null)
    {
        options ??= s_defaultOptions;
        _options = options;
    }

    public JsonSerializerOptions Options => _options;

    /// <summary>
    /// Validate the given json using the supplied type schema. If successful, returns a
    /// deserialized object
    /// </summary>
    /// <param name="schema">validation schema</param>
    /// <param name="json">json to validate</param>
    /// <returns>If success, a result containing a deserialized object. Else an diagnostic message</returns>
    public Result<object?> Validate(TypeSchema schema, string json)
    {
        try
        {
            return JsonSerializer.Deserialize(json, schema.Type, _options);
        }
        catch (JsonException jex)
        {
            return Result.Error<object?>(ToErrorString(json, jex));
        }
        catch (Exception ex)
        {
            return Result.Error<object?>(ex.Message);
        }
    }

    private string ToErrorString(string json, JsonException error)
    {
        StringBuilder sb = new StringBuilder();
        sb.AppendLine("### JSON ERROR:");
        sb.AppendLineNotEmpty(error.Message);
        if (error.Path is not null)
        {
            sb.Append("Property with error: ");
            sb.AppendLine(ParsePath(error.Path));
        }
        if (error.LineNumber is not null)
        {
            sb.AppendLine("### Errors here:");
            json.ExtractLine((long)error.LineNumber, sb);
        }
        return sb.ToString();
    }

    private string ParsePath(string path)
    {
        const string PathPrefix = "$.";
        int iPrefix = path.IndexOf(PathPrefix);
        return iPrefix >= 0 ? path.Substring(iPrefix + PathPrefix.Length) : path;
    }
}

/// <summary>
/// A Json Validator that uses the .NET Json Serializer to validate that the given json
/// conforms to the type T
/// </summary>
public class JsonSerializerTypeValidator<T> : IJsonTypeValidator<T>
{
    private readonly TypeSchema _schema;
    private readonly JsonSerializerTypeValidator _validator;

    /// <summary>
    /// Create a new validator
    /// </summary>
    /// <param name="schema">schema for T</param>
    /// <param name="options">serialization options</param>
    public JsonSerializerTypeValidator(SchemaText schema, JsonSerializerOptions? options = null)
        : this(new TypeSchema(typeof(T), schema), options)
    {
    }

    /// <summary>
    /// Create a new validator
    /// </summary>
    /// <param name="schema">schema for T</param>
    /// <param name="options">serialization options</param>
    /// <exception cref="ArgumentNullException"></exception>
    public JsonSerializerTypeValidator(TypeSchema schema, JsonSerializerOptions? options = null)
    {
        ArgumentVerify.ThrowIfNull(schema, nameof(schema));
        _schema = schema;
        _validator = new JsonSerializerTypeValidator(options ?? JsonSerializerTypeValidator.DefaultOptions());
    }

    /// <summary>
    /// Schema for T
    /// </summary>
    public TypeSchema Schema => _schema;

    /// <summary>
    /// Serialization options
    /// </summary>
    public JsonSerializerOptions Options => _validator.Options;

    /// <summary>
    /// Validate the given json, returning a validation result containing a deserialized
    /// value of type T
    /// </summary>
    /// <param name="json">json to validate</param>
    /// <returns>If success, a result containing value of type T. Else an diagnostic message</returns>
    public Result<T> Validate(string json)
    {
        Result<object?> result = _validator.Validate(_schema, json);
        return new Result<T>(result);
    }
}
