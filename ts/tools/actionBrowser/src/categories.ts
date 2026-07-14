// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Top-level grouping of agents into human-friendly categories. This taxonomy
// is the first level of the Action Browser map. Agents not listed here fall
// back to the "Other" category, so newly added agents still appear (they just
// want assigning to a category here).

export interface CategoryDef {
    name: string;
    emoji: string;
    /** Agent names (as they appear in the catalog) that belong to this category. */
    agents: string[];
}

const CATEGORIES: CategoryDef[] = [
    {
        name: "Music & Entertainment",
        emoji: "🎵",
        agents: ["player", "localPlayer"],
    },
    {
        name: "Creative & Media",
        emoji: "🎨",
        agents: [
            "image",
            "video",
            "photo",
            "montage",
            "markdown",
            "screencapture",
        ],
    },
    {
        name: "Productivity",
        emoji: "📅",
        agents: ["calendar", "email", "list", "timer"],
    },
    {
        name: "Communication",
        emoji: "💬",
        agents: ["discord", "chat"],
    },
    {
        name: "Web & Knowledge",
        emoji: "🌐",
        agents: ["browser", "weather"],
    },
    {
        name: "Development & Automation",
        emoji: "💻",
        agents: [
            "code",
            "visualStudio",
            "github-cli",
            "powershell",
            "workflow",
            "taskflow",
            "utility",
            "onboarding",
            "studio",
        ],
    },
    {
        name: "System & Devices",
        emoji: "⚙️",
        agents: [
            "desktop",
            "settings",
            "ipconfig",
            "osNotifications",
            "windowsClock",
        ],
    },
    {
        name: "Core",
        emoji: "🧠",
        agents: ["dispatcher", "system"],
    },
];

const OTHER: CategoryDef = { name: "Other", emoji: "📦", agents: [] };

const agentToCategory = new Map<string, CategoryDef>();
for (const category of CATEGORIES) {
    for (const agent of category.agents) {
        agentToCategory.set(agent, category);
    }
}

/** Category name for an agent (falls back to "Other"). */
export function categoryForAgent(agentName: string): string {
    return (agentToCategory.get(agentName) ?? OTHER).name;
}

/**
 * All categories in display order, each paired with its emoji. "Other" is only
 * included when {@link usedNames} contains an agent that mapped to it.
 */
export function orderedCategories(
    usedNames: Iterable<string>,
): { name: string; emoji: string }[] {
    const used = new Set<string>();
    for (const name of usedNames) {
        used.add(categoryForAgent(name));
    }
    const result = CATEGORIES.filter((c) => used.has(c.name)).map((c) => ({
        name: c.name,
        emoji: c.emoji,
    }));
    if (used.has(OTHER.name)) {
        result.push({ name: OTHER.name, emoji: OTHER.emoji });
    }
    return result;
}
