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

app.get("/", (c) => c.text("favicon.aspiz.uk"))
app.get("/:domain", async (c) => {
  const hostname = c.req.param("domain")
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
  const key = hostname.toLowerCase()
  let object = await c.env.BUCKET.get(key)
  if (!object) {
    await c.env.BUCKET.put(key, placeholder, {
      onlyIf: new Headers({"If-None-Match": "*"}),
      httpMetadata: {contentType: "image/svg+xml"},
    })
    object = await c.env.BUCKET.get(key)
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
