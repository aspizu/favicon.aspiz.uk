import * as cheerio from "cheerio/slim"
import {Hono} from "hono"

import sql from "./utils/sql"

const app = new Hono<{Bindings: {DB: D1Database; BUCKET: R2Bucket}}>()

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

async function _fetchFaviconURL(hostname: string) {
  const homepageURL = `https://${hostname}/`
  try {
    const homepage = await fetch(homepageURL, {
      headers: {
        Accept: "text/html",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      },
      signal: AbortSignal.timeout(5000),
    })
    if (homepage.ok) {
      const $ = cheerio.load(await homepage.text())
      const pageURL = homepage.url || homepageURL
      const baseHref = $("base[href]").first().attr("href") ?? ""
      const baseURL = URL.parse(baseHref, pageURL) ?? pageURL
      for (const link of $('link[rel~="icon" i][href]')) {
        const href = link.attribs.href.trim()
        const iconURL = href && URL.parse(href, baseURL)
        if (iconURL) {
          return iconURL.href
        }
      }
    } else {
      await homepage.body?.cancel()
    }
  } catch (error) {
    console.warn("Failed to fetch homepage", hostname, error)
  }
  return `https://${hostname}/favicon.ico`
}

async function _fetchFavicon(hostname: string) {
  const url = await _fetchFaviconURL(hostname)
  try {
    const response = await fetch(url, {
      headers: {Accept: "image/*"},
      signal: AbortSignal.timeout(5000),
    })
    const contentType = response.headers
      .get("Content-Type")
      ?.split(";")[0]
      .trim()
      .toLowerCase()
    if (
      response.ok &&
      (!contentType ||
        contentType.startsWith("image/") ||
        contentType === "application/octet-stream")
    ) {
      const body = await response.arrayBuffer()
      if (body.byteLength) {
        return {body, contentType: contentType || "application/octet-stream"}
      }
    } else {
      await response.body?.cancel()
    }
  } catch (error) {
    console.warn("Failed to fetch favicon", hostname, error)
  }
  return null
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
  const object = await c.env.BUCKET.head(hostname)
  if (!object) {
    const icon = await _fetchFavicon(hostname)
    if (!icon) {
      const fallback = c.req.query("else")
      if (fallback) {
        return c.redirect(fallback, 302)
      }
      return c.text("Favicon not found", 404)
    }
    const stored = await c.env.BUCKET.put(hostname, icon.body, {
      onlyIf: new Headers({"If-None-Match": "*"}),
      httpMetadata: {contentType: icon.contentType},
    })
    const current = stored ?? (await c.env.BUCKET.head(hostname))
    if (!current) {
      return c.body(null, 503)
    }
  }
  return c.redirect(
    `https://files.favicon.aspiz.uk/${encodeURIComponent(hostname)}`,
    302,
  )
})

export default app
