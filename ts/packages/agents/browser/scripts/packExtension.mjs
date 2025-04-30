import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { findUp } from "find-up";
import ChromeExtension from "crx";
import { generateKeyPair } from "crypto";
import { promisify } from "util";
import archiver from "archiver";

// Get the directory name in ES module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const generateKeyPairAsync = promisify(generateKeyPair);

async function loadEnvFile() {
    const envPath = await findUp(".env");

    if (envPath) {
        const envConfig = dotenv.parse(fs.readFileSync(envPath));
        return { envConfig, envPath };
    }

    envPath = path.resolve(process.cwd(), ".env");
    return { envConfig: {}, envPath };
}

async function generatePrivateKey() {
    console.log("Generating new RSA private key...");

    const { privateKey } = await generateKeyPairAsync("rsa", {
        modulusLength: 2048,
        publicKeyEncoding: {
            type: "spki",
            format: "pem",
        },
        privateKeyEncoding: {
            type: "pkcs8",
            format: "pem",
        },
    });

    return privateKey;
}

function updateEnvFile(envPath, envConfig, privateKey) {
    const privateKeyBase64 = btoa(privateKey);
    envConfig.BROWSER_EXTENSION_PUBLISHING = privateKeyBase64;

    // Convert config object to .env format
    const envContent = Object.entries(envConfig)
        .map(([key, value]) => `${key}=${value}`)
        .join("\n");

    // Write the updated .env file
    fs.writeFileSync(envPath, envContent);
    console.log(`Private key saved to ${envPath}`);
}

function ensureDirectoryExists(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
        console.log(`Created directory: ${dirPath}`);
    }
}

function zipDirectory(sourceDir, outputPath) {
    return new Promise((resolve, reject) => {
        const output = fs.createWriteStream(outputPath);
        const archive = archiver("zip", {
            zlib: { level: 9 }, // Highest compression level
        });

        // Listen for all archive data to be written
        output.on("close", () => {
            console.log(`ZIP archive created: ${outputPath}`);
            console.log(`Total bytes: ${archive.pointer()}`);
            resolve();
        });

        archive.on("warning", (err) => {
            if (err.code === "ENOENT") {
                console.warn("Archive warning:", err);
            } else {
                reject(err);
            }
        });
        archive.on("error", (err) => {
            reject(err);
        });

        archive.pipe(output);
        archive.directory(sourceDir, false);
        archive.finalize();
    });
}

async function main() {
    try {
        const extensionPath = path.resolve(__dirname, "../dist/extension");
        const outputDir = path.resolve(__dirname, "../deploy");
        const crxPath = path.resolve(outputDir, "extension.crx");
        const zipPath = path.resolve(outputDir, "extension.zip");

        ensureDirectoryExists(outputDir);

        console.log("Creating ZIP file...");
        await zipDirectory(extensionPath, zipPath);

        console.log("Creating CRX file...");
        const { envConfig, envPath } = await loadEnvFile();

        let privateKey = null;

        if (envConfig.BROWSER_EXTENSION_PUBLISHING) {
            console.log("Using existing private key from .env file");
            privateKey = atob(envConfig.BROWSER_EXTENSION_PUBLISHING);
        } else {
            privateKey = await generatePrivateKey();
            updateEnvFile(envPath, envConfig, privateKey);
        }

        const crx = new ChromeExtension({
            privateKey: privateKey,
        });

        // Pack the extension
        const crxBuffer = await crx
            .load(extensionPath)
            .then((crx) => crx.pack());

        // Save the .crx file
        fs.writeFileSync(crxPath, crxBuffer);
        console.log(
            `Extension packed successfully! CRX file saved to: ${crxPath}`,
        );

        return { crxPath, success: true };
    } catch (error) {
        console.error("Error packaging extension:", error);
        return { success: false, error };
    }
}

main();
