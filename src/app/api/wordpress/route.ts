import { NextResponse } from "next/server";
import { request } from "https";

/**
 * A simple wrapper around Node's https.request to support rejectUnauthorized: false
 * since the global fetch API in Node.js 18+ (undici) doesn't allow it easily.
 */
function httpsRequest(url: string, options: any, body?: any): Promise<any> {
    return new Promise((resolve, reject) => {
        const parsedUrl = new URL(url);
        const reqOptions = {
            hostname: parsedUrl.hostname,
            path: parsedUrl.pathname + parsedUrl.search,
            method: options.method || 'GET',
            headers: options.headers || {},
            rejectUnauthorized: options.rejectUnauthorized !== false,
            port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
            timeout: 15000,
        };

        const req = request(reqOptions, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                resolve({
                    ok: res.statusCode ? res.statusCode >= 200 && res.statusCode < 300 : false,
                    status: res.statusCode,
                    text: () => Promise.resolve(data),
                    json: () => {
                        try { return Promise.resolve(JSON.parse(data)); }
                        catch (e) { return Promise.reject(new Error("Invalid JSON response")); }
                    }
                });
            });
        });

        req.on('error', (e) => reject(e));
        req.on('timeout', () => {
            req.destroy();
            reject(new Error("Connection timed out"));
        });

        if (body) {
            req.write(body);
        }
        req.end();
    });
}

export async function POST(req: Request) {
    try {
        const { action, wpUrl, wpUser, wpAppPassword, payload, skipSsl } = await req.json();

        if (!wpUrl || !wpUser || !wpAppPassword) {
            return NextResponse.json({ error: "Missing WordPress credentials." }, { status: 401 });
        }

        // Fix for HTTP->HTTPS 301 redirects which strip Authorization headers
        let secureUrl = wpUrl;
        if (secureUrl.startsWith('http://') && !secureUrl.includes('localhost')) {
            secureUrl = secureUrl.replace('http://', 'https://');
        }

        // Clean credentials to prevent invisible copy/paste space errors
        const safeUser = wpUser.trim();
        const safePass = wpAppPassword.trim().replace(/\s+/g, '');

        const auth = Buffer.from(`${safeUser}:${safePass}`).toString('base64');
        const headers: Record<string, string> = {
            'Authorization': `Basic ${auth}`,
            'X-WP-Auth': `Basic ${auth}`, 
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Referer': secureUrl,
            'Origin': secureUrl
        };

        let endpoint = "";
        let method = 'POST';
        let body: any = null;

        if (action === 'create_post') {
            endpoint = `${secureUrl.replace(/\/$/, '')}/wp-json/wp/v2/posts?pin_u=${encodeURIComponent(safeUser)}&pin_p=${encodeURIComponent(safePass)}`;
            body = JSON.stringify(payload);
        }
        else if (action === 'upload_media') {
            endpoint = `${secureUrl.replace(/\/$/, '')}/wp-json/wp/v2/media?pin_u=${encodeURIComponent(safeUser)}&pin_p=${encodeURIComponent(safePass)}`;
            body = Buffer.from(payload.base64, 'base64');
            headers['Content-Type'] = 'image/jpeg';
            headers['Content-Disposition'] = `attachment; filename="${payload.filename}"`;
        }
        else if (action === 'test_connection') {
            endpoint = `${secureUrl.replace(/\/$/, '')}/wp-json/wp/v2/users/me?pin_u=${encodeURIComponent(safeUser)}&pin_p=${encodeURIComponent(safePass)}`;
            method = 'GET';
        }
        else {
            return NextResponse.json({ error: "Invalid action." }, { status: 400 });
        }

        let response;
        if (skipSsl) {
            // Use fallback with SSL bypass
            response = await httpsRequest(endpoint, { method, headers, rejectUnauthorized: false }, body);
        } else {
            // Try standard fetch first
            try {
                response = await fetch(endpoint, { method, headers, body });
            } catch (err: any) {
                // If it's a hostname mismatch error and we are testing, try one more time with fallback
                if (action === 'test_connection') {
                     response = await httpsRequest(endpoint, { method, headers, rejectUnauthorized: false }, body);
                } else {
                    throw err; // Re-throw to catch block
                }
            }
        }

        let data;
        const textResponse = await response.text();
        try {
            data = JSON.parse(textResponse);
        } catch (e) {
            return NextResponse.json({ error: `WordPress API returned an invalid response (not JSON). Code: ${response.status}`, details: textResponse.substring(0, 100) }, { status: response.status || 500 });
        }

        if (!response.ok) {
            return NextResponse.json({ 
                error: data.message || "WordPress API Error",
                code: data.code || 'unknown_error',
                status: response.status 
            }, { status: response.status });
        }

        return NextResponse.json({ success: true, data });

    } catch (error: any) {
        console.error("❌ WordPress Route Error:", error);
        
        if (error.cause) {
            console.error("  -> Cause:", error.cause);
        }

        // TypeError: fetch failed = network unreachable (bad URL, DNS failure, SSL cert, firewall)
        if (error instanceof TypeError && error.message === "fetch failed") {
            const cause = (error as any).cause;
            const code = cause?.code;
            
            let detail = "Cannot connect to the WordPress server. Check the URL.";
            
            if (code === "DEPTH_ZERO_SELF_SIGNED_CERT" || code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" || code === "CERT_HAS_EXPIRED") {
                detail = `SSL Error (${code}). Your WordPress site has an invalid or expired SSL certificate. Try using http:// (if supported) or fix your SSL.`;
            } else if (code === "ECONNREFUSED") {
                detail = "Connection refused. The server is down or blocking this app's IP.";
            } else if (code === "ENOTFOUND") {
                detail = "DNS lookup failed. The domain name is incorrect or not resolving.";
            } else if (code === "ETIMEDOUT") {
                detail = "Connection timed out. The server took too long to respond.";
            } else if (cause?.message) {
                detail = `Network Error: ${cause.message}`;
            }

            return NextResponse.json({ 
                error: detail, 
                debug: { code, message: cause?.message, url: error.message } 
            }, { status: 503 });
        }

        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}
