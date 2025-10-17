// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public class KnowledgePropertyName
{
    enum NameType
    {
        Other,
        Entity,
        Action,
        Facet
    }
    /// <summary>
    /// The name of an entity
    /// </summary>
    public static readonly KnowledgePropertyName EntityName = new("name", NameType.Entity);
    /// <summary>
    /// the type of an entity
    /// </summary>
    public static readonly KnowledgePropertyName EntityType = new("type", NameType.Entity);

    public static readonly KnowledgePropertyName FacetName = new("facet.name", NameType.Facet);
    public static readonly KnowledgePropertyName FacetValue = new("facet.value", NameType.Facet);

    /// <summary>
    /// the verb of an action
    /// </summary>
    public static readonly KnowledgePropertyName Verb = new("verb", NameType.Action);
    /// <summary>
    /// the subject of an action
    /// </summary>
    public static readonly KnowledgePropertyName Subject = new("subject", NameType.Action);
    /// <summary>
    /// the object of an action
    /// </summary>
    public static readonly KnowledgePropertyName Object = new("object", NameType.Action);
    /// <summary>
    /// The indirectObject of an action
    /// </summary>
    public static readonly KnowledgePropertyName IndirectObject = new("indirectObject", NameType.Action);
    /// <summary>
    /// Tag
    /// </summary>
    public static readonly KnowledgePropertyName Tag = new("tag", NameType.Other);
    /// <summary>
    /// Topic
    /// </summary>
    public static readonly KnowledgePropertyName Topic = new("topic", NameType.Other);

    private NameType _nameType;

    private KnowledgePropertyName(string value, NameType nameType)
    {
        Value = value;
        _nameType = nameType;
    }

    public string Value { get; }

    public override string ToString() => Value;

    public static implicit operator string(KnowledgePropertyName propertyName)
    {
        return propertyName.Value;
    }

    internal bool IsEntityProperty => _nameType == NameType.Entity;

    internal bool IsActionProperty => _nameType == NameType.Action;
}
