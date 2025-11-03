// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Reflection;

namespace TypeAgent.KnowPro;

internal static class JsonTranslatorFactory
{
    public static JsonTranslator<T> CreateTranslator<T>(IChatModel model, string schemaResourcePath)
    {
        return CreateTranslator<T>(model, typeof(JsonTranslatorFactory).Assembly, schemaResourcePath);
    }

    public static JsonTranslator<T> CreateTranslator<T>(IChatModel model, Assembly assembly, string schemaResourcePath)
    {
        ArgumentVerify.ThrowIfNull(model, nameof(model));

        SchemaText schema = new SchemaText(
            SchemaLoader.LoadResource(
                typeof(JsonTranslatorFactory).Assembly,
                schemaResourcePath
            ),
            SchemaText.Languages.Typescript
        );

        var typeValidator = new JsonSerializerTypeValidator<T>(
            schema,
            Serializer.s_options
        );

        var translator = new JsonTranslator<T>(
            model,
            typeValidator
        );

        return translator;
    }
}
