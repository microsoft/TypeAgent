// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type LandingPage = {
  description: "The default landing page for the site";
};

export type SearchResultsPage = {
  description: "The search results page";
};

export type ProductDetailsPage = {
  description: "A product details page, with focus on one product.";
};

export type ShoppingCartPage = {
  description: "The shopping cart page for the site";
};

export type PastOrderPage = {
  description: "The page showing a user's past orders";
};

export type UnknownPage = {
  description: "A page that does not meet the previous more-specific categories";
};

export type CommercePageTypes =
  | LandingPage
  | SearchResultsPage
  | ProductDetailsPage
  | ShoppingCartPage
  | PastOrderPage
  | UnknownPage;

export type CrosswordPage = {
  description: "The page showing a crossword puzzle";
};

export type NewsLandingPage = {
  description: "The page showing news headlines for the day";
};

export type SportsLandingPage = {
  description: "The page showing sports headlines for the day";
};

export type OpinionPage = {
  description: "The page showing editorial opinions for the day";
};

export type ArticlePage = {
  description: "The page showing an individual news article";
};

export type WeatherPage = {
  description: "The page showing weather headlines";
};

export type PuzzlesPage = {
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
