// Packages the iBrawls desktop app into a distributable folder using
// @electron/packager. Unlike electron-builder's installer targets, this does NOT
// invoke the Windows code-signing toolkit (winCodeSign), which fails to extract
// without Developer Mode / admin rights. The output is a plain folder containing
// iBrawls.exe + resources — zip it and friends unzip & double-click to play.
//
// Run after `npm run build:client` (the npm script chains them for you).

import { packager } from "@electron/packager";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Platform/arch come from CLI flags so the same script can target win/mac/linux:
//   node scripts/pack-desktop.mjs --platform=darwin --arch=arm64,x64
// Defaults to the host platform (Windows x64 for this repo's primary dev box).
function flag(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}
const platform = flag("platform", "win32");
const arch = flag("arch", "x64").split(",").map((a) => a.trim()).filter(Boolean);

// Only the Electron entry + built client need to ship. Everything below is
// source/tooling/data that bloats the package and isn't read at runtime.
const ignore = [
  // main.cjs uses only Node built-ins + the Electron runtime, so the app needs
  // no node_modules shipped. Dropping it saves hundreds of MB.
  /^\/node_modules($|\/)/,
  /^\/src($|\/)/,
  /^\/worker($|\/)/,
  /^\/python($|\/)/,
  /^\/analysis($|\/)/,
  /^\/scripts($|\/)/,
  /^\/docs($|\/)/,
  /^\/data($|\/)/,
  /^\/public($|\/)/, // already copied into dist/ by the Vite build
  /^\/release($|\/)/,
  /^\/runs($|\/)/, // RL trainer artifacts
  /^\/output($|\/)/,
  /^\/coverage($|\/)/,
  /^\/\.git($|\/)/,
  /^\/\.worktrees($|\/)/,
  /^\/\.claude($|\/)/,
  /^\/\.codegraph($|\/)/,
  /^\/EXAMPLE FILES($|\/)/,
  /\.test\./,
  /\.(obj|mp4|log)$/,
];

const appPaths = await packager({
  dir: projectRoot,
  name: "iBrawls",
  platform,
  arch,
  out: path.join(projectRoot, "release"),
  overwrite: true,
  prune: true,
  ignore,
});

for (const p of appPaths) {
  console.log(`Packaged: ${p}`);
}
