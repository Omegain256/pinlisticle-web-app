import { NextResponse } from "next/server";
import { applyAuth } from "@/lib/auth";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

// GET — no API key needed, ADC token is resolved server-side
export async function GET() {
    try {
        const { url: authUrl, headers: authHeaders } = await applyAuth(GEMINI_BASE);
        const response = await fetch(authUrl, { headers: authHeaders });
        const data = await response.json();

        if (!response.ok) {
            return NextResponse.json(
                { error: data.error?.message || "Failed to fetch models from Google." },
                { status: response.status }
            );
        }

        const allModels = data.models || [];
        const filtered = allModels
            .map((m: any) => ({
                id: m.name.replace("models/", ""),
                name: m.displayName,
                description: m.description,
                supportedGenerationMethods: m.supportedGenerationMethods
            }))
            .filter((m: any) =>
                m.id.includes("gemini") ||
                m.id.includes("imagen")
            )
            .sort((a: any, b: any) => a.id.localeCompare(b.id));

        return NextResponse.json({ success: true, models: filtered });

    } catch (error: any) {
        console.error("Models Route Error:", error);
        return NextResponse.json(
            { error: error.message || "Internal Server Error" },
            { status: 500 }
        );
    }
}

// POST kept for backwards compatibility — ignores apiKey, uses ADC
export async function POST() {
    return GET();
}

