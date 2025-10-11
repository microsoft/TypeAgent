// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

/*
* PropertySearch terms let you match named property, values
* - You can  match a well known property name (name("Bach") type("book"))
* - Or you can provide a SearchTerm as a propertyName.
*   E.g. to match hue(red)
*      - propertyName as SearchTerm, set to 'hue'
*      - propertyValue as SearchTerm, set to 'red'
*    We also want hue(red) to match any facets called color(red)
* SearchTerms can included related terms
*   E.g you could include "color" as a related term for the propertyName "hue". Or 'crimson' for red.
*
* See {@link KnowledgePropertyName} for well known property names
*
* The the query processor can also related terms using a related terms secondary index, if one is available
*/
public class PropertySearchTerm : ISearchTerm
{
    public PropertySearchTerm(KnowledgePropertyName propertyName, SearchTerm propertyValue)
        : this(new KnowledgePropertyNameSearchTerm(propertyName), propertyValue)
    {
    }

    public PropertySearchTerm(SearchTerm propertyName, SearchTerm propertyValue)
    {
        ArgumentVerify.ThrowIfNull(propertyName, nameof(propertyName));
        ArgumentVerify.ThrowIfNull(propertyValue, nameof(propertyValue));

        PropertyName = new PropertyNameSearchTerm(propertyName);
        PropertyValue = propertyValue;
    }

    private PropertySearchTerm(IPropertyNameSearchTerm propertyName, SearchTerm propertyValue)
    {
        ArgumentVerify.ThrowIfNull(propertyName, nameof(propertyName));
        ArgumentVerify.ThrowIfNull(propertyValue, nameof(propertyValue));

        PropertyName = propertyName;
        PropertyValue = propertyValue;
    }

    public IPropertyNameSearchTerm PropertyName { get; }

    public SearchTerm PropertyValue { get; }

    public override string ToString()
    {
        return $"{PropertyName} == {PropertyValue}";
    }

    internal bool isEntityPropertyTerm()
    {
        if (PropertyName is KnowledgePropertyNameSearchTerm st)
        {
            switch (st.Value) {
                default:
                    break;
                case "name":
                case "type":
                    return true;
            }
        }
        return false;
    }

}

public interface IPropertyNameSearchTerm { }

public class KnowledgePropertyNameSearchTerm : IPropertyNameSearchTerm
{
    public KnowledgePropertyNameSearchTerm(KnowledgePropertyName value)
    {
        Value = value;
    }

    public KnowledgePropertyName Value { get; }

    public override string ToString() => Value;

    public static implicit operator string(KnowledgePropertyNameSearchTerm propertyName)
    {
        return propertyName.Value;
    }
}

public class PropertyNameSearchTerm : IPropertyNameSearchTerm
{
    public PropertyNameSearchTerm(SearchTerm value)
    {
        Value = value;
    }

    public SearchTerm Value { get; }

    public override string ToString() => Value.ToString();

    public static implicit operator SearchTerm(PropertyNameSearchTerm propertyName)
    {
        return propertyName.Value;
    }
}
