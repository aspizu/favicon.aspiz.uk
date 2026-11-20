import {mkdir, writeFile} from "node:fs/promises"
import {join} from "node:path"

import {
  cleanBuildOutputDir,
  getWorkerBundleDir,
  writeRootConfig,
  writeWorkerConfig,
} from "@cloudflare/build-output-utils"
import {build} from "esbuild"
import {Miniflare} from "miniflare"

import config from "../cloudflare.config.ts"

const {worker} = config
const {entrypoint, ...workerConfig} = worker
const root = process.cwd()
const {outputFiles} = await build({
  entryPoints: [entrypoint],
  bundle: true,
  format: "esm",
  target: "esnext",
  conditions: ["workerd", "worker"],
  write: false,
})
const [bundle] = outputFiles

if (process.argv.includes("--dev")) {
  const runtime = new Miniflare({
    workers: [
      {
        config: {
          ...workerConfig,
          manifest: {
            mainModule: "index.js",
            modules: {"index.js": {type: "esm", contents: bundle.text}},
          },
        },
      },
    ],
    host: "127.0.0.1",
    port: 8787,
  })
  console.log(`Worker listening on ${(await runtime.ready).href}`)
} else {
  await cleanBuildOutputDir(root)
  const directory = getWorkerBundleDir(root)
  await mkdir(directory, {recursive: true})
  await writeFile(join(directory, "index.js"), bundle.contents)
  await writeWorkerConfig({
    root,
    config: worker,
    manifest: {type: "partial", mainModule: "index.js", modules: {}},
  })
  await writeRootConfig(root, undefined, {mode: "production", isPreview: false})
}
