import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const mainDir = path.join(distDir, "main");
const rendererDir = path.join(distDir, "renderer");

await fs.rm(distDir, { recursive: true, force: true });
await fs.mkdir(mainDir, { recursive: true });
await fs.mkdir(rendererDir, { recursive: true });

await build({
  entryPoints: {
    main: path.join(rootDir, "src/main/main.ts"),
    preload: path.join(rootDir, "src/main/preload.ts")
  },
  outdir: mainDir,
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  sourcemap: true,
  external: ["electron"]
});

await fs.copyFile(
  path.join(rootDir, "src/renderer/index.html"),
  path.join(rendererDir, "index.html")
);
await fs.copyFile(
  path.join(rootDir, "src/renderer/styles.css"),
  path.join(rendererDir, "styles.css")
);
await fs.copyFile(
  path.join(rootDir, "src/renderer/app.js"),
  path.join(rendererDir, "app.js")
);
