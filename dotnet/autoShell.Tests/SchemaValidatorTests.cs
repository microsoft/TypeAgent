// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Text.Json;
using autoShell.Logging;
using Moq;

namespace autoShell.Tests;

public class SchemaValidatorTests
{
    private readonly Mock<ILogger> _loggerMock = new();
    private readonly SchemaValidator _validator;

    public SchemaValidatorTests()
    {
        _validator = new SchemaValidator(_loggerMock.Object);
    }

    /// <summary>
    /// Verifies that action names are correctly extracted from object types
    /// that have an <c>actionName</c> field with a <c>typeEnum</c> array.
    /// </summary>
    [Fact]
    public void ExtractActionNames_SimpleSchema_ReturnsActionNames()
    {
        var json = """
        {
            "version": 1,
            "entry": { "action": "TestActions" },
            "types": {
                "TestActions": {
                    "alias": true,
                    "type": { "type": "type-union", "types": [] }
                },
                "VolumeAction": {
                    "alias": true,
                    "type": {
                        "type": "object",
                        "fields": {
                            "actionName": {
                                "type": { "type": "string-union", "typeEnum": ["Volume"] }
                            },
                            "parameters": {
                                "type": { "type": "object", "fields": {} }
                            }
                        }
                    }
                },
                "MuteAction": {
                    "alias": true,
                    "type": {
                        "type": "object",
                        "fields": {
                            "actionName": {
                                "type": { "type": "string-union", "typeEnum": ["Mute"] }
                            }
                        }
                    }
                }
            }
        }
        """;

        var names = SchemaValidator.ExtractActionNames(json);

        Assert.Equal(2, names.Count);
        Assert.Contains("Volume", names);
        Assert.Contains("Mute", names);
    }

    /// <summary>
    /// Verifies that <c>type-union</c> types (e.g., the top-level <c>DesktopActions</c> union)
    /// are skipped since they don't define actions themselves.
    /// </summary>
    [Fact]
    public void ExtractActionNames_SkipsUnionTypes()
    {
        var json = """
        {
            "version": 1,
            "types": {
                "DesktopActions": {
                    "alias": true,
                    "type": {
                        "type": "type-union",
                        "types": [{ "type": "type-reference", "name": "VolumeAction" }]
                    }
                }
            }
        }
        """;

        var names = SchemaValidator.ExtractActionNames(json);

        Assert.Empty(names);
    }

    /// <summary>
    /// Verifies that <c>string-union</c> types without an <c>actionName</c> field
    /// (e.g., <c>KnownPrograms</c>) are skipped.
    /// </summary>
    [Fact]
    public void ExtractActionNames_SkipsTypesWithoutActionName()
    {
        var json = """
        {
            "version": 1,
            "types": {
                "KnownPrograms": {
                    "alias": true,
                    "type": {
                        "type": "string-union",
                        "typeEnum": ["chrome", "edge", "notepad"]
                    }
                }
            }
        }
        """;

        var names = SchemaValidator.ExtractActionNames(json);

        Assert.Empty(names);
    }

    /// <summary>
    /// Verifies that a schema with an empty <c>types</c> dictionary returns no action names.
    /// </summary>
    [Fact]
    public void ExtractActionNames_EmptyTypes_ReturnsEmpty()
    {
        var json = """{ "version": 1, "types": {} }""";

        var names = SchemaValidator.ExtractActionNames(json);

        Assert.Empty(names);
    }

    /// <summary>
    /// Verifies that a schema missing the <c>types</c> property entirely returns no action names.
    /// </summary>
    [Fact]
    public void ExtractActionNames_MissingTypes_ReturnsEmpty()
    {
        var json = """{ "version": 1 }""";

        var names = SchemaValidator.ExtractActionNames(json);

        Assert.Empty(names);
    }

    /// <summary>
    /// Verifies that invalid JSON input throws a <see cref="JsonException"/>.
    /// </summary>
    [Fact]
    public void ExtractActionNames_MalformedJson_Throws()
    {
        Assert.ThrowsAny<JsonException>(() => SchemaValidator.ExtractActionNames("not json"));
    }

    /// <summary>
    /// Verifies that a nonexistent directory returns an empty set and logs an info message.
    /// </summary>
    [Fact]
    public void LoadActionNames_MissingDirectory_ReturnsEmpty()
    {
        var names = _validator.LoadActionNames(@"C:\nonexistent\path\that\does\not\exist");

        Assert.Empty(names);
        _loggerMock.Verify(l => l.Info(It.Is<string>(s => s.Contains("not found"))), Times.Once);
    }

    /// <summary>
    /// Verifies that an existing directory with no <c>.pas.json</c> files returns
    /// an empty set and logs an info message.
    /// </summary>
    [Fact]
    public void LoadActionNames_EmptyDirectory_ReturnsEmpty()
    {
        var tempDir = Path.Combine(Path.GetTempPath(), $"schema_test_{Guid.NewGuid():N}");
        Directory.CreateDirectory(tempDir);
        try
        {
            var names = _validator.LoadActionNames(tempDir);

            Assert.Empty(names);
            _loggerMock.Verify(l => l.Info(It.Is<string>(s => s.Contains("No .pas.json"))), Times.Once);
        }
        finally
        {
            Directory.Delete(tempDir, true);
        }
    }

    /// <summary>
    /// Verifies that action names from multiple <c>.pas.json</c> files are merged
    /// into a single result set.
    /// </summary>
    [Fact]
    public void LoadActionNames_ValidFiles_AggregatesAcrossFiles()
    {
        var tempDir = Path.Combine(Path.GetTempPath(), $"schema_test_{Guid.NewGuid():N}");
        Directory.CreateDirectory(tempDir);
        try
        {
            File.WriteAllText(Path.Combine(tempDir, "a.pas.json"), """
            {
                "version": 1,
                "types": {
                    "VolumeAction": {
                        "alias": true,
                        "type": {
                            "type": "object",
                            "fields": {
                                "actionName": { "type": { "type": "string-union", "typeEnum": ["Volume"] } }
                            }
                        }
                    }
                }
            }
            """);

            File.WriteAllText(Path.Combine(tempDir, "b.pas.json"), """
            {
                "version": 1,
                "types": {
                    "MuteAction": {
                        "alias": true,
                        "type": {
                            "type": "object",
                            "fields": {
                                "actionName": { "type": { "type": "string-union", "typeEnum": ["Mute"] } }
                            }
                        }
                    }
                }
            }
            """);

            var names = _validator.LoadActionNames(tempDir);

            Assert.Equal(2, names.Count);
            Assert.Contains("Volume", names);
            Assert.Contains("Mute", names);
        }
        finally
        {
            Directory.Delete(tempDir, true);
        }
    }

    /// <summary>
    /// Verifies that a malformed file logs a warning but does not prevent
    /// valid files in the same directory from being processed.
    /// </summary>
    [Fact]
    public void LoadActionNames_MalformedFile_LogsWarningAndContinues()
    {
        var tempDir = Path.Combine(Path.GetTempPath(), $"schema_test_{Guid.NewGuid():N}");
        Directory.CreateDirectory(tempDir);
        try
        {
            File.WriteAllText(Path.Combine(tempDir, "bad.pas.json"), "not json");
            File.WriteAllText(Path.Combine(tempDir, "good.pas.json"), """
            {
                "version": 1,
                "types": {
                    "VolumeAction": {
                        "alias": true,
                        "type": {
                            "type": "object",
                            "fields": {
                                "actionName": { "type": { "type": "string-union", "typeEnum": ["Volume"] } }
                            }
                        }
                    }
                }
            }
            """);

            var names = _validator.LoadActionNames(tempDir);

            Assert.Single(names);
            Assert.Contains("Volume", names);
            _loggerMock.Verify(l => l.Warning(It.Is<string>(s => s.Contains("Failed to parse"))), Times.Once);
        }
        finally
        {
            Directory.Delete(tempDir, true);
        }
    }

    /// <summary>
    /// Verifies that no warnings are logged when every schema action has a handler
    /// and every handler has a schema entry.
    /// </summary>
    [Fact]
    public void ValidateWiring_AllMatch_NoWarnings()
    {
        var schema = new HashSet<string> { "Volume", "Mute" };
        var handlers = new[] { "Volume", "Mute" };

        _validator.ValidateWiring(schema, handlers);

        _loggerMock.Verify(l => l.Warning(It.IsAny<string>()), Times.Never);
    }

    /// <summary>
    /// Verifies that a schema action with no corresponding handler triggers a warning.
    /// </summary>
    [Fact]
    public void ValidateWiring_SchemaWithoutHandler_WarnsForMissing()
    {
        var schema = new HashSet<string> { "Volume", "Mute", "NewAction" };
        var handlers = new[] { "Volume", "Mute" };

        _validator.ValidateWiring(schema, handlers);

        _loggerMock.Verify(l => l.Warning(It.Is<string>(s => s.Contains("NewAction") && s.Contains("no registered"))), Times.Once);
    }

    /// <summary>
    /// Verifies that a handler command with no matching schema definition triggers a warning.
    /// </summary>
    [Fact]
    public void ValidateWiring_HandlerWithoutSchema_WarnsForMissing()
    {
        var schema = new HashSet<string> { "Volume" };
        var handlers = new[] { "Volume", "ListAppNames" };

        _validator.ValidateWiring(schema, handlers);

        _loggerMock.Verify(l => l.Warning(It.Is<string>(s => s.Contains("ListAppNames") && s.Contains("no matching schema"))), Times.Once);
    }

    /// <summary>
    /// Verifies that matching is case-insensitive (e.g., "volume" in schema matches "Volume" in handler).
    /// </summary>
    [Fact]
    public void ValidateWiring_CaseInsensitive_NoWarnings()
    {
        var schema = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "volume" };
        var handlers = new[] { "Volume" };

        _validator.ValidateWiring(schema, handlers);

        _loggerMock.Verify(l => l.Warning(It.IsAny<string>()), Times.Never);
    }
}
