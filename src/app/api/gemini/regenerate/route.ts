import { NextResponse } from "next/server";

const MODELS = {
    pro: "gemini-2.5-pro",
    lite: "gemini-2.0-flash-lite",
} as const;

type ModelKey = keyof typeof MODELS;

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export async function POST(req: Request) {
    try {
        const { topic, itemTitle, itemContent, apiKey, model: modelPref } = await req.json();

        if (!apiKey) {
            return NextResponse.json({ error: "No Gemini API Key provided." }, { status: 401 });
        }

        const modelId = MODELS[(modelPref as ModelKey) ?? "pro"] ?? MODELS.pro;

        const system_instruction = [
            "You are an expert Pinterest content creator and editor.",
            "Your task is to rewrite a single listicle subsection to be more engaging, trendy, and highly specific.",
            "RULES:",
            "- Write in the style of high-end editorial blogs.",
            "- BANNED WORDS: do NOT use clichés or common AI words such as 'chic', 'elevate', 'unveil', 'delve', or 'testament'.",
            "- The content field MUST be exactly ~60 words — deeply researched, engaging, and highly informative.",
            "- The title MUST BE VERY SHORT (max 4-5 words), exceptionally catchy, creative, and use emotional hooks or power words.",
            "- Return ONLY a valid raw JSON object matching the exact schema provided — no markdown fences, no explanation, no extra text.",
        ].join(" ");

        let prompt = `We are rewriting an item for the overall topic: "${topic}".\n\n`;
        prompt += `Original Title: "${itemTitle}"\n`;
        prompt += `Original Content: "${itemContent}"\n\n`;
        prompt += `Please rewrite this to improve its trendy, editorial appeal while keeping the same core subject.\n\n`;

        prompt += `Return a JSON object matching this schema exactly:\n`;
        prompt += `{\n`;
        prompt += `  "title": "Very short, punchy, creative subtitle (max 4-5 words) using power words",\n`;
        prompt += `  "content": "Deeply researched, trendy, highly specific description. Exactly ~60 words. No generic info."\n`;
        prompt += `}`;

        const response = await fetch(`${GEMINI_BASE}/${modelId}:generateContent?key=${apiKey}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                system_instruction: { parts: [{ text: system_instruction }] },
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    responseMimeType: "application/json",
                    temperature: 0.9,
                    topP: 0.95,
                    topK: 40,
                },
            }),
        });

        const data = await response.json();

        if (!response.ok) {
            return NextResponse.json(
                { error: data.error?.message || "Gemini API Error" },
                { status: response.status }
            );
        }

        const textPayload = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!textPayload) {
            return NextResponse.json(
                { error: "Invalid response format from Gemini.", raw: data },
                { status: 500 }
            );
        }

        try {
            const parsed = JSON.parse(textPayload);
            return NextResponse.json({ success: true, data: parsed, model: modelId });
        } catch {
            return NextResponse.json(
                { error: "Failed to parse JSON from Gemini.", raw: textPayload },
                { status: 500 }
            );
        }
    } catch (error: any) {
        console.error("Gemini Regenerate Route Error:", error);
        return NextResponse.json(
            { error: error.message || "Internal Server Error" },
            { status: 500 }
        );
    }
}
