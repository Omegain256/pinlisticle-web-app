// Utility functions for interacting with Google's Generative Language API from the client.
// This bypasses Vercel's strict 4.5MB payload limits and 10s Serverless Function timeouts.

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

const MODELS_DEFAULT = {
    pro: "gemini-1.5-pro",
    lite: "gemini-1.5-flash",
} as const;

// These will be used as fallbacks if no dynamic models are discovered
const IMAGEN_MODELS_DEFAULT = [
    "imagen-4.0-ultra-generate-001",
    "imagen-4.0-generate-001",
    "imagen-4.0-fast-generate-001",
    "imagen-3.0-generate-001",
    "imagen-3.0-fast-generate-001",
] as const;

export interface DiscoveredModel {
    id: string;
    name: string;
    description: string;
    supportedGenerationMethods: string[];
}

export type Tone = "Casual" | "Professional" | "Fun" | "Minimal";

// ─── Multi-Key Load Balancer ───────────────────────────────────────────────

export class QuotaExceededError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "QuotaExceededError";
    }
}

let currentKeyIndex = 0;

export function parseApiKeys(keysString: string): string[] {
    if (!keysString) return [];
    return keysString.split(/[\n,]+/).map(k => k.trim()).filter(Boolean);
}

export async function fetchAvailableModels(keysString: string): Promise<DiscoveredModel[]> {
    const keys = parseApiKeys(keysString);
    if (keys.length === 0) return [];
    
    try {
        const res = await fetch("/api/models", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ apiKey: keys[0] })
        });
        const data = await res.json();
        if (data.success) {
            localStorage.setItem("pinlisticle_discovered_models", JSON.stringify(data.models));
            return data.models;
        }
    } catch (e) {
        console.error("Failed to sync models:", e);
    }
    return [];
}

export function getCachedModels(): DiscoveredModel[] {
    if (typeof window === "undefined") return [];
    const saved = localStorage.getItem("pinlisticle_discovered_models");
    return saved ? JSON.parse(saved) : [];
}

async function fetchWithKeyRotation(
    keysString: string,
    urlTemplate: string,
    options: any
): Promise<any> {
    const keys = parseApiKeys(keysString);
    if (keys.length === 0) throw new Error("No API keys provided. Please add them in Settings.");

    let attempts = 0;
    const maxAttempts = keys.length;
    let lastResponseData: any = null;

    while (attempts < maxAttempts) {
        const key = keys[currentKeyIndex % keys.length];
        currentKeyIndex++; // Rotate for the next call
        attempts++;

        const finalUrl = urlTemplate.replace("API_KEY_PLACEHOLDER", key);

        try {
            const res = await fetch(finalUrl, options);
            const data = await res.json();
            
            if (res.ok) {
                return data;
            }

            const errorMsg = data.error?.message || "Unknown error";
            const isQuotaError = res.status === 429 || 
                               errorMsg.toLowerCase().includes("quota") || 
                               errorMsg.toLowerCase().includes("limit exceeded");

            if (isQuotaError) {
                console.warn(`API Key ending in ...${key.slice(-4)} hit quota limit. Rotating to next key if available.`);
                lastResponseData = data;
                continue; // Try next key
            } else {
                // Not a quota error, immediately throw a normal error
                throw new Error(errorMsg);
            }
        } catch (e: any) {
            // For true network failures or the error we just threw above
            if (e.message !== "fetch failed" && !e?.message?.toLowerCase().includes("quota")) {
                throw e; 
            }
        }
    }

    throw new QuotaExceededError(lastResponseData?.error?.message || "All provided API keys have exceeded their active quota limits.");
}

// ─── Generation Utilities ──────────────────────────────────────────────────

export async function generateContent(params: {
    topic: string;
    keyword?: string;
    tone: Tone;
    count: number;
    apiKey: string; // Accepts string of comma/newline separated keys
    modelPrefix: "pro" | "lite";
    brandVoice?: string;
    internalLinks?: string;
}) {
    const { topic, keyword, tone, count, apiKey, modelPrefix, brandVoice, internalLinks } = params;
    const cached = getCachedModels();
    
    // Strategy: 
    // 1. If modelPrefix (pro/lite) is and found in cache, use it.
    // 2. Otherwise, look for stable IDs in this order: gemini-2.5-pro, gemini-2.1-pro...
    // 3. Fallback: hardcoded defaults
    let modelId = "";
    let sanitizedPrefix = modelPrefix;
    if (((modelPrefix as any) === "gemini-2.1-pro") || modelPrefix === "pro") sanitizedPrefix = "pro";
    if (((modelPrefix as any) === "gemini-2.0-flash-lite") || modelPrefix === "lite") sanitizedPrefix = "lite";

    const requestedId = MODELS_DEFAULT[sanitizedPrefix as keyof typeof MODELS_DEFAULT] || MODELS_DEFAULT.pro;

    if (cached.some(m => m.id === requestedId)) {
        modelId = requestedId;
    } else {
        const priorities = ["gemini-1.5-pro", "gemini-2.0-flash", "gemini-1.5-flash", "gemini-2.5-pro", "gemini-2.5-flash"];
        for (const p of priorities) {
            if (cached.some(m => m.id === p)) {
                modelId = p;
                break;
            }
        }
    }

    if (!modelId) modelId = requestedId;

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
        "- image_prompt: Write a photographic formula for 100% human-like realism. Mandatory: FULL LENGTH FULL BODY PORTRAIT showing the person from HEAD TO TOE. The subject MUST be STANDING ON THE FLOOR and WEARING DETAILED SHOES (e.g., boots, heels, sneakers) that match the outfit. Absolutely NO bare feet, no socks-only, and no feet cropped-off. The crop must be wide enough to clearly see the shoes and the floor. [Subject description], mirror selfie in a residential interior, candid snapshot, shot on smartphone, amateur lighting, unpolished, raw photo.",
        "- IMPERFECT REALISM: Demand natural skin texture, visible pores, and mundane environments. ENSURE EXACTLY TWO HANDS. To avoid anatomical errors (like 'three hands'), explicitly frame hands in pockets or naturally at sides. Avoid any artifacts like 'hanging phones' or 'floating accessories'.",
        "- AVOID HANDS PARADOX: AI struggles with hands. To ensure 100% realism, explicitly frame subjects to HIDE their hands. Add constraints like 'hands in pockets', 'hands completely resting out of frame', 'cropped at waist', or 'holding nothing visible'.",
        "- BANNED VISUALS: Do NOT include studio lighting, high-fashion, artificial gloss, or standard AI-generated 'glow'. Avoid 'dreamy' or 'backlit' aesthetics. Emphasize 'casual unposed lifestyle photography'.",
        "- RECREATE THIS LOOK (CRITICAL): The `product_recommendations` MUST BE the specific individual pieces that make up the outfit described in the `image_prompt`. For EACH listicle entry, you MUST provide exactly 3 product recommendations (e.g., the shoes, the bottom, and the top/outerwear) that collectively recreate the complete 'look' shown in the image. Ensure the products are specific real-world items that match the aesthetic perfectly.",
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

    const urlTemplate = `${GEMINI_BASE}/${modelId}:generateContent?key=API_KEY_PLACEHOLDER`;
    const data = await fetchWithKeyRotation(apiKey, urlTemplate, {
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

    const textPayload = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!textPayload) throw new Error("Invalid response format from Gemini (missing text candidate).");

    try {
        return JSON.parse(textPayload);
    } catch {
        throw new Error("Failed to parse JSON from Gemini.");
    }
}

export async function generateImage(params: { prompt: string; apiKey: string; preferredModel?: string }) {
    const { prompt, apiKey, preferredModel } = params;

    const cached = getCachedModels();
    
    // 1. Identify ALL models that support Image Generation (containing "imagen")
    const discoveredImagen = cached
        .filter(m => m.id.includes("imagen"))
        .map(m => m.id);

    // 2. Determine rotation pool
    let modelsToTry: string[] = [];

    if (preferredModel && preferredModel !== "auto") {
        // Priority: preferred model then others
        modelsToTry = [preferredModel, ...discoveredImagen.filter(m => m !== preferredModel)];
        // Ensure the preferred model is at least in the pool if discovered is empty
        if (modelsToTry.length === 0) modelsToTry = [preferredModel, ...IMAGEN_MODELS_DEFAULT];
    } else {
        // Full auto-rotation through all discovered models, falling back to defaults
        modelsToTry = discoveredImagen.length > 0 ? discoveredImagen : [...IMAGEN_MODELS_DEFAULT];
    }

    // Best strategy for Pinterest realism: Anti-AI aesthetics. Force amateur smartphone photography, natural textures, and unedited looks.
    const fortifiedPrompt = `WIDE ANGLE FULL LENGTH FULL BODY PORTRAIT, HEAD TO TOE VISIBLE, NO CROPPED FEET. The person MUST be standing ON THE FLOOR and WEARING DETAILED SHOES OR BOOTS. ${prompt}. highly realistic mirror selfie in a residential interior, true amateur smartphone photography, natural skin texture, ENSURE EXACTLY TWO HANDS (hands hidden in pockets or at sides), unpolished, unedited, zero studio lighting, raw photo. CRITICAL: No hanging phones, no floating artifacts.`;

    const base64Image = await tryGenerateWithRotation(apiKey, fortifiedPrompt, modelsToTry);
    return base64Image;
}

/**
 * Special rotation logic for Imagen sub-models (Standard, Fast, Ultra) 
 * to pool their independent quotas on a single key before moving to next key.
 */
async function tryGenerateWithRotation(keysString: string, prompt: string, models: readonly string[]) {
    const keys = parseApiKeys(keysString);
    let lastError: any = null;

    for (const key of keys) {
        for (const modelId of models) {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:predict?key=${key}`;
            
            try {
                const res = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        instances: [{ prompt }],
                        parameters: {
                            sampleCount: 1,
                            aspectRatio: "9:16",
                            outputOptions: { mimeType: "image/jpeg" }
                        }
                    })
                });

                const data = await res.json();
                
                if (res.ok) {
                    const bytes = data.predictions?.[0]?.bytesBase64Encoded;
                    if (bytes) return bytes;
                }

                // If it's a quota error (429), we just continue to the next model in the inner loop
                const errorMsg = data.error?.message || "Unknown Imagen Error";
                const isQuota = res.status === 429 || 
                               errorMsg.toLowerCase().includes("quota") || 
                               errorMsg.toLowerCase().includes("limit exceeded") ||
                               data.error?.status === "RESOURCE_EXHAUSTED";

                if (isQuota) {
                    console.warn(`[Quota] Imagen Model ${modelId} hit limits on key ...${key.slice(-4)}. Error: ${errorMsg}. Trying next sub-model...`);
                    lastError = new Error(errorMsg);
                    continue; 
                }

                // If it's a safety filter (400) or other non-quota error, we throw immediately (rotation won't help)
                throw new Error(errorMsg);

            } catch (e: any) {
                if (!e.message.toLowerCase().includes("quota") && !e.message.toLowerCase().includes("limit")) throw e;
            }
        }
    }

    throw lastError || new Error("All Imagen models on all API keys have exceeded their active quota limits.");
}

export async function regenerateText(params: {
    topic: string;
    itemTitle: string;
    itemContent: string;
    apiKey: string;
    modelPrefix: "pro" | "lite";
}) {
    const { topic, itemTitle, itemContent, apiKey, modelPrefix } = params;
    const cached = getCachedModels();
    let modelId = "";
    let sanitizedPrefix = modelPrefix;
    if (((modelPrefix as any) === "gemini-2.1-pro") || modelPrefix === "pro") sanitizedPrefix = "pro";
    if (((modelPrefix as any) === "gemini-2.0-flash-lite") || modelPrefix === "lite") sanitizedPrefix = "lite";

    const requestedId = MODELS_DEFAULT[sanitizedPrefix as keyof typeof MODELS_DEFAULT] || MODELS_DEFAULT.pro;

    if (cached.some(m => m.id === requestedId)) {
        modelId = requestedId;
    } else {
        const priorities = ["gemini-1.5-pro", "gemini-2.0-flash", "gemini-1.5-flash", "gemini-2.5-pro", "gemini-2.5-flash"];
        for (const p of priorities) {
            if (cached.some(m => m.id === p)) {
                modelId = p;
                break;
            }
        }
    }

    if (!modelId) modelId = requestedId;

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

    const urlTemplate = `${GEMINI_BASE}/${modelId}:generateContent?key=API_KEY_PLACEHOLDER`;
    const data = await fetchWithKeyRotation(apiKey, urlTemplate, {
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

    const textPayload = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!textPayload) throw new Error("Invalid response format from Gemini (missing text candidate).");

    try {
        return JSON.parse(textPayload);
    } catch {
        throw new Error("Failed to parse JSON from Gemini.");
    }
}
