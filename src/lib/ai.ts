// Utility functions for interacting with Google's Generative Language API from the client.
// This bypasses Vercel's strict 4.5MB payload limits and 10s Serverless Function timeouts.

// All currently available models are 2.x series, which use v1beta.
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

const MODELS_DEFAULT = {
    pro: "gemini-2.5-pro",
    lite: "gemini-2.5-flash",
} as const;

// ─── Deprecated Model Blocklist ───────────────────────────────────────────
// Maps ANY deprecated/unavailable model ID to a confirmed-working replacement.
// This catches stale values from localStorage, old Settings selections, etc.
const DEPRECATED_MODEL_MAP: Record<string, string> = {
    "gemini-2.0-flash": "gemini-2.5-flash",
    "gemini-2.0-flash-lite": "gemini-2.5-flash",
    "gemini-2.0-flash-exp": "gemini-2.5-flash",
    "gemini-1.5-pro": "gemini-2.5-pro",
    "gemini-1.5-pro-002": "gemini-2.5-pro",
    "gemini-1.5-flash": "gemini-2.5-flash",
    "gemini-1.5-flash-002": "gemini-2.5-flash",
    "gemini-2.1-pro": "gemini-2.5-pro",
};

/** Sanitize any model ID — if it's deprecated, return the safe replacement. */
export function sanitizeModelId(modelId: string): string {
    return DEPRECATED_MODEL_MAP[modelId] || modelId;
}

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
    
    // Strategy: Use ONLY models confirmed on user's Google AI Studio dashboard.
    // Priority: gemini-2.5-flash (1K RPM) > gemini-2.5-pro (150 RPM) > gemini-2.0-flash-lite
    let modelId = "";
    let sanitizedPrefix = modelPrefix;
    if (((modelPrefix as any) === "gemini-2.1-pro") || modelPrefix === "pro") sanitizedPrefix = "pro";
    if (((modelPrefix as any) === "gemini-2.0-flash-lite") || modelPrefix === "lite") sanitizedPrefix = "lite";

    const requestedId = MODELS_DEFAULT[sanitizedPrefix as keyof typeof MODELS_DEFAULT] || MODELS_DEFAULT.pro;

    if (cached.some(m => m.id === requestedId)) {
        modelId = requestedId;
    } else {
        // ONLY dashboard-confirmed models. Order: best capacity first.
        const priorities = [
            "gemini-2.5-flash",
            "gemini-2.5-pro",
        ];
        for (const p of priorities) {
            if (cached.some(m => m.id === p)) {
                modelId = p;
                break;
            }
        }
    }

    if (!modelId) modelId = requestedId;

    // PERMANENT FIX: Always sanitize before API call — catches stale localStorage values
    modelId = sanitizeModelId(modelId);

    const urlTemplate = `${GEMINI_BASE}/${modelId}:generateContent?key=API_KEY_PLACEHOLDER`;

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
        "- LISTICLE ENTRIES: Each entry content MUST be exactly ~60 words. They MUST be deeply researched, highly specific, and up-to-date with current trends. Absolutely NO generic fluff or surface-level knowledge. Explain specific details, real-world relevance, and why it is essential.",
        "- SUBTITLES: Must be exceptionally punchy (max 4-5 words). Avoid generic labels. Use 'Hook' titles.",
        "- image_prompt DIVERSITY (CRITICAL): Every image prompt MUST be completely unique. Use radically different environments (e.g., bustling city street, cozy dim cafe, bright minimalist studio, outdoor park at golden hour, neon-lit alleyway). Vary the lighting conditions, subject's natural pose, and the camera type (e.g., DSLR, disposable camera flash, iPhone candid, vintage film). Do NOT make them all look the same.",
        "- image_prompt FRAMING (MANDATORY): AI generators crop feet by default. You MUST explicitly state 'Wide angle full body portrait taken from 15 feet away' in the prompt to force the AI to include the entire body. The prompt MUST describe the subject's SHOES and where they are standing (e.g., 'wearing red sneakers standing on wet pavement'). If you don't describe the shoes and the ground, the image will crop the feet.",
        "- image_prompt FORMAT: The returned value MUST follow this formula exactly: 'Wide angle full body portrait taken from 15 feet away, showing the person from head to toe including shoes. [Specific highly diverse environment and unique lighting]. [Detailed outfit describing top, bottom, and SPECIFIC SHOES]. [Camera style and vibe]. Unposed, 100% human realistic, candid.'",
        "- IMPERFECT REALISM: Demand natural skin texture, visible pores, and mundane environments. Avoid 'dreamy', 'backlit', or 'studio lighting' aesthetics.",
        "- AVOID HANDS PARADOX: AI struggles with hands. To ensure realism, explicitly frame subjects to HIDE their hands (e.g., 'hands in pockets', 'hands completely resting out of frame').",
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
    prompt += `      "content": "Deeply researched, trendy, highly specific and up-to-date description. Exactly ~60 words. No generic info.",\n`;
    prompt += `      "image_prompt": "Highly detailed photographic formula (e.g., 'Woman in butter yellow slip dress, bright vineyard garden, candid full body shot, 35mm lens'). CRITICAL RULE: NEVER write 'mirror selfie', NEVER include mobile phones, and ALWAYS specify 'clearly visible face' and 'natural relaxed arms at sides'.",\n`;
    prompt += `      "product_recommendations": [\n`;
    prompt += `        { "product_name": "Specific real-world brand/product name", "amazon_search_term": "precise search term for Amazon" }\n`;
    prompt += `      ] // Generate EXACTLY 3 product recommendations per listicle item.\n    }\n  ]\n}`;
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
        const fallbackPool = discoveredImagen.length > 0 ? discoveredImagen : IMAGEN_MODELS_DEFAULT;
        modelsToTry = Array.from(new Set([preferredModel, ...fallbackPool]));
    } else {
        // Full auto-rotation through all discovered models, falling back to defaults
        modelsToTry = discoveredImagen.length > 0 ? discoveredImagen : [...IMAGEN_MODELS_DEFAULT];
    }

    // Best strategy for Pinterest realism: Candid lifestyle photography, natural lighting, and authentic textures.
    // Removed hardcoded 'Soft natural lighting' etc. so Gemini's diverse prompts shine through.
    const fortifiedPrompt = `${prompt}. 100% CANDID LIFESTYLE PHOTOGRAPHY, AUTHENTIC MOMENT, WIDE ANGLE FULL LENGTH BODY SHOT. The person MUST be standing ON THE FLOOR and WEARING DETAILED SHOES OR BOOTS. The entire head, hair, and face MUST be fully visible within the frame. Organic skin textures with pores and slight imperfections (NOT AI SMOOTH), UNPOSED FEEL. Realistic natural hand posture (arms resting at sides or naturally posed). NO MOBILE PHONES, NO CAMERAS, NO MIRRORS, NO FLOATING ARTIFACTS.`;

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
                    
                    const isBlocked = data.predictions?.[0]?.safetyAttributes?.blocked;
                    if (isBlocked) {
                        throw new Error("Google API Safety Filter blocked this image generation.");
                    }
                    throw new Error(`No image returned. API Response: ${JSON.stringify(data.predictions?.[0] || data)}`);
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

    const finalError = lastError || new Error("All Imagen models on all API keys have exceeded their active quota limits.");
    finalError.name = "QuotaExceededError";
    throw finalError;
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
    // Strategy: Use ONLY models confirmed on user's Google AI Studio dashboard.
    // Priority: gemini-2.5-flash (1K RPM) > gemini-2.5-pro (150 RPM) > gemini-2.0-flash-lite
    let modelId = "";
    let sanitizedPrefix = modelPrefix;
    if (((modelPrefix as any) === "gemini-2.1-pro") || modelPrefix === "pro") sanitizedPrefix = "pro";
    if (((modelPrefix as any) === "gemini-2.0-flash-lite") || modelPrefix === "lite") sanitizedPrefix = "lite";

    const requestedId = MODELS_DEFAULT[sanitizedPrefix as keyof typeof MODELS_DEFAULT] || MODELS_DEFAULT.pro;

    if (cached.some(m => m.id === requestedId)) {
        modelId = requestedId;
    } else {
        // ONLY dashboard-confirmed models. Order: best capacity first.
        const priorities = [
            "gemini-2.5-flash",
            "gemini-2.5-pro",
        ];
        for (const p of priorities) {
            if (cached.some(m => m.id === p)) {
                modelId = p;
                break;
            }
        }
    }

    if (!modelId) modelId = requestedId;

    // PERMANENT FIX: Always sanitize before API call — catches stale localStorage values
    modelId = sanitizeModelId(modelId);

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
    prompt += `  "content": "Deeply researched, trendy, highly specific and up-to-date description. Exactly ~60 words. No generic info."\n`;
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
