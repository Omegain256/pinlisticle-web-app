import { NextResponse } from "next/server";

// ─── Available models on this API key ────────────────────────────────────────
// gemini-2.5-pro       → best quality, 1M token context, supports thinking
// gemini-2.0-flash-lite → fast & lightweight, ideal for large batches
//
// Note: gemini-1.5-flash has been deprecated from v1beta. Use the models above.

const MODELS = {
    pro: "gemini-2.5-pro",
    lite: "gemini-2.5-flash",
} as const;

type ModelKey = keyof typeof MODELS;

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export async function POST(req: Request) {
    try {
        const { topic, keyword, tone, count, apiKey, model: modelPref, brandVoice, internalLinks } = await req.json();

        if (!apiKey) {
            return NextResponse.json({ error: "No Gemini API Key provided." }, { status: 401 });
        }

        // Dashboard-confirmed models: gemini-2.5-flash (1K RPM) > gemini-2.5-pro (150 RPM)
        let modelId = "gemini-2.5-flash";
        if (modelPref === "lite" || modelPref === "gemini-2.0-flash-lite" || modelPref === "gemini-2.0-flash") {
            modelId = "gemini-2.5-flash";
        } else if (modelPref === "pro" || modelPref === "gemini-2.1-pro" || modelPref === "gemini-2.5-pro") {
            modelId = "gemini-2.5-pro";
        } else if (modelPref && modelPref.includes("gemini")) {
            modelId = modelPref;
        }

        const system_instruction_arr = [
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
            "- LISTICLE ENTRIES: Each entry content MUST be exactly ~60 words. They MUST be deeply researched, highly specific, and up-to-date with current trends. Absolutely NO generic fluff or surface-level knowledge. Explain specific details, real-world relevance, and why it is essential.",
            "- SUBTITLES: Must be exceptionally punchy (max 4-5 words). Avoid generic labels. Use 'Hook' titles.",
            "- image_prompt DIVERSITY (CRITICAL): Every image prompt MUST be a highly-aesthetic, influencer-style fashion photo. Mix between 'street style candid photography' AND 'aesthetic indoor mirror selfies'. Focus entirely on showing the trendy outfit. Do NOT make them all look the same. Use diverse settings (e.g., sunny city streets, outdoor patios, aesthetic bedrooms with mirrors).",
            "- image_prompt FRAMING (MANDATORY): The MAIN focus is showing the COMPLETE OUTFIT from top to bottom. If it's a street photo, say 'Full body street style shot, standing on the ground, shoes visible'. If it's a mirror selfie, describe the phone and the full-length mirror showing the entire outfit.",
            "- image_prompt FORMAT: The returned value MUST follow this formula exactly: 'Full body [street style photo OR mirror selfie]. [Specific diverse setting, e.g., bright sunny patio, minimalist bedroom]. [Detailed trendy outfit describing top, bottom, and SPECIFIC SHOES]. [Camera style: e.g., shot on iPhone]. Influencer aesthetic, 100% human realistic, unposed.'",
            "- IMPERFECT REALISM: Demand natural textures. Avoid 'dreamy' or 'studio lighting'. Use 'direct sunlight', 'bright daylight', or 'aesthetic indoor lighting'.",
            "- AVOID HANDS PARADOX: AI struggles with hands. Ask for poses that hide hands naturally (e.g., holding a coffee cup, carrying a small bag, hands in pockets, or holding a phone for a mirror selfie).",
            "- RECREATE THIS LOOK (CRITICAL): The `product_recommendations` MUST BE the specific individual pieces that make up the outfit described in the `image_prompt`. For EACH listicle entry, you MUST provide exactly 3 product recommendations (e.g., the shoes, the bottom, and the top/outerwear) that collectively recreate the complete 'look' shown in the image. Ensure the products are specific real-world items that match the aesthetic perfectly.",
            "- Return ONLY a valid raw JSON object.",
        ];

        if (brandVoice) {
            system_instruction_arr.push("- BRAND VOICE MATCH (CRITICAL): The user has provided an exact Brand Voice DNA sample in the prompt. You must forcefully overwrite your default writing tone to seamlessly match their vocabulary, rhythm, and sentence structure. Sound EXACTLY like them.");
        }

        if (internalLinks) {
            system_instruction_arr.push("- INTERNAL LINKING: The user has provided a list of their own website URLs. Inject 1-2 of these URLs as valid HTML `<a href=\"...\">keyword</a>` anchors into the `content` field of the SECOND or THIRD listicle item only (index 1 or 2, never index 0). They must blend naturally into the sentence. Do NOT put links in the intro, the first item, or the last item.");
        }

        const system_instruction = system_instruction_arr.join(" ");

        let prompt = `Target Topic: ${topic}\n`;
        if (keyword) prompt += `Primary SEO Keyword: ${keyword}\n`;
        prompt += `Tone of Voice: ${tone || "Casual"}\n`;
        prompt += `Number of Listicle Items: ${count || 10}\n\n`;

        if (brandVoice) {
            prompt += `--- BRAND VOICE DNA SAMPLES ---\n`;
            prompt += `${brandVoice}\n`;
            prompt += `-------------------------------\n\n`;
        }

        if (internalLinks) {
            prompt += `--- INTERNAL SEO LINKS TO INJECT ---\n`;
            prompt += `${internalLinks}\n`;
            prompt += `------------------------------------\n\n`;
        }

        prompt += `Return a JSON object matching this schema exactly:\n`;
        prompt += `{\n`;
        prompt += `  "seo_title": "SEO-optimized title, max 60 characters, include the primary keyword naturally",\n`;
        prompt += `  "seo_desc": "Compelling meta description, max 155 characters, include a soft call-to-action",\n`;
        prompt += `  "pinterest_title": "Catchy Pinterest-optimized title with emotional hooks and power words",\n`;
        prompt += `  "pinterest_desc": "Pinterest description with 3-5 relevant hashtags and a call-to-action, max 500 chars",\n`;
        prompt += `  "article_intro": "Engaging article introduction, exactly ~60 words, hooks the reader immediately",\n`;
        prompt += `  "listicle_items": [\n    {\n`;
        prompt += `      "title": "Very short, punchy, creative subtitle (max 4-5 words) using power words",\n`;
        prompt += `      "content": "Deeply researched, trendy, highly specific and up-to-date description. Exactly ~60 words. No generic info.",\n`;
        prompt += `      "image_prompt": "Highly detailed photographic formula (e.g., 'Woman in butter yellow slip dress, bright vineyard garden, golden hour lighting, candid full body shot, 35mm lens, raw photo, highly realistic')",\n`;
        prompt += `      "product_recommendations": [\n`;
        prompt += `        { "product_name": "Specific real-world brand/product name", "amazon_search_term": "precise search term for Amazon" }\n`;
        prompt += `      ] // Generate EXACTLY 3 product recommendations per listicle item.\n    }\n  ]\n}`;

        const response = await fetch(`${GEMINI_BASE}/${modelId}:generateContent?key=${apiKey}`, {
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
        console.error("Gemini Route Error:", error);
        return NextResponse.json(
            { error: error.message || "Internal Server Error" },
            { status: 500 }
        );
    }
}
