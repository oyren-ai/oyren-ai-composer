// Tiny shared helpers for the /agent/* HTTP edges (message, stream, control). The SESSION_TOKEN gate
// mirrors the /terminal WS: every agent endpoint carries ?token=<SESSION_TOKEN> and 401s without it.
const { SESSION_TOKEN } = require("./config")

function json(res, status, body, { allowCors = false } = {}) {
  if (res.headersSent) return
  const headers = { "content-type": "application/json" }
  if (allowCors) {
    headers["Access-Control-Allow-Origin"] = "*"
    headers["Access-Control-Allow-Methods"] = "GET, OPTIONS"
    headers["Access-Control-Allow-Headers"] = "Content-Type"
  }
  res.writeHead(status, headers)
  res.end(JSON.stringify(body))
}

/** Handle CORS preflight OPTIONS request. */
function handleCorsOptions(res) {
  res.writeHead(204, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  })
  res.end()
}

function tokenOk(reqUrl) {
  try {
    const token = new URL(reqUrl, "http://localhost").searchParams.get("token")
    return !!SESSION_TOKEN && token === SESSION_TOKEN
  } catch {
    return false
  }
}

/** Read the full request body into a Buffer (POST bodies are small: one stream-json line). */
function readBody(req) {
  return new Promise((resolve) => {
    const chunks = []
    req.on("data", (c) => chunks.push(c))
    req.on("error", () => resolve(Buffer.alloc(0)))
    req.on("end", () => resolve(Buffer.concat(chunks)))
  })
}

module.exports = { json, tokenOk, readBody, handleCorsOptions }
