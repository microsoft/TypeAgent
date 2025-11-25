// Copyright (c) Microsoft. All rights reserved.

namespace Microsoft.TypeChat.Tests;

public class TestVocab : TypeChatTest
{
    [Fact]
    public void TestVocabAttribute()
    {
        JsonVocabAttribute attribute = new JsonVocabAttribute
        {
            Entries = "One | Two | Three",
            Name = "Test"
        };
        Vocab? vocab = attribute.ToVocab();
        Assert.NotNull(vocab);
        Assert.Equal(3, vocab.Count);

        NamedVocab? type = attribute.ToVocabType();
        Assert.NotNull(type);
        Assert.Equal(type.Name, attribute.Name);
        VocabEquals(vocab, type.Vocab);
    }

    //[Fact]
    //public void ExportHardcoded()
    //{
    //    JsonVocabAttribute? vattr = typeof(HardcodedVocabObj).GetProperties()[0].JsonVocabAttribute();
    //    Assert.NotNull(vattr);
    //    Vocab? vocab = vattr.ToVocab();

    //    using StringWriter writer = new StringWriter();
    //    TypescriptExporter exporter = new TypescriptExporter(writer);
    //    exporter.Export(typeof(HardcodedVocabObj));
    //    Assert.NotNull(exporter.UsedVocabs);
    //    Assert.True(exporter.UsedVocabs.Count == 1);
    //    IVocab localVocab = exporter.UsedVocabs.Get(HardcodedVocabObj.VocabName).Vocab;
    //    VocabEquals(vocab, localVocab);
    //}

    [Fact]
    public void ExportVocabDirect()
    {
        string vocabName = "Foo";
        using StringWriter sw = new StringWriter();
        VocabCollection store = new VocabCollection
        {
            {vocabName, new Vocab("One", "Two", "Three") }
        };
        NamedVocab? type = store.Get(vocabName);
        Assert.NotNull(type);

        var exporter = new TypescriptVocabExporter(new TypescriptWriter(sw), store);
        exporter.Export(type);
        string text = sw.ToString();
        Assert.NotEmpty(text);

        // TODO: better checks for correctness
        Assert.EndsWith(";", text.Trim());
        ValidateVocab(text, type.Vocab);
    }

    //[Fact]
    //public void ExportVocabInline()
    //{
    //    var milks = TestVocabs.Milks();
    //    VocabCollection vocabs = new VocabCollection { milks };
    //    var schema = TypescriptExporter.GenerateSchema(typeof(Milk), vocabs);
    //    ValidateBasic(typeof(Milk), schema);
    //    ValidateVocabInline(schema, milks);
    //}

    //[Fact]
    //public void ExportVocab()
    //{
    //    var dessertVocab = TestVocabs.Desserts();
    //    var fruitsVocab = TestVocabs.Fruits();

    //    VocabCollection vocabs = new VocabCollection { dessertVocab, fruitsVocab };
    //    var schema = TypescriptExporter.GenerateSchema(typeof(DessertOrder), vocabs);
    //    ValidateBasic(typeof(DessertOrder), schema);
    //    ValidateVocab(schema, dessertVocab);

    //    schema = TypescriptExporter.GenerateSchema(typeof(Order), vocabs);
    //    ValidateBasic(typeof(Order), schema);
    //    ValidateVocab(schema, dessertVocab);
    //    ValidateVocab(schema, fruitsVocab);
    //}

    [Fact]
    public async Task TestVocabFileAsync()
    {
        VocabCollection vocabs = await VocabFile.LoadAsync("TestVocabs.json");
        Assert.True(vocabs.Contains("Desserts"));
        Assert.True(vocabs.Contains("Fruits"));

        var fruitType = vocabs.Get("Fruits");
        Assert.NotNull(fruitType);
        Assert.Contains("Banana", fruitType.Vocab);
        Assert.Contains("Pear", fruitType.Vocab);
    }

    //[Fact]
    //public void JsonVocab()
    //{
    //    var obj = new ConverterTestObj();
    //    obj.Milk = "Cream";

    //    string json = Json.Stringify(obj);
    //    Assert.Throws<SchemaException>(() => Json.Parse<ConverterTestObj>(json));

    //    obj.Milk = "Whole";
    //    json = Json.Stringify(obj);
    //    var obj2 = Json.Parse<ConverterTestObj>(json);
    //    Assert.Equal(obj.Milk, obj2.Milk);

    //    obj.Milk = "Almond";
    //    json = Json.Stringify(obj);
    //    obj2 = Json.Parse<ConverterTestObj>(json);
    //}

    private void ValidateVocab(TypeSchema schema, NamedVocab vocab)
    {
        ValidateVocab(schema.Schema.Text, vocab.Vocab);
    }

    private void ValidateVocabInline(TypeSchema schema, NamedVocab vocab)
    {
        // Type should not be emitted. Kludgy test
        Assert.DoesNotContain(vocab.Name, schema.Schema.Text);
        ValidateVocab(schema.Schema.Text, vocab.Vocab);
    }

    private void ValidateVocab(string text, NamedVocab vocabType) => ValidateVocab(text, vocabType.Vocab);

    private void ValidateVocab(string text, IVocab vocab)
    {
        // Kludgy for now
        foreach (var entry in vocab)
        {
            Assert.Contains($"'{entry}'", text);
        }
    }

    // Workaround for Xunit issues
    private void VocabEquals(IVocab left, IVocab right)
    {
        var l = left.ToArray();
        var r = right.ToArray();
        Assert.Equal(l.Length, r.Length);
        for (int i = 0; i < l.Length; ++i)
        {
            Assert.Equal(l[i], r[i]);
            //Assert.True(l[i].Equals(r[i]));
        }
    }

}
