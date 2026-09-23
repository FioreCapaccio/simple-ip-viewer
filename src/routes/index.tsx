import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchPage, type FetchPageResult } from "@/lib/proxy.functions";
import { buildProxyUrl, normalizeTarget } from "@/lib/proxy-shared";
// src/lib/electron-viewer.d.ts augments the global Window type with
// `electronViewer` — picked up automatically via tsconfig's include glob, no
// import needed.

const DEFAULT_HOST = "http://192.168.1.69";
const DEFAULT_PORT = "80";

// Persisted locally (survives app restarts) — these are per-device service
// credentials the user re-enters every few months, not the per-session
// "Accesso" fields above which only cover HTTP Basic Auth.
const SERVICE_CODE_KEY = "viewer:serviceCode";
const SERVICE_PASSWORD_KEY = "viewer:servicePassword";
const SERVICE_PASSWORD_DATE_KEY = "viewer:servicePasswordDate";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Visore di rete locale — 192.168.1.69" },
      {
        name: "description",
        content:
          "Apri l'interfaccia web di una macchina della rete locale senza i blocchi del browser: navigazione dei link, accesso con utente e password e vista del codice sorgente.",
      },
      { property: "og:title", content: "Visore di rete locale — 192.168.1.69" },
      {
        property: "og:description",
        content:
          "Mini-browser per l'interfaccia web di una macchina in rete locale, senza blocchi di sicurezza del browser.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Viewer,
});

function Viewer() {
  const load = useServerFn(fetchPage);

  // In the Electron desktop build, window.electronViewer (see
  // electron/preload.cjs) drives a native WebContentsView that loads the
  // device page directly — script, AJAX, WebSocket included — instead of the
  // fetch-and-rewrite flow below, which the plain web build (Lovable/
  // Cloudflare) still uses since it has no such native view available.
  // Detected post-mount (not during the initial render) so the server-
  // rendered markup and the client's first paint always match.
  const [isElectron, setIsElectron] = useState(false);
  useEffect(() => {
    if (typeof window !== "undefined" && window.electronViewer) setIsElectron(true);
  }, []);

  const [address, setAddress] = useState(DEFAULT_HOST);
  const [port, setPort] = useState(DEFAULT_PORT);
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [showLogin, setShowLogin] = useState(false);
  const [showSource, setShowSource] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<FetchPageResult | null>(null);

  const [history, setHistory] = useState<string[]>([]);
  const [cursor, setCursor] = useState(-1);

  const credsRef = useRef({ user: "", pass: "" });
  credsRef.current = { user, pass };

  // --- Saved service credentials (persisted in localStorage, not just React
  // state) — the "codice assistenza" is auto-filled into the CLX/Milli-Q
  // Connect maintenance page (see electron/main.cjs's autofillScript); the
  // service password has no known-safe field to auto-fill so it's just kept
  // here for a one-click copy into the device's own login form. ---
  const [serviceCode, setServiceCode] = useState("");
  const [servicePassword, setServicePassword] = useState("");
  const [servicePasswordDate, setServicePasswordDate] = useState("");
  const [showSaved, setShowSaved] = useState(false);
  const [showServicePassword, setShowServicePassword] = useState(false);
  const [copiedPassword, setCopiedPassword] = useState(false);

  useEffect(() => {
    try {
      setServiceCode(localStorage.getItem(SERVICE_CODE_KEY) ?? "");
      setServicePassword(localStorage.getItem(SERVICE_PASSWORD_KEY) ?? "");
      setServicePasswordDate(localStorage.getItem(SERVICE_PASSWORD_DATE_KEY) ?? "");
    } catch {
      /* localStorage non disponibile: le credenziali salvate restano vuote */
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(SERVICE_CODE_KEY, serviceCode);
    } catch {
      /* ignora: nessuna persistenza disponibile */
    }
    window.electronViewer?.setServiceCode(serviceCode);
  }, [serviceCode]);

  useEffect(() => {
    try {
      localStorage.setItem(SERVICE_PASSWORD_KEY, servicePassword);
    } catch {
      /* ignora: nessuna persistenza disponibile */
    }
  }, [servicePassword]);

  useEffect(() => {
    try {
      localStorage.setItem(SERVICE_PASSWORD_DATE_KEY, servicePasswordDate);
    } catch {
      /* ignora: nessuna persistenza disponibile */
    }
  }, [servicePasswordDate]);

  const copyServicePassword = useCallback(async () => {
    if (!servicePassword) return;
    try {
      await navigator.clipboard.writeText(servicePassword);
      setCopiedPassword(true);
      setTimeout(() => setCopiedPassword(false), 1500);
    } catch {
      /* clipboard non disponibile */
    }
  }, [servicePassword]);

  // --- Web-mode (fetch + rewritten HTML in a sandboxed iframe) ---

  const request = useCallback(
    async (target: string) => {
      setBusy(true);
      try {
        const res = await load({
          data: {
            url: target,
            user: credsRef.current.user || undefined,
            pass: credsRef.current.pass || undefined,
          },
        });
        setResult(res);
        setAddress(res.finalUrl);
        return res;
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  const go = useCallback(
    async (rawTarget: string) => {
      const target = normalizeTarget(rawTarget, port);
      if (!target) return;
      const res = await request(target);
      setHistory((prev) => {
        const base = prev.slice(0, cursor + 1);
        base.push(res.finalUrl || target);
        setCursor(base.length - 1);
        return base;
      });
    },
    [cursor, port, request],
  );

  const jump = useCallback(
    (delta: number) => {
      const next = cursor + delta;
      const target = history[next];
      if (!target) return;
      setCursor(next);
      void request(target);
    },
    [cursor, history, request],
  );

  const download = useCallback(
    (rawTarget: string) => {
      const target = normalizeTarget(rawTarget, port);
      if (!target) return;
      const link = document.createElement("a");
      link.href = `${buildProxyUrl(target, credsRef.current)}&dl=1`;
      link.download = "";
      link.rel = "noopener";
      document.body.appendChild(link);
      link.click();
      link.remove();
    },
    [port],
  );

  const savePage = useCallback(() => {
    if (!result) return;
    const body = result.text ?? result.html;
    if (body === null) return;
    let name = "pagina";
    try {
      const u = new URL(result.finalUrl);
      const last = u.pathname.split("/").filter(Boolean).pop();
      name = (last ? last.replace(/\.[^.]+$/, "") : u.hostname).replace(/[^\w.-]+/g, "_");
    } catch {
      /* nome di riserva */
    }
    const withBase = /<head[^>]*>/i.test(body)
      ? body.replace(/<head([^>]*)>/i, `<head$1><base href="${result.finalUrl}">`)
      : body;
    const url = URL.createObjectURL(new Blob([withBase], { type: "text/html;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${name || "pagina"}.html`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }, [result]);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const data = event.data as { __viewer?: boolean; kind?: string; url?: string } | null;
      if (!data || !data.__viewer || !data.url) return;
      if (data.kind === "download") download(data.url);
      else if (data.kind === "navigate") void go(data.url);
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [go, download]);

  const canBack = cursor > 0;
  const canForward = cursor >= 0 && cursor < history.length - 1;

  // --- Electron mode (native WebContentsView) ---

  const [hasNavigated, setHasNavigated] = useState(false);
  const [electronBusy, setElectronBusy] = useState(false);
  const [electronUrl, setElectronUrl] = useState("");
  const [electronCanBack, setElectronCanBack] = useState(false);
  const [electronCanForward, setElectronCanForward] = useState(false);
  const [electronError, setElectronError] = useState<string | null>(null);
  const [electronSource, setElectronSource] = useState<string | null>(null);
  const contentAreaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const viewer = window.electronViewer;
    if (!isElectron || !viewer) return;
    const offState = viewer.onState((s) => {
      setElectronUrl(s.url);
      setElectronBusy(s.loading);
      setElectronCanBack(s.canGoBack);
      setElectronCanForward(s.canGoForward);
      setElectronError(null);
      setAddress((prev) => s.url || prev);
    });
    const offError = viewer.onError((e) => {
      setElectronBusy(false);
      setElectronError(
        `Impossibile contattare la macchina (${e.errorDescription || e.errorCode}). Verifica che sia sulla stessa rete e che la porta sia corretta.`,
      );
    });
    return () => {
      offState();
      offError();
    };
  }, [isElectron]);

  const electronGo = useCallback(
    async (rawTarget: string) => {
      const viewer = window.electronViewer;
      const target = normalizeTarget(rawTarget, port);
      if (!target || !viewer) return;
      setElectronError(null);
      setHasNavigated(true);
      setElectronBusy(true);
      await viewer.navigate(target, { user: credsRef.current.user, pass: credsRef.current.pass });
    },
    [port],
  );

  const electronBack = useCallback(() => void window.electronViewer?.back(), []);
  const electronForward = useCallback(() => void window.electronViewer?.forward(), []);
  const electronReload = useCallback(() => void window.electronViewer?.reload(), []);

  const electronDownload = useCallback(
    (rawTarget: string) => {
      const target = normalizeTarget(rawTarget, port);
      if (target) void window.electronViewer?.downloadUrl(target);
    },
    [port],
  );

  const electronSavePage = useCallback(() => {
    void window.electronViewer?.savePage();
  }, []);

  // Overlay (placeholder/error/source) vs. the native content view are
  // mutually exclusive — the native view is composited above the whole
  // window regardless of CSS, so it has to be explicitly shrunk to nothing
  // whenever we want an overlay to actually be visible.
  const contentVisible = hasNavigated && !electronError && !showSource;

  useEffect(() => {
    if (!isElectron || !showSource) return;
    const viewer = window.electronViewer;
    if (!viewer) return;
    let cancelled = false;
    setElectronSource(null);
    viewer.getSource().then((html) => {
      if (!cancelled) setElectronSource(html);
    });
    return () => {
      cancelled = true;
    };
  }, [isElectron, showSource]);

  useEffect(() => {
    const viewer = window.electronViewer;
    if (!isElectron || !viewer) return;
    const report = () => {
      const el = contentAreaRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      viewer.setContentBounds(
        contentVisible
          ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
          : { x: rect.x, y: rect.y, width: 0, height: 0 },
      );
    };
    report();
    const ro = new ResizeObserver(report);
    if (contentAreaRef.current) ro.observe(contentAreaRef.current);
    window.addEventListener("resize", report);
    const offRequestBounds = viewer.onRequestBounds(report);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", report);
      offRequestBounds();
    };
  }, [isElectron, contentVisible, showLogin]);

  const isBusy = isElectron ? electronBusy : busy;
  const canGoBack = isElectron ? electronCanBack : canBack;
  const canGoForward = isElectron ? electronCanForward : canForward;

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <header className="border-b border-border bg-card">
        <form
          className="flex flex-wrap items-center gap-2 px-3 py-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (isElectron) void electronGo(address);
            else void go(address);
          }}
        >
          <div className="flex items-center gap-1">
            <NavButton
              label="◀"
              title="Indietro"
              disabled={!canGoBack}
              onClick={() => (isElectron ? electronBack() : jump(-1))}
            />
            <NavButton
              label="▶"
              title="Avanti"
              disabled={!canGoForward}
              onClick={() => (isElectron ? electronForward() : jump(1))}
            />
            <NavButton
              label="⟳"
              title="Ricarica"
              disabled={isBusy || (isElectron ? !hasNavigated : !history.length)}
              onClick={() => {
                if (isElectron) {
                  electronReload();
                  return;
                }
                const current = history[cursor];
                if (current) void request(current);
              }}
            />
          </div>

          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            spellCheck={false}
            aria-label="Indirizzo"
            className="min-w-[16rem] flex-1 rounded-md border border-input bg-background px-3 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <input
            value={port}
            onChange={(e) => setPort(e.target.value)}
            aria-label="Porta"
            className="w-20 rounded-md border border-input bg-background px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            placeholder="Porta"
          />

          <button
            type="submit"
            disabled={isBusy}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {isBusy ? "Attendi…" : "Vai"}
          </button>

          <button
            type="button"
            onClick={() => {
              const target = isElectron ? electronUrl || address : (history[cursor] ?? address);
              if (isElectron) electronDownload(target);
              else download(target);
            }}
            className="rounded-md border border-input px-3 py-2 text-sm transition-colors hover:bg-accent"
          >
            Scarica
          </button>

          <button
            type="button"
            onClick={() => {
              if (isElectron) electronSavePage();
              else savePage();
            }}
            disabled={
              isElectron ? !hasNavigated : !result || (result.text === null && result.html === null)
            }
            title="Salva la pagina come file HTML da leggere offline"
            className="rounded-md border border-input px-3 py-2 text-sm transition-colors hover:bg-accent disabled:opacity-50"
          >
            Salva pagina
          </button>

          <button
            type="button"
            onClick={() => setShowLogin((v) => !v)}
            className="rounded-md border border-input px-3 py-2 text-sm transition-colors hover:bg-accent"
          >
            {user ? `Accesso: ${user}` : "Accesso"}
          </button>

          <button
            type="button"
            onClick={() => setShowSaved((v) => !v)}
            className="rounded-md border border-input px-3 py-2 text-sm transition-colors hover:bg-accent"
          >
            Credenziali salvate
          </button>

          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={showSource}
              onChange={(e) => setShowSource(e.target.checked)}
            />
            codice sorgente
          </label>
        </form>

        {showLogin && (
          <div className="flex flex-wrap items-end gap-2 border-t border-border px-3 py-2">
            <Field label="Utente" value={user} onChange={setUser} />
            <Field label="Password" value={pass} onChange={setPass} type="password" />
            <button
              type="button"
              onClick={() => {
                setShowLogin(false);
                if (isElectron) {
                  const current = electronUrl || normalizeTarget(address, port);
                  if (current) void electronGo(current);
                  return;
                }
                const current = history[cursor] ?? normalizeTarget(address, port);
                if (current) void request(current);
              }}
              className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Usa credenziali
            </button>
            <button
              type="button"
              onClick={() => {
                setUser("");
                setPass("");
              }}
              className="rounded-md border border-input px-3 py-2 text-sm hover:bg-accent"
            >
              Cancella
            </button>
            <p className="text-xs text-muted-foreground">
              Le credenziali restano solo in questa scheda del browser.
            </p>
          </div>
        )}

        {showSaved && (
          <div className="flex flex-wrap items-end gap-2 border-t border-border px-3 py-2">
            <Field label="Codice assistenza (CLX)" value={serviceCode} onChange={setServiceCode} />
            <div className="flex flex-col gap-1 text-xs text-muted-foreground">
              Password SERVICE
              <div className="flex items-center gap-1">
                <input
                  type={showServicePassword ? "text" : "password"}
                  value={servicePassword}
                  onChange={(e) => setServicePassword(e.target.value)}
                  className="rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
                />
                <button
                  type="button"
                  onClick={() => setShowServicePassword((v) => !v)}
                  title={showServicePassword ? "Nascondi" : "Mostra"}
                  className="rounded-md border border-input px-2 py-2 text-sm hover:bg-accent"
                >
                  {showServicePassword ? "🙈" : "👁"}
                </button>
                <button
                  type="button"
                  onClick={() => void copyServicePassword()}
                  disabled={!servicePassword}
                  className="rounded-md border border-input px-3 py-2 text-sm hover:bg-accent disabled:opacity-50"
                >
                  {copiedPassword ? "Copiata!" : "Copia"}
                </button>
              </div>
            </div>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Data ultimo utilizzo
              <input
                type="date"
                value={servicePasswordDate}
                onChange={(e) => setServicePasswordDate(e.target.value)}
                className="rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
              />
            </label>
            <p className="max-w-xs text-xs text-muted-foreground">
              Salvati sul computer: il codice assistenza viene inserito automaticamente
              nell&apos;interfaccia CLX; la password va incollata a mano nel form dell&apos;altro
              strumento.
            </p>
          </div>
        )}
      </header>

      <main className="relative flex-1 overflow-hidden bg-muted">
        {isElectron ? (
          <>
            {/* The device page is drawn natively by a WebContentsView layered
                over this div (see the bounds-reporting effect above) — it's
                not part of the DOM, so it stays on top of these overlays
                unless we tell the main process to shrink it to zero size. */}
            <div ref={contentAreaRef} className="absolute inset-0" />

            {!hasNavigated && (
              <div className="absolute inset-0 flex items-center justify-center px-6 text-center">
                <div className="max-w-md">
                  <h1 className="text-2xl font-semibold">Visore di rete locale</h1>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Premi “Vai” per aprire {DEFAULT_HOST}. Cambia porta o indirizzo se serve. La
                    pagina viene caricata direttamente, script inclusi, come in un browser.
                  </p>
                </div>
              </div>
            )}

            {hasNavigated && electronError && (
              <div className="absolute inset-0 flex items-center justify-center px-6 text-center">
                <p className="max-w-lg text-sm text-destructive">{electronError}</p>
              </div>
            )}

            {hasNavigated && !electronError && showSource && (
              <pre className="absolute inset-0 overflow-auto bg-card p-4 font-mono text-xs whitespace-pre-wrap">
                {electronSource ?? "Caricamento codice sorgente…"}
              </pre>
            )}
          </>
        ) : (
          <>
            {!result && (
              <div className="flex h-full items-center justify-center px-6 text-center">
                <div className="max-w-md">
                  <h1 className="text-2xl font-semibold">Visore di rete locale</h1>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Premi “Vai” per aprire {DEFAULT_HOST}. Cambia porta o indirizzo se serve. L’app
                    contatta la macchina direttamente, quindi i blocchi del browser non si
                    applicano.
                  </p>
                </div>
              </div>
            )}

            {result && result.error && (
              <div className="flex h-full items-center justify-center px-6 text-center">
                <p className="max-w-lg text-sm text-destructive">{result.error}</p>
              </div>
            )}

            {result && !result.error && showSource && (
              <pre className="h-full overflow-auto bg-card p-4 font-mono text-xs whitespace-pre-wrap">
                {result.text ?? "(contenuto non testuale)"}
              </pre>
            )}

            {result &&
              !result.error &&
              !showSource &&
              result.html === null &&
              result.text === null && (
                <div className="flex h-full items-center justify-center px-6 text-center">
                  <div className="max-w-md">
                    <h2 className="text-lg font-semibold">File pronto da scaricare</h2>
                    <p className="mt-2 text-sm text-muted-foreground break-all">
                      {result.finalUrl}
                      {result.contentType ? ` · ${result.contentType}` : ""}
                    </p>
                    <button
                      type="button"
                      onClick={() => download(result.finalUrl)}
                      className="mt-4 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                    >
                      Scarica il file
                    </button>
                  </div>
                </div>
              )}

            {result &&
              !result.error &&
              !showSource &&
              (result.html !== null || result.text !== null) && (
                <iframe
                  title="Contenuto della macchina"
                  className="h-full w-full border-0 bg-white"
                  sandbox="allow-scripts allow-forms"
                  srcDoc={
                    result.html ??
                    `<pre style="font:13px/1.5 monospace;padding:16px;white-space:pre-wrap">${escapeHtml(
                      result.text ?? "",
                    )}</pre>`
                  }
                />
              )}
          </>
        )}
      </main>

      <footer className="border-t border-border bg-card px-3 py-2 text-xs text-muted-foreground">
        {isElectron
          ? electronBusy
            ? "Caricamento…"
            : !hasNavigated
              ? "Pronto"
              : electronError
                ? "Nessuna risposta"
                : electronUrl || "Pronto"
          : busy
            ? "Richiesta in corso…"
            : result
              ? result.error
                ? "Nessuna risposta"
                : `${result.status} ${result.statusText} · ${result.contentType || "tipo sconosciuto"} · ${result.elapsedMs} ms · ${result.finalUrl}`
              : "Pronto"}
      </footer>
    </div>
  );
}

function NavButton({
  label,
  title,
  disabled,
  onClick,
}: {
  label: string;
  title: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className="rounded-md border border-input px-3 py-2 text-sm transition-colors hover:bg-accent disabled:opacity-40"
    >
      {label}
    </button>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      {label}
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
      />
    </label>
  );
}

function escapeHtml(input: string): string {
  return input.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
