import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { stopCopilotClient } from "@typeagent/aiclient";
import { loadRuntimeConfigSync } from "@typeagent/config";
import { createVariantDecisionClient, median } from "./decision.mjs";

const team = {
    type: "choice",
    instructions:
        "Which team should handle this customer support request? Select exactly one team based on the primary problem.",
    criteria: {
        billing: "Charges, invoices, refunds, or subscription payments",
        technical: "Software errors, bugs, or integration failures",
        account: "Sign-in, password, or account-access problems",
    },
};
const severity = {
    type: "score",
    instructions: "How severe is this issue?",
    criteria: ["Cosmetic", "Minor", "Major", "Critical"],
};
const samples = [
    ...[
        ["I was charged twice.", "billing"],
        ["The integration crashes during checkout.", "technical"],
        ["I cannot sign in after resetting my password.", "account"],
    ].map(([state, expected]) => ({
        group: "support",
        state,
        questions: { team },
        expected,
    })),
    {
        group: "noul",
        state: "I refunded your $200. You don't need to contact billing.",
        questions: {
            promises_refund: {
                type: "noul",
                instructions: "Does this reply promise the customer a refund?",
                criteria: {
                    true: "Commits to returning money",
                    false: "Makes no commitment about money",
                },
            },
        },
    },
    {
        group: "score",
        state: "Checkout is down for all EU customers since 09:00.",
        questions: { severity },
    },
    {
        group: "combined",
        state: {
            message: "Checkout is down again. This is my third request.",
            customer_contact_count: 3,
        },
        questions: {
            team,
            severity,
            repeat_contact: {
                type: "noul",
                instructions: "Has the customer contacted support before?",
            },
        },
    },
    {
        group: "typeagent",
        state: "Play my jazz playlist.",
        questions: {
            agent: {
                type: "choice",
                instructions:
                    "Which application agent should handle the request?",
                criteria: {
                    player: "Play music and manage playback or playlists",
                    calendar: "Manage calendar events and scheduling",
                    list: "Manage lists and list items",
                    unknown: "Unsupported, ambiguous, or multi-agent request",
                },
            },
        },
    },
];

async function main() {
    const { values } = parseArgs({
        options: {
            provider: { type: "string", default: "copilot" },
            "config-key": { type: "string", default: "decision_1" },
            model: { type: "string" },
            "cli-path": { type: "string" },
            region: { type: "string" },
            sample: { type: "string", default: "all" },
            repeat: { type: "string", default: "1" },
            "dry-run": { type: "boolean", default: false },
            jsonl: { type: "boolean", default: false },
            help: { type: "boolean", default: false },
        },
    });
    const indent = values.jsonl ? undefined : 2;
    if (values.help) {
        console.log(
            "Options: --provider copilot|azure --model <model ID or Azure deployment name> --cli-path <Copilot executable> --config-key decision_1 --region <Azure region> --sample all|support|noul|score|combined|typeagent --repeat <count> --dry-run --jsonl",
        );
        return;
    }
    if (!["copilot", "azure"].includes(values.provider)) {
        throw new Error("--provider must be copilot or azure.");
    }
    if (values.provider === "copilot" && values.region) {
        throw new Error("--region applies only to the Azure provider.");
    }
    if (values.provider === "azure" && values["cli-path"]) {
        throw new Error("--cli-path applies only to the Copilot provider.");
    }
    const repeat = Number(values.repeat);
    if (!Number.isSafeInteger(repeat) || repeat < 1 || repeat > 100) {
        throw new Error("--repeat must be an integer from 1 to 100.");
    }
    const selected = samples.filter(
        (sample) => values.sample === "all" || sample.group === values.sample,
    );
    if (!selected.length) throw new Error("Unknown --sample; use --help.");
    const { config } = loadRuntimeConfigSync({
        workspaceRoot: fileURLToPath(new URL("../../", import.meta.url)),
        populateProcessEnv: false,
    });
    const model =
        values.model ??
        (values.provider === "copilot"
            ? "gpt-6-luna-decisions"
            : process.env.AZURE_DECISION_DEPLOYMENT);
    const client = createVariantDecisionClient(config, { ...values, model });
    console.log(
        JSON.stringify(
            {
                provider: values.provider,
                model,
                configKey:
                    values.provider === "azure"
                        ? values["config-key"]
                        : undefined,
                endpoints: client.endpoints,
            },
            null,
            indent,
        ),
    );
    if (values["dry-run"]) {
        console.log(JSON.stringify(selected, null, indent));
        return;
    }
    const latencies = [];
    let correct = 0;
    let labeled = 0;
    for (let iteration = 0; iteration < repeat; iteration++) {
        for (const sample of selected) {
            const start = performance.now();
            const response = await client.decide(
                sample.state,
                sample.questions,
            );
            const latencyMs = performance.now() - start;
            latencies.push(latencyMs);
            if (sample.expected) {
                labeled++;
                correct += Number(
                    response.answers.team.choice === sample.expected,
                );
            }
            console.log(
                JSON.stringify(
                    {
                        sample: sample.group,
                        iteration: iteration + 1,
                        expected: sample.expected,
                        latencyMs: Math.round(latencyMs),
                        response,
                    },
                    null,
                    indent,
                ),
            );
        }
    }
    console.log(
        JSON.stringify(
            {
                requests: latencies.length,
                medianLatencyMs: Math.round(median(latencies)),
                supportAccuracy: labeled ? correct / labeled : undefined,
            },
            null,
            indent,
        ),
    );
}

main()
    .catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    })
    .finally(() => stopCopilotClient());
