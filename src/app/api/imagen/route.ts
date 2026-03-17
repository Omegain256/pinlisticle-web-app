import { NextResponse } from "next/server";

export async function POST(req: Request) {
    try {
        const { prompt, apiKey } = await req.json();

        if (!apiKey) {
            return NextResponse.json({ error: "No Gemini API Key provided." }, { status: 401 });
        }

        if (!prompt) {
            return NextResponse.json({ error: "No image prompt provided." }, { status: 400 });
        }

        // Force absolute realism onto every single generated prompt
        const fortifiedPrompt = `${prompt}, Ultra-realistic, extremely detailed, true-to-life photography. If humans are visible: PERFECT human anatomy, EXACTLY 5 digits per hand, exactly 2 normal hands, no extra limbs, normal human proportions, no mutations.`;

        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-001:predict?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                instances: [{ prompt: fortifiedPrompt }],
                parameters: {
                    sampleCount: 1,
                    aspectRatio: "9:16",
                    outputOptions: { mimeType: "image/jpeg" }
                }
            })
        });

        const data = await response.json();

        if (!response.ok) {
            return NextResponse.json({ error: data.error?.message || "Imagen API Error" }, { status: response.status });
        }

        const base64Image = data.predictions?.[0]?.bytesBase64Encoded;
        if (base64Image) {
            return NextResponse.json({ success: true, image: base64Image });
        }

        return NextResponse.json({ error: "Invalid image response format from Imagen." }, { status: 500 });

    } catch (error: any) {
        console.error("Imagen Route Error:", error);
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}
