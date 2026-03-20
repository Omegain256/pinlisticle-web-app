import { NextResponse } from "next/server";

// ─── Available models on this API key ────────────────────────────────────────
// gemini-2.5-pro       → best quality, 1M token context, supports thinking
// gemini-2.0-flash-lite → fast & lightweight, ideal for large batches
//
// Note: gemini-1.5-flash has been deprecated from v1beta. Use the models above.

const MODELS = {
    pro: "gemini-2.5-pro",
    lite: "gemini-2.0-flash-lite",
} as const;

type ModelKey = keyof typeof MODELS;

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export async function POST(req: Request) {
    try {
        const { topic, keyword, tone, count, apiKey, model: modelPref, brandVoice, internalLinks } = await req.json();

        if (!apiKey) {
            return NextResponse.json({ error: "No Gemini API Key provided." }, { status: 401 });
        }

        // Select model — default to "pro" for best quality
        // Standard priority for No Assumptions: 2.5-pro > 2.0-flash
        let modelId = "gemini-1.5-pro";
        if (modelPref === "lite" || modelPref === "gemini-2.0-flash-lite") {
            modelId = "gemini-2.0-flash";
        } else if (modelPref === "pro" || modelPref === "gemini-2.1-pro" || modelPref === "gemini-2.5-pro") {
            modelId = "gemini-1.5-pro";
        } else if (modelPref && modelPref.includes("gemini")) {
            modelId = modelPref; // Use specifically discovered model if passed
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
            "- LISTICLE ENTRIES: Each entry content MUST be exactly ~60 words. Don't just describe the item; explain WHY it's essential, the history/craftsmanship behind it, or how it fits into a modern lifestyle.",
            "- SUBTITLES: Must be exceptionally punchy (max 4-5 words). Avoid generic labels. Use 'Hook' titles.",
            "- image_prompt: Write a photographic formula for 100% human-like realism. Mandatory: FULL LENGTH FULL BODY PORTRAIT showing the person from HEAD TO TOE. The subject MUST be STANDING ON THE FLOOR and WEARING DETAILED SHOES (e.g., boots, heels, sneakers) that match the outfit. Absolutely NO bare feet, no socks-only, and no feet cropped-off. The crop must be wide enough to clearly see the shoes and the floor. [Subject description], mirror selfie in a residential interior, candid snapshot, shot on smartphone, amateur lighting, unpolished, raw photo.",
            "- IMPERFECT REALISM: Demand natural skin texture, visible pores, and mundane environments. ENSURE EXACTLY TWO HANDS. To avoid anatomical errors (like 'three hands'), explicitly frame hands in pockets or naturally at sides. Avoid any artifacts like 'hanging phones' or 'floating accessories'.",
            "- AVOID HANDS PARADOX: AI struggles with hands. To ensure 100% realism, explicitly frame subjects to HIDE their hands. Add constraints like 'hands in pockets', 'hands completely resting out of frame', 'cropped at waist', or 'holding nothing visible'.",
            "- BANNED VISUALS: Do NOT include studio lighting, high-fashion, artificial gloss, or standard AI-generated 'glow'. Avoid 'dreamy' or 'backlit' aesthetics. Emphasize 'casual unposed lifestyle photography'.",
            "- FULL BODY OUTFITS ONLY: If the topic is fashion or outfits, EVERY single image prompt MUST explicitly describe a FULL BODY portrait of a person standing or walking, wearing the complete outfit INCLUDING DETAILED SHOES. NEVER generate an image of just a bag, watch, shoes, or a half-body crop. Head to toe with visible shoes on the floor.",
            "- RECREATE THIS LOOK (CRITICAL): The `product_recommendations` MUST BE the specific individual pieces that make up the outfit described in the `image_prompt`. For EACH listicle entry, you MUST provide exactly 3 product recommendations (e.g., the shoes, the bottom, and the top/outerwear) that collectively recreate the complete 'look' shown in the image. Ensure the products are specific real-world items that match the aesthetic perfectly.",
            "- Return ONLY a valid raw JSON object.",
        ];

        if (brandVoice) {
            system_instruction_arr.push("- BRAND VOICE MATCH (CRITICAL): The user has provided an exact Brand Voice DNA sample in the prompt. You must forcefully overwrite your default writing tone to seamlessly match their vocabulary, rhythm, and sentence structure. Sound EXACTLY like them.");
        }

        if (internalLinks) {
            system_instruction_arr.push("- INTERNAL LINKING: The user has provided a list of their own website URLs. You must forcefully map 1 to 2 of these URLs into the sub-item `content` fields naturally using valid HTML `<a href=\"...\">keyword</a>` anchors. Ensure they blend perfectly into the sentence. Do NOT put links in the intro.");
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
        prompt += `      "content": "Deeply researched, trendy, highly specific description. Exactly ~60 words. No generic info.",\n`;
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
