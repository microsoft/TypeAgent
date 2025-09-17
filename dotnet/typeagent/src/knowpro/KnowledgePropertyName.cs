// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public readonly struct KnowledgePropertyName
{
    /// <summary>
    /// The name of an entity
    /// </summary>
    public static readonly KnowledgePropertyName Name = new KnowledgePropertyName("name");
    /// <summary>
    /// the type of an entity
    /// </summary>
    public static readonly KnowledgePropertyName Type = new KnowledgePropertyName("type");
    /// <summary>
    /// the verb of an action
    /// </summary>
    public static readonly KnowledgePropertyName Verb = new KnowledgePropertyName("verb");
    /// <summary>
    /// the subject of an action
    /// </summary>
    public static readonly KnowledgePropertyName Subject = new KnowledgePropertyName("subject");
    /// <summary>
    /// the object of an action
    /// </summary>
    public static readonly KnowledgePropertyName Object = new KnowledgePropertyName("object");
    /// <summary>
    /// The indirectObject of an action
    /// </summary>
    public static readonly KnowledgePropertyName IndirectObject = new KnowledgePropertyName("indirectObject");
    /// <summary>
    /// Tag
    /// </summary>
    public static readonly KnowledgePropertyName Tag = new KnowledgePropertyName("tag");
    /// <summary>
    /// Topic
    /// </summary>
    public static readonly KnowledgePropertyName Topic = new KnowledgePropertyName("topic");


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
