// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Collections.Generic;
using System.Text.Json;

namespace autoShell.Generators;

/// <summary>
/// Represents a parsed action definition from a .pas.json schema file.
/// </summary>
internal class ActionDefinition
{
    public string ActionName { get; set; }
    public string TypeName { get; set; }
    public List<ParameterDefinition> Parameters { get; set; } = [];
}

/// <summary>
/// Represents a single parameter field within an action definition.
/// </summary>
internal class ParameterDefinition
{
    public string JsonName { get; set; }
    public string CSharpName { get; set; }
    public string CSharpType { get; set; }
    public bool IsOptional { get; set; }
    public string DefaultValue { get; set; }
}

/// <summary>
/// Parses .pas.json schema files to extract action definitions with their parameter types.
/// </summary>
internal static class SchemaParser
{
    /// <summary>
    /// Parses a .pas.json file and returns all action definitions found.
    /// </summary>
    public static List<ActionDefinition> Parse(string json)
    {
        var actions = new List<ActionDefinition>();

        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;

        if (!root.TryGetProperty("types", out var types))
        {
            return actions;
        }

        foreach (var typeProp in types.EnumerateObject())
        {
            var actionDef = TryParseActionType(typeProp);
            if (actionDef != null)
            {
                actions.Add(actionDef);
            }
        }

        return actions;
    }

    private static ActionDefinition TryParseActionType(JsonProperty typeProp)
    {
        var typeObj = typeProp.Value;

        // Navigate: type.fields.actionName.type.typeEnum[0]
        if (!typeObj.TryGetProperty("type", out var typeInfo))
        {
            return null;
        }

        if (!typeInfo.TryGetProperty("fields", out var fields))
        {
            return null;
        }

        if (!fields.TryGetProperty("actionName", out var actionNameField))
        {
            return null;
        }

        if (!actionNameField.TryGetProperty("type", out var actionNameType))
        {
            return null;
        }

        if (!actionNameType.TryGetProperty("typeEnum", out var typeEnum))
        {
            return null;
        }

        if (typeEnum.GetArrayLength() == 0)
        {
            return null;
        }

        string actionName = typeEnum[0].GetString();
        if (string.IsNullOrEmpty(actionName))
        {
            return null;
        }

        var def = new ActionDefinition
        {
            ActionName = actionName,
            TypeName = ToPascalCase(actionName) + "Params"
        };

        // Navigate: type.fields.parameters.type.fields
        if (fields.TryGetProperty("parameters", out var parametersField) &&
            parametersField.TryGetProperty("type", out var parametersType) &&
            parametersType.TryGetProperty("fields", out var paramFields))
        {
            foreach (var paramProp in paramFields.EnumerateObject())
            {
                var paramDef = ParseParameter(paramProp);
                if (paramDef != null)
                {
                    def.Parameters.Add(paramDef);
                }
            }
        }

        return def;
    }

    private static ParameterDefinition ParseParameter(JsonProperty paramProp)
    {
        string jsonName = paramProp.Name;
        var paramType = paramProp.Value;

        if (!paramType.TryGetProperty("type", out var typeInfo))
        {
            return null;
        }

        bool isOptional = false;
        if (paramType.TryGetProperty("optional", out var optionalProp))
        {
            isOptional = optionalProp.GetBoolean();
        }

        string csharpType = ResolveCSharpType(typeInfo, out bool isNullable);
        isOptional = isOptional || isNullable;

        string defaultValue = GetDefaultValue(csharpType, isOptional);

        return new ParameterDefinition
        {
            JsonName = jsonName,
            CSharpName = ToPascalCase(jsonName),
            CSharpType = isOptional && IsValueType(csharpType) ? csharpType + "?" : csharpType,
            IsOptional = isOptional,
            DefaultValue = defaultValue
        };
    }

    private static string ResolveCSharpType(JsonElement typeInfo, out bool isNullable)
    {
        isNullable = false;

        // Simple type: { "type": "number" }
        if (typeInfo.TryGetProperty("type", out var simpleType))
        {
            string typeStr = simpleType.GetString();
            return typeStr switch
            {
                "number" => "int",
                "boolean" => "bool",
                "string" => "string",
                "string-union" => "string",
                "type-union" => ResolveTypeUnion(typeInfo, out isNullable),
                "array" => ResolveArrayType(typeInfo),
                "type-reference" => "string",
                "object" => "string",
                _ => "string",
            };
        }

        return "string";
    }

    private static string ResolveArrayType(JsonElement typeInfo)
    {
        if (typeInfo.TryGetProperty("elementType", out var elementType))
        {
            string elementCSharpType = ResolveCSharpType(elementType, out _);
            return elementCSharpType + "[]";
        }

        return "string[]";
    }

    private static string ResolveTypeUnion(JsonElement typeInfo, out bool isNullable)
    {
        isNullable = false;

        if (!typeInfo.TryGetProperty("types", out var unionTypes))
        {
            return "string";
        }

        string resolvedType = "string";
        foreach (var unionMember in unionTypes.EnumerateArray())
        {
            if (unionMember.TryGetProperty("type", out var memberType))
            {
                string memberTypeStr = memberType.GetString();
                if (memberTypeStr == "undefined" || memberTypeStr == "null")
                {
                    isNullable = true;
                }
                else
                {
                    resolvedType = ResolveCSharpType(unionMember, out _);
                }
            }
        }

        return resolvedType;
    }

    private static bool IsValueType(string csharpType)
    {
        return csharpType == "int" || csharpType == "bool" || csharpType == "double";
    }

    private static string GetDefaultValue(string csharpType, bool isOptional)
    {
        if (isOptional)
        {
            return "null";
        }

        if (csharpType.EndsWith("[]"))
        {
            return "null";
        }

        return csharpType switch
        {
            "int" => "0",
            "bool" => "false",
            "double" => "0.0",
            "string" => "\"\"",
            _ => "\"\"",
        };
    }

    private static string ToPascalCase(string name)
    {
        return string.IsNullOrEmpty(name) ? name : char.ToUpperInvariant(name[0]) + name.Substring(1);
    }
}
