import {Hono} from "hono"

import sql from "./utils/sql"

const app = new Hono<{Bindings: {DB: D1Database; BUCKET: R2Bucket}}>()
const placeholder = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="6" fill="#334155"/>
  <g fill="none" stroke="white" stroke-width="2">
    <circle cx="16" cy="16" r="11"/>
    <ellipse cx="16" cy="16" rx="5" ry="11"/>
    <path d="M5 16h22"/>
  </g>
</svg>`

function _parseDomain(domain: string) {
  const hostname = URL.parse(`https://${domain}`)?.hostname.replace(/\.$/, "")
  if (!hostname) {
    return null
  }
  const isTooLong = hostname.length > 253
  const isTLD = !hostname.includes(".")
  const isIPv4 = /\.\d+$/.test(hostname)
  if (isTooLong || isTLD || isIPv4) {
    return null
  }
  const hasValidLabels = hostname
    .split(".")
    .every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
  if (!hasValidLabels) {
    return null
  }
  return hostname
}

app.get("/", (c) => c.text("favicon.aspiz.uk"))
app.get("/:domain", async (c) => {
  const hostname = _parseDomain(c.req.param("domain"))
  if (!hostname) {
    return c.text("Invalid domain", 400)
  }
  const favicon = await sql(c)`
    SELECT * FROM favicons WHERE hostname = ${hostname}
  `.first()
  if (!favicon) {
    const now = new Date()
    await sql(c)`
      INSERT INTO favicons (hostname, created_at, updated_at)
      VALUES (${hostname}, ${now}, ${now})
      ON CONFLICT (hostname) DO NOTHING
    `.run()
  }
  let object = await c.env.BUCKET.get(hostname)
  if (!object) {
    await c.env.BUCKET.put(hostname, placeholder, {
      onlyIf: new Headers({"If-None-Match": "*"}),
      httpMetadata: {contentType: "image/svg+xml"},
    })
    object = await c.env.BUCKET.get(hostname)
    if (!object) {
      return c.body(null, 503)
    }
  }
  const headers = new Headers()
  object.writeHttpMetadata(headers)
  headers.set("ETag", object.httpEtag)
  return new Response(object.body, {headers})
})

export default app
