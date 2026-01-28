// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Collections;
using TypeAgent.ExamplesLib.CommandLine;

namespace KnowProConsole;

public partial class ModelCommands : ICommandModule
{
    private readonly KnowProConsoleContext _context;

    public ModelCommands(KnowProConsoleContext context)
    {
        _context = context;
    }

    public IList<Command> GetCommands()
    {
        return [
            ModelListDef(),
            ModelSwitchDef(),
            EmbeddingModelSwitchDef()
        ];
    }

    private Command ModelListDef()
    {
        Command cmd = new("kpModelList", "List available chat models.");
        cmd.SetAction(this.ModelListAsync);
        return cmd;
    }

    private Task ModelListAsync(ParseResult result, CancellationToken cancellationToken)
    {
        var models = GetAvailableModels();

        if (models.Count == 0)
        {
            KnowProWriter.WriteLine("No models found. Ensure [AZURE_]OPENAI_ENDPOINT_* environment variables are set.");
            return Task.CompletedTask;
        }

        KnowProWriter.WriteLine("Available chat models:");
        KnowProWriter.WriteLine();

        var sortedModels = models.OrderBy(m => m).ToList();
        int maxModelWidth = sortedModels.Max(m => m.Length) + " (current)".Length;
        int consoleWidth = Console.WindowWidth > 0 ? Console.WindowWidth : 120;
        int endpointColumnWidth = consoleWidth - maxModelWidth - 6; // 6 for padding and separators

        foreach (var model in sortedModels)
        {
            string marker = IsCurrentModel(model) ? " (current)" : "";
            string modelColumn = $"  {model}{marker}".PadRight(maxModelWidth + 4);

            string endpoint = GetEndpointForModel(model);
            if (endpoint.Length > endpointColumnWidth && endpointColumnWidth > 3)
            {
                endpoint = endpoint[..(endpointColumnWidth - 3)] + "...";
            }

            ConsoleColor color = IsCurrentModel(model) ? ConsoleColor.Green : ConsoleColor.Gray;
            KnowProWriter.WriteLine(color, $"{modelColumn}{endpoint}");
        }

        KnowProWriter.WriteLine();
        KnowProWriter.WriteLine($"Use 'kpModelSwitch <model>' to switch models.");
        KnowProWriter.WriteLine($"Use 'kpModelSwitch' (no argument) to switch to the default model.");

        return Task.CompletedTask;
    }

    private string GetEndpointForModel(string modelSuffix)
    {
        string endpointKey = modelSuffix == "DEFAULT"
            ? EnvVars.AZURE_OPENAI_ENDPOINT
            : EnvVars.ToVarName(EnvVars.AZURE_OPENAI_ENDPOINT, modelSuffix);

        return Environment.GetEnvironmentVariable(endpointKey) ?? "";
    }

    private Command ModelSwitchDef()
    {
        Command cmd = new("kpModelSwitch", "Switch to a different chat model.")
        {
            Options.Arg<string>("model", "Model suffix (e.g., GPT_4_O, GPT_5_MINI). Leave empty for default.", "")
        };
        cmd.SetAction(this.ModelSwitchAsync);
        return cmd;
    }

    private Task ModelSwitchAsync(ParseResult result, CancellationToken cancellationToken)
    {
        var args = new NamedArgs(result);
        string? modelSuffix = args.Get<string>("model");

        if (string.IsNullOrWhiteSpace(modelSuffix) || modelSuffix == "DEFAULT")
        {
            // Switch to default (no suffix)
            _context.ModelSuffix = null;
            KnowProWriter.WriteLine("Switched to default model (AZURE_OPENAI_ENDPOINT).");
            return Task.CompletedTask;
        }

        // Normalize the suffix (uppercase, underscores)
        modelSuffix = modelSuffix.ToUpperInvariant().Replace("-", "_");

        // Validate the model exists
        var availableModels = GetAvailableModels();
        if (!availableModels.Contains(modelSuffix) && modelSuffix != "DEFAULT")
        {
            KnowProWriter.WriteLine($"Error: Model '{modelSuffix}' not found.");
            KnowProWriter.WriteLine($"Available models: {string.Join(", ", availableModels.OrderBy(m => m))}");
            return Task.CompletedTask;
        }

        _context.ModelSuffix = modelSuffix;
        KnowProWriter.WriteLine($"Switched to model: {modelSuffix}");

        // Show the endpoint being used
        string endpointKey = EnvVars.ToVarName(EnvVars.AZURE_OPENAI_ENDPOINT, modelSuffix);
        string? endpoint = Environment.GetEnvironmentVariable(endpointKey);
        if (!string.IsNullOrEmpty(endpoint))
        {
            // Extract deployment name from endpoint URL if possible
            var deploymentMatch = DeploymentsRegEx().Match(endpoint);
            if (deploymentMatch.Success)
            {
                KnowProWriter.WriteLine($"Deployment: {deploymentMatch.Groups[1].Value}");
            }
            KnowProWriter.WriteLine($"Endpoint: {endpoint}");
        }

        return Task.CompletedTask;
    }

    private Command EmbeddingModelSwitchDef()
    {
        Command cmd = new("kpEmbeddingModelSwitch", "Switch to a different embedding model.")
        {
            Options.Arg<string>("model", "Model suffix for embedding model.", "")
        };
        cmd.SetAction(this.EmbeddingModelSwitchAsync);
        return cmd;
    }

    private Task EmbeddingModelSwitchAsync(ParseResult result, CancellationToken cancellationToken)
    {
        KnowProWriter.WriteLine("Switching embedding models is not supported at this time.");
        return Task.CompletedTask;
    }

    /// <summary>
    /// Gets available models by scanning environment variables for AZURE_OPENAI_ENDPOINT_* patterns.
    /// </summary>
    private HashSet<string> GetAvailableModels()
    {
        var models = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        const string Prefix = "AZURE_OPENAI_ENDPOINT_";

        foreach (DictionaryEntry entry in Environment.GetEnvironmentVariables())
        {
            string key = entry.Key?.ToString() ?? "";
            if (key.StartsWith(Prefix, StringComparison.OrdinalIgnoreCase))
            {
                string suffix = key[Prefix.Length..];
                // Exclude embedding endpoints
                if (!suffix.Contains("EMBEDDING", StringComparison.OrdinalIgnoreCase) && !suffix.Contains("DALLE", StringComparison.OrdinalIgnoreCase) && !suffix.Contains("SORA", StringComparison.OrdinalIgnoreCase))
                {
                    models.Add(suffix);
                }
            }
        }

        models.Add("DEFAULT");

        return models;
    }

    /// <summary>
    /// Checks if the given model suffix is the currently selected model.
    /// </summary>
    private bool IsCurrentModel(string modelSuffix)
    {
        if (string.IsNullOrEmpty(_context.ModelSuffix))
        {
            if (modelSuffix == "DEFAULT")
            {
                return true;
            }

            return false; // Default is selected, no specific suffix
        }
        return string.Equals(_context.ModelSuffix, modelSuffix, StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    /// Gets the current model suffix. Returns null if using the default model.
    /// </summary>
    public string? CurrentModelSuffix => _context.ModelSuffix;

    [System.Text.RegularExpressions.GeneratedRegex(@"/deployments/([^/]+)/")]
    private static partial System.Text.RegularExpressions.Regex DeploymentsRegEx();
}
