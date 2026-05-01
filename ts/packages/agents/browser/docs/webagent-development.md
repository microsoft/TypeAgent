# WebAgent Development Guide

This guide walks through building a new site-specific WebAgent for the
TypeAgent browser extension. For framework architecture, see the WebAgent
section in
[browserScenarios.md](../../../../docs/architecture/browserScenarios.md).

---

## What is a WebAgent?

A WebAgent is a site-specific agent that runs inside the browser page and
registers with the TypeAgent dispatcher at runtime. Unlike general browser
actions (open, click, scroll), WebAgents understand a specific site's
structure and provide typed, high-level actions.

**Built-in WebAgents:**

- **Crossword** — Solve crossword puzzles (WSJ, NYT, etc.)
- **Instacart** — Search products, manage cart, handle recipes
- **Commerce** — Generic e-commerce automation (Amazon, Walmart, etc.)
- **WebFlow** — Execute multi-page WebFlow scripts in the page context

---

## Step-by-step: Building a New WebAgent

We'll build a hypothetical "RecipeSite" agent that can search for recipes
and save favorites on a cooking website.

### 1. Define Action Types

Create `extension/webagent/recipesite/recipeSiteSchema.ts`:

```typescript
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type RecipeSiteActions = SearchRecipe | SaveRecipe | GetIngredients;

export type SearchRecipe = {
  actionName: "searchRecipe";
  parameters: {
    query: string;
    cuisine?: string;
  };
};

export type SaveRecipe = {
  actionName: "saveRecipe";
  parameters: {
    recipeName: string;
  };
};

export type GetIngredients = {
  actionName: "getIngredients";
  parameters: {
    recipeName: string;
  };
};
```

### 2. Create the WebAgent

Create `extension/webagent/recipesite/RecipeSiteWebAgent.ts`:

```typescript
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { WebAgentContext } from "../WebAgentContext";

export class RecipeSiteWebAgent {
  private context: WebAgentContext;

  constructor(context: WebAgentContext) {
    this.context = context;
  }

  async handleAction(action: any): Promise<any> {
    switch (action.actionName) {
      case "searchRecipe":
        return this.searchRecipe(
          action.parameters.query,
          action.parameters.cuisine,
        );
      case "saveRecipe":
        return this.saveRecipe(action.parameters.recipeName);
      case "getIngredients":
        return this.getIngredients(action.parameters.recipeName);
      default:
        throw new Error(`Unknown action: ${action.actionName}`);
    }
  }

  private async searchRecipe(query: string, cuisine?: string): Promise<any> {
    // Find the search input on the page
    const searchInput = document.querySelector(
      'input[name="search"], input[type="search"], #recipe-search',
    );
    if (!searchInput) {
      throw new Error("Search input not found on page");
    }

    // Clear and type the query
    (searchInput as HTMLInputElement).value = "";
    (searchInput as HTMLInputElement).value = query;
    searchInput.dispatchEvent(new Event("input", { bubbles: true }));

    // Submit the search
    const form = searchInput.closest("form");
    if (form) {
      form.submit();
    }

    return { success: true, query };
  }

  private async saveRecipe(recipeName: string): Promise<any> {
    // Find the save/favorite button near the recipe title
    const recipeHeading = Array.from(document.querySelectorAll("h1, h2")).find(
      (el) => el.textContent?.toLowerCase().includes(recipeName.toLowerCase()),
    );

    if (!recipeHeading) {
      throw new Error(`Recipe "${recipeName}" not found on page`);
    }

    const saveButton = recipeHeading
      .closest("article, section, .recipe-card")
      ?.querySelector(
        'button[aria-label*="save"], button[aria-label*="favorite"], .save-btn',
      );

    if (saveButton) {
      (saveButton as HTMLElement).click();
      return { success: true, recipeName };
    }

    throw new Error(`Save button not found for "${recipeName}"`);
  }

  private async getIngredients(recipeName: string): Promise<any> {
    // Extract ingredients list from page
    const ingredientsList = document.querySelector(
      '.ingredients, [class*="ingredient"], ul[aria-label*="ingredient"]',
    );

    if (!ingredientsList) {
      throw new Error("Ingredients list not found");
    }

    const ingredients = Array.from(ingredientsList.querySelectorAll("li")).map(
      (li) => li.textContent?.trim(),
    );

    return { recipeName, ingredients };
  }
}
```

### 3. Create the Site Entry Script

Create `extension/sites/recipesite.ts`:

```typescript
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { RecipeSiteWebAgent } from "../webagent/recipesite/RecipeSiteWebAgent";
import { WebAgentContext } from "../webagent/WebAgentContext";

const AGENT_NAME = "browser.recipesite";

function initialize() {
  const context = new WebAgentContext(AGENT_NAME);

  const agent = new RecipeSiteWebAgent(context);

  // Register with the dispatcher
  context.register({
    name: AGENT_NAME,
    description: "Recipe site assistant",
    schema: {
      // The action types the agent handles
      actionTypes: ["searchRecipe", "saveRecipe", "getIngredients"],
    },
    handler: (action: any) => agent.handleAction(action),
  });
}

// Initialize when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initialize);
} else {
  initialize();
}
```

### 4. Add Grammar Rules (optional)

If you want natural language matching without LLM translation, create
`extension/webagent/recipesite/recipeSiteSchema.agr`:

```agr
<SearchRecipe> =
    search for $(query:wildcard) recipe
  | find $(query:wildcard) recipes
  | look up $(query:wildcard) ;

<SaveRecipe> =
    save $(recipeName:wildcard) recipe
  | favorite $(recipeName:wildcard) ;

<GetIngredients> =
    get ingredients for $(recipeName:wildcard)
  | what's in $(recipeName:wildcard) ;
```

Compile: `npx agc -i recipeSiteSchema.agr -o recipeSiteSchema.ag.json`

### 5. Register in the Extension Manifest

Add URL patterns to `src/extension/manifest.json`:

```json
{
  "content_scripts": [
    {
      "matches": [
        "https://www.allrecipes.com/*",
        "https://www.food.com/*",
        "https://cooking.nytimes.com/*"
      ],
      "js": ["sites/recipesite.js"],
      "world": "MAIN",
      "run_at": "document_idle"
    }
  ]
}
```

Also add the Electron manifest (`src/electron/manifest.json`) if
Electron support is needed.

### 6. Build and Test

```bash
cd TypeAgent/ts/packages/agents/browser

# Build the extension
npm run build:extension:dev

# Reload in Chrome
# chrome://extensions → TypeAgent → refresh icon

# Navigate to a supported recipe site
# Try: "search for chocolate cake recipe"
```

---

## WebAgent Communication Flow

Understanding the message flow helps with debugging:

```
RecipeSiteWebAgent (MAIN world)
  ↓ context.register() sends via chrome.runtime.connect()
Content Script bridge (isolated world)
  ↓ Port message relay
Service Worker (port listener)
  ↓ webAgent/register message via WebSocket
Browser Agent (Node.js)
  ↓ addDynamicAgent()
Dispatcher
  → Agent now registered, grammar available for NL matching
```

When a user says "search for chocolate cake recipe":

```
Dispatcher matches grammar → { actionName: "searchRecipe", parameters: { query: "chocolate cake" } }
  ↓ Routes to dynamic agent "browser.recipesite"
Browser Agent
  ↓ handleWebAgentRpc()
Service Worker
  ↓ Port message to content script
RecipeSiteWebAgent.handleAction()
  ↓ DOM manipulation on the page
```

### Port protocol

The WebAgent connects via `chrome.runtime.connect({ name: "typeagent" })`.
Messages use these methods:

| Method                | Direction             | Purpose                                   |
| --------------------- | --------------------- | ----------------------------------------- |
| `webAgent/register`   | WebAgent → Dispatcher | Register agent with name, schema, grammar |
| `webAgent/disconnect` | WebAgent → Dispatcher | Deregister on page unload                 |
| (action name)         | Dispatcher → WebAgent | Execute an action                         |
| (response)            | WebAgent → Dispatcher | Return action result                      |

---

## Reference: Existing WebAgent Patterns

### Crossword agent patterns

The crossword agent demonstrates several advanced patterns:

- **Schema extraction at registration time**: Detects crossword grid
  structure and extracts clue selectors before reporting capability
- **Early registration**: Registers with the dispatcher immediately,
  then loads the full schema in the background
- **Cached schemas**: Stores extracted schemas in Chrome storage to
  avoid re-extracting on repeat visits
- **Smart page readiness**: Uses DOM observation rather than fixed
  delays to detect when the crossword puzzle is loaded

Key files:

- `extension/webagent/crossword/CrosswordWebAgent.ts`
- `agent/crosswordSchemaExtractor.mts`

### Instacart agent patterns

The Instacart agent demonstrates component-based page interaction:

- **Typed page components**: Defines SearchInput, ProductTile,
  ShoppingCartButton, StoreInfo as typed components
- **Component extraction**: Uses `extractComponent<T>()` to pull typed
  data from page elements
- **Multiple action categories**: Search, cart management, lists,
  recipes, store selection

Key files:

- `extension/webagent/instacart/InstacartWebAgent.ts`

### WebFlow agent patterns

The WebFlow agent bridges server-side flows with in-page execution:

- **Local flow caching**: Caches flow definitions from the server
- **Cache invalidation**: Listens for `refreshFlowCache` messages
- **Browser adapter**: Maps WebFlowBrowserAPI to direct DOM
  manipulation for fast-path execution
- **Multi-page continuation**: Stores continuation state for
  cross-navigation flows

Key files:

- `extension/webagent/webflow/WebFlowAgent.ts`
- `extension/webagent/webflow/webFlowBrowserAdapter.ts`

---

## Tips

1. **MAIN world vs. Isolated world**: WebAgents typically run in MAIN
   world because they need access to page JavaScript (e.g., SPA
   frameworks, custom elements). Content scripts in isolated world can
   access the DOM but not page JS variables.

2. **Page readiness**: Don't assume the page is fully loaded when your
   script runs. Use MutationObserver or poll for expected elements before
   registering.

3. **Cleanup on unload**: Always deregister your agent on `beforeunload`
   to prevent stale registrations in the dispatcher.

4. **Error handling**: Wrap action handlers in try/catch and return
   structured error objects. Unhandled exceptions propagate as opaque
   RPC errors.

5. **Testing without the dispatcher**: You can test DOM interaction logic
   directly in the browser console by instantiating your WebAgent class
   with a mock context.
