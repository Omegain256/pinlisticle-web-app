/* eslint-disable @typescript-eslint/no-explicit-any */
import {
    fetchWithKeyRotation,
    sanitizeModelId,
    MODELS_DEFAULT,
    ModelOverloadedError
} from "./ai";
import {
    TopicClassificationSchema,
    EvidencePackSchema,
    ItemCardsSchema,
    DraftArticleSchema,
    QAScoreSchema,
    StyleDNASchema
} from "./schemas";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

// Current date injected into every prompt so Gemini knows it's 2026, not 2024.
function getNow(): string {
    return new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

// Server-safe model resolution — does NOT rely on localStorage (which is client-only).
function resolveModelId(modelPrefix: "pro" | "lite", forceFlash: boolean = false): string {
    const prefix = forceFlash ? "lite" : modelPrefix;
    const modelId = MODELS_DEFAULT[prefix as keyof typeof MODELS_DEFAULT] || MODELS_DEFAULT.pro;
    return sanitizeModelId(modelId);
}

// Stage 1: Classify Topic (Brief)
export async function pipelineClassifyTopic(keyword: string, apiKey: string) {
    const modelId = resolveModelId("lite", true); // Classification is simple, use flash
    const urlTemplate = `${GEMINI_BASE}/${modelId}:generateContent?key=API_KEY_PLACEHOLDER`;

    const systemInstruction = `You are a high-end fashion editor. Your job is to transform a simple keyword into a "Real Wardrobe Problem" worth solving.
    
    EDITORIAL MISSION: 
    Help women aged 26-44 make faster, smarter wardrobe decisions. Translate inspiration into wardrobes that work for real mornings, real budgets, and real schedules.

    OBJECTIVE:
    1. Identify the core "Wardrobe Tension" or "Problem" behind this keyword.
    2. Determine the "Style Logic" required to solve it.
    3. Define the "Reader Outcome" (how they feel more capable).
    
    Return a JSON brief.`;
    const prompt = `Classify this keyword/topic: "${keyword}". Identify the real-life wardrobe problem it solves.`;

    const data = await fetchWithKeyRotation(apiKey, urlTemplate, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            system_instruction: { parts: [{ text: systemInstruction }] },
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
                responseMimeType: "application/json",
                responseSchema: TopicClassificationSchema,
                temperature: 0.2, // low temp for classification
            },
        }),
    });

    return extractJSONData(data);
}

// Stage 2: Web Search Evidence Pack
// NOTE: Gemini does NOT support responseSchema/responseMimeType when googleSearch grounding is enabled.
export async function pipelineSearchEvidence(keyword: string, briefJson: any, apiKey: string) {
    const modelId = resolveModelId("lite", true);
    const urlTemplate = `${GEMINI_BASE}/${modelId}:generateContent?key=API_KEY_PLACEHOLDER`;
    const now = getNow();

    const systemInstruction = `You are a research editor working in ${now}. Use Google Search to find the MOST CURRENT information available — prioritise results from 2025 and 2026. Do NOT reference articles or trends from 2024 or earlier unless they are still actively relevant today. Output ONLY valid JSON, no markdown fences, no extra text.`;
    const prompt = `
Today's date: ${now}
Keyword: "${keyword}"
Brief: ${JSON.stringify(briefJson)}

Search Google for the very latest 2025-2026 trends, statistics, and angles for this keyword.
Return a JSON object with these fields:
- "trending_angles": string[] (3-5 current 2026 angles — be specific, e.g. "quiet luxury trench coats trending on TikTok Spring 2026")
- "top_sources": string[] (3-5 source domains found)
- "seasonal_context": string (specific to current season: ${now})
- "audience_pain_points": string[] (what readers are actually struggling with right now)
- "competitive_gaps": string (what most articles on this topic are missing in 2026)
- "key_statistics": string[] (specific numbers or data points — include the year/source)
`.trim();

    const data = await fetchWithKeyRotation(apiKey, urlTemplate, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            system_instruction: { parts: [{ text: systemInstruction }] },
            contents: [{ parts: [{ text: prompt }] }],
            tools: [{ googleSearch: {} }],
            generationConfig: { temperature: 0.3 },
        }),
    });

    return extractJSONDataFreeForm(data);
}

// Stage 3: Item Cards
export async function pipelineGenerateItemCards(keyword: string, count: number, briefJson: any, evidencePackJson: any, apiKey: string, modelPrefix: "pro" | "lite") {
    const modelId = resolveModelId(modelPrefix);
    const urlTemplate = `${GEMINI_BASE}/${modelId}:generateContent?key=API_KEY_PLACEHOLDER`;

    const systemInstruction = `You are an expert editor building a visual and editorial content plan.
    
    For IMAGE SEEDS:
    - SHOT_TYPE: Must ALWAYS be 'Full-body (shoes to crown)'. No exceptions. The reader must see the entire silhouette from head to toe.
    - Provide a specific, unposed POSE_INSTRUCTION for each item (e.g. weight shifting forward, hands in pockets, gaze off-camera).
    - Define an OUTFIT_DESCRIPTION focused on materials and fabrics.`;
    const prompt = `
KEYWORD: "${keyword}"
ARTICLE BRIEF:
${JSON.stringify(briefJson, null, 2)}

WEB RESEARCH:
${JSON.stringify(evidencePackJson, null, 2)}

Generate exactly ${count} item evidence cards. Rotation: ensure a mix of Full-body, Medium, and Detail shots across the list.
    `.trim();

    try {
        const data = await fetchWithKeyRotation(apiKey, urlTemplate, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                system_instruction: { parts: [{ text: systemInstruction }] },
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    responseMimeType: "application/json",
                    responseSchema: ItemCardsSchema,
                    temperature: 0.7, 
                },
            }),
        });

        return extractJSONData(data);
    } catch (err: any) {
        if (err instanceof ModelOverloadedError && modelPrefix === "pro") {
            console.warn(`[Resilience] Gemini Pro overloaded during item_cards. Falling back to Gemini Flash.`);
            return pipelineGenerateItemCards(keyword, count, briefJson, evidencePackJson, apiKey, "lite");
        }
        throw err;
    }
}

// Stage 3.5: Style DNA
export async function pipelineGenerateStyleDNA(topic: string, briefJson: any, apiKey: string) {
    const modelId = resolveModelId("lite", true);
    const urlTemplate = `${GEMINI_BASE}/${modelId}:generateContent?key=API_KEY_PLACEHOLDER`;

    const prompt = `
Generate a single Style DNA JSON object for an article about: "${topic}".
BRIEF: ${JSON.stringify(briefJson)}

VOICE & AESTHETIC GOAL: 
Create a cohesive "Visual Identity" for this article. Select ONE consistent vibe from these categories as inspiration:
1. SUBJECT: Define the person (Age, Ethnicity, unique feature like 'sharp bob' or 'visible laugh lines').
2. LOCATION: Select a specific setting. PRIORITISE variety across articles. Pool: [minimalist brutalist concrete loft, candlelit Italian bistro, sun-drenched conservatory with floor-to-ceiling glass, mid-century modern library, produce aisle of a boutique grocery, grand marble museum hallway, cluttered artist studio, high-ceilinged converted warehouse, penthouse rooftop at dusk].
3. LIGHTING/WEATHER: Define the light (e.g. 'overcast winter afternoon', 'harsh direct on-camera flash', 'warm golden hour').
4. CAMERA/AESTHETIC: Define the tech vibe (e.g. 'Shot on iPhone 16 Pro', 'Shot on Contax T2 35mm film', 'Shot on Sony A7RV 85mm f/1.4'). Reference a specific editorial photographer.
5. TEXTURE & FINISH: Define the skin/film texture (e.g. 'Visible pores, honest skin', 'Heavy 35mm film grain, subtle halation').

Return a JSON object matching StyleDNASchema.
    `.trim();

    const data = await fetchWithKeyRotation(apiKey, urlTemplate, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
                responseMimeType: "application/json",
                responseSchema: StyleDNASchema,
                temperature: 0.8, 
            },
        }),
    });

    return extractJSONData(data);
}



interface ItemCard {
    item_index: number;
    item_name: string;
    why_it_works: string[];
    trend_support: string[];
    styling_notes: {
        colors: string[];
        fabrics: string[];
        accessories: string[];
        optional_swap: string;
    };
    reader_value: string;
    freshness_signal: string;
    image_prompt_seed: {
        shot_type: string;
        outfit_description: string;
        pose_instruction: string;
    };
}

interface DraftBatchResult {
    seo_title?: string;
    seo_desc?: string;
    pinterest_title?: string;
    article_intro?: string;
    article_outro?: string;
    listicle_items: Array<{
        title: string;
        content: string;
        has_swap: boolean;
        image_prompt: string;
        product_recommendations: Array<{
            product_name: string;
            amazon_search_term: string;
        }>;
    }>;
}

interface StyleDNA {
    subject_definition: string;
    lighting_and_weather: string;
    camera_and_aesthetic: string;
    texture_and_finish: string;
}

// Stage 4: Draft Article (with Batching support for high-count listicles)
export async function pipelineDraftArticle(
    keyword: string, 
    tone: string, 
    briefJson: unknown, 
    itemCardsJson: ItemCard[], 
    evidencePack: unknown, 
    apiKey: string, 
    modelPrefix: "pro" | "lite"
) {
    const totalItems = itemCardsJson.length;
    const batchSize = 5; // Process 5 items at a time to guarantee quality and avoid truncation
    const chunks: ItemCard[][] = [];
    for (let i = 0; i < totalItems; i += batchSize) {
        chunks.push(itemCardsJson.slice(i, i + batchSize));
    }

    let fullArticle: DraftBatchResult | null = null;

    for (let i = 0; i < chunks.length; i++) {
        const isFirst = i === 0;
        const isLast = i === chunks.length - 1;
        const batch = chunks[i];

        const batchResult = await executeDraftBatch({
            keyword,
            tone,
            briefJson,
            batch,
            evidencePack,
            apiKey,
            modelPrefix,
            isFirst,
            isLast,
            totalItems,
            styleDNA: (briefJson as { styleDNA?: StyleDNA })?.styleDNA || null
        });

        if (isFirst) {
            fullArticle = batchResult as DraftBatchResult;
        } else if (fullArticle) {
            fullArticle.listicle_items = [...fullArticle.listicle_items, ...(batchResult as DraftBatchResult).listicle_items];
            if (isLast && (batchResult as DraftBatchResult).article_outro) {
                fullArticle.article_outro = (batchResult as DraftBatchResult).article_outro;
            }
        }
    }

    return fullArticle;
}

// Internal helper for batched drafting
async function executeDraftBatch(params: {
    keyword: string;
    tone: string;
    briefJson: unknown;
    batch: ItemCard[];
    evidencePack: unknown;
    apiKey: string;
    modelPrefix: "pro" | "lite";
    isFirst: boolean;
    isLast: boolean;
    totalItems: number;
    styleDNA: StyleDNA | null;
}) {
    const { keyword, batch, evidencePack, apiKey, modelPrefix, isFirst, isLast, totalItems, styleDNA } = params;
    const modelId = resolveModelId(modelPrefix);
    const urlTemplate = `${GEMINI_BASE}/${modelId}:generateContent?key=API_KEY_PLACEHOLDER`;

    const systemInstruction = `You are a SHARP WARDROBE EDITOR. Your target audience is women (26-44) seeking style advice for real life.
    
    EDITORIAL PROMISE:
    Every article must: 1. Name a real wardrobe problem; 2. Explain the style logic; 3. Leave the reader feeling more capable.
    
    VOICE RULES:
    Intelligent but legible | Warm but not sugary | Opinionated but not arrogant. Practical but stylish.

    VOCABULARY GUIDE (MANDATORY):
    USE OFTEN: polished, grounded, deliberate, versatile, sharp, soft structure, balance, proportion, visual weight, clean line.
    STRICTLY BANNED: obsessed, game-changer, must-have, stunning, viral, Amazon hack, fashionista, flawlessly, look expensive, trendy girl, delve, elevate, chic, essential.

    IMAGE GENERATION MASTER STRUCTURE (MANDATORY):
    Assemble each "image_prompt" strictly following this formula:
    [SHOT_TYPE] of [SUBJECT] wearing [OUTFIT]. [LOCATION]. [LIGHTING_AND_WEATHER]. [CAMERA_AND_AESTHETIC]. [TEXTURE_AND_FINISH].

    - SHOT_TYPE: Must ALWAYS be 'Full-length frame showing shoes to crown, mid-stride'. The feet and shoes MUST be visible.
    - SUBJECT: ${styleDNA?.subject_definition || "A woman (26-44) with a modern, unforced personal style"}
    - OUTFIT: Focus on fabrics and material drape.
    - LOCATION: Ensure high variety. Choose settings like [Minimalist loft, cobblestone street, sun-drenched cafe, architectural library, flower market, art gallery, brutalist courtyard, moonlit garden]. Mix these throughout the list.
    - LIGHTING: ${styleDNA?.lighting_and_weather || "Natural cinematic lighting"}
    - CAMERA: ${styleDNA?.camera_and_aesthetic || "Shot on 35mm film"}
    - TEXTURE: ${styleDNA?.texture_and_finish || "Visible skin texture, authentic film grain"}

    AESTHETIC: 100% human, unposed, realistic skin texture, candid photography.
    
    EDITORIAL BANNED ACTIONS:
    - DO NOT drift into influencer tone.
    - DO NOT over-explain trends without utility.
    - DO NOT write long intros.
    - DO NOT promise wear-tests unless verified.
    - DO NOT INCLUDE ANY NUMBERING IN THE "title" FIELD.
    `;

    const instructions = isFirst ? `You are drafting the START of a ${totalItems}-item listicle. Generate the SEO metadata, Introduction, and the first ${batch.length} items.`
        : isLast ? `You are drafting the END of a ${totalItems}-item listicle. Generate the final ${batch.length} items and the Outro.`
        : `You are drafting a MIDDLE section of a ${totalItems}-item listicle. Generate content for ${batch.length} items.`;

    const prompt = `
${instructions}
KEYWORD: "${keyword}"
EVIDENCE: ${JSON.stringify(evidencePack)}
BATCH ITEMS: ${JSON.stringify(batch, null, 2)}

OUTPUT REQUIREMENTS:
- "title": Specific, compelling headline. NO NUMBERS.
- "content": Exactly 3 SHORT sentences. FORMULA: Hook (tension/problem) → Meaning (logic) → Utility (action) → Direction (branding).
- "image_prompt": ASSEMBLE the prompt using the MASTER STRUCTURE. 

Return a JSON matching the appropriate schema parts.
    `.trim();

    const data = (await fetchWithKeyRotation(apiKey, urlTemplate, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            system_instruction: { parts: [{ text: systemInstruction }] },
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
                responseMimeType: "application/json",
                responseSchema: DraftArticleSchema, 
                temperature: 0.9,
            },
        }),
    })) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };

    return extractJSONData(data);
}

// Stage 5: Editorial QA
export async function pipelineScoreEditorialQA(articleJson: any, itemCardsJson: any[], apiKey: string) {
    const modelId = resolveModelId("lite", true);
    const urlTemplate = `${GEMINI_BASE}/${modelId}:generateContent?key=API_KEY_PLACEHOLDER`;

    const systemInstruction = `You are a SENIOR EDITORIAL DIRECTOR. Review this AI-generated fashion article against the "SHARP WARDROBE EDITOR" standards.
    
    REJECT OR SCORE LOW IF:
    1. It fails to name a "Real Wardrobe Problem".
    2. It uses BANNED AI-isms (chic, elevate, essential, game-changer, viral, obsessed).
    3. It sounds trend-panicked, shouty, or fake-luxury.
    4. The sentence formula (Hook → Meaning → Utility → Direction) is missing or weak.
    
    Output JSON only.`;
    const prompt = `
ARTICLE:
${JSON.stringify(articleJson, null, 2)}

CARDS:
${JSON.stringify(itemCardsJson, null, 2)}

Provide strict Quality Assurance scores. Flag weak sections.
    `.trim();

    const data = await fetchWithKeyRotation(apiKey, urlTemplate, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            system_instruction: { parts: [{ text: systemInstruction }] },
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
                responseMimeType: "application/json",
                responseSchema: QAScoreSchema,
                temperature: 0.2, 
            },
        }),
    });

    return extractJSONData(data);
}

// Helper for JSON schema-constrained responses
function extractJSONData(data: any): any {
    const textPayload = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!textPayload) {
        const blockReason = data.promptFeedback?.blockReason;
        throw new Error(`Invalid response from Gemini. ${blockReason ? `Blocked: ${blockReason}` : "Missing text candidate."}`);
    }
    try {
        return JSON.parse(textPayload);
    } catch {
        throw new Error("Failed to parse JSON from Gemini payload.");
    }
}

// Helper for grounded free-form responses (googleSearch cannot use responseSchema)
function extractJSONDataFreeForm(data: any): any {
    const textPayload = data.candidates?.[0]?.content?.parts?.find((p: any) => p.text)?.text;
    if (!textPayload) {
        const blockReason = data.promptFeedback?.blockReason;
        throw new Error(`Grounded search returned no content. ${blockReason ? `Blocked: ${blockReason}` : ""}`);
    }
    // Strip markdown fences if model wrapped it
    const clean = textPayload.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
    try {
        return JSON.parse(clean);
    } catch {
        // If JSON parse fails, return a safe fallback so pipeline continues
        console.warn("Evidence pack JSON parse failed, using fallback.", clean.slice(0, 200));
        return {
            trending_angles: [textPayload.slice(0, 100)],
            top_sources: [],
            seasonal_context: "",
            audience_pain_points: [],
            competitive_gaps: "",
            key_statistics: [],
        };
    }
}
