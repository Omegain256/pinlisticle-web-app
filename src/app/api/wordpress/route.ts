import { NextResponse } from "next/server";

export async function POST(req: Request) {
    try {
        const { action, wpUrl, wpUser, wpAppPassword, payload } = await req.json();

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
        // WordPress app passwords often copy with spaces (e.g. "aaaa bbbb"), we strip them before encoding
        const safePass = wpAppPassword.trim().replace(/\s+/g, '');

        const auth = Buffer.from(`${safeUser}:${safePass}`).toString('base64');
        const headers: Record<string, string> = {
            'Authorization': `Basic ${auth}`,
            'X-WP-Auth': `Basic ${auth}`, // Custom header to heavily bypass LiteSpeed stripping
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        };

        let endpoint = "";
        let options: RequestInit = { method: 'POST', headers };

        if (action === 'create_post') {
            endpoint = `${secureUrl.replace(/\/$/, '')}/wp-json/wp/v2/posts?pin_u=${encodeURIComponent(safeUser)}&pin_p=${encodeURIComponent(safePass)}`;
            options.body = JSON.stringify(payload);
        }
        else if (action === 'upload_media') {
            endpoint = `${secureUrl.replace(/\/$/, '')}/wp-json/wp/v2/media?pin_u=${encodeURIComponent(safeUser)}&pin_p=${encodeURIComponent(safePass)}`;

            // Convert base64 back to binary for WP
            const imageBuffer = Buffer.from(payload.base64, 'base64');
            
            options.headers = {
                // Keep headers as fallback
                'Authorization': `Basic ${auth}`,
                'X-WP-Auth': `Basic ${auth}`,
                'Content-Type': 'image/jpeg',
                'Content-Disposition': `attachment; filename="${payload.filename}"`,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
            };

            options.body = imageBuffer;
        }
        else if (action === 'test_connection') {
            endpoint = `${secureUrl.replace(/\/$/, '')}/wp-json/wp/v2/users/me?pin_u=${encodeURIComponent(safeUser)}&pin_p=${encodeURIComponent(safePass)}`;
            options.method = 'GET';
            delete options.body;
        }
        else {
            return NextResponse.json({ error: "Invalid action." }, { status: 400 });
        }

        const response = await fetch(endpoint, options);
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
        console.error("WordPress Route Error:", error);
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}
