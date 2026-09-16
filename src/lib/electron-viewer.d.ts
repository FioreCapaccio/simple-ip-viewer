// Shape of the API exposed by electron/preload.cjs via contextBridge, when
// this app runs inside the Electron desktop build. Absent entirely when
// running as a normal web page (Lovable/Cloudflare) — always check for
// `window.electronViewer` before using it.
export type ElectronViewerCreds = { user?: string | undefined; pass?: string | undefined };

export type ElectronViewerState = {
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
};

export type ElectronViewerError = {
  errorCode: number;
  errorDescription: string;
  validatedURL: string;
};

export type ElectronViewerBounds = { x: number; y: number; width: number; height: number };

export type ElectronViewerApi = {
  isElectron: true;
  navigate: (url: string, creds: ElectronViewerCreds) => Promise<void>;
  back: () => Promise<void>;
  forward: () => Promise<void>;
  reload: () => Promise<void>;
  getSource: () => Promise<string>;
  savePage: () => Promise<{ ok: boolean; filePath?: string; error?: string }>;
  downloadUrl: (url: string) => Promise<void>;
  setContentBounds: (rect: ElectronViewerBounds) => void;
  onState: (callback: (state: ElectronViewerState) => void) => () => void;
  onError: (callback: (error: ElectronViewerError) => void) => () => void;
  onRequestBounds: (callback: () => void) => () => void;
};

declare global {
  interface Window {
    electronViewer?: ElectronViewerApi;
  }
}
