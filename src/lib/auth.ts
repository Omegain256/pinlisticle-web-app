/**
 * auth.ts — Server-side Application Default Credentials (ADC) token helper.
 *
 * Provides a single `getAccessToken()` function that returns a short-lived
 * OAuth2 Bearer token for the Google Generative Language / AI Platform APIs.
 *
 * Auth resolution order (standard ADC chain):
 *   1. GOOGLE_APPLICATION_CREDENTIALS_JSON env var  → Service Account (production)
 *   2. GOOGLE_APPLICATION_CREDENTIALS file path      → Service Account via file
 *   3. ~/.config/gcloud/application_default_credentials.json → local gcloud login
 */

import { GoogleAuth } from "google-auth-library";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// Scopes required for Gemini + Imagen via Generative Language API
const SCOPES = ["https://www.googleapis.com/auth/cloud-platform"];

// ─── Token cache ───────────────────────────────────────────────────────────────
// Reuse the same token across requests until it's within 5 minutes of expiry.
let _cachedToken: string | null = null;
let _tokenExpiresAt: number = 0; // Unix ms

// ─── Service Account bootstrap ────────────────────────────────────────────────
// In production the JSON key is stored as a single env var (no file on disk).
// We write it to a temp file once so GoogleAuth can pick it up normally.
let _serviceAccountTmpPath: string | null = null;

function bootstrapServiceAccount(): void {
    if (_serviceAccountTmpPath) return; // already done

    const jsonEnv = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
    if (!jsonEnv) return; // not set — fall through to other ADC sources

    try {
        // Validate it parses as JSON before writing
        JSON.parse(jsonEnv);
        const tmpDir = os.tmpdir();
        const tmpFile = path.join(tmpDir, "gac-pinlisticle.json");
        fs.writeFileSync(tmpFile, jsonEnv, { encoding: "utf8", mode: 0o600 });
        process.env.GOOGLE_APPLICATION_CREDENTIALS = tmpFile;
        _serviceAccountTmpPath = tmpFile;
        console.log("[ADC] Service Account credentials loaded from env var.");
    } catch (e) {
        console.error("[ADC] Failed to parse GOOGLE_APPLICATION_CREDENTIALS_JSON:", e);
    }
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Returns a valid OAuth2 Bearer token using Application Default Credentials.
 * Tokens are cached in memory and refreshed automatically before expiry.
 */
export async function getAccessToken(): Promise<string> {
    // 1. Bootstrap service account if env var is set
    bootstrapServiceAccount();

    // 2. Return cached token if still valid (with 5-min buffer)
    const now = Date.now();
    if (_cachedToken && _tokenExpiresAt - now > 5 * 60 * 1000) {
        return _cachedToken;
    }

    // 3. Fetch a new token via ADC
    const auth = new GoogleAuth({ scopes: SCOPES });
    const client = await auth.getClient();
    const tokenResponse = await client.getAccessToken();

    if (!tokenResponse.token) {
        throw new Error("ADC returned an empty token.");
    }

    _cachedToken = tokenResponse.token;
    _tokenExpiresAt = now + 55 * 60 * 1000;
    console.log("[ADC] New access token acquired successfully.");
    return _cachedToken;
}

// ─── Universal auth applier ──────────────────────────────────────────────────────

/**
 * Applies authentication to a URL + headers using whichever method is available:
 *   1. ADC / Service Account  → Authorization: Bearer <token>  (no key in URL)
 *   2. GEMINI_API_KEY env var → ?key=<apiKey> appended to URL
 *
 * Production (Vercel/Render) without a service account JSON:
 *   Just add  GEMINI_API_KEY=AIzaSy...  in your environment variables.
 *
 * @param baseUrl  The endpoint URL without any auth params.
 * @param headers  Existing headers object (will be merged, not mutated).
 */
export async function applyAuth(
    baseUrl: string,
    headers: Record<string, string> = {}
): Promise<{ url: string; headers: Record<string, string> }> {
    // ── Path 1: ADC / Service Account ───────────────────────────────────
    try {
        const token = await getAccessToken();
        return {
            url: baseUrl,
            headers: { ...headers, Authorization: `Bearer ${token}` },
        };
    } catch {
        // ADC not available — fall through to API key
    }

    // ── Path 2: GEMINI_API_KEY environment variable ────────────────────
    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey) {
        console.log("[Auth] Using GEMINI_API_KEY env var.");
        const sep = baseUrl.includes("?") ? "&" : "?";
        return { url: `${baseUrl}${sep}key=${apiKey}`, headers };
    }

    throw new Error(
        "No authentication configured.\n" +
        "  Local dev : run  gcloud auth application-default login\n" +
        "  Production: add  GEMINI_API_KEY=AIzaSy...  in your Vercel/Render env vars"
    );
}
