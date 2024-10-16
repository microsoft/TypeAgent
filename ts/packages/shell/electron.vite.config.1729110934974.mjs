// electron.vite.config.mts
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import { resolve } from "path";
var __electron_vite_injected_dirname = "C:\\repos\\TypeAgent\\ts\\packages\\shell";
var electron_vite_config_default = defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      sourcemap: true
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      sourcemap: true,
      rollupOptions: {
        input: {
          index: resolve(__electron_vite_injected_dirname, "src/preload/index.ts"),
          webview: resolve(__electron_vite_injected_dirname, "src/preload/webView.ts")
        }
      }
    }
  },
  renderer: {
    build: {
      sourcemap: true
    }
  }
});
export {
  electron_vite_config_default as default
};
