// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Diagnostics.CodeAnalysis;

namespace TypeAgent.KnowPro;

public struct KnowledgeType : IEquatable<KnowledgeType>, IParsable<KnowledgeType>
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

    public const string EntityTypeName = "entity";
    public const string ActionTypeName = "action";
    public const string TopicTypeName = "topic";
    public const string TagTypeName = "tag";
    public const string STagTypeName = "sTag";

    public static bool IsKnowledgeType(string type)
    {
        return
            type == EntityTypeName ||
            type == ActionTypeName ||
            type == TopicTypeName ||
            type == STagTypeName ||
            type == TagTypeName
        ;
    }

    internal KnowledgeType(string value)
    {
        Value = value;
    }

    public string Value { get; }

    public override string ToString() => Value;

    public override int GetHashCode() => Value.GetHashCode();

    public override bool Equals([NotNullWhen(true)] object? obj)
    {
        return obj is not null && obj is var kType ? Equals(kType) : false;
    }

    public bool Equals(KnowledgeType other)
    {
        return Value == other.Value;
    }

    public static KnowledgeType Parse(string s, IFormatProvider? provider = null)
    {
        return s.Trim().ToLowerInvariant() switch
        {
            EntityTypeName => Entity,
            ActionTypeName => Action,
            TopicTypeName => Topic,
            TagTypeName => Tag,
            STagTypeName => STag,
            _ => throw new KnowProException(KnowProException.ErrorCode.InvalidKnowledgeType, s),
        };
    }

    public static bool TryParse([NotNullWhen(true)] string? s, IFormatProvider? provider, [MaybeNullWhen(false)] out KnowledgeType result)
    {
        try
        {
            result = Parse(s, provider);
            return true;
        }
        catch
        {
            result = default;
            return false;
        }
    }

    public static bool operator ==(KnowledgeType x, KnowledgeType y)
    {
        return x.Value == y.Value;
    }

    public static bool operator !=(KnowledgeType x, KnowledgeType y)
    {
        return x.Value != y.Value;
    }

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
