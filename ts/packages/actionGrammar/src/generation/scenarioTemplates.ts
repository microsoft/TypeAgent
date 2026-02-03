// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Scenario-based grammar generation
 *
 * This module defines scenario templates for generating natural, contextual grammar patterns.
 * Instead of purely syntactic variations, scenarios model realistic user contexts (morning routine,
 * cooking, working from home, etc.) to generate patterns that users would actually say.
 */

/**
 * A scenario template describes a realistic user context for natural language generation
 */
export interface ScenarioTemplate {
    /** Short identifier (e.g., "morning-routine", "work-focus") */
    id: string;
    /** Human-readable name */
    name: string;
    /** Description of the scenario */
    description: string;
    /** User context during this scenario */
    userContext: {
        /** What the user is doing (e.g., "getting ready in the morning") */
        situation: string;
        /** Physical state affecting interaction style */
        physicalState: "hands-free" | "mobile" | "stationary" | "multitasking";
        /** Emotional state affecting formality and brevity */
        emotionalState:
            | "relaxed"
            | "urgent"
            | "focused"
            | "casual"
            | "stressed";
        /** Formality level of language */
        formality: "casual" | "neutral" | "formal";
    };
    /** Domain-specific vocabulary likely to appear in this scenario */
    vocabulary: string[];
    /** Example goals the user wants to accomplish */
    exampleGoals: string[];
    /** Language code (e.g., "en", "fr") */
    language: "en" | "fr";
}

/**
 * Prefix/suffix pattern categories for reusable grammar components
 */
export interface PrefixSuffixPatterns {
    /** Language code */
    language: "en" | "fr";
    /** Politeness prefixes (e.g., "can you", "please") */
    politePrefixes: string[];
    /** Desire/intent prefixes (e.g., "I want to", "I need to") */
    desirePrefixes: string[];
    /** Action initiators (e.g., "go ahead and", "just") */
    actionInitiators: string[];
    /** Greeting prefixes (e.g., "hey", "hello") */
    greetings: string[];
    /** Acknowledgement/gratitude suffixes (e.g., "thanks", "appreciate it") */
    acknowledgements: string[];
    /** Politeness suffixes (e.g., "please", "if you don't mind") */
    politeSuffixes: string[];
}

/**
 * Music player scenario templates
 */
export const musicPlayerScenarios: ScenarioTemplate[] = [
    {
        id: "morning-routine",
        name: "Morning Routine",
        description:
            "User is getting ready in the morning, needs energizing music",
        userContext: {
            situation: "getting ready for the day",
            physicalState: "multitasking",
            emotionalState: "casual",
            formality: "casual",
        },
        vocabulary: [
            "upbeat",
            "energy",
            "wake up",
            "morning",
            "start",
            "pump up",
            "get going",
        ],
        exampleGoals: [
            "Start the day with energetic music",
            "Quick music start while brushing teeth/showering",
            "Familiar playlist for routine",
        ],
        language: "en",
    },
    {
        id: "work-focus",
        name: "Work/Focus",
        description: "User needs music for concentration while working",
        userContext: {
            situation: "working from home or office",
            physicalState: "stationary",
            emotionalState: "focused",
            formality: "neutral",
        },
        vocabulary: [
            "focus",
            "concentrate",
            "quiet",
            "background",
            "work",
            "calm",
            "instrumental",
        ],
        exampleGoals: [
            "Start long-duration focus music",
            "Minimize interruptions",
            "Create work atmosphere",
        ],
        language: "en",
    },
    {
        id: "exercise",
        name: "Exercise/Workout",
        description: "User is exercising and needs high-energy music",
        userContext: {
            situation: "working out or running",
            physicalState: "hands-free",
            emotionalState: "urgent",
            formality: "casual",
        },
        vocabulary: [
            "workout",
            "running",
            "gym",
            "fast",
            "loud",
            "pump",
            "intense",
        ],
        exampleGoals: [
            "Start workout playlist hands-free",
            "Quick controls while exercising",
            "High-energy tracks",
        ],
        language: "en",
    },
    {
        id: "cooking",
        name: "Cooking/Cleaning",
        description: "User is cooking or cleaning with hands occupied",
        userContext: {
            situation: "cooking dinner or cleaning house",
            physicalState: "hands-free",
            emotionalState: "relaxed",
            formality: "casual",
        },
        vocabulary: [
            "kitchen",
            "cooking",
            "dinner",
            "ambiance",
            "background",
            "something nice",
        ],
        exampleGoals: [
            "Hands-free music control",
            "Create pleasant atmosphere",
            "Easy skipping of unwanted tracks",
        ],
        language: "en",
    },
    {
        id: "social-gathering",
        name: "Social Gathering",
        description: "User is hosting friends and managing music",
        userContext: {
            situation: "party or dinner with guests",
            physicalState: "mobile",
            emotionalState: "casual",
            formality: "neutral",
        },
        vocabulary: [
            "party",
            "guests",
            "everyone",
            "crowd",
            "playlist",
            "queue",
        ],
        exampleGoals: [
            "Quick playlist changes",
            "Volume control for conversation",
            "Device switching between rooms",
        ],
        language: "en",
    },
    {
        id: "relaxation",
        name: "Relaxation/Sleep",
        description: "User is winding down or preparing for sleep",
        userContext: {
            situation: "relaxing or going to bed",
            physicalState: "stationary",
            emotionalState: "relaxed",
            formality: "casual",
        },
        vocabulary: [
            "calm",
            "quiet",
            "soft",
            "sleep",
            "relax",
            "peaceful",
            "soothing",
        ],
        exampleGoals: [
            "Start calming music",
            "Low volume requests",
            "Minimal interaction",
        ],
        language: "en",
    },
    {
        id: "discovery",
        name: "Music Discovery",
        description: "User is exploring and discovering new music",
        userContext: {
            situation: "browsing and discovering music",
            physicalState: "stationary",
            emotionalState: "casual",
            formality: "neutral",
        },
        vocabulary: [
            "find",
            "search",
            "new",
            "similar",
            "like this",
            "recommend",
            "explore",
        ],
        exampleGoals: [
            "Search for specific tracks/artists",
            "Find similar music",
            "Browse by mood or genre",
        ],
        language: "en",
    },
    {
        id: "commuting",
        name: "Commuting",
        description: "User is traveling or commuting",
        userContext: {
            situation: "driving or on public transport",
            physicalState: "hands-free",
            emotionalState: "casual",
            formality: "casual",
        },
        vocabulary: [
            "driving",
            "car",
            "commute",
            "next",
            "skip",
            "louder",
            "softer",
        ],
        exampleGoals: [
            "Hands-free control while driving",
            "Quick track changes",
            "Volume adjustments",
        ],
        language: "en",
    },
];

/**
 * Calendar agent scenario templates
 */
export const calendarScenarios: ScenarioTemplate[] = [
    {
        id: "meeting-scheduling",
        name: "Meeting Scheduling",
        description: "User is scheduling a formal business meeting",
        userContext: {
            situation: "scheduling meetings with colleagues",
            physicalState: "stationary",
            emotionalState: "focused",
            formality: "formal",
        },
        vocabulary: [
            "meeting",
            "schedule",
            "book",
            "appointment",
            "conference",
            "call",
        ],
        exampleGoals: [
            "Schedule meeting with specific time/participants",
            "Check availability",
            "Add meeting details",
        ],
        language: "en",
    },
    {
        id: "personal-reminders",
        name: "Personal Reminders",
        description: "User is setting casual personal reminders",
        userContext: {
            situation: "managing personal tasks and reminders",
            physicalState: "mobile",
            emotionalState: "casual",
            formality: "casual",
        },
        vocabulary: [
            "remind",
            "don't forget",
            "remember",
            "pick up",
            "call",
            "check",
        ],
        exampleGoals: [
            "Quick reminder creation",
            "Simple time expressions",
            "Personal tasks",
        ],
        language: "en",
    },
    {
        id: "time-checking",
        name: "Schedule Checking",
        description: "User needs to quickly check their schedule",
        userContext: {
            situation: "checking what's on the calendar",
            physicalState: "mobile",
            emotionalState: "urgent",
            formality: "casual",
        },
        vocabulary: [
            "what",
            "when",
            "today",
            "tomorrow",
            "next",
            "schedule",
            "free",
        ],
        exampleGoals: [
            "Quick schedule overview",
            "Check specific day/time",
            "Find next meeting",
        ],
        language: "en",
    },
    {
        id: "coordination",
        name: "Team Coordination",
        description: "User is coordinating with others on scheduling",
        userContext: {
            situation: "finding time with multiple people",
            physicalState: "stationary",
            emotionalState: "focused",
            formality: "neutral",
        },
        vocabulary: [
            "with",
            "team",
            "everyone",
            "available",
            "works for",
            "include",
        ],
        exampleGoals: [
            "Find common availability",
            "Add participants to event",
            "Coordinate schedules",
        ],
        language: "en",
    },
];

/**
 * List/todo agent scenario templates
 */
export const listScenarios: ScenarioTemplate[] = [
    {
        id: "shopping-prep",
        name: "Shopping Preparation",
        description: "User is building a shopping list",
        userContext: {
            situation: "preparing to go shopping",
            physicalState: "mobile",
            emotionalState: "casual",
            formality: "casual",
        },
        vocabulary: [
            "shopping",
            "grocery",
            "store",
            "buy",
            "pick up",
            "get",
            "need",
        ],
        exampleGoals: [
            "Rapid item addition",
            "Hands-free list building",
            "Quick item checks",
        ],
        language: "en",
    },
    {
        id: "task-planning",
        name: "Task Planning",
        description: "User is organizing work or project tasks",
        userContext: {
            situation: "planning tasks and projects",
            physicalState: "stationary",
            emotionalState: "focused",
            formality: "neutral",
        },
        vocabulary: [
            "todo",
            "task",
            "work",
            "project",
            "complete",
            "finish",
            "priority",
        ],
        exampleGoals: [
            "Structured task organization",
            "Task list management",
            "Progress tracking",
        ],
        language: "en",
    },
    {
        id: "quick-capture",
        name: "Quick Capture",
        description: "User needs to quickly capture an idea or item",
        userContext: {
            situation: "capturing thoughts on the go",
            physicalState: "hands-free",
            emotionalState: "urgent",
            formality: "casual",
        },
        vocabulary: [
            "add",
            "remember",
            "note",
            "quick",
            "jot down",
            "don't forget",
        ],
        exampleGoals: [
            "Instant item addition",
            "Minimal interaction",
            "Voice-first usage",
        ],
        language: "en",
    },
    {
        id: "review-cleanup",
        name: "List Review/Cleanup",
        description: "User is reviewing and cleaning up lists",
        userContext: {
            situation: "reviewing and organizing lists",
            physicalState: "stationary",
            emotionalState: "relaxed",
            formality: "casual",
        },
        vocabulary: [
            "show",
            "what's",
            "remove",
            "delete",
            "clear",
            "done",
            "finished",
        ],
        exampleGoals: [
            "Review list contents",
            "Remove completed items",
            "Clean up old lists",
        ],
        language: "en",
    },
];

/**
 * English prefix/suffix patterns
 */
export const englishPrefixSuffixPatterns: PrefixSuffixPatterns = {
    language: "en",
    politePrefixes: [
        "can you",
        "could you",
        "would you",
        "please",
        "can you please",
        "could you please",
        "would you please",
        "would you mind",
        "do you mind",
        "I'd like you to",
        "I would like you to",
        "I was hoping you could",
        "I was hoping you would",
        "if you could",
        "if you would",
        "would you be able to",
    ],
    desirePrefixes: [
        "I want to",
        "I'd like to",
        "I would like to",
        "I need to",
        "I wanna",
        "I gotta",
        "let me",
        "let's",
        "I'm trying to",
        "help me",
        "can I",
        "could I",
        "may I",
    ],
    actionInitiators: [
        "go ahead and",
        "please go ahead and",
        "just",
        "just quickly",
        "quickly",
        "now",
        "right now",
    ],
    greetings: [
        "hey",
        "hi",
        "hello",
        "hey there",
        "hi there",
        "yo",
        "excuse me",
    ],
    acknowledgements: [
        "thanks",
        "thank you",
        "thank you so much",
        "thanks a lot",
        "appreciate it",
        "I appreciate it",
        "much appreciated",
        "cheers",
        "great",
        "perfect",
        "awesome",
    ],
    politeSuffixes: [
        "please",
        "if you would",
        "if you could",
        "if you don't mind",
        "if that's okay",
        "if that's alright",
        "if possible",
        "for me",
    ],
};

/**
 * French prefix/suffix patterns
 */
export const frenchPrefixSuffixPatterns: PrefixSuffixPatterns = {
    language: "fr",
    politePrefixes: [
        "pouvez-vous",
        "pourriez-vous",
        "s'il vous plaît",
        "s'il te plaît",
        "je voudrais que vous",
        "je souhaiterais que vous",
        "serait-il possible de",
    ],
    desirePrefixes: [
        "je veux",
        "je voudrais",
        "j'aimerais",
        "je dois",
        "laisse-moi",
        "aide-moi",
        "je peux",
        "puis-je",
    ],
    actionInitiators: ["allez-y", "juste", "maintenant", "tout de suite"],
    greetings: [
        "salut",
        "bonjour",
        "bonsoir",
        "hey",
        "allô",
        "excusez-moi",
        "pardon",
    ],
    acknowledgements: [
        "merci",
        "merci beaucoup",
        "merci bien",
        "je vous remercie",
        "c'est gentil",
        "super",
        "parfait",
        "génial",
    ],
    politeSuffixes: ["s'il vous plaît", "s'il te plaît", "pour moi"],
};

/**
 * Get all scenarios for a given agent type
 */
export function getScenariosForAgent(
    agentType: "player" | "calendar" | "list",
): ScenarioTemplate[] {
    switch (agentType) {
        case "player":
            return musicPlayerScenarios;
        case "calendar":
            return calendarScenarios;
        case "list":
            return listScenarios;
        default:
            return [];
    }
}

/**
 * Get prefix/suffix patterns for a language
 */
export function getPrefixSuffixPatterns(
    language: "en" | "fr",
): PrefixSuffixPatterns {
    return language === "fr"
        ? frenchPrefixSuffixPatterns
        : englishPrefixSuffixPatterns;
}
