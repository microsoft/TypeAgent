import { defineConfig } from "vite";
import typescript from "@rollup/plugin-typescript";
import { resolve } from "path";

export default defineConfig({
    plugins: [
        typescript({
            tsconfig: "./src/client/tsconfig.json",
        }),
    ],
    build: {
        outDir: "dist/public",
        sourcemap: true,
        rollupOptions: {
            input: {
                main: resolve(__dirname, "src/client/app.ts"),
            },
            output: {
                entryFileNames: "js/[name].js",
            },
        },
    },
    logLevel: "error",
    server: {
        proxy: {
            // Forward API requests to your Express server
            "/api": {
                target: "http://localhost:9015",
                changeOrigin: true,
            },
        },
    },
});
