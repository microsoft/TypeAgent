// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.IO;
using Microsoft.CodeAnalysis;

namespace autoShell.Generators;

/// <summary>
/// Roslyn incremental source generator that reads .pas.json schema files
/// and generates strongly-typed C# parameter records for each action.
/// </summary>
[Generator]
public class ActionParamsGenerator : IIncrementalGenerator
{
    public void Initialize(IncrementalGeneratorInitializationContext context)
    {
        // Filter AdditionalFiles to only .pas.json files
        var schemaFiles = context.AdditionalTextsProvider
            .Where(static file => file.Path.EndsWith(".pas.json"));

        // Transform each schema file into generated source
        var sources = schemaFiles.Select(static (file, cancellationToken) =>
        {
            var text = file.GetText(cancellationToken);
            if (text == null)
            {
                return (FileName: (string)null, Source: (string)null);
            }

            var json = text.ToString();
            var actions = SchemaParser.Parse(json);

            if (actions.Count == 0)
            {
                return (FileName: (string)null, Source: (string)null);
            }

            string fileName = Path.GetFileNameWithoutExtension(file.Path);
            string source = RecordEmitter.Emit(actions, Path.GetFileName(file.Path));

            return (FileName: fileName, Source: source);
        });

        // Register each generated source
        context.RegisterSourceOutput(sources, static (ctx, result) =>
        {
            if (result.FileName != null && result.Source != null)
            {
                ctx.AddSource($"{result.FileName}.g.cs", result.Source);
            }
        });
    }
}
