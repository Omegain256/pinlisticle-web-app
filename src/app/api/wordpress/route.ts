import { NextResponse } from "next/server";
import { request as httpsRequest } from "https";
import { request as httpRequest } from "http";

/**
 * A robust Node.js request wrapper for WordPress that supports:
 * 1. SSL Bypass (rejectUnauthorized: false)
 * 2. HTTP/HTTPS protocol switching
 * 3. Binary & JSON payloads
 * 
 * This is the 'Master Fix' for WordPress hostname mismatches and SSL errors.
 */
async function wpRequest(
    url: string, 
    options: { method: string; headers: any; skipSsl?: boolean }, 
    body?: any,
    redirectCount = 0
): Promise<any> {
    const MAX_REDIRECTS = 3;

    return new Promise((resolve, reject) => {
        try {
            const parsedUrl = new URL(url);
            const isHttps = parsedUrl.protocol === 'https:';
            const requestFn = isHttps ? httpsRequest : httpRequest;
            
            // Explicitly set the Host header to the target domain.
            // This is critical for sites behind Cloudflare/WAFs like hairmusings.com.
            const headers = { ...options.headers };
            headers['Host'] = parsedUrl.hostname;

            const reqOptions = {
                hostname: parsedUrl.hostname,
                path: parsedUrl.pathname + parsedUrl.search,
                method: options.method,
                headers: headers,
                // THE MASTER SSL BYPASS KEY:
                rejectUnauthorized: options.skipSsl !== true,
                port: parsedUrl.port || (isHttps ? 443 : 80),
                timeout: 20000,
            };

            const req = requestFn(reqOptions, (res) => {
                // HANDLE REDIRECTS (Found on sites like hairmusings.com)
                if ([301, 302, 307, 308].includes(res.statusCode || 0) && res.headers.location) {
                    if (redirectCount >= MAX_REDIRECTS) {
                        return reject(new Error("Too many redirects from WordPress server. Check your site settings."));
                    }
                    console.log(`[WP Proxy] Redirecting (${res.statusCode}) to: ${res.headers.location}`);
                    
                    // Resolve relative URLs
                    const nextUrl = new URL(res.headers.location, url).toString();
                    return resolve(wpRequest(nextUrl, options, body, redirectCount + 1));
                }

                let data = Buffer.alloc(0);
                res.on('data', (chunk) => {
                    data = Buffer.concat([data, chunk]);
                });
                res.on('end', () => {
                    const text = data.toString('utf-8');
                    resolve({
                        ok: res.statusCode ? res.statusCode >= 200 && res.statusCode < 300 : false,
                        status: res.statusCode,
                        text: () => Promise.resolve(text),
                        json: () => {
                            try { return Promise.resolve(JSON.parse(text)); }
                            catch (e) { return Promise.reject(new Error("Invalid JSON response from WordPress")); }
                        }
                    });
                });
            });

            req.on('error', (e) => {
                console.error(`[WP Proxy] Request Error for ${url}:`, e);
                reject(e);
            });
            
            req.on('timeout', () => {
                req.destroy();
                reject(new Error(`The WordPress server at ${parsedUrl.hostname} took too long to respond (Timeout).`));
            });

            if (body) {
                req.write(body);
            }
            req.end();
        } catch (e) {
            reject(e);
        }
    });
}

export const maxDuration = 300; // 5 minutes
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
    let stage = "initialization";
    try {
        const body = await req.json();
        const { action, wpUrl, wpUser, wpAppPassword, payload, skipSsl } = body;
        
        console.log(`[WP Proxy] Action: ${action} | URL: ${wpUrl} | SSL Bypass: ${skipSsl}`);
        stage = "validation";

        if (!wpUrl || !wpUser || !wpAppPassword) {
            return NextResponse.json({ error: "Missing WordPress credentials." }, { status: 401 });
        }

        stage = "auth_encoding";
        const safeUser = wpUser.trim();
        const safePass = wpAppPassword.trim().replace(/\s+/g, '');
        const auth = Buffer.from(`${safeUser}:${safePass}`).toString('base64');

        stage = "header_preparation";
        const headers: Record<string, string> = {
            'Authorization': `Basic ${auth}`,
            'X-WP-Auth': `Basic ${auth}`, 
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Accept': 'application/json',
            'Referer': wpUrl,
            'Origin': wpUrl
        };

        let endpoint = "";
        let method = 'POST';
        let fetchBody: any = null;

        const baseUrl = wpUrl.replace(/\/$/, '');

        stage = "payload_handling";
        if (action === 'create_post') {
            endpoint = `${baseUrl}/wp-json/wp/v2/posts`;
            headers['Content-Type'] = 'application/json';
            fetchBody = JSON.stringify(payload);
            headers['Content-Length'] = Buffer.byteLength(fetchBody, 'utf8').toString();
        }
        else if (action === 'upload_media') {
            endpoint = `${baseUrl}/wp-json/wp/v2/media`;
            headers['Content-Type'] = 'image/jpeg';
            headers['Content-Disposition'] = `attachment; filename="${payload.filename || 'upload.jpg'}"`;
            fetchBody = Buffer.from(payload.base64, 'base64');
            headers['Content-Length'] = fetchBody.length.toString();
            console.log(`[WP Proxy] Uploading media: ${payload.filename} (${fetchBody.length} bytes)`);
        }
        else if (action === 'test_connection') {
            endpoint = `${baseUrl}/wp-json/wp/v2/users/me`;
            method = 'GET';
        }

        stage = "network_request";
        console.log(`[WP Proxy] Sending request to ${endpoint} (${method}). SSL Bypass: ${skipSsl}`);
        
        const response = await wpRequest(endpoint, { 
            method, 
            headers, 
            skipSsl: skipSsl === true 
        }, fetchBody);

        stage = "response_parsing";
        let data;
        const textResponse = await response.text();
        try {
            data = JSON.parse(textResponse);
        } catch (e) {
            console.error(`[WP Proxy] Non-JSON response from ${baseUrl}:`, textResponse.substring(0, 500));
            return NextResponse.json({ 
                error: `WordPress returned a non-JSON response (HTTP ${response.status})`, 
                debug: textResponse.substring(0, 100) 
            }, { status: 502 });
        }

        if (!response.ok) {
            return NextResponse.json({ 
                error: data.message || "WordPress rejected the request.",
                code: data.code || 'wp_error',
                status: response.status 
            }, { status: response.status });
        }

        return NextResponse.json({ success: true, data });

    } catch (error: any) {
        console.error(`❌ [WP Proxy] Error at stage [${stage}]:`, error);
        
        let message = error?.message;
        if (!message) {
            try { message = JSON.stringify(error); } 
            catch(err) { message = String(error); }
        }
        if (!message || message === '{}') {
            message = "An unexpected error occurred in the proxy (No error message provided).";
        }

        const code = error?.cause?.code || error?.code || 'RUNTIME_ERROR';

        // Specific handling for SSL/Network errors to guide the user
        let detail = message;
        if (code === "ERR_TLS_CERT_ALTNAME_INVALID" || code === "DEPTH_ZERO_SELF_SIGNED_CERT" || code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE") {
            detail = `SSL Security Error (${code}). Please enable 'Bypass SSL Verification' in Settings and try again.`;
        } else if (code === "ECONNREFUSED") {
            detail = "Connection refused. Your WordPress site is not reachable or is blocking this connection.";
        } else if (code === "ENOTFOUND") {
            detail = "DNS error. The URL domain name cannot be resolved.";
        }

        return NextResponse.json({ 
            error: `Connection Failed at stage [${stage}]: ${detail}`,
            debug: { code, stage, message, rawError: error ? String(error) : 'null' }
        }, { status: 500 });
    }
}
