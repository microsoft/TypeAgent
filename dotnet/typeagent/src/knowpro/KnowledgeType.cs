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
    public const string Entity = "entity";
    /// <summary>
    /// <see cref="KnowPro.Action"/>
    /// </summary>
    public const string Action = "action";
    /// <summary>
    /// <see cref="KnowPro.Topic"/>
    /// </summary>
    public const string Topic = "topic";
    /// <summary>
    /// <see cref="KnowPro.Tag"/>
    /// </summary>
    public const string Tag = "tag";
    /// <summary>
    /// <see cref="KnowPro.StructuredTag"/>
    /// </summary>
    public const string STag = "sTag";
}
