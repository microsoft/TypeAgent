// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.KnowledgeExtractor;

public partial class ActionEx
{
    public Action? ToInverseAction()
    {
        if (InverseVerbs.IsNullOrEmpty())
        {
            return null;
        }
        var inverseVerbs = InverseVerbs.Filter(
            (v) => !string.IsNullOrEmpty(v) && v != NoneEntityName
        );
        if (inverseVerbs.IsNullOrEmpty())
        {
            return null;
        }

        string? subjectEntityName = null;
        string? objectEntityName = null;
        string? indirectObjectEntityName = NoneEntityName;
        if (!string.IsNullOrEmpty(ObjectEntityName))
        {
            subjectEntityName = ObjectEntityName;
            objectEntityName = SubjectEntityName;
        }
        else if (!string.IsNullOrEmpty(indirectObjectEntityName))
        {
            subjectEntityName = IndirectObjectEntityName;
            indirectObjectEntityName = SubjectEntityName;
        }
        if (string.IsNullOrEmpty(subjectEntityName) || subjectEntityName == NoneEntityName)
        {
            return null;
        }
        TypeAgent.KnowPro.Action action = new()
        {
            Verbs = InverseVerbs,
            VerbTense = VerbTense,
            SubjectEntityName = subjectEntityName,
            ObjectEntityName = objectEntityName,
            IndirectObjectEntityName = indirectObjectEntityName,
            SubjectEntityFacet = SubjectEntityFacet,
        };
        if (!Params.IsNullOrEmpty())
        {
            action.Params = Params;
        }
        return action;
    }
}

public partial class ExtractedKnowledge
{
    public KnowledgeResponse ToKnowledgeResponse()
    {
        KnowledgeResponse response = new()
        {
            Entities = Entities,
            Topics = Topics,
            Actions = Actions,
        };
        List<Action>? inverseActions = null;
        foreach (var actionex in Actions)
        {
            Action action = actionex.ToInverseAction();
            if (action is not null)
            {
                inverseActions ??= [];
                inverseActions.Add(action);
            }
        }
        response.InverseActions = inverseActions?.ToArray();

        return response;
    }
}
