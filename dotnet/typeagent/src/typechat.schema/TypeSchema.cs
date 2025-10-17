// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace Microsoft.TypeChat.Schema;
/// <summary>
/// The Schema for a Type
/// </summary>
public class TypeSchema
{
    private readonly Type _type;
    private readonly SchemaText _schema;

    /// <summary>
    /// Create a new TypeSchema
    /// </summary>
    /// <param name="type">type</param>
    /// <param name="schema">schema for the type</param>
    /// <exception cref="ArgumentNullException"></exception>
    public TypeSchema(Type type, SchemaText schema)
    {
        ArgumentVerify.ThrowIfNull(type, nameof(type));
        _schema = schema;
        _type = type;
    }

    /// <summary>
    /// Create TypeSchema
    /// </summary>
    /// <param name="name">Type name</param>
    /// <param name="schema">Schema text for type</param>
    public TypeSchema(string name, SchemaText schema)
    {
        _type = Type.GetType(name);
        _schema = schema;
    }

    [JsonIgnore]
    public Type Type => _type;

    /// <summary>
    /// Name of the type
    /// </summary>
    [JsonIgnore]
    public string TypeName => _type.Name;

    /// <summary>
    /// Full name for the type
    /// </summary>
    [JsonPropertyName("name")]
    public string TypeFullName => _type.FullName;

    /// <summary>
    /// Schema for the Type
    /// </summary>
    [JsonPropertyName("schema")]
    public SchemaText Schema => _schema;
}
