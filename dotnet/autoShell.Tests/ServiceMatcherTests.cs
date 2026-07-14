// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Collections.Generic;
using autoShell.Services;

namespace autoShell.Tests;

public class ServiceMatcherTests
{
    private static readonly List<ServiceInfo> Services = new()
    {
        new ServiceInfo(
            "Spooler",
            "Print Spooler",
            "This service spools print jobs and handles interaction with the printer."),
        new ServiceInfo(
            "wuauserv",
            "Windows Update",
            "Enables the detection, download, and installation of updates for Windows and other programs."),
        new ServiceInfo(
            "Audiosrv",
            "Windows Audio",
            "Manages audio for Windows-based programs."),
        new ServiceInfo(
            "Dnscache",
            "DNS Client",
            "The DNS Client service caches Domain Name System (DNS) names."),
    };

    /// <summary>
    /// Verifies that an empty query yields no match.
    /// </summary>
    [Fact]
    public void Match_EmptyQuery_ReturnsNone()
    {
        var match = ServiceMatcher.Match(Services, "", byDescription: false);

        Assert.Equal(ServiceMatchKind.None, match.Kind);
    }

    /// <summary>
    /// Verifies that an empty candidate list yields no match.
    /// </summary>
    [Fact]
    public void Match_NoServices_ReturnsNone()
    {
        var match = ServiceMatcher.Match(new List<ServiceInfo>(), "spooler", byDescription: false);

        Assert.Equal(ServiceMatchKind.None, match.Kind);
    }

    /// <summary>
    /// Verifies that a case-insensitive service-name equality is an exact match.
    /// </summary>
    [Fact]
    public void Match_ExactServiceName_CaseInsensitive_ReturnsExact()
    {
        var match = ServiceMatcher.Match(Services, "SPOOLER", byDescription: false);

        Assert.Equal(ServiceMatchKind.Exact, match.Kind);
        Assert.Equal("Spooler", match.ServiceName);
        Assert.Equal("Print Spooler", match.DisplayName);
    }

    /// <summary>
    /// Verifies that a display-name equality (ignoring whitespace/case) is an exact match.
    /// </summary>
    [Fact]
    public void Match_ExactDisplayName_ReturnsExact()
    {
        var match = ServiceMatcher.Match(Services, "  windows   update ", byDescription: false);

        Assert.Equal(ServiceMatchKind.Exact, match.Kind);
        Assert.Equal("wuauserv", match.ServiceName);
    }

    /// <summary>
    /// Verifies that a partial display-name query is offered as a fuzzy match.
    /// </summary>
    [Fact]
    public void Match_SubstringOfDisplayName_ReturnsFuzzy()
    {
        var match = ServiceMatcher.Match(Services, "print", byDescription: false);

        Assert.Equal(ServiceMatchKind.Fuzzy, match.Kind);
        Assert.Equal("Spooler", match.ServiceName);
        Assert.Equal("Print Spooler", match.DisplayName);
    }

    /// <summary>
    /// Verifies that a typo close to a display name is offered as a fuzzy match.
    /// </summary>
    [Fact]
    public void Match_Typo_ReturnsFuzzy()
    {
        var match = ServiceMatcher.Match(Services, "widnows update", byDescription: false);

        Assert.Equal(ServiceMatchKind.Fuzzy, match.Kind);
        Assert.Equal("wuauserv", match.ServiceName);
    }

    /// <summary>
    /// Verifies that an unrelated query yields no match.
    /// </summary>
    [Fact]
    public void Match_Unrelated_ReturnsNone()
    {
        var match = ServiceMatcher.Match(Services, "xyzzy nonexistent", byDescription: false);

        Assert.Equal(ServiceMatchKind.None, match.Kind);
    }

    /// <summary>
    /// Verifies that a phrase contained in a service's description is offered as a fuzzy match.
    /// </summary>
    [Fact]
    public void Match_ByDescription_PhraseContained_ReturnsFuzzy()
    {
        var match = ServiceMatcher.Match(Services, "spools print jobs", byDescription: true);

        Assert.Equal(ServiceMatchKind.Fuzzy, match.Kind);
        Assert.Equal("Spooler", match.ServiceName);
    }

    /// <summary>
    /// Verifies that overlapping description keywords produce a fuzzy match even when not contiguous.
    /// </summary>
    [Fact]
    public void Match_ByDescription_TokenCoverage_ReturnsFuzzy()
    {
        var match = ServiceMatcher.Match(
            Services,
            "detection download installation updates",
            byDescription: true);

        Assert.Equal(ServiceMatchKind.Fuzzy, match.Kind);
        Assert.Equal("wuauserv", match.ServiceName);
    }

    /// <summary>
    /// Verifies that a description query with no meaningful overlap yields no match.
    /// </summary>
    [Fact]
    public void Match_ByDescription_NoMatch_ReturnsNone()
    {
        var match = ServiceMatcher.Match(Services, "quantum flux capacitor", byDescription: true);

        Assert.Equal(ServiceMatchKind.None, match.Kind);
    }

    /// <summary>
    /// Verifies that an exact display-name match is still preferred in description mode.
    /// </summary>
    [Fact]
    public void Match_ByDescription_ExactDisplayName_ReturnsExact()
    {
        var match = ServiceMatcher.Match(Services, "DNS Client", byDescription: true);

        Assert.Equal(ServiceMatchKind.Exact, match.Kind);
        Assert.Equal("Dnscache", match.ServiceName);
    }

    /// <summary>
    /// Verifies that the service name is used as the display name when no display name is set.
    /// </summary>
    [Fact]
    public void Match_MissingDisplayName_FallsBackToServiceName()
    {
        var services = new List<ServiceInfo>
        {
            new("CustomSvc", "", "A custom background worker service."),
        };

        var match = ServiceMatcher.Match(services, "CustomSvc", byDescription: false);

        Assert.Equal(ServiceMatchKind.Exact, match.Kind);
        Assert.Equal("CustomSvc", match.DisplayName);
    }
}
