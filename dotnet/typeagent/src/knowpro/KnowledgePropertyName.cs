// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public readonly struct KnowledgePropertyName
{
    /// <summary>
    /// The name of an entity
    /// </summary>
    public static readonly KnowledgePropertyName EntityName = new("name");
    /// <summary>
    /// the type of an entity
    /// </summary>
    public static readonly KnowledgePropertyName EntityType = new("type");

    public static readonly KnowledgePropertyName FacetName = new("facet.name");
    public static readonly KnowledgePropertyName FacetValue = new("facet.value");

    /// <summary>
    /// the verb of an action
    /// </summary>
    public static readonly KnowledgePropertyName Verb = new("verb");
    /// <summary>
    /// the subject of an action
    /// </summary>
    public static readonly KnowledgePropertyName Subject = new("subject");
    /// <summary>
    /// the object of an action
    /// </summary>
    public static readonly KnowledgePropertyName Object = new("object");
    /// <summary>
    /// The indirectObject of an action
    /// </summary>
    public static readonly KnowledgePropertyName IndirectObject = new("indirectObject");
    /// <summary>
    /// Tag
    /// </summary>
    public static readonly KnowledgePropertyName Tag = new("tag");
    /// <summary>
    /// Topic
    /// </summary>
    public static readonly KnowledgePropertyName Topic = new("topic");

    private KnowledgePropertyName(string value)
    {
        Value = value;
    }

    public string Value { get; }

    public static implicit operator string(KnowledgePropertyName propertyName)
    {
        return propertyName.Value;
    }
}
