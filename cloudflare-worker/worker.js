/**
 * TeraLace Cloudflare Worker - Self-Hostable TeraBox API Resolver
 * 
 * Free, private, and high-performance serverless reverse proxy for TeraBox links.
 * Works seamlessly with TeraLace's Dynamic Round-Robin Balancer & API Pool.
 *
 * Supported Query Formats:
 *   GET  /?url=<terabox_link>
 *   GET  /api/get-info?url=<terabox_link>
 *   POST /api/get-info  (JSON body: { "url": "<terabox_link>" })
 *   GET  /health
 */

export default {
  async fetch(request, env) {
    // 1. Handle CORS Preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    const url = new URL(request.url);

    // 2. Health Check Endpoint
    if (url.pathname === "/health" || (url.pathname === "/" && !url.searchParams.has("url"))) {
      return jsonResponse({
        ok: true,
        name: "TeraLace Cloudflare Resolver",
        status: "online",
        version: "1.0.0",
        message: "Self-hosted TeraLace API worker is active. Pass ?url=<terabox_share_url> to resolve files.",
        has_worker_cookie: !!env.TERABOX_COOKIE,
      });
    }

    // 3. Optional Authentication
    const requiredAuth = env.AUTH_TOKEN;
    if (requiredAuth) {
      const providedAuth = url.searchParams.get("authkey") || request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
      if (providedAuth !== requiredAuth) {
        return jsonResponse({ ok: false, status: "error", message: "Unauthorized: Invalid or missing authkey" }, 401);
      }
    }

    // 4. Extract Target TeraBox Share URL
    let targetUrl = url.searchParams.get("url");
    if (!targetUrl && request.method === "POST") {
      try {
        const body = await request.json();
        targetUrl = body.url;
      } catch (e) {
        // Ignored
      }
    }

    if (!targetUrl) {
      return jsonResponse({ ok: false, status: "error", message: "Missing required 'url' parameter" }, 400);
    }

    // 5. Extract surl key from URL
    const surlMatch = targetUrl.match(/(?:surl=|\/s\/|share\/init\?surl=)([A-Za-z0-9_-]+)/);
    if (!surlMatch) {
      return jsonResponse({ ok: false, status: "error", message: "Could not extract TeraBox surl identifier from URL" }, 400);
    }

    let surl = surlMatch[1];
    if (surl.startsWith("1") && surl.length > 20) {
      surl = surl.substring(1);
    }

    // Optional folder path query
    const pathParam = url.searchParams.get("path") || "";

    // 6. Resolve Session Cookie (Worker Environment Variable or User Query)
    const sessionCookie = url.searchParams.get("cookie") || env.TERABOX_COOKIE || "";
    const cookieHeader = sessionCookie
      ? (sessionCookie.includes("=") ? sessionCookie : `ndus=${sessionCookie.trim()}`)
      : "";

    const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36";

    try {
      // 7. Request TeraBox share list API
      const tbApiUrl = new URL("https://www.terabox.app/share/list");
      tbApiUrl.searchParams.set("app_id", "250528");
      tbApiUrl.searchParams.set("shorturl", surl);
      tbApiUrl.searchParams.set("root", pathParam ? "0" : "1");
      if (pathParam) {
        tbApiUrl.searchParams.set("dir", pathParam);
      }

      const headers = {
        "User-Agent": userAgent,
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": `https://www.terabox.app/sharing/link?surl=${surl}`,
      };

      if (cookieHeader) {
        headers["Cookie"] = cookieHeader;
      }

      const tbResp = await fetch(tbApiUrl.toString(), {
        method: "GET",
        headers,
      });

      if (!tbResp.ok) {
        return jsonResponse({
          ok: false,
          status: "error",
          message: `TeraBox upstream returned HTTP ${tbResp.status}`,
        }, tbResp.status);
      }

      const tbData = await tbResp.json();

      if (tbData.errno && tbData.errno !== 0) {
        return jsonResponse({
          ok: false,
          status: "error",
          errno: tbData.errno,
          message: tbData.errmsg || `TeraBox API returned errno ${tbData.errno}`,
        });
      }

      const rawList = tbData.list || [];
      const files = rawList.map((item, idx) => {
        const isDir = item.isdir === 1 || item.isdir === "1";
        const size = typeof item.size === "number" ? item.size : parseInt(item.size || "0", 10);
        
        return {
          fs_id: String(item.fs_id || idx + 1),
          file_name: item.server_filename || `file_${idx + 1}`,
          filename: item.server_filename || `file_${idx + 1}`,
          size: size,
          size_readable: formatBytes(size),
          is_dir: isDir,
          path: item.path || "",
          thumb: item.thumbs?.url3 || item.thumbs?.url2 || item.thumbs?.url1 || null,
          download_url: item.dlink || null,
          direct_link: item.dlink || null,
          category: item.category ? String(item.category) : undefined,
          create_time: item.server_ctime || item.server_mtime || undefined,
        };
      });

      return jsonResponse({
        ok: true,
        status: "success",
        shareid: tbData.shareid || 0,
        uk: tbData.uk || 0,
        sign: tbData.sign || "",
        timestamp: tbData.timestamp || 0,
        total: files.length,
        files: files,
      });

    } catch (err) {
      return jsonResponse({
        ok: false,
        status: "error",
        message: `Worker exception: ${err.message || String(err)}`,
      }, 500);
    }
  },
};

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
    },
  });
}
