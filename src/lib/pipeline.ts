import {
    fetchWithKeyRotation,
    sanitizeModelId,
    MODELS_DEFAULT,
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

// Server-safe model resolution — does NOT rely on localStorage (which is client-only).
// Uses MODELS_DEFAULT directly since the server always knows which models exist.
function resolveModelId(modelPrefix: "pro" | "lite", forceFlash: boolean = false): string {
    const prefix = forceFlash ? "lite" : modelPrefix;
    const modelId = MODELS_DEFAULT[prefix as keyof typeof MODELS_DEFAULT] || MODELS_DEFAULT.pro;
    return sanitizeModelId(modelId);
}

// Stage 1: Classify Topic (Brief)
export async function pipelineClassifyTopic(keyword: string, apiKey: string) {
    const modelId = resolveModelId("lite", true); // Classification is simple, use flash
    const urlTemplate = `${GEMINI_BASE}/${modelId}:generateContent?key=API_KEY_PLACEHOLDER`;

    const systemInstruction = `You are a content strategist for a Pinterest-focused publishing platform. Classify the user keyword and create a content brief.`;
    const prompt = `Classify this keyword: "${keyword}"`;

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
// We use free-form output and parse it ourselves.
export async function pipelineSearchEvidence(keyword: string, briefJson: any, apiKey: string) {
    const modelId = resolveModelId("lite", true);
    const urlTemplate = `${GEMINI_BASE}/${modelId}:generateContent?key=API_KEY_PLACEHOLDER`;

    const systemInstruction = `You are a research editor. Use Google Search to gather current information, then produce a JSON evidence pack. Output ONLY valid JSON, no markdown fences, no extra text.`;
    const prompt = `
Keyword: "${keyword}"
Brief: ${JSON.stringify(briefJson)}

Return a JSON object with these fields:
- "trending_angles": string[] (3-5 current angles)
- "top_sources": string[] (3-5 source domains)
- "seasonal_context": string
- "audience_pain_points": string[]
- "competitive_gaps": string
- "key_statistics": string[]
`.trim();

    const data = await fetchWithKeyRotation(apiKey, urlTemplate, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            system_instruction: { parts: [{ text: systemInstruction }] },
            contents: [{ parts: [{ text: prompt }] }],
            tools: [{ googleSearch: {} }],
            generationConfig: {
                temperature: 0.3,
            },
        }),
    });

    // Grounded responses return free-form text — extract and parse JSON manually
    return extractJSONDataFreeForm(data);
}

// Stage 3: Item Cards
export async function pipelineGenerateItemCards(keyword: string, count: number, briefJson: any, evidencePackJson: any, apiKey: string, modelPrefix: "pro" | "lite") {
    const modelId = resolveModelId(modelPrefix);
    const urlTemplate = `${GEMINI_BASE}/${modelId}:generateContent?key=API_KEY_PLACEHOLDER`;

    const systemInstruction = `You are an expert editor building an evidence-backed content plan.`;
    const prompt = `
KEYWORD: "${keyword}"
ARTICLE BRIEF:
${JSON.stringify(briefJson, null, 2)}

WEB RESEARCH:
${JSON.stringify(evidencePackJson, null, 2)}

Generate exactly ${count} item evidence cards based strictly on the research, ignoring generic fluff.
    `.trim();

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
}

// Stage 3.5: Style DNA
export async function pipelineGenerateStyleDNA(topic: string, briefJson: any, apiKey: string) {
    const modelId = resolveModelId("lite", true);
    const urlTemplate = `${GEMINI_BASE}/${modelId}:generateContent?key=API_KEY_PLACEHOLDER`;

    const prompt = `
Generate a single Style DNA JSON object that will drive the image generation prompts for an article about: "${topic}".
BRIEF: ${JSON.stringify(briefJson)}
Keep it editorial, realistic, and Pinterest-optimized.
    `.trim();

    const data = await fetchWithKeyRotation(apiKey, urlTemplate, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
                responseMimeType: "application/json",
                responseSchema: StyleDNASchema,
                temperature: 0.7, 
            },
        }),
    });

    return extractJSONData(data);
}


// Stage 4: Draft Article
export async function pipelineDraftArticle(keyword: string, tone: string, briefJson: any, itemCardsJson: any[], apiKey: string, modelPrefix: "pro" | "lite") {
    const modelId = resolveModelId(modelPrefix);
    const urlTemplate = `${GEMINI_BASE}/${modelId}:generateContent?key=API_KEY_PLACEHOLDER`;

    const systemInstruction = `You are a senior Pinterest content editor. You write listicles that feel like genuine expert advice — specific, experience-backed, and immediately useful. 
Tone: ${tone}. 
STRICT RULES:
- Each listicle item MUST come from the provided Item Cards. Do not invent new items.
- Each item's content MUST reference the item's trend_support data and styling_notes from its card.
- Each item's image_prompt MUST be a rich, detailed Imagen generation prompt (50-80 words) describing a real editorial photo of a real woman wearing/using the item. Be hyper-specific: include clothing colors, fabric, setting, lighting, camera angle.
- The article must feel like it was written by someone with first-hand expertise, not generic SEO content.`;

    const briefSummary = briefJson ? `
TOPIC BRIEF:
- Search intent: ${briefJson.search_intent || "mixed"}
- Audience: ${briefJson.audience || "style-conscious women"}
- Seasonal context: ${briefJson.seasonality_notes || "year-round"}
- Archetype: ${briefJson.recommended_article_archetype || "wearable-ideas"}` : "";

    const prompt = `
KEYWORD: "${keyword}"
${briefSummary}

ITEM EVIDENCE CARDS (use ALL ${itemCardsJson.length} cards, in order):
${JSON.stringify(itemCardsJson, null, 2)}

Write the full listicle. For each listicle_item:
- "title": catchy, specific headline for the item
- "content": 3-4 sentences of genuinely useful, specific advice referencing the card's why_it_works and styling_notes
- "has_swap": true if the card has a budget/alternative swap
- "image_prompt": detailed Imagen prompt for a hyper-realistic editorial photograph of this item
    `.trim();

    const data = await fetchWithKeyRotation(apiKey, urlTemplate, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            system_instruction: { parts: [{ text: systemInstruction }] },
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
                responseMimeType: "application/json",
                responseSchema: DraftArticleSchema,
                temperature: 0.8,
            },
        }),
    });

    return extractJSONData(data);
}

// Stage 5: Editorial QA
export async function pipelineScoreEditorialQA(articleJson: any, itemCardsJson: any[], apiKey: string) {
    const modelId = resolveModelId("lite", true);
    const urlTemplate = `${GEMINI_BASE}/${modelId}:generateContent?key=API_KEY_PLACEHOLDER`;

    const systemInstruction = `You are a senior editor reviewing AI-generated content. Score the article against the cards. Return exact JSON matches for dimension scoring.`;
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
