// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export const DEPARTMENTS = ["produce", "bakery", "dairy", "pantry"];

export const DIETARY = ["gluten-free", "vegan", "nut-free"];

export const VENDOR_LABEL = "Lane & Rye";

export const PRODUCTS = [
    {
        id: "red-apple",
        name: "Red Apple",
        department: "produce",
        dietary: ["vegan", "nut-free", "gluten-free"],
        organic: true,
        priceCents: 129,
        image: "apple.svg",
    },
    {
        id: "kale-bunch",
        name: "Kale Bunch",
        department: "produce",
        dietary: ["vegan", "nut-free", "gluten-free"],
        organic: true,
        priceCents: 199,
        image: "kale.svg",
    },
    {
        id: "millet-roll",
        name: "Millet Roll",
        department: "bakery",
        dietary: ["vegan", "gluten-free"],
        organic: false,
        priceCents: 250,
        image: "roll.svg",
    },
    {
        id: "rye-loaf",
        name: "Rye Loaf",
        department: "bakery",
        dietary: ["vegan"],
        organic: false,
        priceCents: 420,
        image: "loaf.svg",
    },
    {
        id: "oat-milk",
        name: "Oat Milk",
        department: "dairy",
        dietary: ["vegan", "nut-free"],
        organic: false,
        priceCents: 349,
        image: "carton.svg",
    },
    {
        id: "plain-yogurt",
        name: "Plain Yogurt",
        department: "dairy",
        dietary: ["nut-free", "gluten-free"],
        organic: true,
        priceCents: 189,
        image: "carton.svg",
    },
    {
        id: "rice-cakes",
        name: "Rice Cakes",
        department: "pantry",
        dietary: ["vegan", "gluten-free", "nut-free"],
        organic: false,
        priceCents: 279,
        image: "cakes.svg",
    },
    {
        id: "peanut-butter",
        name: "Peanut Butter",
        department: "pantry",
        dietary: ["vegan", "gluten-free"],
        organic: false,
        priceCents: 399,
        image: "jar.svg",
    },
];

export function productById(id) {
    return PRODUCTS.find((product) => product.id === id);
}
