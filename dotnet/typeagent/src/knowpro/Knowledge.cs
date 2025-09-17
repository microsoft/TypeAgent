// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public interface IKnowledge
{
}

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

public class ConcreteEntity : IKnowledge
{
    public string Name { get; set; }
    public string[] Type { get; set; }
}

public class Action : IKnowledge
{
    public string[] Verbs { get; set; }
    public string SubjectEntityName { get; set; }
    public string ObjectEntityName { get; set; }
    public string IndirectObjectEntityName { get; set; }
}

public class Topic : IKnowledge
{
    public string Text { get; set; }
}

