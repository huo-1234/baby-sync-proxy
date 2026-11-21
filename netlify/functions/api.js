// Supabase 反向代理（Netlify Function，CommonJS 版本）
// 访问 /api/* 会被转发到 Supabase 项目
//
// 用 CommonJS 是因为仓库没有 package.json 的 type:module，
// 用 export default 会被 Node 当语法错误，函数会静默构建失败。

const https = require("https");
const zlib = require("zlib");

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

  // 转发原始请求头
  const headers = {};
  for (const [k, v] of Object.entries(event.headers || {})) {
    const key = k.toLowerCase();
    // host/connection 由 Node 自己处理；content-length 会因为后续处理而变化
    if (key === "host" || key === "connection" || key === "content-length") continue;
    // 关键：不转发 accept-encoding。
    // 若让 Supabase 返回 gzip，而我们又要去掉 content-encoding 头，
    // 客户端拿到的是压缩字节却没有解压标志，就会解析成乱码。
    // 数据库记录是文本，不压缩也没多少流量。
    if (key === "accept-encoding") continue;
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
          let buf = Buffer.concat(chunks);

          // 上游若返回压缩内容，先解压成明文。
          // 之后由 Netlify 边缘统一处理压缩，并会正确带上 content-encoding，
          // OkHttp 才能识别并解压。
          const enc = String(res.headers["content-encoding"] || "").toLowerCase();
          try {
            if (enc.includes("gzip") || (buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b)) {
              buf = zlib.gunzipSync(buf);
            } else if (enc.includes("deflate")) {
              buf = zlib.inflateSync(buf);
            } else if (enc.includes("br")) {
              buf = zlib.brotliDecompressSync(buf);
            }
          } catch (e) {
            // 解压失败就原样返回
          }

          const outHeaders = {};
          for (const [k, v] of Object.entries(res.headers)) {
            const lk = k.toLowerCase();
            // content-encoding/content-length 必须去掉：
            // 内容已被我们解压，长度也变了，留着会让客户端二次误解
            if (
              lk === "content-encoding" ||
              lk === "content-length" ||
              lk === "transfer-encoding" ||
              lk === "etag" ||
              lk === "last-modified"
            ) {
              continue;
            }
            outHeaders[k] = Array.isArray(v) ? v.join(", ") : v;
          }
          outHeaders["access-control-allow-origin"] = "*";
          outHeaders["cache-control"] = "no-store, no-cache, must-revalidate";

          // 判断是否二进制：图片/视频等才用 base64，
          // JSON 文本必须原样返回，否则 App 解析会得到乱码
          const ctype = String(res.headers["content-type"] || "");
          const isText =
            ctype.startsWith("application/json") ||
            ctype.startsWith("text/") ||
            ctype.includes("json") ||
            ctype === "";

          resolve({
            statusCode: res.statusCode || 500,
            headers: outHeaders,
            body: isText ? buf.toString("utf8") : buf.toString("base64"),
            isBase64Encoded: !isText,
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
