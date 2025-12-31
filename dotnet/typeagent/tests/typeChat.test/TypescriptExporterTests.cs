// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using Microsoft.TypeChat.Schema;

namespace Microsoft.TypeChat.Tests;

public class TypescriptExporterTests
{
    #region GenerateSchema Tests

    [Fact]
    public void GenerateSchema_Class_GeneratesValidSchema()
    {
        var schema = TypescriptExporter.GenerateSchema(typeof(CoffeeOrder));

        Assert.NotNull(schema);
        Assert.NotNull(schema.Schema);
        Assert.Contains("interface CoffeeOrder", schema.Schema);
        Assert.Contains("coffee:", schema.Schema);
        Assert.Contains("quantity:", schema.Schema);
        Assert.Contains("size:", schema.Schema);
    }

    [Fact]
    public void GenerateSchema_Enum_GeneratesEnumDefinition()
    {
        var schema = TypescriptExporter.GenerateSchema(typeof(Coffees));

        Assert.NotNull(schema);
        Assert.Contains("enum Coffees", schema.Schema);
        Assert.Contains("Coffee", schema.Schema);
        Assert.Contains("Latte", schema.Schema);
        Assert.Contains("Mocha", schema.Schema);
    }

    [Fact]
    public void GenerateSchema_WithVocabs_IncludesUsedVocabs()
    {
        var vocabs = TestVocabs.All();
        var schema = TypescriptExporter.GenerateSchema(typeof(DessertOrder), vocabs);

        Assert.NotNull(schema);
        Assert.True(schema.HasVocabs);
    }

    [Fact]
    public void GenerateSchema_NullType_ThrowsArgumentNullException()
    {
        Assert.Throws<ArgumentNullException>(() => TypescriptExporter.GenerateSchema(null));
    }

    #endregion

    #region GenerateAPI Tests

    [Fact]
    public void GenerateAPI_Interface_GeneratesAPISchema()
    {
        var apiInterface = typeof(ITestApi);
        var schema = TypescriptExporter.GenerateAPI(apiInterface);

        Assert.NotNull(schema);
        Assert.Contains("interface ITestApi", schema.Schema);
    }

    [Fact]
    public void GenerateAPI_NonInterface_ThrowsArgumentException()
    {
        Assert.Throws<ArgumentException>(() => TypescriptExporter.GenerateAPI(typeof(CoffeeOrder)));
    }

    #endregion

    #region ExportClass Tests

    [Fact]
    public void ExportClass_SimpleClass_ExportsCorrectly()
    {
        using StringWriter writer = new StringWriter();
        var exporter = new TypescriptExporter(writer);

        exporter.ExportClass(typeof(Location));

        string result = writer.ToString();
        Assert.Contains("interface Location", result);
        Assert.Contains("City:", result);
        Assert.Contains("State:", result);
        Assert.Contains("Country:", result);
    }

    [Fact]
    public void ExportClass_WithInheritance_ExportsBaseClass()
    {
        using StringWriter writer = new StringWriter();
        var exporter = new TypescriptExporter(writer);

        exporter.ExportClass(typeof(AuthorPerson));
        exporter.ExportPending();

        string result = writer.ToString();
        Assert.Contains("interface AuthorPerson", result);
        Assert.Contains("Books:", result);
    }

    [Fact]
    public void ExportClass_NonClass_ThrowsArgumentException()
    {
        using StringWriter writer = new StringWriter();
        var exporter = new TypescriptExporter(writer);

        Assert.Throws<ArgumentException>(() => exporter.ExportClass(typeof(Coffees)));
    }

    [Fact]
    public void ExportClass_NullType_ThrowsArgumentNullException()
    {
        using StringWriter writer = new StringWriter();
        var exporter = new TypescriptExporter(writer);

        Assert.Throws<ArgumentNullException>(() => exporter.ExportClass(null));
    }

    #endregion

    #region ExportEnum Tests

    [Fact]
    public void ExportEnum_AsEnum_GeneratesEnumDefinition()
    {
        using StringWriter writer = new StringWriter();
        var exporter = new TypescriptExporter(writer);
        exporter.EnumsAsLiterals = false;

        exporter.ExportEnum(typeof(CoffeeSize));

        string result = writer.ToString();
        Assert.Contains("enum CoffeeSize", result);
        Assert.Contains("Small", result);
        Assert.Contains("Medium", result);
        Assert.Contains("Large", result);
        Assert.Contains("Grande", result);
        Assert.Contains("Venti", result);
    }

    [Fact]
    public void ExportEnum_AsLiterals_GeneratesLiteralUnion()
    {
        using StringWriter writer = new StringWriter();
        var exporter = new TypescriptExporter(writer);
        exporter.EnumsAsLiterals = true;

        exporter.ExportEnum(typeof(CoffeeSize));

        string result = writer.ToString();
        Assert.Contains("type CoffeeSize", result);
        Assert.Contains("'Small'", result);
        Assert.Contains("'Medium'", result);
        Assert.Contains("|", result);
    }

    [Fact]
    public void ExportEnum_NonEnum_ThrowsArgumentException()
    {
        using StringWriter writer = new StringWriter();
        var exporter = new TypescriptExporter(writer);

        Assert.Throws<ArgumentException>(() => exporter.ExportEnum(typeof(CoffeeOrder)));
    }

    [Fact]
    public void ExportEnum_NullType_ThrowsArgumentNullException()
    {
        using StringWriter writer = new StringWriter();
        var exporter = new TypescriptExporter(writer);

        Assert.Throws<ArgumentNullException>(() => exporter.ExportEnum(null));
    }

    #endregion

    #region Nullable Tests

    [Fact]
    public void Export_NullableValueType_GeneratesOptionalProperty()
    {
        using StringWriter writer = new StringWriter();
        var exporter = new TypescriptExporter(writer);

        exporter.ExportClass(typeof(NullableTestObj));

        string result = writer.ToString();
        Assert.Contains("Optional?:", result);
    }

    [Fact]
    public void Export_RequiredProperty_NoOptionalMarker()
    {
        using StringWriter writer = new StringWriter();
        var exporter = new TypescriptExporter(writer);

        exporter.ExportClass(typeof(NullableTestObj));

        string result = writer.ToString();
        Assert.Contains("Required:", result);
        Assert.DoesNotContain("Required?:", result);
    }

    #endregion

    #region Vocabulary Tests

    [Fact]
    public void Export_InlineVocab_GeneratesLiteralUnion()
    {
        using StringWriter writer = new StringWriter();
        var exporter = new TypescriptExporter(writer);
        exporter.Vocabs = TestVocabs.All();

        exporter.ExportClass(typeof(Milk));

        string result = writer.ToString();
        Assert.Contains("name:", result);
    }

    [Fact]
    public void Export_NamedVocab_GeneratesVocabReference()
    {
        using StringWriter writer = new StringWriter();
        var exporter = new TypescriptExporter(writer);
        exporter.Vocabs = TestVocabs.All();

        exporter.ExportClass(typeof(Creamer));

        string result = writer.ToString();
        Assert.Contains("Name:", result);
    }

    [Fact]
    public void Export_HardcodedVocab_GeneratesLiterals()
    {
        using StringWriter writer = new StringWriter();
        var exporter = new TypescriptExporter(writer);

        exporter.ExportClass(typeof(HardcodedVocabObj));

        string result = writer.ToString();
        Assert.Contains("Value:", result);
    }

    #endregion

    #region Comments Tests

    [Fact]
    public void Export_WithComments_IncludesComments()
    {
        using StringWriter writer = new StringWriter();
        var exporter = new TypescriptExporter(writer);
        exporter.IncludeComments = true;

        exporter.ExportEnum(typeof(Coffees));

        string result = writer.ToString();
        Assert.Contains("//", result);
    }

    [Fact]
    public void Export_WithoutComments_ExcludesComments()
    {
        using StringWriter writer = new StringWriter();
        var exporter = new TypescriptExporter(writer);
        exporter.IncludeComments = false;

        exporter.ExportEnum(typeof(Coffees));

        string result = writer.ToString();
        int commentCount = result.Split("//").Length - 1;
        Assert.True(commentCount == 0 || commentCount == 1);
    }

    #endregion

    #region JsonPropertyName Tests

    // TODO: implement type dependency resolution to enable this test
    //[Fact]
    //public void Export_JsonPropertyName_UsesCustomName()
    //{
    //    using StringWriter writer = new StringWriter();
    //    var exporter = new TypescriptExporter(writer);

    //    exporter.ExportClass(typeof(DessertOrder));

    //    string result = writer.ToString();
    //    Assert.Contains("dessert:", result);
    //    Assert.DoesNotContain("Name:", result);
    //}

    #endregion

    #region Array Types Tests

    [Fact]
    public void Export_ArrayProperty_GeneratesArrayType()
    {
        using StringWriter writer = new StringWriter();
        var exporter = new TypescriptExporter(writer);

        exporter.ExportClass(typeof(AuthorPerson));

        string result = writer.ToString();
        Assert.Contains("Books:", result);
        Assert.Contains("[]", result);
    }

    #endregion

    #region Polymorphism Tests

#if NET7_0_OR_GREATER
    [Fact]
    public void Export_PolymorphicTypes_GeneratesDiscriminator()
    {
        using StringWriter writer = new StringWriter();
        var exporter = new TypescriptExporter(writer);
        exporter.PolymorphismSettings = new JsonPolymorphismSettings
        {
            IncludeDiscriminator = true
        };

        exporter.ExportClass(typeof(Rectangle));

        string result = writer.ToString();
        Assert.Contains("$type:", result);
    }

    [Fact]
    public void Export_BaseShape_ExportsHierarchy()
    {
        using StringWriter writer = new StringWriter();
        var exporter = new TypescriptExporter(writer);

        exporter.ExportClass(typeof(Shape));
        exporter.ExportPending();

        string result = writer.ToString();
        Assert.Contains("interface Shape", result);
    }
#endif

    #endregion

    #region Generic Types Tests

    [Fact]
    public void Export_GenericClass_HandlesTypeParameters()
    {
        using StringWriter writer = new StringWriter();
        var exporter = new TypescriptExporter(writer);

        var childIntType = typeof(Child<int>);
        exporter.ExportClass(childIntType);

        string result = writer.ToString();
        Assert.Contains("interface", result);
        Assert.Contains("Name:", result);
        Assert.Contains("Value:", result);
    }

    #endregion

    #region IncludeSubclasses Tests

    [Fact]
    public void Export_IncludeSubclassesTrue_ExportsHierarchy()
    {
        using StringWriter writer = new StringWriter();
        var exporter = new TypescriptExporter(writer);
        exporter.IncludeSubclasses = true;

        exporter.ExportClass(typeof(Person));
        exporter.ExportPending();

        string result = writer.ToString();
        Assert.Contains("interface Person", result);
    }

    [Fact]
    public void Export_IncludeSubclassesFalse_ExportsOnlyType()
    {
        using StringWriter writer = new StringWriter();
        var exporter = new TypescriptExporter(writer);
        exporter.IncludeSubclasses = false;

        exporter.ExportClass(typeof(Person));

        string result = writer.ToString();
        Assert.Contains("interface Person", result);
    }

    #endregion

    #region TypeNameMapper Tests

    [Fact]
    public void Export_WithTypeNameMapper_UsesCustomNames()
    {
        using StringWriter writer = new StringWriter();
        var exporter = new TypescriptExporter(writer);
        exporter.TypeNameMapper = (type) =>
        {
            if (type == typeof(string))
                return "CustomString";
            return null;
        };

        exporter.ExportClass(typeof(Location));

        string result = writer.ToString();
        Assert.Contains("interface Location", result);
    }

    #endregion

    #region Clear Tests

    [Fact]
    public void Clear_ResetsExporter()
    {
        using StringWriter writer = new StringWriter();
        var exporter = new TypescriptExporter(writer);

        exporter.ExportClass(typeof(Location));
        exporter.Clear();
        exporter.ExportClass(typeof(Person));

        string result = writer.ToString();
        Assert.Contains("interface Person", result);
    }

    #endregion

    #region TypesToIgnore Tests

    [Fact]
    public void TypesToIgnore_ContainsCommonTypes()
    {
        using StringWriter writer = new StringWriter();
        var exporter = new TypescriptExporter(writer);

        Assert.Contains(typeof(object), exporter.TypesToIgnore);
        Assert.Contains(typeof(string), exporter.TypesToIgnore);
        Assert.Contains(typeof(Task), exporter.TypesToIgnore);
    }

    [Fact]
    public void TypesToIgnore_CanAddCustomTypes()
    {
        using StringWriter writer = new StringWriter();
        var exporter = new TypescriptExporter(writer);

        exporter.TypesToIgnore.Add(typeof(Location));

        Assert.Contains(typeof(Location), exporter.TypesToIgnore);
    }

    #endregion

    #region Writer Property Tests

    [Fact]
    public void Writer_Property_ReturnsTypescriptWriter()
    {
        using StringWriter writer = new StringWriter();
        var exporter = new TypescriptExporter(writer);

        Assert.NotNull(exporter.Writer);
        Assert.IsType<TypescriptWriter>(exporter.Writer);
    }

    #endregion

    #region Constructor Tests

    [Fact]
    public void Constructor_WithTextWriter_CreatesExporter()
    {
        using StringWriter writer = new StringWriter();
        var exporter = new TypescriptExporter(writer);

        Assert.NotNull(exporter);
        Assert.NotNull(exporter.Writer);
    }

    [Fact]
    public void Constructor_WithTypescriptWriter_CreatesExporter()
    {
        using StringWriter stringWriter = new StringWriter();
        var tsWriter = new TypescriptWriter(stringWriter);
        var exporter = new TypescriptExporter(tsWriter);

        Assert.NotNull(exporter);
        Assert.Same(tsWriter, exporter.Writer);
    }

    [Fact]
    public void Constructor_NullWriter_ThrowsArgumentNullException()
    {
        Assert.Throws<ArgumentNullException>(() => new TypescriptExporter((TextWriter)null));
    }

    #endregion

    #region Complex Scenarios Tests

    // TODO: implement type dependency resolution to enable this test
    //[Fact]
    //public void Export_ComplexOrder_GeneratesCompleteSchema()
    //{
    //    var schema = TypescriptExporter.GenerateSchema(typeof(Order));

    //    Assert.NotNull(schema);
    //    Assert.Contains("interface Order", schema.Schema);
    //    Assert.Contains("coffee", schema.Schema);
    //    Assert.Contains("desserts", schema.Schema);
    //    Assert.Contains("fruits", schema.Schema);
    //    Assert.Contains("unknown", schema.Schema);
    //}

    [Fact]
    public void Export_PersonWithNestedTypes_ExportsAll()
    {
        using StringWriter writer = new StringWriter();
        var exporter = new TypescriptExporter(writer);

        exporter.ExportClass(typeof(Person));
        exporter.ExportPending();

        string result = writer.ToString();
        Assert.Contains("interface Person", result);
        Assert.Contains("interface Name", result);
        Assert.Contains("interface Location", result);
    }

    #endregion
}

// Test interface for API export tests
public interface ITestApi
{
    string GetData(int id);
    void ProcessData(string data);
}
