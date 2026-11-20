import {bindings, defineConfig} from "cf/config"

export default defineConfig({
  worker: {
    name: "favicon",
    compatibilityDate: "2026-11-09",
    entrypoint: "./src/index.ts",
    domains: ["favicon.aspiz.uk"],
    env: {
      DB: bindings.d1({name: "favicon", id: "897e5f9a-b788-40e9-900c-ab8a77fda573"}),
      BUCKET: bindings.r2({name: "favicon"}),
    },
  },
})
