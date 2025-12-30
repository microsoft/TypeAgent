// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace Microsoft.TypeChat.Tests;

public class SchemaTests
{
    #region Enum Tests

    [Fact]
    public void Coffees_Enum_HasExpectedValues()
    {
        Assert.Equal(4, Enum.GetValues<Coffees>().Length);
        Assert.True(Enum.IsDefined(typeof(Coffees), Coffees.Coffee));
        Assert.True(Enum.IsDefined(typeof(Coffees), Coffees.Latte));
        Assert.True(Enum.IsDefined(typeof(Coffees), Coffees.Mocha));
        Assert.True(Enum.IsDefined(typeof(Coffees), Coffees.Unknown));
    }

    [Fact]
    public void CoffeeSize_Enum_HasExpectedValues()
    {
        Assert.Equal(5, Enum.GetValues<CoffeeSize>().Length);
        Assert.True(Enum.IsDefined(typeof(CoffeeSize), CoffeeSize.Small));
        Assert.True(Enum.IsDefined(typeof(CoffeeSize), CoffeeSize.Medium));
        Assert.True(Enum.IsDefined(typeof(CoffeeSize), CoffeeSize.Large));
        Assert.True(Enum.IsDefined(typeof(CoffeeSize), CoffeeSize.Grande));
        Assert.True(Enum.IsDefined(typeof(CoffeeSize), CoffeeSize.Venti));
    }

    #endregion

    #region CoffeeOrder Tests

    [Fact]
    public void CoffeeOrder_CanBeCreated()
    {
        var order = new CoffeeOrder
        {
            Coffee = Coffees.Latte,
            Quantity = 2,
            Size = CoffeeSize.Grande
        };

        Assert.Equal(Coffees.Latte, order.Coffee);
        Assert.Equal(2, order.Quantity);
        Assert.Equal(CoffeeSize.Grande, order.Size);
    }

    [Fact]
    public void CoffeeOrder_Serializes_WithCorrectPropertyNames()
    {
        var order = new CoffeeOrder
        {
            Coffee = Coffees.Mocha,
            Quantity = 1,
            Size = CoffeeSize.Large
        };

        var json = System.Text.Json.JsonSerializer.Serialize(order);
        Assert.Contains("\"coffee\"", json);
        Assert.Contains("\"quantity\"", json);
        Assert.Contains("\"size\"", json);
    }

    #endregion

    #region Creamer and Milk Tests

    [Fact]
    public void Creamer_HasNameProperty()
    {
        var creamer = new Creamer { Name = "half and half" };
        Assert.Equal("half and half", creamer.Name);
    }

    [Fact]
    public void Milk_SerializesWithCorrectPropertyName()
    {
        var milk = new Milk { Name = "whole milk" };
        var json = System.Text.Json.JsonSerializer.Serialize(milk);
        Assert.Contains("\"name\"", json);
    }

    #endregion

    #region DessertOrder Tests

    [Fact]
    public void DessertOrder_DefaultConstructor_SetsDefaultQuantity()
    {
        var dessert = new DessertOrder { Name = "Tiramisu" };
        Assert.Equal(1, dessert.Quantity);
    }

    [Fact]
    public void DessertOrder_ParameterizedConstructor_SetsValues()
    {
        var dessert = new DessertOrder("Chocolate Cake", 3);
        Assert.Equal("Chocolate Cake", dessert.Name);
        Assert.Equal(3, dessert.Quantity);
    }

    [Fact]
    public void DessertOrder_ImplicitConversion_FromString()
    {
        DessertOrder dessert = "Tiramisu";
        Assert.Equal("Tiramisu", dessert.Name);
        Assert.Equal(1, dessert.Quantity);
    }

    [Fact]
    public void DessertOrder_Serializes_WithCorrectPropertyNames()
    {
        var dessert = new DessertOrder("Coffee Cake", 2);
        var json = System.Text.Json.JsonSerializer.Serialize(dessert);
        Assert.Contains("\"dessert\"", json);
        Assert.Contains("\"quantity\"", json);
    }

    #endregion

    #region FruitOrder Tests

    [Fact]
    public void FruitOrder_CanBeCreated()
    {
        var fruit = new FruitOrder { Name = "Banana", Quantity = 5 };
        Assert.Equal("Banana", fruit.Name);
        Assert.Equal(5, fruit.Quantity);
    }

    [Fact]
    public void FruitOrder_Serializes_WithCorrectPropertyNames()
    {
        var fruit = new FruitOrder { Name = "Regular Apple", Quantity = 3 };
        var json = System.Text.Json.JsonSerializer.Serialize(fruit);
        Assert.Contains("\"fruit\"", json);
        Assert.Contains("\"quantity\"", json);
    }

    #endregion

    #region UnknownItem Tests

    [Fact]
    public void UnknownItem_StoresText()
    {
        var unknown = new UnknownItem { Text = "something unclear" };
        Assert.Equal("something unclear", unknown.Text);
    }

    #endregion

    #region Order Tests

    [Fact]
    public void Order_CanContainMultipleOrderTypes()
    {
        var order = new Order
        {
            Coffees = new[] { new CoffeeOrder { Coffee = Coffees.Latte, Quantity = 1, Size = CoffeeSize.Medium } },
            Desserts = new[] { new DessertOrder("Tiramisu", 2) },
            Fruits = new[] { new FruitOrder { Name = "Banana", Quantity = 3 } },
            Unknown = new[] { new UnknownItem { Text = "unclear item" } }
        };

        Assert.NotNull(order.Coffees);
        Assert.Single(order.Coffees);
        Assert.NotNull(order.Desserts);
        Assert.Single(order.Desserts);
        Assert.NotNull(order.Fruits);
        Assert.Single(order.Fruits);
        Assert.NotNull(order.Unknown);
        Assert.Single(order.Unknown);
    }

    [Fact]
    public void Order_AllowsNullCollections()
    {
        var order = new Order { Desserts = Array.Empty<DessertOrder>() };
        Assert.Null(order.Coffees);
        Assert.Null(order.Fruits);
        Assert.Null(order.Unknown);
    }

    #endregion

    #region SentimentResponse Tests

    [Fact]
    public void SentimentResponse_CanStoreSentiment()
    {
        var response = new SentimentResponse { Sentiment = "positive" };
        Assert.Equal("positive", response.Sentiment);
    }

    #endregion

    #region NullableTestObj Tests

    [Fact]
    public void NullableTestObj_SupportsNullableAndRequiredFields()
    {
        var obj = new NullableTestObj
        {
            Required = CoffeeSize.Large,
            Optional = null,
            Text = "test",
            OptionalText = null,
            OptionalTextField = "field",
            Amt = 100,
            OptionalAmt = null
        };

        Assert.Equal(CoffeeSize.Large, obj.Required);
        Assert.Null(obj.Optional);
        Assert.Equal("test", obj.Text);
        Assert.Null(obj.OptionalText);
        Assert.Equal("field", obj.OptionalTextField);
        Assert.Equal(100, obj.Amt);
        Assert.Null(obj.OptionalAmt);
    }

    [Fact]
    public void NullableTestObj_CanSetOptionalValues()
    {
        var obj = new NullableTestObj
        {
            Required = CoffeeSize.Small,
            Optional = CoffeeSize.Medium,
            Text = "required",
            OptionalText = "optional",
            Amt = 50,
            OptionalAmt = 25
        };

        Assert.Equal(CoffeeSize.Medium, obj.Optional);
        Assert.Equal("optional", obj.OptionalText);
        Assert.Equal(25, obj.OptionalAmt);
    }

    #endregion

    #region WrapperNullableObj Tests

    [Fact]
    public void WrapperNullableObj_CanWrapNullableTest()
    {
        var wrapper = new WrapperNullableObj
        {
            Test = new NullableTestObj { Required = CoffeeSize.Grande, Amt = 10, Text = "test" },
            OptionalMilk = "whole milk"
        };

        Assert.NotNull(wrapper.Test);
        Assert.Equal("whole milk", wrapper.OptionalMilk);
    }

    [Fact]
    public void WrapperNullableObj_AllowsNullValues()
    {
        var wrapper = new WrapperNullableObj { Test = null, OptionalMilk = null };
        Assert.Null(wrapper.Test);
        Assert.Null(wrapper.OptionalMilk);
    }

    #endregion

    #region ConverterTestObj and HardcodedVocabObj Tests

    [Fact]
    public void ConverterTestObj_HasMilkProperty()
    {
        var obj = new ConverterTestObj { Milk = "Almond" };
        Assert.Equal("Almond", obj.Milk);
    }

    [Fact]
    public void HardcodedVocabObj_HasVocabName()
    {
        Assert.Equal("Local", HardcodedVocabObj.VocabName);
    }

    [Fact]
    public void HardcodedVocabObj_CanSetValue()
    {
        var obj = new HardcodedVocabObj { Value = "Two" };
        Assert.Equal("Two", obj.Value);
    }

    #endregion

    #region JsonFunc and JsonExpr Tests

    [Fact]
    public void JsonFunc_HasNameProperty()
    {
        var func = new JsonFunc { Name = "testFunc" };
        Assert.Equal("testFunc", func.Name);
    }

    [Fact]
    public void JsonExpr_CanContainFuncAndValue()
    {
        var func = new JsonFunc { Name = "add" };
        var value = System.Text.Json.JsonDocument.Parse("42").RootElement;
        var expr = new JsonExpr { Func = func, Value = value };

        Assert.NotNull(expr.Func);
        Assert.Equal("add", expr.Func.Name);
        Assert.Equal(System.Text.Json.JsonValueKind.Number, expr.Value.ValueKind);
    }

    #endregion

    #region TestVocabs Tests

    [Fact]
    public void TestVocabs_Names_HasExpectedConstants()
    {
        Assert.Equal("Desserts", TestVocabs.Names.Desserts);
        Assert.Equal("Fruits", TestVocabs.Names.Fruits);
        Assert.Equal("Milks", TestVocabs.Names.Milks);
        Assert.Equal("Creamers", TestVocabs.Names.Creamers);
    }

    [Fact]
    public void TestVocabs_Desserts_ReturnsVocab()
    {
        var vocab = TestVocabs.Desserts();
        Assert.Equal(TestVocabs.Names.Desserts, vocab.Name);
        Assert.NotNull(vocab.Vocab);
        Assert.Contains("Tiramisu", vocab.Vocab);
        Assert.Contains("Chocolate Cake", vocab.Vocab);
    }

    [Fact]
    public void TestVocabs_Fruits_ReturnsVocab()
    {
        var vocab = TestVocabs.Fruits();
        Assert.Equal(TestVocabs.Names.Fruits, vocab.Name);
        Assert.Contains("Banana", vocab.Vocab);
        Assert.Contains("Regular Apple", vocab.Vocab);
    }

    [Fact]
    public void TestVocabs_Milks_ReturnsVocab()
    {
        var vocab = TestVocabs.Milks();
        Assert.Equal(TestVocabs.Names.Milks, vocab.Name);
        Assert.Contains("whole milk", vocab.Vocab);
        Assert.Contains("almond milk", vocab.Vocab);
    }

    [Fact]
    public void TestVocabs_Creamers_ReturnsVocab()
    {
        var vocab = TestVocabs.Creamers();
        Assert.Equal(TestVocabs.Names.Creamers, vocab.Name);
        Assert.Contains("half and half", vocab.Vocab);
        Assert.Contains("heavy cream", vocab.Vocab);
    }

    [Fact]
    public void TestVocabs_All_ReturnsAllVocabs()
    {
        var allVocabs = TestVocabs.All();
        Assert.Equal(4, allVocabs.Count);
    }

    #endregion

    #region Person, Name, and Location Tests

    [Fact]
    public void Person_CanBeCreated()
    {
        var person = new Person
        {
            Name = new Name { FirstName = "John", LastName = "Doe" },
            Age = 30,
            Location = new Location { City = "Seattle", State = "WA", Country = "USA" }
        };

        Assert.Equal("John", person.Name.FirstName);
        Assert.Equal(30, person.Age);
        Assert.Equal("Seattle", person.Location.City);
    }

    [Fact]
    public void Person_HasSameName_ComparesCorrectly()
    {
        var person1 = new Person { Name = new Name { FirstName = "Jane", LastName = "Smith" }, Age = 25 };
        var person2 = new Person { Name = new Name { FirstName = "Jane", LastName = "Smith" }, Age = 30 };
        var person3 = new Person { Name = new Name { FirstName = "John", LastName = "Smith" }, Age = 25 };

        Assert.True(person1.HasSameName(person2));
        Assert.False(person1.HasSameName(person3));
    }

    [Fact]
    public void Person_ChangeCase_ModifiesNameAndLocation()
    {
        var person = new Person
        {
            Name = new Name { FirstName = "John", LastName = "Doe" },
            Age = 30,
            Location = new Location { City = "Seattle", State = "WA", Country = "USA" }
        };

        person.ChangeCase(true);
        Assert.Equal("JOHN", person.Name.FirstName);
        Assert.Equal("DOE", person.Name.LastName);
        Assert.Equal("SEATTLE", person.Location.City);

        person.ChangeCase(false);
        Assert.Equal("john", person.Name.FirstName);
        Assert.Equal("seattle", person.Location.City);
    }

    [Fact]
    public void Name_CompareTo_WorksCorrectly()
    {
        var name1 = new Name { FirstName = "Alice", LastName = "Brown" };
        var name2 = new Name { FirstName = "Bob", LastName = "Brown" };
        var name3 = new Name { FirstName = "Alice", LastName = "Brown" };

        Assert.True(name1.CompareTo(name2) < 0);
        Assert.Equal(0, name1.CompareTo(name3));
        Assert.True(name2.CompareTo(name1) > 0);
    }

    [Fact]
    public void Name_ToString_FormatsCorrectly()
    {
        var name = new Name { FirstName = "Jane", LastName = "Doe" };
        Assert.Equal("Jane Doe", name.ToString());
    }

    [Fact]
    public void Location_ChangeCase_ModifiesAllFields()
    {
        var location = new Location { City = "Portland", State = "OR", Country = "USA" };
        
        location.ChangeCase(true);
        Assert.Equal("PORTLAND", location.City);
        Assert.Equal("OR", location.State);
        Assert.Equal("USA", location.Country);
    }

    #endregion

    #region AuthorPerson and FriendsOfPerson Tests

    [Fact]
    public void AuthorPerson_CanStoreBooks()
    {
        var author = new AuthorPerson
        {
            Name = new Name { FirstName = "Isaac", LastName = "Asimov" },
            Books = new[] { "Foundation", "I, Robot" }
        };

        Assert.Equal(2, author.Books.Length);
        Assert.Contains("Foundation", author.Books);
    }

    [Fact]
    public void FriendsOfPerson_CanStoreFriendNames()
    {
        var person = new FriendsOfPerson
        {
            Name = new Name { FirstName = "Alice", LastName = "Smith" },
            FriendNames = new[]
            {
                new Name { FirstName = "Bob", LastName = "Jones" },
                new Name { FirstName = "Carol", LastName = "White" }
            }
        };

        Assert.Equal(2, person.FriendNames.Length);
        Assert.Equal("Bob", person.FriendNames[0].FirstName);
    }

    #endregion

    #region Generic Tests

    [Fact]
    public void Child_Generic_CanStoreValue()
    {
        var child = new Child<int> { Name = "IntChild", Value = 42 };
        Assert.Equal("IntChild", child.Name);
        Assert.Equal(42, child.Value);

        var childString = new Child<string> { Name = "StringChild", Value = "test" };
        Assert.Equal("test", childString.Value);
    }

    [Fact]
    public void Parent_Generic_CanStoreChildrenOfDifferentTypes()
    {
        var parent = new Parent<int, string>
        {
            ChildrenX = new[] { new Child<int> { Name = "Child1", Value = 1 } },
            ChildrenY = new[] { new Child<string> { Name = "Child2", Value = "two" } }
        };

        Assert.Single(parent.ChildrenX);
        Assert.Single(parent.ChildrenY);
        Assert.Equal(1, parent.ChildrenX[0].Value);
        Assert.Equal("two", parent.ChildrenY[0].Value);
    }

    #endregion

    #region Polymorphic Shape Tests (NET7_0_OR_GREATER)

#if NET7_0_OR_GREATER
    [Fact]
    public void Rectangle_CanBeCreated()
    {
        var rect = new Rectangle
        {
            Id = "rect1",
            TopX = 10,
            TopY = 20,
            Height = 100,
            Width = 50
        };

        Assert.Equal("rect1", rect.Id);
        Assert.Equal(10, rect.TopX);
        Assert.Equal(100, rect.Height);
    }

    [Fact]
    public void Circle_CanBeCreated()
    {
        var circle = new Circle
        {
            Id = "circle1",
            CenterX = 50,
            CenterY = 50,
            Radius = 25
        };

        Assert.Equal("circle1", circle.Id);
        Assert.Equal(25, circle.Radius);
    }

    [Fact]
    public void Drawing_CanStoreMultipleShapes()
    {
        var drawing = new Drawing
        {
            Shapes = new Shape[]
            {
                new Rectangle { Id = "r1", TopX = 0, TopY = 0, Height = 10, Width = 10 },
                new Circle { Id = "c1", CenterX = 5, CenterY = 5, Radius = 2 }
            }
        };

        Assert.Equal(2, drawing.Shapes.Length);
    }

    [Fact]
    public void Drawing_GetShape_ReturnsCorrectShape()
    {
        var drawing = new Drawing
        {
            Shapes =
            [
                new Rectangle { Id = "r1", TopX = 0, TopY = 0, Height = 10, Width = 10 },
                new Circle { Id = "c1", CenterX = 5, CenterY = 5, Radius = 2 },
                new Rectangle { Id = "r2", TopX = 20, TopY = 20, Height = 5, Width = 5 }
            ]
        };

        var firstRect = drawing.GetShape<Rectangle>(0);
        Assert.NotNull(firstRect);
        Assert.Equal("r1", firstRect.Id);

        var secondRect = drawing.GetShape<Rectangle>(1);
        Assert.NotNull(secondRect);
        Assert.Equal("r2", secondRect.Id);

        var circle = drawing.GetShape<Circle>(0);
        Assert.NotNull(circle);
        Assert.Equal("c1", circle.Id);
    }

    [Fact]
    public void Drawing_GetShape_ReturnsNull_WhenNotFound()
    {
        var drawing = new Drawing
        {
            Shapes = new Shape[] { new Rectangle { Id = "r1", TopX = 0, TopY = 0, Height = 10, Width = 10 } }
        };

        var circle = drawing.GetShape<Circle>(0);
        Assert.Null(circle);
    }

    [Fact]
    public void Drawing_Serialization_PreservesPolymorphicTypes()
    {
        var drawing = new Drawing
        {
            Shapes = new Shape[]
            {
                new Rectangle { Id = "r1", TopX = 0, TopY = 0, Height = 10, Width = 10 },
                new Circle { Id = "c1", CenterX = 5, CenterY = 5, Radius = 2 }
            }
        };

        var json = System.Text.Json.JsonSerializer.Serialize(drawing);
        var deserialized = System.Text.Json.JsonSerializer.Deserialize<Drawing>(json);

        Assert.NotNull(deserialized);
        Assert.Equal(2, deserialized.Shapes.Length);
        Assert.IsType<Rectangle>(deserialized.Shapes[0]);
        Assert.IsType<Circle>(deserialized.Shapes[1]);
    }
#endif

    #endregion
}
