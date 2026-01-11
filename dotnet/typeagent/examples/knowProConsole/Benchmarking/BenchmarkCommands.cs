// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Linq;
using System.Numerics;
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
    const int METRIC_COL_WIDTH = 12;
    const int VALUE_COL_WIDTH = 18;

    KnowProConsoleContext _kpContext;
    OpenAIChatModel _model;

    const string QUESTION_GENERATOR = @"You are a question generator. The user provides you with a transcript and you generate 50 questions regarding the content in the supplied transcript.";
    const string QUESTION_GRADER = @"You are a question grader. The user provides you with a list of questions, the correct answers, and some provided answers.
You need to grade each answer as Correct, Incorrect, or Partial based on how well it matches the correct answer.
Provide feedback for each answer to help improve future responses.  If the answer contains additional context you should still consider the answer correct but you can add notes int he feedback.";

    PromptSection _questionGeneratorSystemPrompt = new PromptSection(PromptSection.Sources.System, QUESTION_GENERATOR);
    PromptSection _questionGraderSystemPrompt = new PromptSection(PromptSection.Sources.System, QUESTION_GRADER);
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
            Options.Arg<int>("maxQuestions", "The maximum number of questions to process.", 0),
        };
        cmd.TreatUnmatchedTokensAsErrors = false;
        cmd.SetAction(BenchmarkRunAsync);
        return cmd;

    }

    private async Task BenchmarkRunAsync(ParseResult args)
    {
        IConversation conversation = EnsureConversation();

        NamedArgs namedArgs = new(args);
        string path = namedArgs.GetRequired("path");
        int maxQuestions = namedArgs.Get<int>("maxQuestions");
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
        List<GradedQuestion> allGradedQuestions = [];
        foreach (var file in questionFiles)
        {
            var questions = Json.ParseFile<QuestionResponse>(file);
            KnowProWriter.Write(ConsoleColor.White, $"Loaded");
            KnowProWriter.Write(ConsoleColor.Magenta, $" {questions?.Questions?.Count} questions");
            KnowProWriter.WriteLine(ConsoleColor.White, $" from '{file}'");

            // now run this query through RAG and SRAG and collect the answers
            for(int i = 0; i < questions?.Questions?.Count && (maxQuestions == 0 || i < maxQuestions); i++)
            {
                BenchmarkQuestion q = questions!.Questions![i];
                // get the RAG answer
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

                // get the structured RAG answer
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

                // Grade the answer
                GradingResponse answers = new GradingResponse()
                {
                    GradedQuestions = [
                        new GradedQuestion()
                        {
                            Id = 1,
                            Question = question,
                            CorrectAnswer = q.Answer,
                            ProvidedAnswer = answerRAG?.Answer ?? string.Empty,
                        },
                        new GradedQuestion()
                        {
                            Id = 2,
                            Question = question,
                            CorrectAnswer = q.Answer,
                            ProvidedAnswer = answer?.Answer ?? string.Empty,
                        },

                    ]
                };

                var graded = await EvaluateAnswersAsync(answers);
                foreach (var g in graded)
                {
                    if (g.Id % 2 == 0)
                    {
                        g.source = "Structured Rag";
                    }
                    else if (g.Id % 2 != 0)
                    {
                        g.source = "Traditional Rag";
                    }
                }

                allGradedQuestions.AddRange(graded);
            }
        }

        // group the questions by source
        Dictionary<string, List<GradedQuestion>> groupedQuestions = allGradedQuestions
            .GroupBy(g => g.source)
            .ToDictionary(g => g.Key, g => g.ToList());

        Dictionary<string, (int correct, int incorrect, int partial, int total)> summary = [];

        // summarize each group
        foreach (var group in groupedQuestions)
        {
            int correct = group.Value.Count(g => g.IsCorrect == Answer.Correct);
            int incorrect = group.Value.Count(g => g.IsCorrect == Answer.Incorrect);
            int partial = group.Value.Count(g => g.IsCorrect == Answer.Partial);
            int total = group.Value.Count;
            summary.Add(group.Key, (correct, incorrect, partial, total));
        }

        // output combined summary table
        KnowProWriter.WriteLine(ConsoleColor.White, $"Overall Summary:");
        OutputSummary(summary);
    }

    private void OutputSummary(Dictionary<string, (int correct, int incorrect, int partial, int total)> summary)
    {
        // Build header with metric column + source columns
        var sources = summary.Keys.ToList();
        StringBuilder headerBuilder = new();
        headerBuilder.Append($"{"Metric",-METRIC_COL_WIDTH}");
        foreach (var source in sources)
        {
            headerBuilder.Append($" {source,VALUE_COL_WIDTH}");
        }
        string header = headerBuilder.ToString();
        string separator = new string('-', header.Length);

        KnowProWriter.WriteLine(ConsoleColor.White, separator);
        KnowProWriter.WriteLine(ConsoleColor.Cyan, header);
        KnowProWriter.WriteLine(ConsoleColor.White, separator);

        // Calculate scores
        var scores = new Dictionary<string, double>();
        foreach (var group in summary)
        {
            double score = (group.Value.correct + ((double)group.Value.partial / 2)) / (double)group.Value.total * 100D;
            scores[group.Key] = score;
        }

        // Data rows for each metric
        WriteMetricRow("Correct", sources, s => summary[s].correct);
        WriteMetricRow("Incorrect", sources, s => summary[s].incorrect);
        WriteMetricRow("Partial", sources, s => summary[s].partial);
        WriteMetricRow("Total", sources, s => summary[s].total);

        KnowProWriter.WriteLine(ConsoleColor.White, separator);

        // Score row with color coding
        double? maxScore = scores.Values.Max();
        double? minScore = scores.Values.Min();

        KnowProWriter.Write(ConsoleColor.White, $"{"Score",-METRIC_COL_WIDTH}");
        foreach (var source in sources)
        {
            double score = scores[source];
            ConsoleColor scoreColor = score == maxScore && maxScore != minScore
                ? ConsoleColor.Green
                : score == minScore && maxScore != minScore
                    ? ConsoleColor.Red
                    : ConsoleColor.Cyan;

            KnowProWriter.Write(scoreColor, $" {score,VALUE_COL_WIDTH - 1:N1}%");
        }
        KnowProWriter.WriteLine(ConsoleColor.White, "");
        KnowProWriter.WriteLine(ConsoleColor.White, separator);
    }

    private void WriteMetricRow(string metricName, List<string> sources, Func<string, double> getValue)
    {
        KnowProWriter.Write(ConsoleColor.White, $"{metricName,-METRIC_COL_WIDTH}");
        //foreach (var source in sources)
        //{
        var v1 = getValue(sources.First());
        var v2 = getValue(sources.Last());
        var color1 = (v1 == v2) ? ConsoleColor.Yellow : (v1 > v2) ? ConsoleColor.Green : ConsoleColor.Red;
        var color2 = (v1 == v2) ? ConsoleColor.Yellow : (v1 < v2) ? ConsoleColor.Green : ConsoleColor.Red;

        // for partial lower is better
        if (metricName == "Partial")
        {
            (color2, color1) = (color1, color2);
        }

        KnowProWriter.Write(color1, $" {v1,VALUE_COL_WIDTH}");
        KnowProWriter.Write(color2, $" {v2,VALUE_COL_WIDTH}");
        KnowProWriter.WriteLine(ConsoleColor.White, "");
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

    /// <summary>
    /// Given a podcast transcript get the LLM to generate some questions for the podcast content
    /// </summary>
    /// <param name="answers">The answers being graded.</param>
    private async Task<List<GradedQuestion>> EvaluateAnswersAsync(GradingResponse answers)
    {
        if (!_kpContext.Stopwatch.IsRunning)
        {
            _kpContext.Stopwatch.Start();
        }
        var start = _kpContext.Stopwatch.Elapsed;

        SchemaText schema = new SchemaText(
            SchemaLoader.LoadResource(
                this.GetType().Assembly,
                $"{typeof(BenchmarkQuestion).Namespace}.AnswerGradingResponseSchema.ts"
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

        var typeValidator = new JsonSerializerTypeValidator<GradingResponse>(
            schema,
            s_options
        );

        var translator = new JsonTranslator<GradingResponse>(
            _model,
            typeValidator,
            JsonTranslatorPrompts.System
        );

        List<GradedQuestion> gradedQuestions = [];
        foreach (GradedQuestion q in answers.GradedQuestions)
        {
            try
            {
                KnowProWriter.Write(ConsoleColor.White, $"Grading {q.Question}");

                PromptSection transcript = new PromptSection(PromptSection.Sources.User, Json.Stringify(q));

                var response = await translator.TranslateAsync(new(transcript), [_questionGraderSystemPrompt]);

                KnowProWriter.Write(ConsoleColor.Gray, Json.Stringify(response));

                gradedQuestions.AddRange(response.GradedQuestions);

                Json.StringifyToFile(response, "grades.json", true);

                KnowProWriter.WriteLine(ConsoleColor.Cyan, $"done. [{_kpContext.Stopwatch.Elapsed.Subtract(start).TotalSeconds:N2}s]");
            }
            catch (Exception ex)
            {
                KnowProWriter.WriteLine(ConsoleColor.Red, ex.ToString());
            }

        }

        return gradedQuestions;
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

public class GradingResponse
{
    [JsonPropertyName("gradedQuestions")]
    public IList<GradedQuestion> GradedQuestions { get; set; } = [];
}

public class GradedQuestion
{
    [JsonPropertyName("id")]
    public int Id { get; set; } = -1;
    [JsonPropertyName("question")]
    public required string Question { get; set; } = string.Empty;
    [JsonPropertyName("correctAnswer")]
    public required string CorrectAnswer { get; set; } = string.Empty;
    [JsonPropertyName("providedAnswer")]
    public required string ProvidedAnswer { get; set; } = string.Empty;
    [JsonPropertyName("isCorrect")]
    public Answer IsCorrect { get; set; } = Answer.Unknown;
    [JsonPropertyName("feedback")]
    public string Feedback { get; set; } = string.Empty;

    public string source { get; set; } = string.Empty;
}

public enum Answer
{
    [JsonPropertyName("unknown")]
    Unknown,
    [JsonPropertyName("correct")]
    Correct,
    [JsonPropertyName("incorrect")]
    Incorrect,
    [JsonPropertyName("partialAnswer")]
    Partial
}
