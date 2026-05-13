/**
 * Debug hook — logs whatever input it receives to stderr.
 * Used to verify hooks are firing and inspect their input shape.
 */

async function main(): Promise<void> {
    let inputData = "";
    process.stdin.setEncoding("utf8");

    for await (const chunk of process.stdin) {
        inputData += chunk;
    }

    let input: unknown;
    try {
        input = JSON.parse(inputData);
    } catch {
        console.error("[hook-debug] Failed to parse input");
        console.log("{}");
        return;
    }

    const type = process.env.HOOK_TYPE ?? "unknown";
    console.error(`[hook-debug] type=${type} input=${JSON.stringify(input).substring(0, 500)}`);
    console.log("{}");
}

main().catch((error) => {
    console.error(`[hook-debug] error: ${error}`);
    console.log("{}");
});
