// Utility functions for interacting with Google's Generative Language API from the client.
// This bypasses Vercel's strict 4.5MB payload limits and 10s Serverless Function timeouts.

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

const MODELS = {
    pro: "gemini-2.5-pro",
    lite: "gemini-2.0-flash-lite",
} as const;

export type Tone = "Casual" | "Professional" | "Fun" | "Minimal";

export async function generateContent(params: {
    topic: string;
    keyword?: string;
    tone: Tone;
    count: number;
    apiKey: string;
    modelPrefix: "pro" | "lite";
}) {
    const { topic, keyword, tone, count, apiKey, modelPrefix } = params;
    const modelId = MODELS[modelPrefix] || MODELS.pro;

    const system_instruction = [
        "You are an elite-level editorial writer for high-end publications like GQ, Vogue, and Harper's Bazaar.",
        "Your writing is sophisticated, culturally aware, and narrative-driven. You avoid generic AI fluff and PR-speak.",
        "GOAL: Write a Pinterest listicle that feels like a premium GQ feature — authoritative, discerning, and exceptionally well-written.",
        "RULES:",
        `- The current year is ${new Date().getFullYear()}. Base the article on current trends, but DO NOT explicitly mention the year in every subsection.`,
        "- Base the article entirely on thorough research and verifiable trends. Provide specific details that show true expertise.",
        "- STYLE: Aim for a sharp, sophisticated editorial voice. Use varied sentence structures and a rich, mature vocabulary.",
        "- BANNED WORDS: do NOT use AI-isms like 'chic', 'elevate', 'unveil', 'delve', 'testament', 'journey', or 'look no further'.",
        "- CRITICAL TITLES: For 'seo_title', 'pinterest_title', your titles MUST start with the exact number of listicles. Example: '10 High-End Watches for Men'.",
        "- STRICT DEMOGRAPHIC ALIGNMENT: Ensure all content and image prompts strictly match the gender/demographic of the Target Topic.",
        "- THE INTRODUCTION: Must be exactly ~60 words. It should set a compelling, narrative scene (editorial style).",
        "- LISTICLE ENTRIES: Each entry content MUST be exactly ~60 words. Don't just describe the item; explain WHY it's essential, the history/craftsmanship behind it, or how it fits into a modern lifestyle.",
        "- SUBTITLES: Must be exceptionally punchy (max 4-5 words). Avoid generic labels. Use 'Hook' titles.",
        "- image_prompt: Follow this formula for extreme realism: '[Subject description], [Setting/Background], [Lighting], [Camera Angle/Shot Type], raw photo, UGC candid style, 8k resolution, photorealistic'.",
        "- ANATOMY: Append instructions for perfect human anatomy (e.g., 'anatomically correct hands, 5 fingers, realistic skin').",
        "- BANNED VISUALS: Never result in distorted anatomy or missing features. Emphasize 'real-world photography'.",
        "- PRODUCTS: Recommendations must be specific real-world products suitable for a GQ-level audience.",
        "- SHORT PRODUCTS: Keep product names concise (e.g., 'Cartier Tank' instead of 'Cartier Tank Must de Cartier Small Model').",
        "- Return ONLY a valid raw JSON object.",
    ].join(" ");

    let prompt = `Target Topic: ${topic}\n`;
    if (keyword) prompt += `Primary SEO Keyword: ${keyword}\n`;
    prompt += `Tone of Voice: ${tone || "Casual"}\n`;
    prompt += `Number of Listicle Items: ${count || 10}\n\n`;

    prompt += `Return a JSON object matching this schema exactly:\n`;
    prompt += `{\n`;
    prompt += `  "seo_title": "SEO-optimized title, max 60 characters, include the primary keyword naturally",\n`;
    prompt += `  "seo_desc": "Compelling meta description, max 155 characters, include a soft call-to-action",\n`;
    prompt += `  "pinterest_title": "Catchy Pinterest-optimized title with emotional hooks and power words",\n`;
    prompt += `  "pinterest_desc": "Pinterest description with 3-5 relevant hashtags and a call-to-action, max 500 chars",\n`;
    prompt += `  "article_intro": "Engaging article introduction, exactly ~60 words, hooks the reader immediately",\n`;
    prompt += `  "listicle_items": [\n    {\n`;
    prompt += `      "title": "Very short, punchy, creative subtitle (max 4-5 words) using power words",\n`;
    prompt += `      "content": "Deeply researched, trendy, highly specific description. Exactly ~60 words. No generic info.",\n`;
    prompt += `      "image_prompt": "Highly detailed photographic formula (e.g., 'Woman in butter yellow slip dress, bright vineyard garden, golden hour lighting, candid full body shot, 35mm lens, raw photo, highly realistic')",\n`;
    prompt += `      "product_recommendations": [\n`;
    prompt += `        { "product_name": "Specific real-world brand/product name", "amazon_search_term": "precise search term for Amazon" }\n`;
    prompt += `      ] // Generate EXACTLY 3 product recommendations per listicle item.\n    }\n  ]\n}`;

    const res = await fetch(`${GEMINI_BASE}/${modelId}:generateContent?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            system_instruction: { parts: [{ text: system_instruction }] },
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
                responseMimeType: "application/json",
                temperature: 0.8,
                topP: 0.95,
                topK: 40,
            },
        }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || "Gemini API Error");

    const textPayload = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!textPayload) throw new Error("Invalid response format from Gemini.");

    try {
        return JSON.parse(textPayload);
    } catch {
        throw new Error("Failed to parse JSON from Gemini.");
    }
}

export async function generateImage(params: { prompt: string; apiKey: string }) {
    const { prompt, apiKey } = params;

    const fortifiedPrompt = `${prompt}, Ultra-realistic, extremely detailed, true-to-life photography. If humans are visible: PERFECT human anatomy, EXACTLY 5 digits per hand, exactly 2 normal hands, no extra limbs, normal human proportions, no mutations.`;

    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-001:predict?key=${apiKey}`, {
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

    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || "Imagen API Error");

    const base64Image = data.predictions?.[0]?.bytesBase64Encoded;
    if (!base64Image) throw new Error("Invalid image response format from Imagen.");

    return base64Image;
}

export async function regenerateText(params: {
    topic: string;
    itemTitle: string;
    itemContent: string;
    apiKey: string;
    modelPrefix: "pro" | "lite";
}) {
    const { topic, itemTitle, itemContent, apiKey, modelPrefix } = params;
    const modelId = MODELS[modelPrefix] || MODELS.pro;

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

    const res = await fetch(`${GEMINI_BASE}/${modelId}:generateContent?key=${apiKey}`, {
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

    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || "Gemini API Error");

    const textPayload = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!textPayload) throw new Error("Invalid response format from Gemini.");

    try {
        return JSON.parse(textPayload);
    } catch {
        throw new Error("Failed to parse JSON from Gemini.");
    }
}
