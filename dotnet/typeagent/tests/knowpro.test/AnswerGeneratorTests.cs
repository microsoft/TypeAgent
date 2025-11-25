// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
using System.CommandLine;
using System.Diagnostics;
using System.Linq;
using System.Reflection;
using System.Reflection.Emit;
using System.Runtime.CompilerServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using KnowProConsole;
using TypeAgent.AIClient;
using TypeAgent.ConversationMemory;
using TypeAgent.ExamplesLib;
using TypeAgent.ExamplesLib.CommandLine;
using TypeAgent.KnowPro;
using TypeAgent.KnowPro.Answer;
using TypeAgent.KnowPro.Lang;
using TypeAgent.KnowPro.Storage.Sqlite;
using TypeAgent.KnowProTest;
using static System.Runtime.InteropServices.JavaScript.JSType;

namespace TypeAgent.Tests.KnowPro;

public class AnswerGeneratorTests : TestWithTemporaryFiles
{

    [Fact]
    public async Task GenerateAnswerAsync()
    {
        List<string> testQueries = QueryUtils.LoadTestQueries("../../../../../../../ts/packages/knowPro/test/data/Episode_53_nlpAnswer.txt");

        IChatModel model = ModelUtils.CreateTestChatModel(nameof(GenerateAnswerAsync));
        AnswerGenerator answerGenerator = new AnswerGenerator(AnswerGeneratorSettings.CreateDefault(model));

        // simulate console commands
        RootCommand cmds = [];
        cmds.AddModule(new PodcastCommands(new KnowProConsoleContext()));
        cmds.AddModule(new MemoryCommands(new KnowProConsoleContext()));
        cmds.AddModule(new TestCommands(new KnowProConsoleContext()));

        var provider = new SqliteStorageProvider<PodcastMessage, PodcastMessageMeta>(new ConversationSettings(), Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location), "episode_53_adriantchaikovsky", false);

        Podcast podcast = new Podcast(new MemorySettings(), provider);

        foreach (string query in testQueries)
        {
            var space = query.IndexOf(' ');
            var cmdLine = new string[] { "kpTestAnswer", query[..space], query[space..] };

            var parseResult = cmds.Parse(cmdLine);
            string? question = parseResult.GetValue<string>("--query");

            Assert.False(string.IsNullOrEmpty(question));
            question = question.Replace("\"", "").Trim();

            LangSearchDebugContext? debugContext = new LangSearchDebugContext();
            var searchResults = await podcast.SearchAsync(question, null, null, debugContext);

            Assert.True(searchResults.Any());

            // Get answers for individual questions in parallel
            List<AnswerResponse> answerResponses = await searchResults.MapAsync(
                2,
                async (searchResult, ct) =>
                {
                    return await podcast.AnswerQuestionAsync(
                        question,
                        searchResult,
                        null,
                        CancellationToken.None
                    ).ConfigureAwait(false);
                },
                null,
                CancellationToken.None
            );

            if (answerResponses.Count == 1)
            {
                Assert.Equal(AnswerType.Answered, answerResponses.First().Type);
                Assert.False(string.IsNullOrEmpty(answerResponses.First().Answer));
            }
            else
            {
                AnswerGenerator generator = new AnswerGenerator(AnswerGeneratorSettings.CreateDefault(model));
                var combinedResponse = await generator.CombinePartialAsync(
                    question,
                    answerResponses,
                    CancellationToken.None
                );

                Assert.Equal(AnswerType.Answered, combinedResponse.Type);
                Assert.False(string.IsNullOrEmpty(combinedResponse.Answer));
            }
        }
    }
}

