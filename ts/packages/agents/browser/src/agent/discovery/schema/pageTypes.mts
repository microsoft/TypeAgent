// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type LandingPage = {
    name: "LandingPage";
    description: "The default landing page for the site";
};

export type SearchResultsPage = {
    name: "SearchResultsPage";
    description: "The search results page";
};

export type ProductDetailsPage = {
    name: "ProductDetailsPage";
    description: "A product details page, with focus on one product.";
};

export type ShoppingCartPage = {
    name: "ShoppingCartPage";
    description: "The shopping cart page for the site";
};

export type PastOrderPage = {
    name: "PastOrderPage";
    description: "The page showing a user's past orders";
};

export type StoreLandingPage = {
    name: "StoreLandingPage";
    description: "The landing page for a particular store";
};

export type UnknownPage = {
    name: "UnknownPage";
    description: "A page that does not meet the previous more-specific categories";
};

export type CommercePageTypes =
    | LandingPage
    | SearchResultsPage
    | ProductDetailsPage
    | ShoppingCartPage
    | PastOrderPage
    | StoreLandingPage
    | UnknownPage;

export type CrosswordPage = {
    name: "CrosswordPage";
    description: "The page showing a crossword puzzle";
};

export type NewsLandingPage = {
    name: "NewsLandingPage";
    description: "The page showing news headlines for the day";
};

export type SportsLandingPage = {
    name: "SportsLandingPage";
    description: "The page showing sports headlines for the day";
};

export type OpinionPage = {
    name: "OpinionPage";
    description: "The page showing editorial opinions for the day";
};

export type ArticlePage = {
    name: "ArticlePage";
    description: "The page showing an individual news article";
};

export type WeatherPage = {
    name: "WeatherPage";
    description: "The page showing weather headlines";
};

export type PuzzlesPage = {
    name: "PuzzlesPage";
    description: "The page showing a list of puzzles, such as sudoku, crossword, word matching games and more.";
};

export type NewsPageTypes =
    | CrosswordPage
    | NewsLandingPage
    | SportsLandingPage
    | OpinionPage
    | ArticlePage
    | PuzzlesPage
    | UnknownPage;

export type KnownPageTypes = {
    pageType: CommercePageTypes | NewsPageTypes | UnknownPage;
};
