// Supabase 反向代理（Netlify Function，CommonJS 版本）
// 访问 /api/* 会被转发到 Supabase 项目
//
// 用 CommonJS 是因为仓库没有 package.json 的 type:module，
// 用 export default 会被 Node 当语法错误，函数会静默构建失败。

const https = require("https");

const SUPABASE_HOST = "hggrufjzjdbwcrnejagz.supabase.co";

exports.handler = async (event) => {
  // event.path 形如 /api/rest/v1/feed
  let path = event.path || "/";
  if (path.startsWith("/.netlify/functions/api")) {
    path = path.replace("/.netlify/functions/api", "");
  }
  path = path.replace(/^\/api/, "");
  if (!path.startsWith("/")) path = "/" + path;

  const qs = event.rawQuery ? "?" + event.rawQuery : "";
  const targetPath = path + qs;

  // 转发原始请求头，剔除会干扰的
  const headers = {};
  for (const [k, v] of Object.entries(event.headers || {})) {
    const key = k.toLowerCase();
    if (key === "host" || key === "connection" || key === "content-length") continue;
    headers[k] = v;
  }
  headers["host"] = SUPABASE_HOST;

  const body =
    event.body && event.isBase64Encoded
      ? Buffer.from(event.body, "base64")
      : event.body || undefined;

  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: SUPABASE_HOST,
        port: 443,
        path: targetPath,
        method: event.httpMethod || "GET",
        headers: headers,
        timeout: 25000,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const buf = Buffer.concat(chunks);
          const outHeaders = {};
          for (const [k, v] of Object.entries(res.headers)) {
            if (["content-encoding", "content-length", "transfer-encoding"].includes(k)) continue;
            outHeaders[k] = Array.isArray(v) ? v.join(", ") : v;
          }
          outHeaders["access-control-allow-origin"] = "*";
          resolve({
            statusCode: res.statusCode || 500,
            headers: outHeaders,
            body: buf.toString("base64"),
            isBase64Encoded: true,
          });
        });
      }
    );

    req.on("timeout", () => {
      req.destroy();
      resolve({
        statusCode: 504,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "proxy_timeout" }),
      });
    });

    req.on("error", (e) => {
      resolve({
        statusCode: 502,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "proxy_failed", detail: String(e) }),
      });
    });

    if (body) req.write(body);
    req.end();
  });
};
