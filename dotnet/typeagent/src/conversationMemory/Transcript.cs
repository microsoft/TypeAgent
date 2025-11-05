// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Text.RegularExpressions;

namespace TypeAgent.ConversationMemory;

public interface ITranscriptMessage
{
    void AddContent(string text, int chunkOrdinal);
}

public static partial class Transcript
{
    // Matches an optional SPEAKER: prefix (uppercase letters/digits) followed by the rest of the line as speech.
    // Examples:
    //  ALICE: Hello there
    //  BOB:
    //  (continuation line) more text
    [GeneratedRegex(@"^(?:(?<speaker>[A-Z0-9 ]+):)?(?<speech>.*)$", RegexOptions.Compiled)]
    private static partial Regex s_turnParserRegex();

    private static readonly Regex s_turnParser = s_turnParserRegex();

    /// <summary>
    /// Parses transcript text consisting of turns in a conversation.
    /// Turns are lines of the form:
    ///   SPEAKER_NAME: TEXT
    ///   SPEAKER_NAME:
    ///   TEXT (continuation of prior speaker)
    /// Returns the list of constructed messages and the distinct participant speaker names (normalized).
    /// </summary>
    /// <typeparam name="TMessage">Concrete message type implementing <see cref="ITranscriptMessage"/>.</typeparam>
    /// <param name="transcriptText">Full transcript text.</param>
    /// <param name="messageFactory">
    /// Factory invoked for each new message: (speaker, initialText) => message.
    /// speaker may be null for lines that continue without a new speaker prefix.
    /// </param>
    public static (IList<TMessage> Messages, ISet<string> Participants) Parse<TMessage>(
        string transcriptText,
        Func<string, string?, TMessage> messageFactory)
        where TMessage : ITranscriptMessage
    {
        var lines = GetTranscriptLines(transcriptText);
        var participants = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var messages = new List<TMessage>();

        TMessage? current = default;

        foreach (var line in lines)
        {
            var match = s_turnParser.Match(line);
            if (!match.Success)
            {
                continue;
            }

            var speakerRaw = match.Groups["speaker"].Success ? match.Groups["speaker"].Value : null;
            var speech = match.Groups["speech"].Value;

            if (current is not null)
            {
                if (speakerRaw is not null)
                {
                    // New speaker starts: close current message.
                    messages.Add(current);
                    current = default;
                }
                else if (!string.IsNullOrEmpty(speech))
                {
                    // Continuation line: append with newline.
                    current.AddContent("\n" + speech, 0);
                }
            }

            if (current is null)
            {
                string? normalizedSpeaker = null;
                if (speakerRaw is not null)
                {
                    normalizedSpeaker = PrepareSpeakerName(speakerRaw);
                    participants.Add(normalizedSpeaker);
                }

                current = messageFactory(normalizedSpeaker, speech);
            }
        }

        if (current is not null)
        {
            messages.Add(current);
        }

        return (messages, participants);
    }

    /// <summary>
    /// Splits transcript text into trimmed lines. Removes empty lines by default.
    /// </summary>
    public static IList<string> GetTranscriptLines(string transcriptText, bool removeEmpty = true)
    {
        ArgumentVerify.ThrowIfNullOrEmpty(transcriptText, nameof(transcriptText));

        return transcriptText.SplitLines(StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries);
    }

    /// <summary>
    /// Normalizes a speaker name: trims, removes trailing colon, lowercases.
    /// </summary>
    public static string PrepareSpeakerName(string speaker)
    {
        if (speaker is null)
        {
            return string.Empty;
        }

        speaker = speaker.Trim();
        if (speaker.EndsWith(':'))
        {
            speaker = speaker[0..^1];
        }

        speaker = speaker.ToLower();
        return speaker;
    }
}
