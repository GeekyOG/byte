import tls from "node:tls";
import type { Finding, Severity } from "./types";
import { shortId } from "./util";

const HEADERS: { name: string; severity: Severity; why: string }[] = [
  { name: "strict-transport-security", severity: "moderate", why: "Browsers may still connect over plain HTTP." },
  { name: "content-security-policy", severity: "moderate", why: "Injected scripts can run freely (XSS)." },
  { name: "x-content-type-options", severity: "low", why: "Browsers may guess file types in unsafe ways." },
  { name: "referrer-policy", severity: "low", why: "Full URLs may leak to other sites." },
];

/** Checks a response's headers; pure so it's easy to test. */
export function checkHeaders(url: string, headers: Record<string, string>, status: number, ms: number): Finding[] {
  const out: Finding[] = [];
  const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  const add = (key: string, severity: Severity, title: string, fix: string, detail?: string) =>
    out.push({ id: shortId("live", url, key), category: "live", severity, title, file: url, detail, fix });

  if (!url.startsWith("https://")) add("http", "high", "Site is served over plain HTTP", "Serve it over HTTPS and redirect HTTP to HTTPS.");
  if (status >= 500) add("5xx", "high", `Site returned an error (${status})`, "Check the server logs.");
  for (const header of HEADERS) {
    if (!h[header.name]) add(header.name, header.severity, `Missing ${header.name} header`, `Add the header. ${header.why}`);
  }
  if (!h["x-frame-options"] && !(h["content-security-policy"] ?? "").includes("frame-ancestors")) {
    add("framing", "low", "Site can be embedded in other sites (clickjacking)", "Add X-Frame-Options: DENY or a CSP frame-ancestors rule.");
  }
  if (h["x-powered-by"]) add("powered-by", "low", "X-Powered-By header reveals your server stack", "Remove it (in Express: app.disable('x-powered-by')).", h["x-powered-by"]);
  if (ms > 1500) add("slow", "low", `Slow response (${ms} ms)`, "Check slow database queries and add caching.");
  return out;
}

export function checkCertificateDays(url: string, validTo: Date, now = new Date()): Finding[] {
  const days = Math.floor((validTo.getTime() - now.getTime()) / 86_400_000);
  const id = shortId("live", url, "cert");
  if (days < 0) return [{ id, category: "live", severity: "critical", title: "SSL certificate has expired", file: url, fix: "Renew the certificate now." }];
  if (days < 14) return [{ id, category: "live", severity: "high", title: `SSL certificate expires in ${days} days`, file: url, fix: "Renew it, or check auto-renewal is working." }];
  if (days < 30) return [{ id, category: "live", severity: "moderate", title: `SSL certificate expires in ${days} days`, file: url, fix: "Make sure auto-renewal is set up." }];
  return [];
}

function certificateExpiry(host: string): Promise<Date | null> {
  return new Promise((resolve) => {
    const socket = tls.connect({ host, port: 443, servername: host, timeout: 8000 }, () => {
      const cert = socket.getPeerCertificate();
      socket.end();
      resolve(cert?.valid_to ? new Date(cert.valid_to) : null);
    });
    socket.on("error", () => resolve(null));
    socket.on("timeout", () => {
      socket.destroy();
      resolve(null);
    });
  });
}

export async function scanLive(url: string): Promise<{ findings: Finding[]; note: string }> {
  const started = Date.now();
  try {
    const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(10_000) });
    const ms = Date.now() - started;
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => (headers[k] = v));
    const finalUrl = res.url || url;
    const findings = checkHeaders(finalUrl, headers, res.status, ms);
    if (finalUrl.startsWith("https://")) {
      const expiry = await certificateExpiry(new URL(finalUrl).hostname);
      if (expiry) findings.push(...checkCertificateDays(finalUrl, expiry));
    }
    return { findings, note: `${finalUrl} answered ${res.status} in ${ms} ms` };
  } catch (err) {
    return {
      findings: [{ id: shortId("live", url, "down"), category: "live", severity: "high", title: "Site didn't respond", file: url, detail: (err as Error).message, fix: "Check that the site is up and the URL is right." }],
      note: `couldn't reach ${url}`,
    };
  }
}
