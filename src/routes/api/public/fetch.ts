import { createFileRoute } from "@tanstack/react-router";

const TIMEOUT_MS = 15000;

function authHeader(user: string | null, pass: string | null): Record<string, string> {
  if (!user) return {};
  const b64 = Buffer.from(`${user}:${pass ?? ""}`, "utf8").toString("base64");
  return { Authorization: `Basic ${b64}` };
}

export const Route = createFileRoute("/api/public/fetch")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const target = url.searchParams.get("u");
        if (!target) return new Response("Missing url", { status: 400 });

        let parsed: URL;
        try {
          parsed = new URL(target);
        } catch {
          return new Response("Invalid url", { status: 400 });
        }
        if (!/^https?:$/.test(parsed.protocol)) {
          return new Response("Unsupported protocol", { status: 400 });
        }

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
        try {
          const upstream = await fetch(parsed.toString(), {
            redirect: "follow",
            signal: controller.signal,
            headers: {
              "User-Agent": "LAN-Viewer/1.0",
              ...authHeader(url.searchParams.get("au"), url.searchParams.get("ap")),
            },
          });

          const headers = new Headers();
          const ct = upstream.headers.get("content-type");
          if (ct) headers.set("content-type", ct);
          headers.set("cache-control", "no-store");

          return new Response(upstream.body, {
            status: upstream.status,
            headers,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return new Response(`Upstream error: ${message}`, { status: 502 });
        } finally {
          clearTimeout(timer);
        }
      },
    },
  },
});
