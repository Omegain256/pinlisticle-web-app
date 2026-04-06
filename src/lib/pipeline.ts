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
export async function pipelineDraftArticle(keyword: string, tone: string, briefJson: any, itemCardsJson: any[], evidencePack: any, apiKey: string, modelPrefix: "pro" | "lite") {
    const modelId = resolveModelId(modelPrefix);
    const urlTemplate = `${GEMINI_BASE}/${modelId}:generateContent?key=API_KEY_PLACEHOLDER`;

    // Pick a random intro hook style to force variety across batch runs
    const hookStyles = [
        "Start with a surprising or counter-intuitive observation about this keyword.",
        "Start with a specific statistic or trend from the evidence data.",
        "Start with a direct, conversational question that speaks to the reader's exact frustration.",
        "Start with a bold, specific style opinion that feels like genuine expertise.",
        "Start by naming a specific season/moment that makes this keyword urgent right now.",
    ];
    const hookStyle = hookStyles[Math.floor(Math.random() * hookStyles.length)];

    const systemInstruction = `You are a senior fashion and lifestyle editor writing for a Pinterest-first audience. Your tone is ${tone}.
ABSOLUTE RULES — violating any of these makes the output unusable:
1. NEVER open with "I've been styling clients for years" or any variation of it.
2. NEVER use generic SEO filler phrases like "you've come to the right place", "look no further", "we've got you covered", "let's dive in", "without further ado".
3. NEVER repeat the same sentence structure or opening across multiple articles.
4. Every item's content MUST cite specific details from its evidence card (colors, fabrics, brand names, trend angles, styling notes).
5. The intro (article_intro) MUST be unique to THIS specific keyword — not a generic style template.
6. The outro (article_outro) must end with a specific, actionable takeaway or styling tip — not a generic "happy styling!" sign-off.
7. Each image_prompt MUST be 60-80 words describing a hyper-realistic editorial photograph of a specific woman wearing/using the item. Include: exact garment description, colors, fabrics, body position, background setting, lighting quality, camera angle.`;

    const evidenceSummary = evidencePack ? `
LIVE RESEARCH DATA (use this to make the article feel current and specific):
- Trending angles: ${(evidencePack.trending_angles || []).join("; ")}
- Key statistics: ${(evidencePack.key_statistics || []).join("; ")}  
- Seasonal context: ${evidencePack.seasonal_context || ""}
- Audience pain points: ${(evidencePack.audience_pain_points || []).join("; ")}
- Competitive gap (what others miss): ${evidencePack.competitive_gaps || ""}` : "";

    const briefSummary = briefJson ? `
CONTENT BRIEF:
- Search intent: ${briefJson.search_intent || "mixed"}
- Seasonal context: ${briefJson.seasonality_notes || ""}
- Article archetype: ${briefJson.recommended_article_archetype || "wearable-ideas"}` : "";

    const prompt = `
KEYWORD: "${keyword}"
${briefSummary}
${evidenceSummary}

INTRO HOOK INSTRUCTION: ${hookStyle}

ITEM EVIDENCE CARDS — write exactly ${itemCardsJson.length} listicle items, one per card, in order:
${JSON.stringify(itemCardsJson, null, 2)}

OUTPUT REQUIREMENTS for each listicle_item:
- "title": Specific, compelling headline (not generic — e.g. "The Oversized Blazer Method" not "Look 1: Blazer")
- "content": 3-4 sentences. Reference specific colors, textures, accessories from the card's styling_notes. Cite at least one of the card's trend_support points.
- "has_swap": true if the card has an optional_swap
- "image_prompt": 60-80 word Imagen prompt for a hyper-realistic editorial photo. Must describe: exact outfit with colors and fabric, woman's pose/action, specific location (e.g. "cobblestone Paris side street"), natural window light, 35mm lens bokeh background.
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
                temperature: 0.9,
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
