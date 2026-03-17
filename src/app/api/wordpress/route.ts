import { NextResponse } from "next/server";

export async function POST(req: Request) {
    try {
        const { action, wpUrl, wpUser, wpAppPassword, payload } = await req.json();

        if (!wpUrl || !wpUser || !wpAppPassword) {
            return NextResponse.json({ error: "Missing WordPress credentials." }, { status: 401 });
        }

        const auth = Buffer.from(`${wpUser}:${wpAppPassword}`).toString('base64');
        const headers = {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/json'
        };

        let endpoint = "";
        let options: RequestInit = { method: 'POST', headers };

        if (action === 'create_post') {
            endpoint = `${wpUrl.replace(/\/$/, '')}/wp-json/wp/v2/posts`; // Or your CPT: /wp/v2/pin_listicle
            options.body = JSON.stringify(payload);
        }
        else if (action === 'upload_media') {
            endpoint = `${wpUrl.replace(/\/$/, '')}/wp-json/wp/v2/media`;

            // Convert base64 back to binary for WP
            const imageBuffer = Buffer.from(payload.base64, 'base64');

            options.headers = {
                'Authorization': `Basic ${auth}`,
                'Content-Type': 'image/jpeg',
                'Content-Disposition': `attachment; filename="${payload.filename}"`
            };

            options.body = imageBuffer;
        }
        else {
            return NextResponse.json({ error: "Invalid action." }, { status: 400 });
        }

        const response = await fetch(endpoint, options);
        const data = await response.json();

        if (!response.ok) {
            return NextResponse.json({ error: data.message || "WordPress API Error" }, { status: response.status });
        }

        return NextResponse.json({ success: true, data });

    } catch (error: any) {
        console.error("WordPress Route Error:", error);
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}
