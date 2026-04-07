import { NextResponse } from "next/server";

export async function POST(req: Request) {
    let stage = "initialization";
    try {
        const body = await req.json();
        const { action, wpUrl, wpUser, wpAppPassword, payload, skipSsl } = body;
        
        console.log(`[WP Proxy] Action: ${action} | URL: ${wpUrl}`);
        stage = "validation";

        if (!wpUrl || !wpUser || !wpAppPassword) {
            return NextResponse.json({ error: "Missing WordPress credentials." }, { status: 401 });
        }

        stage = "auth_encoding";
        const safeUser = wpUser.trim();
        const safePass = wpAppPassword.trim().replace(/\s+/g, '');
        
        // Use Buffer for UTF-8 compatibility (safer than btoa in Node)
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
        }
        else if (action === 'test_connection') {
            endpoint = `${baseUrl}/wp-json/wp/v2/users/me`;
            method = 'GET';
        }

        if (method === 'GET') {
            delete headers['Content-Type'];
        }

        stage = "network_fetch";
        console.log(`[WP Proxy] Fetching ${endpoint} (${method})`);
        
        const response = await fetch(endpoint, {
            method,
            headers,
            body: fetchBody,
            cache: 'no-store'
        });

        stage = "response_parsing";
        const textResponse = await response.text();
        let data;
        try {
            data = JSON.parse(textResponse);
        } catch (e) {
            console.error(`[WP Proxy] Non-JSON response from ${baseUrl}:`, textResponse.substring(0, 500));
            return NextResponse.json({ 
                error: `The WordPress site returned an invalid response (not JSON). HTTP ${response.status}`, 
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

        return NextResponse.json({ 
            error: `Connection Failed at stage [${stage}]: ${message}`,
            debug: { code, stage, message }
        }, { status: 500 });
    }
}
