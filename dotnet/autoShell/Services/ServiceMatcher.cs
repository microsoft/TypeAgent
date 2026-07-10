// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
using System.Linq;

namespace autoShell.Services;

/// <summary>
/// The quality of a service match: an exact name/display-name equality, a fuzzy
/// (approximate) match that should be confirmed with the user, or no match.
/// </summary>
internal enum ServiceMatchKind
{
    None,
    Exact,
    Fuzzy,
}

/// <summary>
/// Minimal, platform-independent description of a Windows service used for matching.
/// </summary>
internal readonly record struct ServiceInfo(string ServiceName, string DisplayName, string Description);

/// <summary>
/// The result of resolving a query against the installed services.
/// </summary>
internal readonly record struct ServiceMatch(ServiceMatchKind Kind, string ServiceName, string DisplayName)
{
    /// <summary>A sentinel representing "no match".</summary>
    public static ServiceMatch None { get; } = new(ServiceMatchKind.None, null, null);
}

/// <summary>
/// Resolves a free-text query to an installed Windows service, distinguishing exact
/// matches from fuzzy (approximate) ones. Pure logic with no OS dependencies so it can
/// be unit-tested directly.
/// </summary>
internal static class ServiceMatcher
{
    /// <summary>Minimum similarity for a name/display-name fuzzy match to be offered.</summary>
    private const double NameThreshold = 0.5;

    /// <summary>Minimum coverage for a description fuzzy match to be offered.</summary>
    private const double DescriptionThreshold = 0.5;

    private static readonly char[] TokenSeparators =
        { ' ', '\t', '\r', '\n', '-', '_', '.', ',', ';', ':', '(', ')', '/', '\\', '"', '\'' };

    /// <summary>
    /// Finds the best match for <paramref name="query"/> among <paramref name="services"/>.
    /// An exact (case/whitespace-insensitive) match on the service name or display name is
    /// preferred; otherwise the highest-scoring candidate above the fuzzy threshold is returned.
    /// </summary>
    /// <param name="services">The candidate services.</param>
    /// <param name="query">The user-provided service name, display name, or description phrase.</param>
    /// <param name="byDescription">When <c>true</c>, scores candidates by their description text.</param>
    public static ServiceMatch Match(IReadOnlyList<ServiceInfo> services, string query, bool byDescription)
    {
        if (services == null || services.Count == 0)
        {
            return ServiceMatch.None;
        }

        string normQuery = Normalize(query);
        if (normQuery.Length == 0)
        {
            return ServiceMatch.None;
        }

        // 1. Exact match on service name or display name always wins and needs no confirmation.
        foreach (var s in services)
        {
            if (Normalize(s.ServiceName) == normQuery || Normalize(s.DisplayName) == normQuery)
            {
                return new ServiceMatch(ServiceMatchKind.Exact, s.ServiceName, DisplayOf(s));
            }
        }

        // 2. Otherwise pick the single highest-scoring candidate above the threshold.
        ServiceInfo best = default;
        double bestScore = 0.0;
        bool found = false;

        foreach (var s in services)
        {
            double score = byDescription ? ScoreByDescription(normQuery, s) : ScoreByName(normQuery, s);
            if (score > bestScore)
            {
                bestScore = score;
                best = s;
                found = true;
            }
        }

        double threshold = byDescription ? DescriptionThreshold : NameThreshold;
        return found && bestScore >= threshold
            ? new ServiceMatch(ServiceMatchKind.Fuzzy, best.ServiceName, DisplayOf(best))
            : ServiceMatch.None;
    }

    private static string DisplayOf(ServiceInfo s) =>
        string.IsNullOrWhiteSpace(s.DisplayName) ? s.ServiceName : s.DisplayName;

    private static double ScoreByName(string normQuery, ServiceInfo s) =>
        Math.Max(
            SimilarityScore(normQuery, Normalize(s.DisplayName)),
            SimilarityScore(normQuery, Normalize(s.ServiceName)));

    private static double ScoreByDescription(string normQuery, ServiceInfo s)
    {
        // A name/display hit still counts when searching by description; otherwise fall
        // back to how much of the query phrase is covered by the description text.
        double nameScore = ScoreByName(normQuery, s);
        double descScore = DescriptionCoverage(normQuery, Normalize(s.Description));
        return Math.Max(nameScore, descScore);
    }

    /// <summary>
    /// General-purpose 0..1 similarity for short strings, combining substring containment,
    /// token (Jaccard) overlap, and an edit-distance ratio.
    /// </summary>
    private static double SimilarityScore(string query, string target)
    {
        if (query.Length == 0 || target.Length == 0)
        {
            return 0.0;
        }
        if (query == target)
        {
            return 1.0;
        }

        double score = LevenshteinRatio(query, target);

        if (target.Contains(query) || query.Contains(target))
        {
            int shorter = Math.Min(query.Length, target.Length);
            int longer = Math.Max(query.Length, target.Length);
            double containment = 0.7 + (0.3 * ((double)shorter / longer));
            score = Math.Max(score, containment);
        }

        return Math.Max(score, TokenOverlap(query, target));
    }

    /// <summary>
    /// Fraction of the query phrase covered by a (typically longer) description: a full
    /// substring hit scores highest, otherwise the ratio of query tokens present.
    /// </summary>
    private static double DescriptionCoverage(string query, string description)
    {
        if (query.Length == 0 || description.Length == 0)
        {
            return 0.0;
        }
        if (description.Contains(query))
        {
            return 0.9;
        }

        var queryTokens = Tokenize(query);
        if (queryTokens.Count == 0)
        {
            return 0.0;
        }

        var descTokens = new HashSet<string>(Tokenize(description));
        int matched = queryTokens.Count(t => descTokens.Contains(t));
        return (double)matched / queryTokens.Count;
    }

    private static double TokenOverlap(string a, string b)
    {
        var setA = new HashSet<string>(Tokenize(a));
        var setB = new HashSet<string>(Tokenize(b));
        if (setA.Count == 0 || setB.Count == 0)
        {
            return 0.0;
        }

        int intersection = setA.Count(t => setB.Contains(t));
        int union = setA.Count + setB.Count - intersection;
        return union == 0 ? 0.0 : (double)intersection / union;
    }

    private static List<string> Tokenize(string s) =>
        s.Split(TokenSeparators, StringSplitOptions.RemoveEmptyEntries).ToList();

    private static double LevenshteinRatio(string a, string b)
    {
        int max = Math.Max(a.Length, b.Length);
        return max == 0 ? 0.0 : 1.0 - ((double)Levenshtein(a, b) / max);
    }

    private static int Levenshtein(string a, string b)
    {
        int n = a.Length;
        int m = b.Length;
        if (n == 0)
        {
            return m;
        }
        if (m == 0)
        {
            return n;
        }

        var prev = new int[m + 1];
        var curr = new int[m + 1];
        for (int j = 0; j <= m; j++)
        {
            prev[j] = j;
        }

        for (int i = 1; i <= n; i++)
        {
            curr[0] = i;
            for (int j = 1; j <= m; j++)
            {
                int cost = a[i - 1] == b[j - 1] ? 0 : 1;
                curr[j] = Math.Min(Math.Min(curr[j - 1] + 1, prev[j] + 1), prev[j - 1] + cost);
            }

            (prev, curr) = (curr, prev);
        }

        return prev[m];
    }

    /// <summary>Lower-cases, trims, and collapses internal whitespace.</summary>
    private static string Normalize(string s)
    {
        if (string.IsNullOrWhiteSpace(s))
        {
            return string.Empty;
        }

        var parts = s.Trim().ToLowerInvariant().Split((char[])null, StringSplitOptions.RemoveEmptyEntries);
        return string.Join(" ", parts);
    }
}
