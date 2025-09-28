// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

/// <summary>
/// TODO: Make this strongly typed to be a discriminated union like Typescript
/// </summary>
public static class KnowledgeType
{
    /// <summary>
    /// <see cref="ConcreteEntity"/>
    /// </summary>
    internal const string EntityTypeName = "entity";
    /// <summary>
    /// <see cref="KnowPro.Action"/>
    /// </summary>
    internal const string ActionTypeName = "action";
    /// <summary>
    /// <see cref="KnowPro.Topic"/>
    /// </summary>
    internal const string TopicTypeName = "topic";
    /// <summary>
    /// <see cref="KnowPro.Tag"/>
    /// </summary>
    internal const string TagTypeName = "tag";
    /// <summary>
    /// <see cref="KnowPro.StructuredTag"/>
    /// </summary>
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


}
