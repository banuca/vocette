#!/usr/bin/env node
/**
 * Proves the on-device engine works in the packaged app on this machine: the
 * built Electron binary loads the shipped sherpa-onnx addon and transcribes
 * two public test recordings with the published model.
 *
 * check-native-packaging.mjs only proves the files are there; this proves
 * they load and decode, which on macOS and Linux nothing else does before a
 * tester's first dictation.
 *
 * Run after `electron-builder`:
 *   node scripts/engine-smoke.mjs [dist]
 * The model and recordings are downloaded into VOCETTE_SMOKE_DIR (default
 * .smoke) and checked against their SHA-256; files already there and correct
 * are reused, so CI can cache the folder.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { arch, argv, env, exit, platform } from "node:process";

const DIST = argv[2] ?? "dist";
const WORK = resolve(env.VOCETTE_SMOKE_DIR ?? ".smoke");

/**
 * The model files, read from the app's own manifest so this check can never
 * test a different model from the one the app downloads.
 */
function manifestFiles() {
  const source = readFileSync(
    new URL("../src/main/engine/models.ts", import.meta.url),
    "utf8",
  );
  const base = /BASE_URL =\s*'([^']+)'/u.exec(source)?.[1];
  const names = Object.fromEntries(
    [...source.matchAll(/(\w+): '([\w.]+\.(?:onnx|txt))'/gu)].map((m) => [
      m[1],
      m[2],
    ]),
  );
  const entries = [
    ...source.matchAll(
      /name: PARAKEET_FILES\.(\w+),[\s\S]*?bytes: ([\d_]+),\s*sha256: '([0-9a-f]{64})'/gu,
    ),
  ];
  const files = entries.map((m) => ({
    name: names[m[1]],
    url: `${base}${names[m[1]]}`,
    bytes: Number(m[2].replaceAll("_", "")),
    sha256: m[3],
  }));
  if (!base || files.length !== 4 || files.some((f) => !f.name)) {
    throw new Error(
      "Could not read the model manifest from src/main/engine/models.ts",
    );
  }
  return files;
}

/**
 * sherpa-onnx's own test recordings, from the model export the q8 model was
 * built from (pinned commit; the LFS id is the file's SHA-256). Never the
 * owner's recordings.
 */
const HF =
  "https://huggingface.co/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3/resolve/1a468a35cbba69418f126de829e75261dea4a4e4/test_wavs/";
const RECORDINGS = [
  {
    name: "en.wav",
    sha256: "148b936b43ce7c546a866e64da059f0458aee2d65e617f16e9d94f06e8d99ed6",
    bytes: 184_608,
    expect: [
      "ask not what your country can do for you",
      "what you can do for your country",
    ],
  },
  {
    name: "de.wav",
    sha256: "36d3c4845b9808a1656a2a2e92d884590e2db94389e6fe559643291ae0cd3710",
    bytes: 121_388,
    expect: ["alles hat ein ende", "wurst hat zwei"],
  },
].map((r) => ({ ...r, url: `${HF}${r.name}` }));

async function sha256Of(path) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}

async function fetchVerified(dir, { name, url, bytes, sha256 }) {
  const path = join(dir, name);
  if (
    existsSync(path) &&
    statSync(path).size === bytes &&
    (await sha256Of(path)) === sha256
  ) {
    console.log(`have  ${name}`);
    return path;
  }
  console.log(`fetch ${name} (${Math.round(bytes / 1e6)} MB)`);
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok || !response.body)
    throw new Error(`${name}: HTTP ${response.status}`);
  const part = `${path}.part`;
  await pipeline(Readable.fromWeb(response.body), createWriteStream(part));
  const got = await sha256Of(part);
  if (got !== sha256)
    throw new Error(`${name}: SHA-256 ${got}, expected ${sha256}`);
  renameSync(part, path);
  return path;
}

/** The packaged executable and its resources folder, for this machine's architecture. */
function packagedApp() {
  if (platform === "darwin") {
    const folder = join(DIST, arch === "arm64" ? "mac-arm64" : "mac");
    const bundle =
      existsSync(folder) &&
      readdirSync(folder).find((entry) => entry.endsWith(".app"));
    if (!bundle) return null;
    const contents = join(folder, bundle, "Contents");
    const binary = readdirSync(join(contents, "MacOS"))[0];
    return {
      exe: join(contents, "MacOS", binary),
      resources: join(contents, "Resources"),
    };
  }
  const folder = join(
    DIST,
    `${platform === "win32" ? "win" : "linux"}${arch === "x64" ? "" : `-${arch}`}-unpacked`,
  );
  if (!existsSync(folder)) return null;
  const exe = readdirSync(folder).find((entry) =>
    platform === "win32"
      ? entry.endsWith(".exe") && !/^(Uninstall|elevate)/iu.test(entry)
      : entry === "murmur",
  );
  return exe
    ? { exe: join(folder, exe), resources: join(folder, "resources") }
    : null;
}

const app = packagedApp();
if (!app) {
  console.error(
    `FAIL  no packaged app for ${platform}-${arch} under ${DIST}. Run electron-builder first.`,
  );
  exit(1);
}

const modelDir = join(WORK, "model");
const audioDir = join(WORK, "audio");
mkdirSync(modelDir, { recursive: true });
mkdirSync(audioDir, { recursive: true });
for (const file of manifestFiles()) await fetchVerified(modelDir, file);
const recordings = [];
for (const recording of RECORDINGS)
  recordings.push({
    ...recording,
    path: await fetchVerified(audioDir, recording),
  });

// The packaged binary, run as Node: the same Electron, the same shipped addon
// and ONNX Runtime the app's engine worker loads.
const run = spawnSync(
  app.exe,
  [
    resolve("scripts/engine-smoke-child.cjs"),
    resolve(app.resources),
    modelDir,
    ...recordings.map((r) => r.path),
  ],
  {
    env: { ...env, ELECTRON_RUN_AS_NODE: "1" },
    encoding: "utf8",
    timeout: 300_000,
  },
);
if (run.stderr) console.error(run.stderr.trim());
if (run.status !== 0) {
  console.error(
    `FAIL  the packaged app's engine exited with ${run.status ?? run.signal ?? run.error}`,
  );
  exit(1);
}

const results = JSON.parse(run.stdout.trim().split("\n").at(-1));
let failures = 0;
console.log(
  `ok    engine loaded in ${results.loadMs} ms (${platform}-${arch}, ${app.exe})`,
);
for (const recording of recordings) {
  const result = results.decoded.find((d) => d.name === recording.name);
  const text = result?.text ?? "";
  const missing = recording.expect.filter(
    (word) => !text.toLowerCase().includes(word.toLowerCase()),
  );
  if (missing.length) failures += 1;
  console.log(
    `${missing.length ? "FAIL" : "ok  "}  ${recording.name} ${result?.ms ?? "?"} ms: ${text}`,
  );
  if (missing.length) console.error(`      missing: ${missing.join(", ")}`);
}
console.log(
  failures === 0
    ? "The on-device engine works in the packaged app."
    : `${failures} problem(s).`,
);
exit(failures === 0 ? 0 : 1);
