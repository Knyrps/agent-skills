// The extension's plain-JS modules that the UI shares with the service worker.
declare module '*/extension/allow.js' {
  export function loadConfig(): Promise<{ bridgeUrl: string; branding: Record<string, string> }>;
  export function hostAllowed(url: string, allowlist: string[]): boolean;
  export function isLoopbackHost(host: string): boolean;
  export function pageKey(url: string): string;
}
