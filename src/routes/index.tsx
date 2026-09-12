import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchPage, type FetchPageResult } from "@/lib/proxy.functions";
import { normalizeTarget } from "@/lib/proxy-shared";

const DEFAULT_HOST = "http://192.168.1.69";
const DEFAULT_PORT = "80";

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

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const data = event.data as { __viewer?: boolean; kind?: string; url?: string } | null;
      if (!data || !data.__viewer || data.kind !== "navigate" || !data.url) return;
      void go(data.url);
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [go]);

  const canBack = cursor > 0;
  const canForward = cursor >= 0 && cursor < history.length - 1;

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <header className="border-b border-border bg-card">
        <form
          className="flex flex-wrap items-center gap-2 px-3 py-2"
          onSubmit={(e) => {
            e.preventDefault();
            void go(address);
          }}
        >
          <div className="flex items-center gap-1">
            <NavButton label="◀" title="Indietro" disabled={!canBack} onClick={() => jump(-1)} />
            <NavButton label="▶" title="Avanti" disabled={!canForward} onClick={() => jump(1)} />
            <NavButton
              label="⟳"
              title="Ricarica"
              disabled={busy || !history.length}
              onClick={() => {
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
            disabled={busy}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {busy ? "Attendi…" : "Vai"}
          </button>

          <button
            type="button"
            onClick={() => setShowLogin((v) => !v)}
            className="rounded-md border border-input px-3 py-2 text-sm transition-colors hover:bg-accent"
          >
            {user ? `Accesso: ${user}` : "Accesso"}
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
      </header>

      <main className="relative flex-1 overflow-hidden bg-muted">
        {!result && (
          <div className="flex h-full items-center justify-center px-6 text-center">
            <div className="max-w-md">
              <h1 className="text-2xl font-semibold">Visore di rete locale</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Premi “Vai” per aprire {DEFAULT_HOST}. Cambia porta o indirizzo se serve. L’app
                contatta la macchina direttamente, quindi i blocchi del browser non si applicano.
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

        {result && !result.error && !showSource && (
          <iframe
            title="Contenuto della macchina"
            className="h-full w-full border-0 bg-white"
            sandbox="allow-scripts allow-forms"
            srcDoc={
              result.html ??
              `<pre style="font:13px/1.5 monospace;padding:16px;white-space:pre-wrap">${escapeHtml(
                result.text ?? "(contenuto non testuale)",
              )}</pre>`
            }
          />
        )}
      </main>

      <footer className="border-t border-border bg-card px-3 py-2 text-xs text-muted-foreground">
        {busy
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
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
