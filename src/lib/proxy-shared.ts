export type ProxyCreds = { user?: string | undefined; pass?: string | undefined };

export function buildProxyUrl(target: string, creds?: ProxyCreds): string {
  const params = new URLSearchParams({ u: target });
  if (creds?.user) params.set("au", creds.user);
  if (creds?.pass) params.set("ap", creds.pass);
  return `/api/public/fetch?${params.toString()}`;
}

export function basicAuthHeader(creds?: ProxyCreds): Record<string, string> {
  if (!creds?.user) return {};
  const raw = `${creds.user}:${creds.pass ?? ""}`;
  const b64 =
    typeof btoa === "function"
      ? btoa(unescape(encodeURIComponent(raw)))
      : Buffer.from(raw, "utf8").toString("base64");
  return { Authorization: `Basic ${b64}` };
}

export function normalizeTarget(input: string, port?: string): string {
  let value = input.trim();
  if (!value) return "";
  if (!/^https?:\/\//i.test(value)) value = `http://${value}`;
  try {
    const url = new URL(value);
    if (port && port.trim() && !/:\d+$/.test(url.host)) {
      url.port = port.trim();
    }
    return url.toString();
  } catch {
    return value;
  }
}
