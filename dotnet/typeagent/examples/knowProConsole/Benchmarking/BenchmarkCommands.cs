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
    const int CATEGORY_COL_WIDTH = 20;

    KnowProConsoleContext _kpContext;
    OpenAIChatModel _model;
    TranslationSettings _translatorSettings = new() { Temperature = 1 };


    //    const string QUESTION_GENERATOR = @"You are a question generator. The user provides you with a transcript and you generate 60 questions regarding the content in the supplied transcript.
    //There should be an equal distribution of question difficulties.
    //Ensure that each category of questions has at least one question of each difficulty.";
    const string QUESTION_GENERATOR = @"You are a question generator. The user provides you with a transcript and you generate 60 questions regarding the content in the supplied transcript.
Half of the questions should be 'easy', half as many 'moderate' questions, and half again as many 'hard' questions.
Ensure that each category of questions has at least one question of each difficulty.";
    const string QUESTION_GRADER = @"You are a question grader. The user provides you with a list of questions, the correct answers, and some provided answers.
You need to grade each answer as Correct, Incorrect, or Partial based on how well it matches the correct answer.
Provide feedback for each answer to help improve future responses.  If the answer contains additional context you should still consider the answer correct but you can add notes int he feedback.";

    PromptSection _questionGeneratorSystemPrompt = new PromptSection(PromptSection.Sources.System, QUESTION_GENERATOR);
    PromptSection _questionGraderSystemPrompt = new PromptSection(PromptSection.Sources.System, QUESTION_GRADER);
    private bool _disposedValue;

    public BenchmarkCommands(KnowProConsoleContext context)
    {
        _kpContext = context;
        _model = new OpenAIChatModel(AzureModelApiSettings.ChatSettingsFromEnv("GPT_5_2_CHAT"));
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
            Options.Arg<string>("outputPath", "The folder to save the results JSON file.", "."),
            Options.Arg<int>("maxCharsInBudget", "The number of characters for any given LLM call.", 16 * 1024)
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
        int maxCharsInBudget = namedArgs.Get<int>("maxCharsInBudget");
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
        List<TimingData> allTimingData = [];
        List<TokenData> allTokenData = [];
        Dictionary<string, int> bestAnswerTally = new()
        {
            ["Traditional Rag"] = 0,
            ["Structured Rag"] = 0,
            ["Tie"] = 0
        };

        foreach (var file in questionFiles)
        {
            TimeSpan fileProcessingStartTime = _kpContext.Stopwatch.Elapsed;

            var questions = Json.ParseFile<QuestionResponse>(file);
            KnowProWriter.Write(ConsoleColor.White, $"Loaded");
            KnowProWriter.Write(ConsoleColor.Magenta, $" {questions?.Questions?.Count} questions");
            KnowProWriter.WriteLine(ConsoleColor.White, $" from '{file}'");

            // now run this query through RAG and SRAG and collect the answers
            _kpContext.Stopwatch.Restart();
            for (int i = 0; i < questions?.Questions?.Count && (maxQuestions == 0 || i < maxQuestions); i++)
            {
                BenchmarkQuestion q = questions!.Questions![i];
                // get the RAG answer
                TimeSpan questionStart = _kpContext.Stopwatch.Elapsed;
                string question = q.Question;
                string category = q.Category;
                KnowProWriter.Write(ConsoleColor.DarkYellow, $"[ {i + 1} / {questions.Questions.Count} ] ");
                KnowProWriter.WriteLine(ConsoleColor.Yellow, $"Question: {question}");

                AnswerContextOptions answerOptions = new AnswerContextOptions() { MaxCharsInBudget = maxCharsInBudget };
                LangSearchOptions langSearchOptions = new LangSearchOptions() { ThresholdScore = 0.7, MaxCharsInBudget = maxCharsInBudget, MaxMessageMatches = 25 };


                // Get token counter before RAG call
                var generatorModel = conversation.Settings.AnswerGenerator.Settings.GeneratorModel;
                var languageModel = conversation.Settings.LanguageModel;

                uint ragTokensInBefore = generatorModel.TokenCounter.TokensIn;
                uint ragTokensOutBefore = generatorModel.TokenCounter.TokensOut;
                int ragCallCountBefore = generatorModel.TokenCounter.Latencies.Count;

                AnswerResponse? answerRAG = await conversation.AnswerQuestionRagAsync(question, langSearchOptions.ThresholdScore.Value, langSearchOptions.MaxCharsInBudget.Value, answerOptions, null, CancellationToken.None);
                TimeSpan ragDuration = _kpContext.Stopwatch.Elapsed.Subtract(questionStart);

                // Calculate RAG token usage
                uint ragTokensIn = generatorModel.TokenCounter.TokensIn - ragTokensInBefore;
                uint ragTokensOut = generatorModel.TokenCounter.TokensOut - ragTokensOutBefore;
                int ragCallCount = generatorModel.TokenCounter.Latencies.Count - ragCallCountBefore;

                KnowProWriter.Write(ConsoleColor.DarkBlue, $" RAG: ");
                if (answerRAG is null || answerRAG.Type == AnswerType.NoAnswer)
                {
                    KnowProWriter.Write(ConsoleColor.Red, $"No answer returned ({answerRAG?.WhyNoAnswer}).");
                }
                else
                {
                    KnowProWriter.Write(ConsoleColor.Green, $"{answerRAG.Answer}");
                }
                KnowProWriter.WriteLine(ConsoleColor.Cyan, $" [{ragDuration.TotalSeconds:N0}s] [Tokens: {ragTokensIn}+{ragTokensOut}={ragTokensIn + ragTokensOut}] [Calls: {ragCallCount}]");

                // Track RAG timing
                allTimingData.Add(new TimingData
                {
                    Source = "Traditional Rag",
                    Duration = ragDuration,
                    Category = category,
                    Difficulty = q.Difficulty
                });

                // Track RAG tokens
                allTokenData.Add(new TokenData
                {
                    Source = "Traditional Rag",
                    TokensIn = ragTokensIn,
                    TokensOut = ragTokensOut,
                    LlmCalls = ragCallCount,
                    Category = category,
                    Difficulty = q.Difficulty
                });

                // get the structured RAG answer
                KnowProWriter.Write(ConsoleColor.DarkCyan, $"SRAG: ");
                questionStart = _kpContext.Stopwatch.Elapsed;

                // Get token counter before SRAG call
                uint sragTokensInBefore = generatorModel.TokenCounter.TokensIn;
                uint sragTokensOutBefore = generatorModel.TokenCounter.TokensOut;
                int sragCallCountBefore = generatorModel.TokenCounter.Latencies.Count;

                AnswerResponse? answer = await conversation.AnswerQuestionAsync(question, langSearchOptions, null, answerOptions, null, CancellationToken.None);
                TimeSpan sragDuration = _kpContext.Stopwatch.Elapsed.Subtract(questionStart);

                // Calculate SRAG token usage
                uint sragTokensIn = generatorModel.TokenCounter.TokensIn - sragTokensInBefore;
                uint sragTokensOut = generatorModel.TokenCounter.TokensOut - sragTokensOutBefore;
                int sragCallCount = generatorModel.TokenCounter.Latencies.Count - sragCallCountBefore;

                if (answer is null || answer.Type == AnswerType.NoAnswer)
                {
                    KnowProWriter.Write(ConsoleColor.Red, $"No answer returned.({answer?.WhyNoAnswer})");
                }
                else
                {
                    KnowProWriter.Write(ConsoleColor.Green, $"{answer.Answer}");
                }
                KnowProWriter.WriteLine(ConsoleColor.Cyan, $" [{sragDuration.TotalSeconds:N0}s] [Tokens: {sragTokensIn}+{sragTokensOut}={sragTokensIn + sragTokensOut}] [Calls: {sragCallCount}]");

                // Track SRAG timing
                allTimingData.Add(new TimingData
                {
                    Source = "Structured Rag",
                    Duration = sragDuration,
                    Category = category,
                    Difficulty = q.Difficulty
                });

                // Track SRAG tokens
                allTokenData.Add(new TokenData
                {
                    Source = "Structured Rag",
                    TokensIn = sragTokensIn,
                    TokensOut = sragTokensOut,
                    LlmCalls = sragCallCount,
                    Category = category,
                    Difficulty = q.Difficulty
                });

                // Grade the answer
                GradingResponse answers = new GradingResponse()
                {
                    GradedQuestions = [
                        new GradedQuestion()
                        {
                            Id = 1,
                            Question = question,
                            CorrectAnswer = q.Answer,
                            Answer = answerRAG?.Answer ?? answerRAG?.WhyNoAnswer ?? string.Empty,
                            Category = q.Category,
                            Difficulty = q.Difficulty,
                            IsCorrect = Grade.Unknown
                        },
                        new GradedQuestion()
                        {
                            Id = 2,
                            Question = question,
                            CorrectAnswer = q.Answer,
                            Answer = answer?.Answer ?? answer?.WhyNoAnswer ?? string.Empty,
                            Category = q.Category,
                            Difficulty = q.Difficulty,
                            IsCorrect = Grade.Unknown
                        },

                    ]
                };

                var (graded, bestAnswer) = await EvaluateAnswersAsync(answers);
                foreach (var g in graded)
                {
                    g.Category = category;
                    if (g.Id % 2 == 0)
                    {
                        g.source = "Structured Rag";
                    }
                    else if (g.Id % 2 != 0)
                    {
                        g.source = "Traditional Rag";
                    }
                }

                // Tally best answer
                if (bestAnswer == 1)
                {
                    bestAnswerTally["Traditional Rag"]++;
                }
                else if (bestAnswer == 2)
                {
                    bestAnswerTally["Structured Rag"]++;
                }
                else
                {
                    bestAnswerTally["Tie"]++;
                }

                allGradedQuestions.AddRange(graded);
            }
            KnowProWriter.WriteLine(ConsoleColor.Cyan, $"'{Path.GetFileNameWithoutExtension(file)}' processing time: {_kpContext.Stopwatch.Elapsed.Subtract(fileProcessingStartTime).TotalSeconds:N0}s");
        }

        // group the questions by source
        Dictionary<string, List<GradedQuestion>> groupedQuestions = allGradedQuestions
            .GroupBy(g => g.source)
            .ToDictionary(g => g.Key, g => g.ToList());

        Dictionary<string, (int correct, int incorrect, int partial, int total, int noAnswer)> summary = [];

        // summarize each group
        foreach (var group in groupedQuestions)
        {
            int correct = group.Value.Count(g => g.IsCorrect == Grade.Correct);
            int incorrect = group.Value.Count(g => g.IsCorrect == Grade.Incorrect);
            int partial = group.Value.Count(g => g.IsCorrect == Grade.Partial);
            int noAnswer = group.Value.Count(g => g.Answer == "unknown" || string.IsNullOrEmpty(g.Answer));
            int total = group.Value.Count;
            summary.Add(group.Key, (correct, incorrect, partial, total, noAnswer));
        }

        // output combined summary table
        KnowProWriter.WriteLine(ConsoleColor.White, $"Overall Summary:");
        OutputSummary(summary, bestAnswerTally);

        // output category comparison table
        KnowProWriter.WriteLine(ConsoleColor.White, "");
        KnowProWriter.WriteLine(ConsoleColor.White, $"Category Comparison:");
        OutputCategoryComparison(allGradedQuestions);

        // output difficulty comparison table
        KnowProWriter.WriteLine(ConsoleColor.White, "");
        KnowProWriter.WriteLine(ConsoleColor.White, $"Difficulty Comparison:");
        OutputDifficultyComparison(allGradedQuestions);

        // output timing comparison table
        KnowProWriter.WriteLine(ConsoleColor.White, "");
        KnowProWriter.WriteLine(ConsoleColor.White, $"Timing Comparison:");
        OutputTimingComparison(allTimingData);

        // output token comparison table
        KnowProWriter.WriteLine(ConsoleColor.White, "");
        KnowProWriter.WriteLine(ConsoleColor.White, $"Token Usage Comparison:");
        OutputTokenComparison(allTokenData);

        // Build and save benchmark results to JSON
        BenchmarkSearchParameters searchParams = new()
        {
            RagThresholdScore = 0.7,
            RagMaxCharsInBudget = 8196,
            RagMessagesTopK = 25,
            SragThresholdScore = 0.7,
            SragMaxCharsInBudget = 8196,
            SragMaxMessageMatches = 25,
            MaxQuestions = maxQuestions,
            QuestionFiles = questionFiles
        };

        BenchmarkResults benchmarkResults = BuildBenchmarkResults(
            allGradedQuestions,
            allTimingData,
            allTokenData,
            bestAnswerTally,
            summary,
            searchParams
        );

        string outputPath = namedArgs.Get<string>("outputPath") ?? ".";
        SaveBenchmarkResults(benchmarkResults, outputPath);
    }

    private void OutputCategoryComparison(List<GradedQuestion> allGradedQuestions)
    {
        // Group by category and source
        var categoryGroups = allGradedQuestions
            .GroupBy(g => g.Category)
            .OrderBy(g => g.Key)
            .ToDictionary(
                g => g.Key,
                g => g.GroupBy(q => q.source)
                      .ToDictionary(
                          s => s.Key,
                          s => (
                              correct: s.Count(q => q.IsCorrect == Grade.Correct),
                              incorrect: s.Count(q => q.IsCorrect == Grade.Incorrect),
                              partial: s.Count(q => q.IsCorrect == Grade.Partial),
                              total: s.Count()
                          )
                      )
            );

        var sources = allGradedQuestions.Select(g => g.source).Distinct().ToList();

        // Build header
        StringBuilder headerBuilder = new();
        headerBuilder.Append($"{"Category",-CATEGORY_COL_WIDTH}");
        foreach (var source in sources)
        {
            headerBuilder.Append($" {source,VALUE_COL_WIDTH}");
        }
        headerBuilder.Append($" {"Count",METRIC_COL_WIDTH}");
        string header = headerBuilder.ToString();
        string separator = new string('-', header.Length);

        KnowProWriter.WriteLine(ConsoleColor.White, separator);
        KnowProWriter.WriteLine(ConsoleColor.Cyan, header);
        KnowProWriter.WriteLine(ConsoleColor.White, separator);

        // Track wins for each source
        Dictionary<string, int> wins = sources.ToDictionary(s => s, _ => 0);

        foreach (var category in categoryGroups)
        {
            string categoryName = category.Key.Length > CATEGORY_COL_WIDTH - 2
                ? category.Key[..(CATEGORY_COL_WIDTH - 5)] + "..."
                : category.Key;

            KnowProWriter.Write(ConsoleColor.White, $"{categoryName,-CATEGORY_COL_WIDTH}");

            // Calculate scores for each source in this category
            Dictionary<string, double> scores = [];
            foreach (var source in sources)
            {
                if (category.Value.TryGetValue(source, out var stats))
                {
                    double score = stats.total > 0
                        ? (stats.correct + ((double)stats.partial / 2)) / stats.total * 100D
                        : 0;
                    scores[source] = score;
                }
                else
                {
                    scores[source] = 0;
                }
            }

            double maxScore = scores.Values.Max();
            double minScore = scores.Values.Min();

            // Output scores with color coding
            foreach (var source in sources)
            {
                double score = scores[source];
                ConsoleColor scoreColor = score == maxScore && maxScore != minScore
                    ? ConsoleColor.Green
                    : score == minScore && maxScore != minScore
                        ? ConsoleColor.Red
                        : ConsoleColor.Yellow;

                KnowProWriter.Write(scoreColor, $" {score,VALUE_COL_WIDTH - 1:N1}%");
            }

            // Track winner
            if (maxScore != minScore)
            {
                string winner = sources.First(s => scores[s] == maxScore);
                wins[winner]++;
            }

            // Output question count for this category (divide by source count since each question appears once per source)
            int questionCount = category.Value.Values.Sum(v => v.total) / sources.Count;
            KnowProWriter.Write(ConsoleColor.White, $" {questionCount,METRIC_COL_WIDTH}");
            KnowProWriter.WriteLine(ConsoleColor.White, "");
        }

        KnowProWriter.WriteLine(ConsoleColor.White, separator);

        // Output win totals
        KnowProWriter.Write(ConsoleColor.Cyan, $"{"Category Wins",-CATEGORY_COL_WIDTH}");
        int maxWins = wins.Values.Max();
        int minWins = wins.Values.Min();
        foreach (var source in sources)
        {
            int winCount = wins[source];
            ConsoleColor winColor = winCount == maxWins && maxWins != minWins
                ? ConsoleColor.Green
                : winCount == minWins && maxWins != minWins
                    ? ConsoleColor.Red
                    : ConsoleColor.Yellow;
            KnowProWriter.Write(winColor, $" {winCount,VALUE_COL_WIDTH}");
        }
        KnowProWriter.WriteLine(ConsoleColor.White, "");
        KnowProWriter.WriteLine(ConsoleColor.White, separator);
    }

    private void OutputDifficultyComparison(List<GradedQuestion> allGradedQuestions)
    {
        // Group by difficulty and source
        var difficultyGroups = allGradedQuestions
            .GroupBy(g => g.Difficulty)
            .OrderBy(g => g.Key)
            .ToDictionary(
                g => g.Key,
                g => g.GroupBy(q => q.source)
                      .ToDictionary(
                          s => s.Key,
                          s => (
                              correct: s.Count(q => q.IsCorrect == Grade.Correct),
                              incorrect: s.Count(q => q.IsCorrect == Grade.Incorrect),
                              partial: s.Count(q => q.IsCorrect == Grade.Partial),
                              total: s.Count()
                          )
                      )
            );

        var sources = allGradedQuestions.Select(g => g.source).Distinct().ToList();

        // Build header
        StringBuilder headerBuilder = new();
        headerBuilder.Append($"{"Difficulty",-CATEGORY_COL_WIDTH}");
        foreach (var source in sources)
        {
            headerBuilder.Append($" {source,VALUE_COL_WIDTH}");
        }
        headerBuilder.Append($" {"Count",METRIC_COL_WIDTH}");
        string header = headerBuilder.ToString();
        string separator = new string('-', header.Length);

        KnowProWriter.WriteLine(ConsoleColor.White, separator);
        KnowProWriter.WriteLine(ConsoleColor.Cyan, header);
        KnowProWriter.WriteLine(ConsoleColor.White, separator);

        // Track wins for each source
        Dictionary<string, int> wins = sources.ToDictionary(s => s, _ => 0);

        foreach (var difficulty in difficultyGroups)
        {
            string difficultyName = difficulty.Key.ToString();

            KnowProWriter.Write(ConsoleColor.White, $"{difficultyName,-CATEGORY_COL_WIDTH}");

            // Calculate scores for each source in this difficulty
            Dictionary<string, double> scores = [];
            foreach (var source in sources)
            {
                if (difficulty.Value.TryGetValue(source, out var stats))
                {
                    double score = stats.total > 0
                        ? (stats.correct + ((double)stats.partial / 2)) / stats.total * 100D
                        : 0;
                    scores[source] = score;
                }
                else
                {
                    scores[source] = 0;
                }
            }

            double maxScore = scores.Values.Max();
            double minScore = scores.Values.Min();

            // Output scores with color coding
            foreach (var source in sources)
            {
                double score = scores[source];
                ConsoleColor scoreColor = score == maxScore && maxScore != minScore
                    ? ConsoleColor.Green
                    : score == minScore && maxScore != minScore
                        ? ConsoleColor.Red
                        : ConsoleColor.Yellow;

                KnowProWriter.Write(scoreColor, $" {score,VALUE_COL_WIDTH - 1:N1}%");
            }

            // Track winner
            if (maxScore != minScore)
            {
                string winner = sources.First(s => scores[s] == maxScore);
                wins[winner]++;
            }

            // Output question count for this difficulty (divide by source count since each question appears once per source)
            int questionCount = difficulty.Value.Values.Sum(v => v.total) / sources.Count;
            KnowProWriter.Write(ConsoleColor.White, $" {questionCount,METRIC_COL_WIDTH}");
            KnowProWriter.WriteLine(ConsoleColor.White, "");
        }

        KnowProWriter.WriteLine(ConsoleColor.White, separator);

        // Output win totals
        KnowProWriter.Write(ConsoleColor.Cyan, $"{"Difficulty Wins",-CATEGORY_COL_WIDTH}");
        int maxWins = wins.Values.Max();
        int minWins = wins.Values.Min();
        foreach (var source in sources)
        {
            int winCount = wins[source];
            ConsoleColor winColor = winCount == maxWins && maxWins != minWins
                ? ConsoleColor.Green
                : winCount == minWins && maxWins != minWins
                    ? ConsoleColor.Red
                    : ConsoleColor.Yellow;
            KnowProWriter.Write(winColor, $" {winCount,VALUE_COL_WIDTH}");
        }
        KnowProWriter.WriteLine(ConsoleColor.White, "");
        KnowProWriter.WriteLine(ConsoleColor.White, separator);
    }

    private void OutputSummary(Dictionary<string, (int correct, int incorrect, int partial, int total, int noAnswer)> summary, Dictionary<string, int> bestAnswerTally)
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
            double score = (group.Value.correct + ((double)group.Value.partial / 2D)) / (double)group.Value.total * 100D;
            scores[group.Key] = score;
        }

        // Data rows for each metric
        WriteMetricRow("Correct", sources, s => summary[s].correct);
        WriteMetricRow("Incorrect", sources, s => summary[s].incorrect, true);
        WriteMetricRow("Partial", sources, s => summary[s].partial);
        WriteMetricRow("Total", sources, s => summary[s].total);

        // Divider before No Answers
        KnowProWriter.WriteLine(ConsoleColor.White, separator);

        // No Answers row (lower is better)
        WriteMetricRow("No Answers", sources, s => summary[s].noAnswer, lowerIsBetter: true);

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

        // Best Answer Tally
        KnowProWriter.WriteLine(ConsoleColor.White, separator);
        string tie = $"(Tie {(double)bestAnswerTally["Tie"] / (double)summary.First().Value.total * 100:N1}%)";
        double? maxBestAnswer = bestAnswerTally.Values.Max();
        double? minBestAnswee = bestAnswerTally.Values.Min();
        KnowProWriter.Write(ConsoleColor.Cyan, $"{"Best Answer",-METRIC_COL_WIDTH}");
        foreach (var source in sources)
        {
            int tally = bestAnswerTally[source];

            ConsoleColor tallyColor = tally == maxBestAnswer && maxBestAnswer != minBestAnswee
                ? ConsoleColor.Green
                : tally == minScore && maxBestAnswer != minBestAnswee
                    ? ConsoleColor.Red
                    : ConsoleColor.Cyan;

            KnowProWriter.Write(tallyColor, $" {(double)tally / (double)summary.First().Value.total * 100,VALUE_COL_WIDTH - 1:N1}");
        }
        KnowProWriter.WriteLine(ConsoleColor.Yellow, $"  Tie: {tie:N1}%");
        KnowProWriter.WriteLine(ConsoleColor.White, separator);
    }

    private void WriteMetricRow(string metricName, List<string> sources, Func<string, double> getValue, bool lowerIsBetter = false)
    {
        KnowProWriter.Write(ConsoleColor.White, $"{metricName,-METRIC_COL_WIDTH}");
        var v1 = getValue(sources.First());
        var v2 = getValue(sources.Last());

        ConsoleColor color1, color2;
        if (v1 == v2)
        {
            color1 = color2 = ConsoleColor.Yellow;
        }
        else if (lowerIsBetter)
        {
            color1 = v1 < v2 ? ConsoleColor.Green : ConsoleColor.Red;
            color2 = v1 < v2 ? ConsoleColor.Red : ConsoleColor.Green;
        }
        else
        {
            color1 = v1 > v2 ? ConsoleColor.Green : ConsoleColor.Red;
            color2 = v1 > v2 ? ConsoleColor.Red : ConsoleColor.Green;
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
        string[] files = Directory.GetFiles(path, "*.txt");

        KnowProWriter.WriteLine(ConsoleColor.White, $"Found {files.Length} text transcripts.");

        for(int i = 0; i < files.Length; i++)
        {
            await CreateQuestionsForPodcastAsync(files[i], i + 1, files.Length);
        }
    }

    /// <summary>
    /// Given a podcast transcript get the LLM to generate some questions for the podcast content
    /// </summary>
    /// <param name="file">The file for which we are generating questions.</param>
    /// <param name="index">The current file idnex</param>
    /// <param name="total">The total # of files</param>
    private async Task CreateQuestionsForPodcastAsync(string file, int index, int total)
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

        KnowProWriter.Write(ConsoleColor.DarkYellow, $"[ {index} / {total} ]");
        KnowProWriter.Write(ConsoleColor.White, $"Generating questions for '{Path.GetFileNameWithoutExtension(file)}'...");

        PromptSection transcript = new PromptSection(PromptSection.Sources.User, File.ReadAllText(file));

        var response = await translator.TranslateAsync(new(transcript), [_questionGeneratorSystemPrompt], _translatorSettings, CancellationToken.None);

        // write out these questions to a file
        string outFile = Path.ChangeExtension(file, ".questions.json");
        Json.StringifyToFile(response, outFile, true, true);

        KnowProWriter.WriteLine(ConsoleColor.Cyan, $"done. [{_kpContext.Stopwatch.Elapsed.Subtract(start).TotalSeconds:N2}s]");
    }

    /// <summary>
    /// Given a podcast transcript get the LLM to generate some questions for the podcast content
    /// </summary>
    /// <param name="answers">The answers being graded.</param>
    private async Task<(List<GradedQuestion> graded, int bestAnswer)> EvaluateAnswersAsync(GradingResponse answers)
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
        s_options.PropertyNameCaseInsensitive = true;
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
        int bestAnswer = -1;
        //foreach (GradedQuestion q in answers.GradedQuestions)
        {
            try
            {
                KnowProWriter.Write(ConsoleColor.White, $"Grading {answers.GradedQuestions.First().Question}");

                PromptSection transcript = new PromptSection(PromptSection.Sources.User, Json.Stringify(answers.GradedQuestions));

                var response = await translator.TranslateAsync(new(transcript), [_questionGraderSystemPrompt], _translatorSettings, CancellationToken.None);

                KnowProWriter.Write(ConsoleColor.Gray, Json.Stringify(response));

                gradedQuestions.AddRange(response.GradedQuestions);
                bestAnswer = response.BestAnswer;

                Json.StringifyToFile(response, "grades.json", false);

                KnowProWriter.WriteLine(ConsoleColor.Cyan, $"done. [{_kpContext.Stopwatch.Elapsed.Subtract(start).TotalSeconds:N2}s]");
            }
            catch (Exception ex)
            {
                KnowProWriter.WriteLine(ConsoleColor.Red, ex.ToString());
            }

        }

        return (gradedQuestions, bestAnswer);
    }

    private void OutputTimingComparison(List<TimingData> allTimingData)
    {
        var sources = allTimingData.Select(t => t.Source).Distinct().ToList();

        // Calculate timing statistics per source
        var timingStats = allTimingData
            .GroupBy(t => t.Source)
            .ToDictionary(
                g => g.Key,
                g => (
                    total: g.Aggregate(TimeSpan.Zero, (sum, t) => sum + t.Duration),
                    count: g.Count(),
                    min: g.Min(t => t.Duration),
                    max: g.Max(t => t.Duration),
                    avg: TimeSpan.FromTicks(g.Sum(t => t.Duration.Ticks) / g.Count())
                )
            );

        // Build header
        StringBuilder headerBuilder = new();
        headerBuilder.Append($"{"Metric",-CATEGORY_COL_WIDTH}");
        foreach (var source in sources)
        {
            headerBuilder.Append($" {source,VALUE_COL_WIDTH}");
        }
        string header = headerBuilder.ToString();
        string separator = new string('-', header.Length);

        KnowProWriter.WriteLine(ConsoleColor.White, separator);
        KnowProWriter.WriteLine(ConsoleColor.Cyan, header);
        KnowProWriter.WriteLine(ConsoleColor.White, separator);

        // Total time row (lower is better)
        WriteTimingRow("Total Time", sources, s => timingStats[s].total, lowerIsBetter: true);

        // Question count row
        WriteTimingRow("Questions", sources, s => TimeSpan.FromSeconds(timingStats[s].count), lowerIsBetter: false, isCount: true);

        // Average time row (lower is better)
        WriteTimingRow("Avg Time", sources, s => timingStats[s].avg, lowerIsBetter: true);

        // Min time row (lower is better)
        WriteTimingRow("Min Time", sources, s => timingStats[s].min, lowerIsBetter: true);

        // Max time row (lower is better)
        WriteTimingRow("Max Time", sources, s => timingStats[s].max, lowerIsBetter: true);

        KnowProWriter.WriteLine(ConsoleColor.White, separator);

        // Calculate and display speed difference
        if (sources.Count >= 2)
        {
            var first = timingStats[sources[0]].total;
            var second = timingStats[sources[1]].total;
            var faster = first < second ? sources[0] : sources[1];
            var slower = first < second ? sources[1] : sources[0];
            var fasterTime = first < second ? first : second;
            var slowerTime = first < second ? second : first;
            var speedup = slowerTime.TotalSeconds / fasterTime.TotalSeconds;

            KnowProWriter.Write(ConsoleColor.White, $"{"Speed Diff",-CATEGORY_COL_WIDTH}");
            KnowProWriter.Write(ConsoleColor.Green, $" {faster} is {speedup:N2}x faster");
            KnowProWriter.WriteLine(ConsoleColor.White, "");
            KnowProWriter.WriteLine(ConsoleColor.White, separator);
        }
    }

    private void WriteTimingRow(string metricName, List<string> sources, Func<string, TimeSpan> getValue, bool lowerIsBetter, bool isCount = false)
    {
        KnowProWriter.Write(ConsoleColor.White, $"{metricName,-CATEGORY_COL_WIDTH}");

        var values = sources.Select(s => getValue(s)).ToList();
        var minValue = values.Min();
        var maxValue = values.Max();

        foreach (var source in sources)
        {
            var value = getValue(source);
            ConsoleColor color;

            if (minValue == maxValue)
            {
                color = ConsoleColor.Yellow;
            }
           else if (lowerIsBetter)
            {
                color = value == minValue ? ConsoleColor.Green : ConsoleColor.Red;
            }
            else
            {
                color = value == maxValue ? ConsoleColor.Green : ConsoleColor.Red;
            }

            string displayValue = isCount
                ? $"{(int)value.TotalSeconds,VALUE_COL_WIDTH}"
                : $"{value.TotalSeconds,VALUE_COL_WIDTH - 1:N2}s";

            KnowProWriter.Write(color, $" {displayValue}");
        }
        KnowProWriter.WriteLine(ConsoleColor.White, "");
    }

    private void OutputTokenComparison(List<TokenData> allTokenData)
    {
        var sources = allTokenData.Select(t => t.Source).Distinct().ToList();

        // Calculate token statistics per source
        var tokenStats = allTokenData
            .GroupBy(t => t.Source)
            .ToDictionary(
                g => g.Key,
                g => (
                    totalIn: g.Sum(t => (long)t.TokensIn),
                    totalOut: g.Sum(t => (long)t.TokensOut),
                    totalTokens: g.Sum(t => (long)(t.TokensIn + t.TokensOut)),
                    totalCalls: g.Sum(t => t.LlmCalls),
                    count: g.Count(),
                    minIn: g.Min(t => t.TokensIn),
                    maxIn: g.Max(t => t.TokensIn),
                    minOut: g.Min(t => t.TokensOut),
                    maxOut: g.Max(t => t.TokensOut),
                    avgIn: (double)g.Sum(t => (long)t.TokensIn) / g.Count(),
                    avgOut: (double)g.Sum(t => (long)t.TokensOut) / g.Count(),
                    avgCalls: (double)g.Sum(t => t.LlmCalls) / g.Count()
                )
            );

        // Build header
        StringBuilder headerBuilder = new();
        headerBuilder.Append($"{"Metric",-CATEGORY_COL_WIDTH}");
        foreach (var source in sources)
        {
            headerBuilder.Append($" {source,VALUE_COL_WIDTH}");
        }
        string header = headerBuilder.ToString();
        string separator = new string('-', header.Length);

        KnowProWriter.WriteLine(ConsoleColor.White, separator);
        KnowProWriter.WriteLine(ConsoleColor.Cyan, header);
        KnowProWriter.WriteLine(ConsoleColor.White, separator);

        // Total tokens row (lower is better for cost)
        WriteTokenRow("Total Tokens", sources, s => tokenStats[s].totalTokens, lowerIsBetter: true);

        // Total input tokens row (lower is better)
        WriteTokenRow("Total In", sources, s => tokenStats[s].totalIn, lowerIsBetter: true);

        // Total output tokens row (lower is better)
        WriteTokenRow("Total Out", sources, s => tokenStats[s].totalOut, lowerIsBetter: true);

        // Total LLM calls row (lower is better)
        WriteTokenRow("Total LLM Calls", sources, s => tokenStats[s].totalCalls, lowerIsBetter: true);

        KnowProWriter.WriteLine(ConsoleColor.White, separator);

        // Average tokens per question
        WriteTokenRow("Avg Total", sources, s => (long)(tokenStats[s].avgIn + tokenStats[s].avgOut), lowerIsBetter: true);

        // Average input tokens
        WriteTokenRow("Avg In", sources, s => (long)tokenStats[s].avgIn, lowerIsBetter: true);

        // Average output tokens
        WriteTokenRow("Avg Out", sources, s => (long)tokenStats[s].avgOut, lowerIsBetter: true);

        // Average LLM calls per question
        WriteTokenRowDouble("Avg LLM Calls", sources, s => tokenStats[s].avgCalls, lowerIsBetter: true);

        KnowProWriter.WriteLine(ConsoleColor.White, separator);

        // Min/Max rows
        WriteTokenRow("Min In", sources, s => tokenStats[s].minIn, lowerIsBetter: true);
        WriteTokenRow("Max In", sources, s => tokenStats[s].maxIn, lowerIsBetter: true);
        WriteTokenRow("Min Out", sources, s => tokenStats[s].minOut, lowerIsBetter: true);
        WriteTokenRow("Max Out", sources, s => tokenStats[s].maxOut, lowerIsBetter: true);

        KnowProWriter.WriteLine(ConsoleColor.White, separator);

        // Calculate and display token savings
        if (sources.Count >= 2)
        {
            var first = tokenStats[sources[0]].totalTokens;
            var second = tokenStats[sources[1]].totalTokens;
            var cheaper = first < second ? sources[0] : sources[1];
            var moreExpensive = first < second ? sources[1] : sources[0];
            var cheaperTokens = first < second ? first : second;
            var moreExpensiveTokens = first < second ? second : first;
            var savings = (double)(moreExpensiveTokens - cheaperTokens) / moreExpensiveTokens * 100;
            var ratio = (double)moreExpensiveTokens / cheaperTokens;

            KnowProWriter.Write(ConsoleColor.White, $"{"Token Savings",-CATEGORY_COL_WIDTH}");
            KnowProWriter.Write(ConsoleColor.Green, $" {cheaper} uses {ratio:N2}x fewer tokens ({savings:N1}% savings)");
            KnowProWriter.WriteLine(ConsoleColor.White, "");
            KnowProWriter.WriteLine(ConsoleColor.White, separator);
        }
    }

    private void WriteTokenRow(string metricName, List<string> sources, Func<string, long> getValue, bool lowerIsBetter)
    {
        KnowProWriter.Write(ConsoleColor.White, $"{metricName,-CATEGORY_COL_WIDTH}");

        var values = sources.Select(s => getValue(s)).ToList();
        var minValue = values.Min();
        var maxValue = values.Max();

        foreach (var source in sources)
        {
            var value = getValue(source);
            ConsoleColor color;

            if (minValue == maxValue)
            {
                color = ConsoleColor.Yellow;
            }
            else if (lowerIsBetter)
            {
                color = value == minValue ? ConsoleColor.Green : ConsoleColor.Red;
            }
            else
            {
                color = value == maxValue ? ConsoleColor.Green : ConsoleColor.Red;
            }

            KnowProWriter.Write(color, $" {value,VALUE_COL_WIDTH:N0}");
        }
        KnowProWriter.WriteLine(ConsoleColor.White, "");
    }

    private void WriteTokenRowDouble(string metricName, List<string> sources, Func<string, double> getValue, bool lowerIsBetter)
    {
        KnowProWriter.Write(ConsoleColor.White, $"{metricName,-CATEGORY_COL_WIDTH}");

        var values = sources.Select(s => getValue(s)).ToList();
        var minValue = values.Min();
        var maxValue = values.Max();

        foreach (var source in sources)
        {
            var value = getValue(source);
            ConsoleColor color;

            if (Math.Abs(minValue - maxValue) < 0.001)
            {
                color = ConsoleColor.Yellow;
            }
            else if (lowerIsBetter)
            {
                color = Math.Abs(value - minValue) < 0.001 ? ConsoleColor.Green : ConsoleColor.Red;
            }
            else
            {
                color = Math.Abs(value - maxValue) < 0.001 ? ConsoleColor.Green : ConsoleColor.Red;
            }

            KnowProWriter.Write(color, $" {value,VALUE_COL_WIDTH:N2}");
        }
        KnowProWriter.WriteLine(ConsoleColor.White, "");
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

    private BenchmarkResults BuildBenchmarkResults(
        List<GradedQuestion> allGradedQuestions,
        List<TimingData> allTimingData,
        List<TokenData> allTokenData,
        Dictionary<string, int> bestAnswerTally,
        Dictionary<string, (int correct, int incorrect, int partial, int total, int noAnswer)> summary,
        BenchmarkSearchParameters searchParameters)
    {
        var results = new BenchmarkResults
        {
            RunDate = System.DateTime.UtcNow,
            SearchParameters = searchParameters,
            BestAnswerTally = bestAnswerTally,
            GradedQuestions = allGradedQuestions
        };

        // Build overall summary
        foreach (var group in summary)
        {
            double score = (group.Value.correct + ((double)group.Value.partial / 2D)) / (double)group.Value.total * 100D;
            results.OverallSummary[group.Key] = new SourceSummary
            {
                Correct = group.Value.correct,
                Incorrect = group.Value.incorrect,
                Partial = group.Value.partial,
                Total = group.Value.total,
                NoAnswer = group.Value.noAnswer,
                Score = score
            };
        }

        // Build category comparison
        var categoryGroups = allGradedQuestions
            .GroupBy(g => g.Category)
            .ToDictionary(
                g => g.Key,
                g => g.GroupBy(q => q.source)
                      .ToDictionary(
                          s => s.Key,
                          s =>
                          {
                              int correct = s.Count(q => q.IsCorrect == Grade.Correct);
                              int incorrect = s.Count(q => q.IsCorrect == Grade.Incorrect);
                              int partial = s.Count(q => q.IsCorrect == Grade.Partial);
                              int total = s.Count();
                              double score = total > 0 ? (correct + ((double)partial / 2)) / total * 100D : 0;
                              return new CategoryStats
                              {
                                  Correct = correct,
                                  Incorrect = incorrect,
                                  Partial = partial,
                                  Total = total,
                                  Score = score
                              };
                          }
                      )
            );
        results.CategoryComparison = categoryGroups;

        // Build difficulty comparison
        var difficultyGroups = allGradedQuestions
            .GroupBy(g => g.Difficulty.ToString())
            .ToDictionary(
                g => g.Key,
                g => g.GroupBy(q => q.source)
                      .ToDictionary(
                          s => s.Key,
                          s =>
                          {
                              int correct = s.Count(q => q.IsCorrect == Grade.Correct);
                              int incorrect = s.Count(q => q.IsCorrect == Grade.Incorrect);
                              int partial = s.Count(q => q.IsCorrect == Grade.Partial);
                              int total = s.Count();
                              double score = total > 0 ? (correct + ((double)partial / 2)) / total * 100D : 0;
                              return new CategoryStats
                              {
                                  Correct = correct,
                                  Incorrect = incorrect,
                                  Partial = partial,
                                  Total = total,
                                  Score = score
                              };
                          }
                      )
            );
        results.DifficultyComparison = difficultyGroups;

        // Build timing stats
        results.TimingStats = allTimingData
            .GroupBy(t => t.Source)
            .ToDictionary(
                g => g.Key,
                g => new TimingStats
                {
                    TotalSeconds = g.Aggregate(TimeSpan.Zero, (sum, t) => sum + t.Duration).TotalSeconds,
                    Count = g.Count(),
                    MinSeconds = g.Min(t => t.Duration).TotalSeconds,
                    MaxSeconds = g.Max(t => t.Duration).TotalSeconds,
                    AvgSeconds = g.Sum(t => t.Duration.Ticks) / g.Count() / TimeSpan.TicksPerSecond
                }
            );

        // Build token stats
        results.TokenStats = allTokenData
            .GroupBy(t => t.Source)
            .ToDictionary(
                g => g.Key,
                g => new TokenStats
                {
                    TotalIn = g.Sum(t => (long)t.TokensIn),
                    TotalOut = g.Sum(t => (long)t.TokensOut),
                    TotalTokens = g.Sum(t => (long)(t.TokensIn + t.TokensOut)),
                    TotalLlmCalls = g.Sum(t => t.LlmCalls),
                    Count = g.Count(),
                    AvgIn = (double)g.Sum(t => (long)t.TokensIn) / g.Count(),
                    AvgOut = (double)g.Sum(t => (long)t.TokensOut) / g.Count(),
                    AvgLlmCalls = (double)g.Sum(t => t.LlmCalls) / g.Count()
                }
            );

        return results;
    }

    private void SaveBenchmarkResults(BenchmarkResults results, string outputPath)
    {
        string timestamp = results.RunDate.ToString("yyyyMMdd_HHmmss");
        string fileName = Path.Combine(outputPath, $"benchmark_results_{timestamp}.json");
        Json.StringifyToFile(results, fileName, true, true);
        KnowProWriter.WriteLine(ConsoleColor.Green, $"Results saved to: {fileName}");
    }
}

public class BenchmarkQuestion
{
    [JsonPropertyName("question")]
    public required string Question { get; set; }

    [JsonPropertyName("category")]
    public required string Category { get; set; }

    [JsonPropertyName("answer")]
    public string Answer { get; set; } = string.Empty;

    [JsonPropertyName("difficulty")]
    public Difficulty Difficulty { get; set; } = Difficulty.NotSpecified;
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

    [JsonPropertyName("bestAnswer")]
    public int BestAnswer { get; set; } = -1;

    [JsonPropertyName("whyBestAnswer")]
    public string WhyBestAnswer { get; set; } = string.Empty;
}

public class GradedQuestion : BenchmarkQuestion
{
    [JsonPropertyName("id")]
    public int Id { get; set; } = -1;
    [JsonPropertyName("correctAnswer")]
    public required string CorrectAnswer { get; set; } = string.Empty;
    //[JsonPropertyName("providedAnswer")]
    //public required string ProvidedAnswer { get; set; } = string.Empty;
    [JsonPropertyName("isCorrect")]
    public Grade IsCorrect { get; set; } = Benchmarking.Grade.Unknown;
    [JsonPropertyName("feedback")]
    public string Feedback { get; set; } = string.Empty;

    /// <summary>
    /// The source of the question (withheld from LLM to prevent any bias)
    /// </summary>
    public string source { get; set; } = string.Empty;
}

public enum Grade
{
    [JsonPropertyName("unknown")]
    Unknown,
    [JsonPropertyName("correct")]
    Correct,
    [JsonPropertyName("incorrect")]
    Incorrect,
    [JsonPropertyName("partial")]
    Partial
}

public enum Difficulty
{
    [JsonPropertyName("notSpecified")]
    NotSpecified,
    [JsonPropertyName("easy")]
    Easy,
    [JsonPropertyName("medium")]
    Moderate,
    [JsonPropertyName("hard")]
    Hard
}

public class TimingData
{
    public string Source { get; set; } = string.Empty;
    public TimeSpan Duration { get; set; }
    public string Category { get; set; } = string.Empty;
    public Difficulty Difficulty { get; set; }
}

public class TokenData
{
    public string Source { get; set; } = string.Empty;
    public uint TokensIn { get; set; }
    public uint TokensOut { get; set; }
    public int LlmCalls { get; set; }
    public string Category { get; set; } = string.Empty;
    public Difficulty Difficulty { get; set; }
}

public class BenchmarkResults
{
    [JsonPropertyName("runDate")]
    public System.DateTime RunDate { get; set; } = System.DateTime.UtcNow;

    [JsonPropertyName("searchParameters")]
    public BenchmarkSearchParameters SearchParameters { get; set; } = new();

    [JsonPropertyName("overallSummary")]
    public Dictionary<string, SourceSummary> OverallSummary { get; set; } = [];

    [JsonPropertyName("bestAnswerTally")]
    public Dictionary<string, int> BestAnswerTally { get; set; } = [];

    [JsonPropertyName("categoryComparison")]
    public Dictionary<string, Dictionary<string, CategoryStats>> CategoryComparison { get; set; } = [];

    [JsonPropertyName("difficultyComparison")]
    public Dictionary<string, Dictionary<string, CategoryStats>> DifficultyComparison { get; set; } = [];

    [JsonPropertyName("timingStats")]
    public Dictionary<string, TimingStats> TimingStats { get; set; } = [];

    [JsonPropertyName("tokenStats")]
    public Dictionary<string, TokenStats> TokenStats { get; set; } = [];

    [JsonPropertyName("gradedQuestions")]
    public List<GradedQuestion> GradedQuestions { get; set; } = [];
}

public class BenchmarkSearchParameters
{
    [JsonPropertyName("ragThresholdScore")]
    public double RagThresholdScore { get; set; }

    [JsonPropertyName("ragMaxCharsInBudget")]
    public int RagMaxCharsInBudget { get; set; }

    [JsonPropertyName("ragMessagesTopK")]
    public int RagMessagesTopK { get; set; }

    [JsonPropertyName("sragThresholdScore")]
    public double SragThresholdScore { get; set; }

    [JsonPropertyName("sragMaxCharsInBudget")]
    public int SragMaxCharsInBudget { get; set; }

    [JsonPropertyName("sragMaxMessageMatches")]
    public int SragMaxMessageMatches { get; set; }

    [JsonPropertyName("maxQuestions")]
    public int MaxQuestions { get; set; }

    [JsonPropertyName("questionFiles")]
    public List<string> QuestionFiles { get; set; } = [];
}

public class SourceSummary
{
    [JsonPropertyName("correct")]
    public int Correct { get; set; }

    [JsonPropertyName("incorrect")]
    public int Incorrect { get; set; }

    [JsonPropertyName("partial")]
    public int Partial { get; set; }

    [JsonPropertyName("total")]
    public int Total { get; set; }

    [JsonPropertyName("noAnswer")]
    public int NoAnswer { get; set; }

    [JsonPropertyName("score")]
    public double Score { get; set; }
}

public class CategoryStats
{
    [JsonPropertyName("correct")]
    public int Correct { get; set; }

    [JsonPropertyName("incorrect")]
    public int Incorrect { get; set; }

    [JsonPropertyName("partial")]
    public int Partial { get; set; }

    [JsonPropertyName("total")]
    public int Total { get; set; }

    [JsonPropertyName("score")]
    public double Score { get; set; }
}

public class TimingStats
{
    [JsonPropertyName("totalSeconds")]
    public double TotalSeconds { get; set; }

    [JsonPropertyName("count")]
    public int Count { get; set; }

    [JsonPropertyName("minSeconds")]
    public double MinSeconds { get; set; }

    [JsonPropertyName("maxSeconds")]
    public double MaxSeconds { get; set; }

    [JsonPropertyName("avgSeconds")]
    public double AvgSeconds { get; set; }
}

public class TokenStats
{
    [JsonPropertyName("totalIn")]
    public long TotalIn { get; set; }

    [JsonPropertyName("totalOut")]
    public long TotalOut { get; set; }

    [JsonPropertyName("totalTokens")]
    public long TotalTokens { get; set; }

    [JsonPropertyName("totalLlmCalls")]
    public int TotalLlmCalls { get; set; }

    [JsonPropertyName("count")]
    public int Count { get; set; }

    [JsonPropertyName("avgIn")]
    public double AvgIn { get; set; }

    [JsonPropertyName("avgOut")]
    public double AvgOut { get; set; }

    [JsonPropertyName("avgLlmCalls")]
    public double AvgLlmCalls { get; set; }
}
