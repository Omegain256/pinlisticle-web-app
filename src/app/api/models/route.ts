import { NextResponse } from "next/server";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export async function POST(req: Request) {
    try {
        const { apiKey } = await req.json();

        if (!apiKey) {
            return NextResponse.json({ error: "No API Key provided." }, { status: 401 });
        }

        // Fetch ALL models visible to this key
        const response = await fetch(`${GEMINI_BASE}?key=${apiKey}`);
        const data = await response.json();

        if (!response.ok) {
            return NextResponse.json(
                { error: data.error?.message || "Failed to fetch models from Google." },
                { status: response.status }
            );
        }

        // Filter and categorize for the UI
        const allModels = data.models || [];
        
        // We look for Gemini and Imagen models
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

        return NextResponse.json({ 
            success: true, 
            models: filtered 
        });

    } catch (error: any) {
        console.error("Models Route Error:", error);
        return NextResponse.json(
            { error: error.message || "Internal Server Error" },
            { status: 500 }
        );
    }
}
