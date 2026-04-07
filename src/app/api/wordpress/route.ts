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
async function wpRequest(url: string, options: { method: string; headers: any; skipSsl?: boolean }, body?: any): Promise<any> {
    return new Promise((resolve, reject) => {
        try {
            const parsedUrl = new URL(url);
            const isHttps = parsedUrl.protocol === 'https:';
            const requestFn = isHttps ? httpsRequest : httpRequest;
            
            const reqOptions = {
                hostname: parsedUrl.hostname,
                path: parsedUrl.pathname + parsedUrl.search,
                method: options.method,
                headers: options.headers,
                // THE MASTER SSL BYPASS KEY:
                rejectUnauthorized: options.skipSsl !== true,
                port: parsedUrl.port || (isHttps ? 443 : 80),
                timeout: 20000,
            };

            const req = requestFn(reqOptions, (res) => {
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

            req.on('error', (e) => reject(e));
            req.on('timeout', () => {
                req.destroy();
                reject(new Error("The WordPress server took too long to respond (Timeout)."));
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
        }
        else if (action === 'upload_media') {
            endpoint = `${baseUrl}/wp-json/wp/v2/media`;
            headers['Content-Type'] = 'image/jpeg';
            headers['Content-Disposition'] = `attachment; filename="${payload.filename || 'upload.jpg'}"`;
            fetchBody = Buffer.from(payload.base64, 'base64');
            headers['Content-Length'] = fetchBody.length.toString();
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
        
        const message = error.message || "An unexpected error occurred in the proxy.";
        const code = error.cause?.code || error.code || 'RUNTIME_ERROR';

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
            debug: { code, stage, message }
        }, { status: 500 });
    }
}
