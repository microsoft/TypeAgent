// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public readonly struct KnowledgeType
{
    public static readonly KnowledgeType Entity = new KnowledgeType("entity");
    public static readonly KnowledgeType Action = new KnowledgeType("action");
    public static readonly KnowledgeType Topic = new KnowledgeType("topic");

    private KnowledgeType(string value)
    {
        Value = value;
    }

    public string Value { get; }

    public static implicit operator string(KnowledgeType knowledgeType)
    {
        return knowledgeType.Value;
    }
}

