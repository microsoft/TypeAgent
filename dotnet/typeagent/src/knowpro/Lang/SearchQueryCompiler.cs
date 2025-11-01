// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using TypeAgent.KnowPro.Query;

namespace TypeAgent.KnowPro.Lang;

internal class SearchQueryCompiler
{
    static HashSet<string> s_noiseText;

    static SearchQueryCompiler()
    {
        s_noiseText = [];
        s_noiseText.LoadFromResource(typeof(SearchQueryCompiler).Assembly, "TypeAgent.KnowPro.Lang.langSearchNoise.txt");
    }

    private PropertyTermSet _entityTermsAdded;
    private bool _dedupe = true;
    private LangSearchFilter? _langSearchFilter;

    public SearchQueryCompiler(
        IConversation conversation,
        LangSearchOptions options,
        LangSearchFilter? langSearchFilter
    )
    {
        Options = options;
        _entityTermsAdded = new PropertyTermSet();
        _langSearchFilter = langSearchFilter;
    }


    public LangSearchOptions Options { get; set; }

    public SearchQueryExpr CompileSearchExpr(SearchExpr searchExpr)
    {
        SearchQueryExpr queryExpr = new();

        if (!searchExpr.Filters.IsNullOrEmpty())
        {
            foreach (var filter in searchExpr.Filters)
            {
                queryExpr.SelectExpressions.Add(
                    CompileSearchFilter(filter)
                );
            }
        }
        queryExpr.RawQuery = searchExpr.RewrittenQuery;
        return queryExpr;
    }

    public SearchSelectExpr CompileSearchFilter(SearchFilter filter)
    {
        var searchTermGroup = CompileTermGroup(filter);
        var when = CompileWhen(filter);
        return new(searchTermGroup, when);
    }

    private WhenFilter? CompileWhen(SearchFilter filter)
    {
        _entityTermsAdded.Clear();

        WhenFilter? when = null;
        var actionTerm = filter.ActionSearchTerm;
        if (
            Options.CompilerSettings.ApplyScope &&
            actionTerm is not null &&
            ShouldAddScope(actionTerm)
        )
        {
            var scopeDefiningTerms = CompileScope(
                actionTerm,
                false,
                Options.CompilerSettings.VerbScope
            );
            if (!scopeDefiningTerms.Terms.IsNullOrEmpty())
            {
                when = new();
                when.ScopeDefiningTerms = scopeDefiningTerms;
            }
        }
        if (filter.TimeRange is not null)
        {
            when ??= new();
            when.DateRange = filter.TimeRange.ToDateRange();
        }
        if (_langSearchFilter is not null)
        {
            if (_langSearchFilter.KnowledgeType is not null)
            {
                when ??= new();
                when.KnowledgeType = _langSearchFilter.KnowledgeType;
            }
            if (!_langSearchFilter.Tags.IsNullOrEmpty())
            {
                when ??= new();
                when.Tags = _langSearchFilter.Tags;
            }
            if (!string.IsNullOrEmpty(_langSearchFilter.ThreadDescription))
            {
                when ??= new();
                when.ThreadDescription = _langSearchFilter.ThreadDescription;
            }
            if (!_langSearchFilter.ScopeDefiningTerms.IsNullOrEmpty())
            {
                when ??= new();
                if (!when.ScopeDefiningTerms.IsNullOrEmpty())
                {
                    when.ScopeDefiningTerms.Terms.Add(_langSearchFilter.ScopeDefiningTerms);
                }
                else
                {
                    when.ScopeDefiningTerms = _langSearchFilter.ScopeDefiningTerms;
                }
            }
        }

        return when;
    }

    private SearchTermGroup CompileScope(
        ActionTerm actionTerm,
        bool includeAdditionalEntities = true,
        bool includeVerbs = true
    )
    {
        var dedupe = _dedupe;
        _dedupe = false;
        var termGroup = CompileActionTerm(actionTerm, true, includeVerbs);
        if (includeAdditionalEntities && !actionTerm.AdditionalEntities.IsNullOrEmpty())
        {
            AddEntityNamesToGroup(
                actionTerm.AdditionalEntities,
                KnowledgePropertyName.EntityName,
                termGroup,
                Options.CompilerSettings.ExactScope
            );
        }

        _dedupe = dedupe;
        return termGroup;
    }

    private SearchTermGroup CompileTermGroup(SearchFilter filter)
    {
        var termGroup = new SearchTermGroup(SearchTermBooleanOp.Or);

        _entityTermsAdded.Clear();
        if (!filter.EntitySearchTerms.IsNullOrEmpty())
        {
            CompileEntityTerms(filter.EntitySearchTerms, termGroup);
        }

        if (filter.ActionSearchTerm is not null)
        {
            CompileActionTermAsSearchTerms(
                filter.ActionSearchTerm,
                termGroup,
                false
            );
        }
        if (!filter.SearchTerms.IsNullOrEmpty())
        {
            if (filter.SearchTerms.Count > 0)
            {
                CompileSearchTerms(filter.SearchTerms, termGroup);
            }
            else if (termGroup.Terms.IsNullOrEmpty())
            {
                // Summary
                termGroup.Terms.Add(new PropertySearchTerm(KnowledgePropertyName.Topic, "*"));
            }
        }
        return termGroup;
    }

    private SearchTermGroup CompileActionTermAsSearchTerms(
        ActionTerm actionTerm,
        SearchTermGroup? termGroup,
        bool useOrMax = false
    )
    {
        termGroup ??= new SearchTermGroup(SearchTermBooleanOp.Or);
        var actionGroup = useOrMax ? new SearchTermGroup(SearchTermBooleanOp.OrMax) : termGroup;

        if (actionTerm.ActionVerbs is not null)
        {
            foreach (var verb in actionTerm.ActionVerbs.Words)
            {
                AddPropertyTermToGroup(KnowledgePropertyName.Topic, verb, actionGroup);
            }
        }
        if (actionTerm.ActorEntities.IsArray())
        {
            CompileEntityTermsAsSearchTerms(actionTerm.ActorEntities.Entities, actionGroup);
        }
        if (!actionTerm.TargetEntities.IsNullOrEmpty())
        {
            CompileEntityTermsAsSearchTerms(actionTerm.TargetEntities, actionGroup);
        }
        if (!actionTerm.AdditionalEntities.IsNullOrEmpty())
        {
            CompileEntityTermsAsSearchTerms(actionTerm.AdditionalEntities, actionGroup);
        }
        if (actionGroup != termGroup)
        {
            termGroup.Terms.Add(actionGroup);
        }

        return termGroup;
    }


    private SearchTermGroup CompileSearchTerms(IList<string> searchTerms, SearchTermGroup? termGroup)
    {
        termGroup ??= new SearchTermGroup(SearchTermBooleanOp.Or);
        foreach (var searchTerm in searchTerms)
        {
            termGroup.Terms.Add(new SearchTerm(searchTerm));
        }
        return termGroup;
    }

    private void CompileEntityTerms(
        IList<EntityTerm> entityTerms,
        SearchTermGroup termGroup,
        bool useOrMax = true,
        bool searchTopics = true  // Entity names and facet values can also be seen as topics
    )
    {
        if (useOrMax)
        {
            var dedupe = _dedupe;
            _dedupe = false;
            foreach (var term in entityTerms)
            {
                var orMax = new SearchTermGroup(SearchTermBooleanOp.OrMax);
                AddEntityTermToGroup(term, orMax);
                termGroup.Terms.Add(orMax.Optimize());
            }
            _dedupe = dedupe;
        }
        else
        {
            foreach (var term in entityTerms)
            {
                AddEntityTermToGroup(term, termGroup);
            }
        }
    }

    private void CompileEntityTermsAsSearchTerms(
        List<EntityTerm> entityTerms,
        SearchTermGroup termGroup,
        bool useOrMax = false
    )
    {
        if (useOrMax)
        {
            var orMax = new SearchTermGroup(SearchTermBooleanOp.OrMax);
            foreach (var term in entityTerms)
            {
                AddEntityTermAsSearchTermsToGroup(term, orMax);
            }
            termGroup.Terms.Add(orMax.Optimize());
        }
        else
        {
            foreach (var term in entityTerms)
            {
                AddEntityTermAsSearchTermsToGroup(term, termGroup);
            }
        }
    }

    // Ported from embedded TypeScript: compileActionTerm + compileObject
    private SearchTermGroup CompileActionTerm(
        ActionTerm actionTerm,
        bool useAnd,
        bool includeVerbs
    )
    {
        var dedupe = _dedupe;
        _dedupe = false;

        SearchTermGroup termGroup;

        if (!actionTerm.TargetEntities.IsNullOrEmpty())
        {
            termGroup = new SearchTermGroup(useAnd ? SearchTermBooleanOp.And : SearchTermBooleanOp.Or);

            foreach (var entity in actionTerm.TargetEntities!)
            {
                var svoTermGroup = includeVerbs
                    ? CompileSubjectAndVerb(actionTerm)
                    : CompileSubject(actionTerm);

                // A target can be the name of an object of an action OR the name of an entity
                var objectTermGroup = CompileObject(entity);
                if (!objectTermGroup.Terms.IsNullOrEmpty())
                {
                    svoTermGroup.Terms.Add(objectTermGroup);
                }

                termGroup.Terms.Add(svoTermGroup);
            }

            // Flatten if only a single child group
            if (termGroup.Terms.Count == 1 && termGroup.Terms[0] is SearchTermGroup singleGroup)
            {
                termGroup = singleGroup;
            }
        }
        else
        {
            termGroup = includeVerbs
                ? CompileSubjectAndVerb(actionTerm)
                : CompileSubject(actionTerm);
        }

        _dedupe = dedupe;
        return termGroup;
    }

    private SearchTermGroup CompileSubjectAndVerb(
        ActionTerm actionTerm)
    {
        var termGroup = new SearchTermGroup(SearchTermBooleanOp.And);
        AddSubjectToGroup(actionTerm, termGroup);
        if (actionTerm.ActionVerbs is not null)
        {
            AddVerbsToGroup(actionTerm.ActionVerbs, termGroup);
        }
        return termGroup;
    }

    private SearchTermGroup CompileSubject(ActionTerm actionTerm)
    {
        var termGroup = new SearchTermGroup(SearchTermBooleanOp.And);
        AddSubjectToGroup(actionTerm, termGroup);
        return termGroup;
    }

    private SearchTermGroup CompileObject(EntityTerm entity)
    {
        // A target can be the name of an object of an action OR the name of an entity
        var objectTermGroup = new SearchTermGroup(SearchTermBooleanOp.Or);

        // Object (direct object of action)
        AddEntityNameToGroup(
            entity,
            KnowledgePropertyName.Object,
            objectTermGroup
        );

        // EntityName (treat target entity also as an entity name)
        AddEntityNameToGroup(
            entity,
            KnowledgePropertyName.EntityName,
            objectTermGroup,
            Options.CompilerSettings.ExactScope
        );

        // Topic (entity name can also be considered a topic)
        AddEntityNameToGroup(
            entity,
            KnowledgePropertyName.Topic,
            objectTermGroup,
            Options.CompilerSettings.ExactScope
        );

        return objectTermGroup;
    }


    private void AddSubjectToGroup(
        ActionTerm actionTerm,
        SearchTermGroup termGroup
    )
    {
        if (actionTerm.ActorEntities.IsArray())
        {
            AddEntityNamesToGroup(
                actionTerm.ActorEntities.Entities,
                KnowledgePropertyName.Subject,
                termGroup
            );
        }
    }

    private void AddVerbsToGroup(VerbsTerm verbs, SearchTermGroup termGroup)
    {
        foreach (var verb in verbs.Words)
        {
            AddPropertyTermToGroup(KnowledgePropertyName.Verb, verb, termGroup);
        }
    }

    private void AddEntityTermToGroup(
        EntityTerm entityTerm,
        SearchTermGroup termGroup,
        bool exactMatchName = false
    )
    {
        AddPropertyTermToGroup(
            KnowledgePropertyName.EntityName,
            entityTerm.Name,
            termGroup,
            exactMatchName
        );

        if (!entityTerm.Type.IsNullOrEmpty())
        {
            foreach (var type in entityTerm.Type)
            {
                AddPropertyTermToGroup(KnowledgePropertyName.EntityType, type, termGroup);
            }
        }

        if (!entityTerm.Facets.IsNullOrEmpty())
        {
            foreach (var facetTerm in entityTerm.Facets)
            {
                bool nameWildcard = facetTerm.FacetName.IsWildcard();
                bool valueWildcard = facetTerm.FacetValue.IsWildcard();
                if (!(nameWildcard || valueWildcard))
                {
                    AddPropertyTermToGroup(
                        facetTerm.FacetName,
                        facetTerm.FacetValue,
                        termGroup
                    );
                }
                else if (nameWildcard)
                {
                    AddPropertyTermToGroup(
                        KnowledgePropertyName.FacetValue,
                        facetTerm.FacetValue,
                        termGroup
                    );
                }
                else if (valueWildcard)
                {
                    AddPropertyTermToGroup(
                        KnowledgePropertyName.FacetName,
                        facetTerm.FacetName,
                        termGroup
                    );
                }
            }
        }
    }

    private void AddEntityNamesToGroup(
        IList<EntityTerm>? entityTerms,
        KnowledgePropertyName propertyName,
        SearchTermGroup termGroup,
        bool exactMatchValue = false)
    {
        if (entityTerms.IsNullOrEmpty())
        {
            return;
        }

        foreach (var entityTerm in entityTerms)
        {
            AddEntityNameToGroup(
                entityTerm,
                propertyName,
                termGroup,
                exactMatchValue
            );
        }
    }

    private void AddEntityNameToGroup(
        EntityTerm entityTerm,
        KnowledgePropertyName propertyName,
        SearchTermGroup termGroup,
        bool exactMatchValue = false
    )
    {
        if (!entityTerm.IsNamePronoun)
        {
            AddPropertyTermToGroup(
                propertyName,
                entityTerm.Name,
                termGroup,
                exactMatchValue
            );
        }
    }

    private void AddPropertyTermToGroup(
        KnowledgePropertyName propertyName,
        string propertyValue,
        SearchTermGroup termGroup,
        bool exactMatchValue = false
    )
    {
        if (
            !IsSearchableString(propertyName) ||
            !IsSearchableString(propertyValue) ||
            IsNoiseTerm(propertyValue)
        )
        {
            return;
        }
        //
        // Dedupe any terms already added to the group earlier
        //
        if (!_dedupe || !_entityTermsAdded.Has(propertyName, propertyValue))
        {
            var searchTerm = new PropertySearchTerm(propertyName, new SearchTerm(propertyValue, exactMatchValue));
            termGroup.Terms.Add(searchTerm);
            _entityTermsAdded.Add(propertyName, searchTerm.PropertyValue.Term);
        }
    }

    private void AddPropertyTermToGroup(
        string propertyName,
        string propertyValue,
        SearchTermGroup termGroup,
        bool exactMatchValue = false
    )
    {
        if (
            !IsSearchableString(propertyName) ||
            !IsSearchableString(propertyValue) ||
            IsNoiseTerm(propertyValue)
        )
        {
            return;
        }
        //
        // Dedupe any terms already added to the group earlier
        //
        if (!_dedupe || !_entityTermsAdded.Has(propertyName, propertyValue))
        {
            var searchTerm = new PropertySearchTerm(propertyName, new SearchTerm(propertyValue, exactMatchValue));
            termGroup.Terms.Add(searchTerm);
            _entityTermsAdded.Add(propertyName, searchTerm.PropertyValue.Term);
        }
    }

    private void AddEntityTermAsSearchTermsToGroup(EntityTerm entityTerm, SearchTermGroup termGroup)
    {
        if (entityTerm.IsNamePronoun)
        {
            return;
        }

        AddSearchTermToGroup(entityTerm.Name, termGroup);
        if (!entityTerm.Type.IsNullOrEmpty())
        {
            foreach (var type in entityTerm.Type)
            {
                AddSearchTermToGroup(type, termGroup);
            }
        }

        if (!entityTerm.Facets.IsNullOrEmpty())
        {
            foreach (var facetTerm in entityTerm.Facets)
            {
                AddSearchTermToGroup(facetTerm.FacetName, termGroup);
                AddSearchTermToGroup(facetTerm.FacetValue, termGroup);
            }
        }
    }

    private void AddSearchTermToGroup(string term, SearchTermGroup termGroup)
    {
        if (term.IsSearchable())
        {
            termGroup.Terms.Add(new SearchTerm(term));
        }
    }

    private bool IsSearchableString(string value)
    {
        var isSearchable = value.IsSearchable();
        if (isSearchable && Options.CompilerSettings.TermFilter is not null)
        {
            isSearchable = Options.CompilerSettings.TermFilter(value);
        }
        return isSearchable;
    }

    private bool IsNoiseTerm(string value) => s_noiseText.Contains(value.ToLower());

    private bool ShouldAddScope(ActionTerm actionTerm)
    {
        if (actionTerm is null || actionTerm.IsInformational)
        {
            return false;
        }

        if (Options.CompilerSettings.ExactScope)
        {
            return true;
        }
        // If the action has no subject, disable scope
        // isEntityTermArray checks for wildcards etc
        return actionTerm.ActorEntities.IsArray();
    }
}
