import {Hono} from "hono"

const app = new Hono<{Bindings: {DB: D1Database; BUCKET: R2Bucket}}>()

app.get("/", (c) => c.text("favicon.aspiz.uk"))

export default app
