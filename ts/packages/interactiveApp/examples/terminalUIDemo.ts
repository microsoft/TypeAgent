// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Demo script for the Terminal UI module
 *
 * Run with: npx tsx examples/terminalUIDemo.ts
 */

import {
    EnhancedSpinner,
    TerminalLayout,
    SpinnerFrames,
    createProgressDisplay,
    withSpinner,
    ANSI,
    InputBox,
    InteractiveSession,
    getDisplayWidth,
    InputBoxWithCompletion,
    CompletionItem,
} from "../src/terminalUI.js";

async function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function demoBasicSpinner(): Promise<void> {
    console.log("\n=== Basic Spinner Demo ===\n");

    const spinner = new EnhancedSpinner({ text: "Loading..." });
    spinner.start();

    await sleep(2000);

    spinner.updateText("Almost done...");
    await sleep(1000);

    spinner.succeed("Completed successfully!");
}

async function demoSpinnerStyles(): Promise<void> {
    console.log("\n=== Spinner Styles Demo ===\n");

    const styles: (keyof typeof SpinnerFrames)[] = [
        "braille",
        "dots",
        "line",
        "arc",
        "circle",
        "bounce",
        "pulse",
        "arrow",
    ];

    for (const style of styles) {
        const spinner = new EnhancedSpinner({
            text: `${style} spinner`,
            frames: style,
        });
        spinner.start();
        await sleep(1500);
        spinner.stop();
        console.log(`  ✓ ${style}`);
    }
}

async function demoOutputAboveSpinner(): Promise<void> {
    console.log("\n=== Output Above Spinner Demo ===\n");
    console.log("Watch as content appears above the spinner:\n");

    const spinner = new EnhancedSpinner({ text: "Processing items..." });
    spinner.start();

    const items = [
        "Fetching configuration...",
        "Loading user data...",
        "Connecting to database...",
        "Running validation...",
        "Preparing response...",
    ];

    for (let i = 0; i < items.length; i++) {
        await sleep(800);
        spinner.writeAbove(`${ANSI.green}✓${ANSI.reset} ${items[i]}`);
        spinner.updateText(`Processing... (${i + 1}/${items.length})`);
    }

    await sleep(500);
    spinner.succeed("All items processed!");
}

async function demoStreamingOutput(): Promise<void> {
    console.log("\n=== Streaming Output Demo ===\n");
    console.log("Simulating streaming text (like from an LLM):\n");

    const spinner = new EnhancedSpinner({ text: "Generating response..." });
    spinner.start();

    // Simulate streaming tokens
    const response =
        "Hello! I'm demonstrating how streaming text works.\nEach word appears gradually, simulating LLM output.\nThe spinner keeps animating while content appears above it.\nThis creates a nice visual effect for the user.";

    const words = response.split(" ");
    for (const word of words) {
        await sleep(100);
        spinner.appendStream(word + " ");
    }

    spinner.flushStream();
    await sleep(500);
    spinner.succeed("Response complete!");
}

async function demoLayout(): Promise<void> {
    console.log("\n=== Terminal Layout Demo ===\n");

    const layout = new TerminalLayout();

    // Draw header
    layout.drawHeader("TypeAgent Terminal");

    console.log("\nActive Agents: player, calendar, weather");
    console.log("Session: interactive mode\n");

    // Draw a status line
    layout.writeStatus("🤖 TypeAgent", "v0.0.1");

    // Thin separator
    layout.drawThinSeparator();

    // Some content
    console.log("Recent commands:");
    console.log("  1. play something by taylor swift");
    console.log("  2. what's on my calendar today?");
    console.log("  3. show weather in seattle\n");

    // Draw box
    layout.drawBox(
        "Current Status",
        "Playing: Shake It Off - Taylor Swift\nDevice: Living Room Speaker",
    );

    // Separator before prompt
    layout.drawSeparator({ marginTop: true });
}

async function demoProgress(): Promise<void> {
    console.log("\n=== Progress Display Demo ===\n");

    const progress = createProgressDisplay();

    const total = 50;
    for (let i = 0; i <= total; i++) {
        progress.update(i, total, "Downloading...");
        await sleep(50);
    }

    progress.complete("Download complete!");
}

async function demoWithSpinner(): Promise<void> {
    console.log("\n=== withSpinner Helper Demo ===\n");

    // Success case
    await withSpinner(
        {
            text: "Running async operation...",
            successText: "Operation completed!",
        },
        async (spinner) => {
            await sleep(1500);
            spinner.writeAbove("  Step 1 done");
            await sleep(1000);
            spinner.writeAbove("  Step 2 done");
            await sleep(500);
            return "success";
        },
    );

    // Failure case (caught)
    try {
        await withSpinner(
            {
                text: "This will fail...",
                failText: "Operation failed (expected)",
            },
            async () => {
                await sleep(1000);
                throw new Error("Simulated error");
            },
        );
    } catch {
        // Expected
    }
}

async function demoSpinnerOutcomes(): Promise<void> {
    console.log("\n=== Spinner Outcome Styles ===\n");

    // Succeed
    let spinner = new EnhancedSpinner({ text: "Loading..." });
    spinner.start();
    await sleep(800);
    spinner.succeed("Task succeeded");

    // Fail
    spinner = new EnhancedSpinner({ text: "Loading..." });
    spinner.start();
    await sleep(800);
    spinner.fail("Task failed");

    // Warn
    spinner = new EnhancedSpinner({ text: "Loading..." });
    spinner.start();
    await sleep(800);
    spinner.warn("Task completed with warnings");

    // Info
    spinner = new EnhancedSpinner({ text: "Loading..." });
    spinner.start();
    await sleep(800);
    spinner.info("Task info");
}

async function demoInputBox(): Promise<void> {
    console.log("\n=== Input Box Demo ===\n");
    console.log("Showing input box with simulated typing:\n");

    const inputBox = new InputBox({
        prompt: "🤖 TypeAgent > ",
    });

    // Draw empty input box
    inputBox.draw("");
    await sleep(1000);

    // Simulate typing
    await inputBox.simulateTyping("play shake it off by taylor swift", 60);
    await sleep(500);

    // Submit - clear and show formatted
    const submitted = inputBox.submit();
    inputBox.clear();
    process.stdout.write(inputBox.formatSubmittedInput(submitted) + "\n\n");

    await sleep(500);

    // Show spinner processing
    const spinner = new EnhancedSpinner({ text: "Searching music library..." });
    spinner.start();
    await sleep(1000);
    spinner.writeAbove(
        `${ANSI.green}✓${ANSI.reset} Found "Shake It Off" by Taylor Swift`,
    );
    spinner.updateText("Loading track...");
    await sleep(800);
    spinner.succeed("Now playing!");

    await sleep(500);

    // Show fresh input box
    console.log("");
    inputBox.draw("");
    await sleep(1000);
    inputBox.clear();
}

async function demoInteractiveSession(): Promise<void> {
    console.log("\n=== Interactive Session Demo ===\n");
    console.log("Full Claude Code-like interaction flow:\n");

    const session = new InteractiveSession({
        prompt: "🤖 TypeAgent > ",
        text: "thinking...",
    });

    // Show initial input box
    session.showInputBox();
    await sleep(800);

    // First interaction
    await session.simulateTyping("what's on my calendar today?", 50);
    await sleep(400);

    session.submitAndProcess("Checking calendar...");
    await sleep(800);

    session.addOutput(
        `${ANSI.dim}Fetching events from Google Calendar...${ANSI.reset}`,
    );
    await sleep(600);
    session.addOutput(`${ANSI.green}✓${ANSI.reset} Found 3 events for today`);
    await sleep(400);

    session.completeAndRefresh("Calendar loaded", "success");
    await sleep(1000);

    // Second interaction
    await session.simulateTyping("play something relaxing", 50);
    await sleep(400);

    session.submitAndProcess("Finding relaxing music...");
    await sleep(600);

    session.addOutput(
        `${ANSI.dim}Searching Spotify for relaxing tracks...${ANSI.reset}`,
    );
    await sleep(500);
    session.addOutput(
        `${ANSI.green}✓${ANSI.reset} Selected: "Clair de Lune" by Debussy`,
    );
    await sleep(400);

    session.completeAndRefresh("Now playing", "success");
    await sleep(1000);

    // Third interaction - shows error
    await session.simulateTyping("send email to boss", 50);
    await sleep(400);

    session.submitAndProcess("Composing email...");
    await sleep(800);

    session.addOutput(
        `${ANSI.yellow}⚠${ANSI.reset} Email agent not configured`,
    );
    await sleep(400);

    session.completeAndRefresh("No email agent available", "warn");
    await sleep(500);

    // Clear the final input box
    session.getInputBox().clear();
}

async function demoMultipleInputs(): Promise<void> {
    console.log("\n=== Multiple Input Submissions Demo ===\n");
    console.log("Watch inputs stack up with responses:\n");

    const layout = new TerminalLayout();
    const spinner = new EnhancedSpinner();
    const inputBox = new InputBox({ prompt: "> " });

    const interactions = [
        { input: "hello", response: "Hi there! How can I help?" },
        { input: "what time is it?", response: "It's 3:45 PM" },
        { input: "thanks!", response: "You're welcome! 😊" },
    ];

    for (const { input, response } of interactions) {
        // Show input box
        inputBox.draw("");
        await sleep(300);

        // Type input
        await inputBox.simulateTyping(input, 40);
        await sleep(300);

        // Submit
        const submitted = inputBox.submit();
        inputBox.clear();

        // Show submitted input with separator
        layout.drawSeparator();
        process.stdout.write(`${ANSI.bold}You:${ANSI.reset} ${submitted}\n`);
        layout.drawSeparator();

        // Process with spinner
        spinner.start({ text: "..." });
        await sleep(600);

        // Show response above spinner
        spinner.writeAbove(`${ANSI.cyan}Assistant:${ANSI.reset} ${response}`);
        await sleep(300);
        spinner.stop();

        console.log("");
    }
}

async function demoEmojiPrompts(): Promise<void> {
    console.log("\n=== Variable-Width Emoji Prompts Demo ===\n");
    console.log("Different agent emojis with proper width handling:\n");

    // Various emoji prompts like TypeAgent uses
    const agentPrompts = [
        { emoji: "🤖", name: "TypeAgent", command: "help" },
        { emoji: "🎵", name: "Player", command: "play jazz" },
        { emoji: "📅", name: "Calendar", command: "show today" },
        { emoji: "☁️", name: "Weather", command: "forecast seattle" },
        { emoji: "📧", name: "Email", command: "inbox" },
        { emoji: "🔍", name: "Search", command: "find documents" },
        { emoji: "🏠", name: "Home", command: "lights on" },
        { emoji: "👨‍💻", name: "Code", command: "run tests" }, // Compound emoji (ZWJ sequence)
    ];

    for (const { emoji, name, command } of agentPrompts) {
        const prompt = `${emoji} ${name} > `;
        const width = getDisplayWidth(prompt);

        console.log(`Prompt: "${prompt}" (display width: ${width})`);

        const inputBox = new InputBox({ prompt });
        inputBox.draw("");
        await sleep(200);

        await inputBox.simulateTyping(command, 30);
        await sleep(300);

        inputBox.clear();
        console.log(`  → Executed: ${command}\n`);
    }
}

async function demoDynamicPromptChange(): Promise<void> {
    console.log("\n=== Dynamic Agent Switching Demo ===\n");
    console.log("Prompt changes as different agents are activated:\n");

    const inputBox = new InputBox({ prompt: "🤖 TypeAgent > " });

    // Show initial prompt
    inputBox.draw("");
    await sleep(500);

    // Type a command
    await inputBox.simulateTyping("play some music", 40);
    await sleep(300);

    // Submit
    const command = inputBox.submit();
    inputBox.clear();
    console.log(`${ANSI.dim}> ${command}${ANSI.reset}\n`);

    // Spinner while routing
    const spinner = new EnhancedSpinner({ text: "Routing to player agent..." });
    spinner.start();
    await sleep(800);
    spinner.succeed("Routed to Player");

    await sleep(300);

    // Change prompt to player agent
    inputBox.setPrompt("🎵 Player > ");
    inputBox.draw("");
    await sleep(500);

    await inputBox.simulateTyping("shuffle playlist", 40);
    await sleep(300);

    inputBox.submit();
    inputBox.clear();
    console.log(`${ANSI.dim}> shuffle playlist${ANSI.reset}\n`);

    // Process
    spinner.start({ text: "Shuffling..." });
    await sleep(600);
    spinner.succeed("Playlist shuffled!");

    await sleep(300);

    // Switch to calendar
    inputBox.setPrompt("📅 Calendar > ");
    inputBox.draw("");
    await sleep(500);

    await inputBox.simulateTyping("next meeting", 40);
    await sleep(300);

    inputBox.clear();
    console.log("");
}

async function demoCompletionMenu(): Promise<void> {
    console.log("\n=== Completion Menu Demo ===\n");
    console.log("Trigger-based autocompletion with @ and / characters:\n");

    // Define completion items for @ (agents/mentions)
    const agentItems: CompletionItem[] = [
        {
            value: "player",
            label: "player",
            description: "Music playback",
            icon: "🎵",
        },
        {
            value: "calendar",
            label: "calendar",
            description: "Schedule management",
            icon: "📅",
        },
        {
            value: "weather",
            label: "weather",
            description: "Weather forecasts",
            icon: "☁️",
        },
        {
            value: "email",
            label: "email",
            description: "Email handling",
            icon: "📧",
        },
        {
            value: "browser",
            label: "browser",
            description: "Web browsing",
            icon: "🌐",
        },
        {
            value: "code",
            label: "code",
            description: "Code assistance",
            icon: "👨‍💻",
        },
        {
            value: "home",
            label: "home",
            description: "Smart home control",
            icon: "🏠",
        },
        {
            value: "search",
            label: "search",
            description: "Web search",
            icon: "🔍",
        },
    ];

    // Define completion items for / (slash commands)
    const slashCommands: CompletionItem[] = [
        {
            value: "help",
            label: "help",
            description: "Show available commands",
        },
        { value: "clear", label: "clear", description: "Clear the screen" },
        {
            value: "history",
            label: "history",
            description: "Show command history",
        },
        { value: "settings", label: "settings", description: "Open settings" },
        { value: "agents", label: "agents", description: "List active agents" },
        { value: "status", label: "status", description: "Show system status" },
        { value: "debug", label: "debug", description: "Toggle debug mode" },
        { value: "quit", label: "quit", description: "Exit the application" },
    ];

    const inputBox = new InputBoxWithCompletion({
        prompt: "🤖 TypeAgent > ",
    });

    // Register triggers
    inputBox.registerTrigger({
        char: "@",
        items: agentItems,
        header: "Select an agent",
    });

    inputBox.registerTrigger({
        char: "/",
        items: slashCommands,
        header: "Commands",
    });

    // Demo 1: @ trigger for agents
    console.log("Demo 1: Type @ to see agent completions\n");
    inputBox.draw("");
    await sleep(500);

    // Simulate typing @
    await inputBox.simulateTypingWithCompletion("@", 100);
    await sleep(1500);

    // Simulate typing filter text
    await inputBox.simulateTypingWithCompletion("@pl", 100);
    await sleep(1000);

    // Navigate down
    inputBox.completionNext();
    await sleep(500);

    // Confirm selection
    const selectedAgent = inputBox.confirmCompletion();
    inputBox.clear();
    console.log(`\n${ANSI.green}✓${ANSI.reset} Selected: ${selectedAgent}\n`);

    await sleep(1000);

    // Demo 2: / trigger for commands
    console.log("Demo 2: Type / to see command completions\n");
    inputBox.draw("");
    await sleep(500);

    // Simulate typing /
    await inputBox.simulateTypingWithCompletion("/", 100);
    await sleep(1500);

    // Filter by typing
    await inputBox.simulateTypingWithCompletion("/he", 100);
    await sleep(1000);

    // Navigate and select
    inputBox.completionNext();
    await sleep(300);
    inputBox.completionPrevious();
    await sleep(300);

    const selectedCommand = inputBox.confirmCompletion();
    inputBox.clear();
    console.log(`\n${ANSI.green}✓${ANSI.reset} Selected: ${selectedCommand}\n`);

    await sleep(500);

    // Demo 3: Filtering with multiple matches
    console.log("Demo 3: Type @c to filter multiple matches\n");
    inputBox.draw("");
    await sleep(500);

    await inputBox.simulateTypingWithCompletion("@c", 100);
    await sleep(1500);

    // Show navigation through filtered items
    inputBox.completionNext();
    await sleep(400);
    inputBox.completionNext();
    await sleep(400);

    const selectedFiltered = inputBox.confirmCompletion();
    inputBox.clear();
    console.log(
        `\n${ANSI.green}✓${ANSI.reset} Selected: ${selectedFiltered}\n`,
    );

    await sleep(500);

    // Demo 4: Cancel completion
    console.log("Demo 4: Cancel completion with Esc\n");
    inputBox.draw("");
    await sleep(500);

    await inputBox.simulateTypingWithCompletion("/set", 100);
    await sleep(1000);

    inputBox.cancelCompletion();
    inputBox.clear();
    console.log(`${ANSI.yellow}⚠${ANSI.reset} Completion cancelled\n`);
}

async function demoCompletionIntegration(): Promise<void> {
    console.log("\n=== Completion Integration Demo ===\n");
    console.log("Full interaction with completion selection:\n");

    const inputBox = new InputBoxWithCompletion({
        prompt: "🤖 > ",
    });

    // Register triggers
    inputBox.registerTrigger({
        char: "@",
        items: [
            {
                value: "player",
                label: "player",
                description: "Music",
                icon: "🎵",
            },
            {
                value: "calendar",
                label: "calendar",
                description: "Schedule",
                icon: "📅",
            },
            {
                value: "weather",
                label: "weather",
                description: "Forecast",
                icon: "☁️",
            },
        ],
        header: "Agents",
    });

    inputBox.registerTrigger({
        char: "/",
        items: [
            { value: "play", label: "play", description: "Play music" },
            { value: "pause", label: "pause", description: "Pause playback" },
            { value: "next", label: "next", description: "Next track" },
        ],
        header: "Player Commands",
    });

    // Simulate a full interaction
    inputBox.draw("");
    await sleep(500);

    // Type @player and select
    await inputBox.simulateTypingWithCompletion("@play", 60);
    await sleep(800);

    const agent = inputBox.confirmCompletion();
    if (agent) {
        // Update input with selection and continue typing
        inputBox.updateInputInPlace(agent + " ");
        await sleep(300);
    }

    // Continue typing after selection
    inputBox.updateInputInPlace("@player shuffle my favorites");
    await sleep(800);

    // Submit
    const submitted = inputBox.submit();
    inputBox.clear();

    console.log(`\n${ANSI.bold}Submitted:${ANSI.reset} ${submitted}\n`);

    // Process with spinner
    const spinner = new EnhancedSpinner({ text: "Processing request..." });
    spinner.start();
    await sleep(1000);
    spinner.writeAbove(`${ANSI.green}✓${ANSI.reset} Routed to @player agent`);
    await sleep(500);
    spinner.writeAbove(
        `${ANSI.green}✓${ANSI.reset} Found "My Favorites" playlist`,
    );
    await sleep(500);
    spinner.succeed("Shuffling playlist!");

    await sleep(500);
}

async function main(): Promise<void> {
    console.log("╔═══════════════════════════════════════════╗");
    console.log("║     Terminal UI Demo for TypeAgent        ║");
    console.log("╚═══════════════════════════════════════════╝");

    await demoBasicSpinner();
    await demoSpinnerOutcomes();
    await demoSpinnerStyles();
    await demoOutputAboveSpinner();
    await demoStreamingOutput();
    await demoProgress();
    await demoWithSpinner();
    await demoInputBox();
    await demoInteractiveSession();
    await demoMultipleInputs();
    await demoEmojiPrompts();
    await demoDynamicPromptChange();
    await demoCompletionMenu();
    await demoCompletionIntegration();
    await demoLayout();

    console.log("\n✅ All demos completed!\n");
}

main().catch(console.error);
