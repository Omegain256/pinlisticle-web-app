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

        // Best strategy for Pinterest realism: Anti-AI aesthetics. Force amateur smartphone photography, natural textures, and unedited looks.
        const fortifiedPrompt = `${prompt}, highly realistic candid snapshot, true amateur photography, shot on smartphone, natural skin texture, visible pores, asymmetrical features, unedited, authentic everyday life, slight motion blur, zero studio lighting, zero airbrushing, raw photo. CRITICAL: Frame the shot so hands are entirely OUT OF FRAME or hidden deep in pockets. No visible fingers.`;

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
