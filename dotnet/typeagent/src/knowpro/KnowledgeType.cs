// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

/// <summary>
/// TODO: Make this strongly typed to be a discriminated union like Typescript
/// </summary>
public struct KnowledgeType
{
    /// <summary>
    /// <see cref="ConcreteEntity"/>
    /// </summary>
    public static readonly KnowledgeType Entity = new("entity");
    /// <summary>
    /// <see cref="KnowPro.Action"/>
    /// </summary>
    public static readonly KnowledgeType Action = new("action");
    /// <summary>
    /// <see cref="KnowPro.Topic"/>
    /// </summary>
    public static readonly KnowledgeType Topic = new("topic");
    /// <summary>
    /// <see cref="KnowPro.Tag"/>
    /// </summary>
    public static readonly KnowledgeType Tag = new("tag");
    /// <summary>
    /// <see cref="KnowPro.StructuredTag"/>
    /// </summary>
    public static readonly KnowledgeType STag = new("sTag");

    internal const string EntityTypeName = "entity";
    internal const string ActionTypeName = "action";
    internal const string TopicTypeName = "topic";
    internal const string TagTypeName = "tag";
    internal const string STagTypeName = "sTag";

    public static bool IsKnowledgeType(string type)
    {
        return (
            type == EntityTypeName ||
            type == ActionTypeName ||
            type == TopicTypeName ||
            type == STagTypeName ||
            type == TagTypeName
        );
    }

    internal KnowledgeType(string value)
    {
        Value = value;
    }

    public string Value { get; }

    public static implicit operator string(KnowledgeType type)
    {
        return type.Value;
    }

    public static implicit operator KnowledgeType(string type)
    {
        return IsKnowledgeType(type)
            ? new(type)
            : throw new KnowProException(KnowProException.ErrorCode.InvalidKnowledgeType, type);
    }
}
