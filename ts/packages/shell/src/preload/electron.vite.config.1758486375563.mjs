// electron.vite.preload-cjs.config.mts
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import { resolve } from "path";
var __electron_vite_injected_dirname = "C:\\repos\\TypeAgent\\ts\\packages\\shell";
var electron_vite_preload_cjs_config_default = defineConfig({
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      sourcemap: true,
      rollupOptions: {
        input: {
          webview: resolve(__electron_vite_injected_dirname, "./src/preload/webView.ts")
        },
        output: {
          // For the CJS preload
          format: "cjs",
          entryFileNames: "[name].cjs",
          dir: "out/preload-cjs",
          preserveModules: true
          // Ensure each module is preserved in the output
        }
      }
    }
  }
});
export {
  electron_vite_preload_cjs_config_default as default
};
