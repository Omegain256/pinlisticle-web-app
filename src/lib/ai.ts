/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
// Utility functions for interacting with Google's Generative Language API from the client.
// This bypasses Vercel's strict 4.5MB payload limits and 10s Serverless Function timeouts.

// All currently available models are 2.x series, which use v1beta.
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export const MODELS_DEFAULT = {
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
    "nano-banana-2",
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

export class ModelOverloadedError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ModelOverloadedError";
    }
}

async function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Defensive access to keys to prevent browser-side crashes if imported into client components
const getApiKeys = () => {
    if (typeof process === 'undefined' || !process.env) return [];
    return (process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || "")
        .split(",")
        .map(k => k.trim())
        .filter(k => k);
};

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

export async function fetchWithKeyRotation(
    keysString: string,
    urlTemplate: string,
    options: any,
    alternativeUrlTemplate?: string
): Promise<any> {
    const keys = parseApiKeys(keysString);
    if (keys.length === 0) throw new Error("No API keys provided. Please add them in Settings.");

    const tryModels = alternativeUrlTemplate 
        ? [{ url: urlTemplate, label: "Primary" }, { url: alternativeUrlTemplate, label: "Alternative" }]
        : [{ url: urlTemplate, label: "Primary" }];

    let lastError: any = null;

    for (const modelConfig of tryModels) {
        let attempts = 0;
        const maxKeys = keys.length;

        while (attempts < maxKeys) {
            const key = keys[currentKeyIndex % keys.length];
            currentKeyIndex++; // Rotate for the next call
            attempts++;

            const finalUrl = modelConfig.url.replace("API_KEY_PLACEHOLDER", key);

            let retryAttempt = 0;
            const maxRetriesPerKey = 3; // Increased retries for transient failures

            while (retryAttempt <= maxRetriesPerKey) {
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

                    const isOverloadError = res.status === 503 || 
                                          res.status === 500 || // Sometimes internal errors are transient spikes
                                          errorMsg.toLowerCase().includes("high demand") || 
                                          errorMsg.toLowerCase().includes("overloaded");

                    if (isQuotaError) {
                        console.warn(`[Quota] Key ...${key.slice(-4)} exhausted. Rotating.`);
                        lastError = data.error;
                        break; // rotate key
                    } else if (isOverloadError) {
                        if (retryAttempt < maxRetriesPerKey) {
                            // Exponential backoff: 2s, 4s, 8s...
                            const waitTime = Math.pow(2, retryAttempt + 1) * 1000 + (Math.random() * 500);
                            console.warn(`[Demand] ${modelConfig.label} overloaded on key ...${key.slice(-4)}. Retrying in ${Math.round(waitTime)}ms... (${retryAttempt + 1}/${maxRetriesPerKey})`);
                            await sleep(waitTime);
                            retryAttempt++;
                            continue; // retry same key
                        } else {
                            console.warn(`[Demand] ${modelConfig.label} failed after retries on key ...${key.slice(-4)}. Rotating.`);
                            lastError = data.error;
                            break; // rotate key
                        }
                    } else {
                        throw new Error(errorMsg); // Fatal error (syntax, auth, etc.)
                    }
                } catch (e: any) {
                    if (e.name === "AbortError" || e.message.includes("fetch failed")) {
                        break; // rotate key on network failure
                    }
                    throw e; 
                }
            }
        }
        
        if (tryModels.length > 1 && modelConfig.label === "Primary") {
            console.warn(`[TierSwap] Primary model overloaded across ALL keys. Attempting Tier-Swap to Alternative model...`);
        }
    }

    const finalErrorMsg = lastError?.message || "All provided API keys and model tiers exhausted.";
    if (finalErrorMsg.toLowerCase().includes("high demand") || finalErrorMsg.toLowerCase().includes("overloaded")) {
        throw new ModelOverloadedError(finalErrorMsg);
    }
    throw new QuotaExceededError(finalErrorMsg);
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

    const primaryModelId = modelId;
    const secondaryPrefix = sanitizedPrefix === "lite" ? "pro" : "lite";
    const secondaryModelId = sanitizeModelId(MODELS_DEFAULT[secondaryPrefix as keyof typeof MODELS_DEFAULT] || MODELS_DEFAULT.pro);

    const urlTemplate = `${GEMINI_BASE}/${primaryModelId}:generateContent?key=API_KEY_PLACEHOLDER`;
    const alternativeUrlTemplate = `${GEMINI_BASE}/${secondaryModelId}:generateContent?key=API_KEY_PLACEHOLDER`;

    const system_instruction = [
        "You are a SHARP WARDROBE EDITOR. Your target audience is women (26-44) seeking style advice for real life.",
        "EDITORIAL MISSION:",
        "Make readers feel more informed, more tasteful, more decisive, and less overwhelmed. help women make faster, smarter wardrobe decisions without losing taste, personality, or realism.",
        "VOICE RULES:",
        "- Intelligent but legible | Warm but not sugary | Opinionated but not arrogant | Elevated but not precious.",
        "- We notice what most content misses: line, proportion, context, and why combinations feel modern while others fall flat.",
        "- Take a position. No hedging. No 'trend-panic'. No filler.",
        "VOCABULARY GUIDE:",
        "- USE OFTEN: polished, grounded, deliberate, versatile, sharp, soft structure, balance, proportion, wardrobe workhorse, outfit formula, real-life dressing, visual weight, clean line.",
        "- STRICTLY BANNED: obsessed, game-changer, must-have, stunning, viral, Amazon hack, fashionista, flawlessly, look expensive, trendy girl, delve, elevate, chic, essential.",
        "WRITING FORMULA per listicle_item:",
        "Each section must move through these 4 layers in EXACTLY 3-4 short sentences (max 20 words each):",
        "1. HOOK: Start with a sharp editorial hook that names a real wardrobe problem or tension.",
        "2. MEANING: Explain the style logic (why it works aesthetically/functionally).",
        "3. UTILITY: Tell the reader exactly what to do.",
        "4. DIRECTION: specific branding/styling advice.",
        "EDITORIAL BANNED ACTIONS (STRICTLY PROHIBITED):",
        "- DO NOT drift into influencer tone ('I'm obsessed', 'You guys need this').",
        "- DO NOT over-explain trends without providing utility/logic.",
        "- DO NOT write long intros (Keep under 60 words).",
        "- DO NOT create list items that repeat styling advice or items from previous cards.",
        "- DO NOT mix different image locations within one article (Keep location consistent).",
        "- DO NOT promise personal wear-tests or claim you've worn the items unless verified in research.",
        "- DO NOT INCLUDE ANY NUMBERING IN THE 'title' FIELD (e.g., No '1.', No 'Item 1').",
        "Return ONLY a valid raw JSON object.",
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
    prompt += `      "image_prompt": "Highly detailed photographic formula: [SHOT_TYPE] of [SUBJECT] wearing [OUTFIT]. [LOCATION]. [LIGHTING_AND_WEATHER]. [CAMERA_AND_AESTHETIC]. [TEXTURE_AND_FINISH]. MUST ALWAYS be 'Full-body (shoes to crown)'. No exceptions. Feet and shoes MUST be visible.",\n`;
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
    }, alternativeUrlTemplate);

    const textPayload = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!textPayload) throw new Error("Invalid response format from Gemini (missing text candidate).");

    try {
        return JSON.parse(textPayload);
    } catch {
        throw new Error("Failed to parse JSON from Gemini.");
    }
}

export interface ImageReference {
    mimeType: string;
    data: string; // Base64 chunk
}

let cachedMatrixRefs: ImageReference[] | null = null;

export async function getShotMatrixReferences(): Promise<ImageReference[]> {
    if (cachedMatrixRefs) return cachedMatrixRefs;

    try {
        const refs: ImageReference[] = [];
        
        // Next.js server-side / Worker environment check for fs
        const isNode = typeof process !== 'undefined' && process.versions && process.versions.node;

        if (isNode) {
            // Use eval to bypass webpack bundling issues with fs in browser builds
            const fs = eval("require('fs')");
            const path = eval("require('path')");
            
            const loadLocal = (relPath: string, mime: string) => {
                try {
                    const full = path.join(process.cwd(), 'public', 'assets', 'character_sheets', relPath);
                    if (fs.existsSync(full)) {
                        const buffer = fs.readFileSync(full);
                        refs.push({ mimeType: mime, data: buffer.toString('base64') });
                    }
                } catch (e) { console.warn("Failed to load local asset:", relPath, e); }
            };

            loadLocal('c1_model/face.jpeg', 'image/jpeg');
            loadLocal('c1_model/full_body.png', 'image/png');
            loadLocal('c1_model/Model 1 Facial Features.png', 'image/png');
            loadLocal('c1_model/Model 1 Side By Side.png', 'image/png');
            loadLocal('e4_scene.jpeg', 'image/jpeg');
        } else {
            // Client-side fetch
            const fetchRemote = async (url: string, mime: string) => {
                try {
                    const res = await fetch(url);
                    if (!res.ok) return;
                    const blob = await res.blob();
                    const reader = new FileReader();
                    await new Promise(r => {
                        reader.onloadend = r;
                        reader.readAsDataURL(blob);
                    });
                    const b64 = (reader.result as string).split(',')[1];
                    refs.push({ mimeType: mime, data: b64 });
                } catch (e) { console.warn("Failed to load remote asset:", url, e); }
            };

            await fetchRemote('/assets/character_sheets/c1_model/face.jpeg', 'image/jpeg');
            await fetchRemote('/assets/character_sheets/c1_model/full_body.png', 'image/png');
            await fetchRemote('/assets/character_sheets/e4_scene.jpeg', 'image/jpeg');
        }

        cachedMatrixRefs = refs;
        return refs;
    } catch (e) {
        console.warn("[ShotMatrix] Could not load reference images", e);
        return [];
    }
}

export async function generateImage(params: { prompt: string; apiKey: string; preferredModel?: string; referenceImages?: ImageReference[] }) {
    const { prompt, apiKey, preferredModel, referenceImages } = params;

    const cached = getCachedModels();
    
    // 1. Identify ALL models that support Image Generation (containing "imagen" or "nano-banana-2")
    const discoveredImagen = cached
        .filter(m => m.id.includes("imagen") || m.id === "nano-banana-2")
        .map(m => m.id);

    // 2. Determine rotation pool
    let modelsToTry: string[] = [];

    const hasRefs = referenceImages && referenceImages.length > 0;

    if (preferredModel && preferredModel !== "auto") {
        // Priority: preferred model then others
        const fallbackPool = discoveredImagen.length > 0 ? discoveredImagen : IMAGEN_MODELS_DEFAULT;
        modelsToTry = Array.from(new Set([preferredModel, ...fallbackPool]));
    } else {
        // Full auto-rotation through all discovered models, falling back to defaults
        let basePool = discoveredImagen.length > 0 ? Array.from(discoveredImagen) : [...IMAGEN_MODELS_DEFAULT];
        
        // If we have reference images, we MUST use a model that supports them (nano-banana-2)
        if (hasRefs) {
            const multiIdx = basePool.indexOf("nano-banana-2");
            if (multiIdx > -1) {
                // Move nano-banana-2 to the front
                basePool.splice(multiIdx, 1);
                basePool.unshift("nano-banana-2");
            } else if (!basePool.includes("nano-banana-2")) {
                // Force add it if it's missing but we have references
                basePool.unshift("nano-banana-2");
            }
        }
        modelsToTry = basePool;
    }

    // The prompt is now assembled using the 'New Master Structure' in the pipeline,
    // which is highly descriptive and expert-led. We pass it directly to Imagen.
    const base64Image = await tryGenerateWithRotation(apiKey, prompt, modelsToTry, referenceImages);
    return base64Image;
}

/**
 * Special rotation logic for Imagen sub-models (Standard, Fast, Ultra) 
 * to pool their independent quotas on a single key before moving to next key.
 */
async function tryGenerateWithRotation(keysString: string, prompt: string, models: readonly string[], referenceImages?: ImageReference[]) {
    const keys = parseApiKeys(keysString);
    let lastError: any = null;

    for (const key of keys) {
        for (const modelId of models) {
            // nano-banana-2 uses generateContent endpoint, not predict
            const isNanoBanana = modelId === "nano-banana-2";
            const url = isNanoBanana
                ? `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${key}`
                : `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:predict?key=${key}`;

            try {
                const NEGATIVE_PROMPT = "editorial fashion shoot, studio lighting, DSLR bokeh, cinematic color grading, beauty filter skin, plastic skin, waxy face, overly airbrushed texture, CGI smoothness, unrealistic symmetry, uncanny eyes, multiple arms, extra arms, fan of hands, spider-like limbs, deity arms, hindu goddess arms, duplicate shoulders, extra forearms, mutated anatomy, unnatural number of limbs, unnatural limb placement, fused body parts, warped hands, extra fingers, duplicate limbs, broken wrists, distorted reflection, incorrect mirror geometry, floating feet, fake shadows, exaggerated curves, unrealistic body proportions, over-sharpened pores, fake fabric sheen, unnatural hair, perfect showroom interior, surreal luxury bedroom, overexposed whites, crushed shadows, extreme HDR halos, glossy skin, anime features, doll-like face";
                const hardenedPrompt = `${prompt}\n\nNegative prompt: ${NEGATIVE_PROMPT}`;

                let parts: any[] = [{ text: hardenedPrompt }];

                if (isNanoBanana && referenceImages && referenceImages.length > 0) {
                    parts = [
                        { text: "STRICT SHOT MATRIX CONSTRAINT. You must draw exactly the environments and subjects shown in the attached reference images. Character C1 and Environment E4 must be meticulously adhered to." },
                        ...referenceImages.map(img => ({ inlineData: { mimeType: img.mimeType, data: img.data } })),
                        { text: hardenedPrompt }
                    ];
                }

                const body = isNanoBanana
                    ? JSON.stringify({
                        contents: [{ parts }],
                        generationConfig: { 
                            responseModalities: ["IMAGE", "TEXT"],
                        }
                    })
                    : JSON.stringify({
                        instances: [{ prompt: hardenedPrompt }],
                        parameters: { sampleCount: 1, aspectRatio: "9:16", outputOptions: { mimeType: "image/jpeg" } }
                    });

                const res = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body
                });

                const data = await res.json();

                if (res.ok) {
                    // nano-banana-2 returns inlineData in candidates
                    if (isNanoBanana) {
                        const parts = data.candidates?.[0]?.content?.parts || [];
                        const imgPart = parts.find((p: any) => p.inlineData?.mimeType?.startsWith("image"));
                        if (imgPart?.inlineData?.data) return imgPart.inlineData.data;
                        // no image part — fall through to next model
                        lastError = new Error("nano-banana-2 returned no image part");
                        continue;
                    }
                    const bytes = data.predictions?.[0]?.bytesBase64Encoded;
                    if (bytes) return bytes;
                    const isBlocked = data.predictions?.[0]?.safetyAttributes?.blocked;
                    if (isBlocked) throw new Error("Safety filter blocked image generation.");
                    lastError = new Error(`No image returned from ${modelId}`);
                    continue;
                }

                // Any non-OK response: log and try next model (never throw here)
                const errorMsg = data.error?.message || `HTTP ${res.status} from ${modelId}`;
                console.warn(`[Image] ${modelId} on key ...${key.slice(-4)} failed: ${errorMsg}. Trying next model...`);
                lastError = new Error(errorMsg);
                // continue to next model

            } catch (e: any) {
                // Network-level errors — log and try next model
                console.warn(`[Image] ${modelId} threw: ${e.message}. Trying next model...`);
                lastError = e;
            }
        }
    }

    const finalError = lastError || new Error("All image models exhausted.");
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
        "You are a SHARP WARDROBE EDITOR.",
        "Your task is to rewrite a single listicle subsection to be more grounded, practical, and authoritative.",
        "VOICE RULES:",
        "- Intelligent but legible | Warm but not sugary | Opinionated but not arrogant.",
        "- Take a position. No hedging. No 'trend-panic'. No filler.",
        "- BANNED WORDS: obsessed, game-changer, must-have, stunning, viral, Amazon hack, fashionista, flawlessly, look expensive, trendy girl, delve, elevate, chic, essential.",
        "WRITING FORMULA:",
        "Each section must follow the 4-layer formula in exactly 3-4 short sentences (max 20 words each):",
        "1. HOOK: Name the tension/problem.",
        "2. MEANING: Explain the style logic.",
        "3. UTILITY: Tell the reader exactly what to do.",
        "4. DIRECTION: specific styling/branding advice.",
        "- The title MUST BE VERY SHORT (max 4-5 words), exceptionally punchy, and use power words.",
        "- Return ONLY a valid raw JSON object.",
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
