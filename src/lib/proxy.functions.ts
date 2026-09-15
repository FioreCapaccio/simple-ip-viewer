import { createServerFn } from "@tanstack/react-start";
import { basicAuthHeader, buildProxyUrl, type ProxyCreds } from "./proxy-shared";

type FetchInput = {
  url: string;
  user?: string | undefined;
  pass?: string | undefined;
};

export type FetchPageResult = {
  ok: boolean;
  status: number;
  statusText: string;
  finalUrl: string;
  contentType: string;
  elapsedMs: number;
  html: string | null;
  text: string | null;
  error: string | null;
};

const TIMEOUT_MS = 15000;

// Decoding arbitrary binary bytes as UTF-8 produces NUL/control characters
// and U+FFFD replacement characters where the bytes weren't valid text. A
// real text/HTML page won't contain more than a trace of these, so a high
// ratio flags content that only *claims* to be textual (e.g. a firmware
// image served with a generic "application/octet-stream" label).
function looksBinary(sample: string): boolean {
  if (!sample) return false;
  const probe = sample.slice(0, 4000);
  let suspicious = 0;
  for (let i = 0; i < probe.length; i++) {
    const code = probe.charCodeAt(i);
    if (code === 0xfffd || (code < 32 && code !== 9 && code !== 10 && code !== 13)) {
      suspicious++;
    }
  }
  return suspicious / probe.length > 0.01;
}

function absolutize(raw: string, base: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (/^(data:|blob:|javascript:|mailto:|tel:|about:)/i.test(value)) return null;
  if (value.startsWith("#")) return null;
  try {
    return new URL(value, base).toString();
  } catch {
    return null;
  }
}

const NAV_SCRIPT = `
<script>
(function () {
  function send(url, kind) {
    parent.postMessage({ __viewer: true, kind: kind, url: url }, "*");
  }
  document.addEventListener("click", function (e) {
    var el = e.target;
    while (el && el.tagName !== "A") el = el.parentElement;
    if (!el) return;
    var href = el.getAttribute("data-viewer-href");
    if (!href) return;
    e.preventDefault();
    var isFile = el.hasAttribute("download") ||
      /\\.(zip|rar|7z|tar|gz|tgz|pdf|csv|xlsx?|docx?|pptx?|txt|log|bin|img|iso|exe|msi|dmg|apk|jpg|jpeg|png|gif|bmp|svg|mp3|mp4|avi|mkv|mov|wav|json|xml|cfg|conf|bak|db)(\\?|$)/i
        .test(href.split("#")[0]);
    send(href, isFile ? "download" : "navigate");
  }, true);
  document.addEventListener("submit", function (e) {
    var form = e.target;
    var action = form.getAttribute("data-viewer-action");
    if (!action) return;
    e.preventDefault();
    var data = new FormData(form);
    var method = (form.getAttribute("method") || "get").toLowerCase();
    if (method === "get") {
      var u = action.split("#")[0];
      var qs = new URLSearchParams(data).toString();
      send(u + (u.indexOf("?") === -1 ? "?" : "&") + qs, "navigate");
    } else {
      send(action, "navigate");
    }
  }, true);
})();
</script>
`;

function rewriteHtml(html: string, baseUrl: string, creds: ProxyCreds): string {
  let out = html;

  // Remove original scripts and frame-busting / CSP meta tags.
  out = out.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  out = out.replace(/<script\b[^>]*\/>/gi, "");
  out = out.replace(
    /<meta[^>]+http-equiv=["']?(content-security-policy|refresh)["']?[^>]*>/gi,
    "",
  );

  // Rewrite resource + link + form URLs.
  out = out.replace(
    /\s(href|src|action|data-src|poster)\s*=\s*("([^"]*)"|'([^']*)'|([^\s">]+))/gi,
    (match, attr: string, _q, dq?: string, sq?: string, uq?: string) => {
      const raw = dq ?? sq ?? uq ?? "";
      const abs = absolutize(raw, baseUrl);
      if (!abs) return match;
      const lower = attr.toLowerCase();
      if (lower === "href") {
        // Anchors are intercepted by the parent app; <link href> is proxied.
        return ` data-viewer-href="${abs}" href="${buildProxyUrl(abs, creds)}"`;
      }
      if (lower === "action") {
        return ` data-viewer-action="${abs}" action="${buildProxyUrl(abs, creds)}"`;
      }
      return ` ${attr}="${buildProxyUrl(abs, creds)}"`;
    },
  );

  out = out.replace(/\ssrcset\s*=\s*("([^"]*)"|'([^']*)')/gi, (match, _q, dq?: string, sq?: string) => {
    const raw = dq ?? sq ?? "";
    const parts = raw
      .split(",")
      .map((part) => {
        const trimmed = part.trim();
        if (!trimmed) return null;
        const [candidate, ...rest] = trimmed.split(/\s+/);
        const abs = absolutize(candidate ?? "", baseUrl);
        if (!abs) return trimmed;
        return [buildProxyUrl(abs, creds), ...rest].join(" ");
      })
      .filter(Boolean);
    if (!parts.length) return match;
    return ` srcset="${parts.join(", ")}"`;
  });

  if (/<\/body>/i.test(out)) {
    out = out.replace(/<\/body>/i, `${NAV_SCRIPT}</body>`);
  } else {
    out += NAV_SCRIPT;
  }

  return out;
}

export const fetchPage = createServerFn({ method: "POST" })
  .inputValidator((data: FetchInput) => {
    if (!data || typeof data.url !== "string" || !data.url.trim()) {
      throw new Error("URL mancante");
    }
    return data;
  })
  .handler(async ({ data }): Promise<FetchPageResult> => {
    const creds: ProxyCreds = { user: data.user, pass: data.pass };
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const response = await fetch(data.url, {
        redirect: "follow",
        signal: controller.signal,
        headers: {
          Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
          "User-Agent": "LAN-Viewer/1.0",
          ...basicAuthHeader(creds),
        },
      });

      const contentType = response.headers.get("content-type") ?? "";
      const finalUrl = response.url || data.url;
      // Many embedded devices (NVR/telecamere/centraline) send a wrong or
      // generic Content-Type on their own HTML page — most commonly
      // "application/octet-stream". A real browser sniffs the actual bytes
      // and renders it anyway, so we only skip reading the body for types
      // that are unambiguously binary (media, archives, office docs,
      // multipart streams); everything else — octet-stream included — gets
      // read and classified by its real content, with a byte-level check to
      // catch genuinely binary data mislabeled the same generic way.
      const isUnambiguousBinary =
        /^(image|audio|video|font|multipart)\//i.test(contentType) ||
        /^application\/(pdf|zip|gzip|x-7z-compressed|x-rar-compressed|x-tar|x-msdownload|vnd\.(ms-|openxmlformats))/i.test(
          contentType,
        );

      let isTextual = !isUnambiguousBinary;
      let body = "";
      if (isTextual) {
        body = await response.text();
        if (looksBinary(body)) {
          isTextual = false;
          body = "";
        }
      }

      const isHtml = isTextual && (/html|xml/i.test(contentType) || /<html[\s>]/i.test(body));

      return {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        finalUrl,
        contentType,
        elapsedMs: Date.now() - started,
        html: isHtml ? rewriteHtml(body, finalUrl, creds) : null,
        text: isTextual ? body : null,
        error: null,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const aborted = /abort/i.test(message);
      return {
        ok: false,
        status: 0,
        statusText: "",
        finalUrl: data.url,
        contentType: "",
        elapsedMs: Date.now() - started,
        html: null,
        text: null,
        error: aborted
          ? "Nessuna risposta entro 15 secondi: la macchina potrebbe essere spenta o la porta errata."
          : `Impossibile contattare la macchina (${message}). Verifica che il computer sia sulla stessa rete e che la porta sia corretta.`,
      };
    } finally {
      clearTimeout(timer);
    }
  });
