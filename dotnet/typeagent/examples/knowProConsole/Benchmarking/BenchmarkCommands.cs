// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Linq;
using System.Reflection;
using System.Text;
using System.Text.Json.Serialization;
using System.Threading.Tasks;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Microsoft.Identity.Client;
using Microsoft.TypeChat;
using Microsoft.TypeChat.Schema;
using TypeAgent.KnowPro.Lang;
using static System.Net.Mime.MediaTypeNames;
using Prompt = Microsoft.TypeChat.Prompt;

namespace KnowProConsole.Benchmarking;

/// <summary>
/// A class that holds the commands for creating benchmark questions/answers.
/// </summary>
public class BenchmarkCommands : ICommandModule, IDisposable
{
    KnowProConsoleContext _kpContext;
    OpenAIChatModel _model;

    const string QUESTION_GENERATOR = @"You are a question generator. The user provides you with a transcript and you generate 50 questions regarding the content in the supplied transcript.";

    PromptSection _questionGeneratorSystemPrompt = new PromptSection(PromptSection.Sources.System, QUESTION_GENERATOR);
    private bool _disposedValue;

    public BenchmarkCommands(KnowProConsoleContext context)
    {
        _kpContext = context;
        _model = new OpenAIChatModel(AzureModelApiSettings.ChatSettingsFromEnv("_GPT_5_2"));
    }

    /// <summary>
    /// The commands provided by this class
    /// </summary>
    /// <returns>The command definitions</returns>
    public IList<Command> GetCommands()
    {
        return [
            BenchmarkCreatePodcastQuestionsDef(),
            BenchmarkRunDef()
        ];
    }

    private Command BenchmarkRunDef()
    {
        Command cmd = new("benchmarkRun", "Run all benchmarks against the loaded podcast.")
        {
            Args.Arg<string>("path", "The file or folder to load questions files (*.question.json) from."),
        };
        cmd.TreatUnmatchedTokensAsErrors = false;
        cmd.SetAction(BenchmarkRunAsync);
        return cmd;

    }

    // TODO: validate answers with LLM
    // TODO: store answer responses and rag/srag configuration parameters
    // TODO: score/report results
    private async Task BenchmarkRunAsync(ParseResult args)
    {
        IConversation conversation = EnsureConversation();

        NamedArgs namedArgs = new(args);
        string path = namedArgs.GetRequired("path");
        List<string> questionFiles = [];
        if (File.Exists(path))
        {
            questionFiles.Add(path);
        }
        else if (Directory.Exists(path))
        {
            var files = Directory.GetFiles(path, "*.questions.json");
            questionFiles.AddRange(files);
        }
        else
        {
            throw new FileNotFoundException($"The specified path '{path}' does not exist.");
        }

        KnowProWriter.WriteLine(ConsoleColor.White, $"Found {questionFiles.Count} question files.");
        foreach (var file in questionFiles)
        {
            var questions = Json.ParseFile<QuestionResponse>(file);
            KnowProWriter.Write(ConsoleColor.White, $"Loaded");
            KnowProWriter.Write(ConsoleColor.Magenta, $" {questions?.Questions?.Count} questions");
            KnowProWriter.WriteLine(ConsoleColor.White, $" from '{file}'");

            // now run this query through RAG and SRAG and collect the answers
            foreach (var q in questions?.Questions ?? [])
            {
                string question = q.Question;
                KnowProWriter.WriteLine(ConsoleColor.Yellow, $"Question: {question}");
                AnswerResponse? answerRAG = await conversation.AnswerQuestionRagAsync(question, 0.7, 8196, new() { MessagesTopK = 25 }, null, CancellationToken.None);
                KnowProWriter.Write(ConsoleColor.DarkBlue, $" RAG: ");
                if (answerRAG is null || answerRAG.Type == AnswerType.NoAnswer)
                {
                    KnowProWriter.WriteLine(ConsoleColor.Red, $"No answer returned ({answerRAG?.WhyNoAnswer}).");
                }
                else
                {
                    KnowProWriter.WriteLine(ConsoleColor.Green, $"{answerRAG.Answer}");
                }

                KnowProWriter.Write(ConsoleColor.DarkCyan, $"SRAG: ");
                AnswerResponse? answer = await conversation.AnswerQuestionAsync(question, new LangSearchOptions() { ThresholdScore = 0.7, MaxCharsInBudget = 8196, MaxMessageMatches = 25 }, null, null, null, CancellationToken.None);
                if (answer is null || answer.Type == AnswerType.NoAnswer)
                {
                    KnowProWriter.WriteLine(ConsoleColor.Red, $"No answer returned.({answer?.WhyNoAnswer})");
                }
                else
                {
                    KnowProWriter.WriteLine(ConsoleColor.Green, $"{answer.Answer}");
                }


            }
        }
    }

    private Command BenchmarkCreatePodcastQuestionsDef()
    {
        Command cmd = new("benchmarkCreatePodcastQuestions", "Create questions and answers for individual podcast transcripts.")
        {
            Args.Arg<string>("path", "The folder from which to import all podcasts (local files only, not recursive)"),
        };
        cmd.TreatUnmatchedTokensAsErrors = false;
        cmd.SetAction(BenchmarkCreatePodcastQuestionsAsync);
        return cmd;
    }

    private async Task BenchmarkCreatePodcastQuestionsAsync(ParseResult args)
    {
        NamedArgs namedArgs = new(args);
        string path = namedArgs.GetRequired("path");
        var files = Directory.GetFiles(path, "*.txt");

        KnowProWriter.WriteLine(ConsoleColor.White, $"Found {files.Length} text transcripts.");

        foreach (var file in files)
        {
            await CreateQuestionsForPodcastAsync(file);
        }
    }

    /// <summary>
    /// Given a podcast transcript get the LLM to generate some questions for the podcast content
    /// </summary>
    /// <param name="file"></param>
    private async Task CreateQuestionsForPodcastAsync(string file)
    {
        if (!_kpContext.Stopwatch.IsRunning)
        {
            _kpContext.Stopwatch.Start();
        }
        var start = _kpContext.Stopwatch.Elapsed;

        SchemaText schema = new SchemaText(
            SchemaLoader.LoadResource(
                this.GetType().Assembly,
                $"{typeof(BenchmarkQuestion).Namespace}.BenchmarkQuestionResponseSchema.ts"
            ),
            SchemaText.Languages.Typescript
        );

        var enumConvertor = new JsonStringEnumConverter();
        var dateConvertor = new IsoDateJsonConverter();
        var facetConvertor = new FacetValueJsonConverter();
        var actionParamConvertor = new ActionParamJsonConverter();
        var oneOrManyConvertor = new OneOrManyJsonConverter<string>();
        var s_options = Json.DefaultOptions();
        s_options.Converters.Add(enumConvertor);
        s_options.Converters.Add(dateConvertor);
        s_options.Converters.Add(facetConvertor);
        s_options.Converters.Add(actionParamConvertor);
        s_options.Converters.Add(oneOrManyConvertor);

        var typeValidator = new JsonSerializerTypeValidator<QuestionResponse>(
            schema,
            s_options
        );

        var translator = new JsonTranslator<QuestionResponse>(
            _model,
            typeValidator,
            JsonTranslatorPrompts.System
        );

        KnowProWriter.Write(ConsoleColor.White, $"Generating questions for '{Path.GetFileNameWithoutExtension(file)}'...");

        PromptSection transcript = new PromptSection(PromptSection.Sources.User, File.ReadAllText(file));

        var response = await translator.TranslateAsync(new(transcript), [_questionGeneratorSystemPrompt]);

        // write out these questions to a file
        string outFile = Path.ChangeExtension(file, ".questions.json");
        Json.StringifyToFile(response, outFile, true);

        KnowProWriter.WriteLine(ConsoleColor.Cyan, $"done. [{_kpContext.Stopwatch.Elapsed.Subtract(start).TotalSeconds:N2}s]");
    }

    protected virtual void Dispose(bool disposing)
    {
        if (!_disposedValue)
        {
            if (disposing)
            {
                this._model.Dispose();
            }

            _disposedValue = true;
        }
    }

    public void Dispose()
    {
        // Do not change this code. Put cleanup code in 'Dispose(bool disposing)' method
        Dispose(disposing: true);
        GC.SuppressFinalize(this);
    }

    // TODO: make an extension method for this
    private IConversation EnsureConversation()
    {
        return (_kpContext.Conversation is not null)
            ? _kpContext.Conversation!
            : throw new InvalidOperationException("No conversation loaded");
    }
}

public class BenchmarkQuestion
{
    [JsonPropertyName("question")]
    public required string Question { get; set; }

    [JsonPropertyName("category")]
    public required string Category { get; set; }

    [JsonPropertyName("answer")]
    public required string Answer { get; set; }
}

public class QuestionResponse
{
    [JsonPropertyName("questions")]
    public IList<BenchmarkQuestion>? Questions { get; set; }
}
