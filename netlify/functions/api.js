// Supabase 反向代理（Netlify Function v2）
// 访问 /api/* 会被转发到 Supabase 项目

const SUPABASE_HOST = "hggrufjzjdbwcrnejagz.supabase.co";

export default async (request) => {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api/, "") || "/";
  const target = `https://${SUPABASE_HOST}${path}${url.search}`;

  const headers = new Headers();
  for (const [k, v] of request.headers) {
    const key = k.toLowerCase();
    if (key === "host" || key === "connection" || key === "content-length") continue;
    headers.set(k, v);
  }

  const init = { method: request.method, headers, redirect: "follow" };
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = await request.arrayBuffer();
  }

  let resp;
  try {
    resp = await fetch(target, init);
  } catch (e) {
    return new Response(
      JSON.stringify({ message: "proxy_failed", detail: String(e) }),
      { status: 502, headers: { "content-type": "application/json" } }
    );
  }

  const outHeaders = new Headers();
  for (const [k, v] of resp.headers) {
    const key = k.toLowerCase();
    if (key === "content-encoding" || key === "content-length" || key === "transfer-encoding") continue;
    outHeaders.set(k, v);
  }
  outHeaders.set("access-control-allow-origin", "*");

  return new Response(resp.body, {
    status: resp.status,
    statusText: resp.statusText,
    headers: outHeaders,
  });
};

export const config = { path: "/api/*" };
