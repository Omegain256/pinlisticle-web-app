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
    const now = getNow();

    // Pick a random intro hook style to force variety across batch runs
    const hookStyles = [
        "Start with a surprising or counter-intuitive observation about this keyword that most people get wrong.",
        "Start with a specific 2026 trend statistic or data point from the evidence data.",
        "Start with a direct, punchy question that names the reader's exact frustration.",
        "Start with a bold, specific style opinion that signals genuine expertise — no hedging.",
        `Start by naming the exact season (it is currently ${now}) and why this keyword is urgent right now.`,
    ];
    const hookStyle = hookStyles[Math.floor(Math.random() * hookStyles.length)];

    const systemInstruction = `You are a fashion editor writing for Who What Wear — the gold standard for Pinterest-first style content. Today is ${now}. Tone: ${tone}.

VOICE — study this and match it exactly:
Who What Wear uses first-person, self-aware, conversational writing. Examples of correct style:
- "Every spring, I have that moment when I feel convinced I need a whole new wardrobe."
- "What I've learned (mostly from watching chic people on Instagram) is that the secret isn't more clothes."
- "This is the outfit equivalent of letting one piece do all the talking."
- "A trench coat is basically spring's answer to every outfit dilemma."
- "There's something about a nipped-in blazer that makes everything feel more styled."
Write exactly like this. Short, declarative, confident, slightly self-aware. Never formal. Never corporate.

STYLE RULES:
- First-person singular ("I", "my") for the intro — like you discovered this yourself
- Each item's "content": one strong editorial sentence + one specific styling tip + one "why it works" line
- Use "instantly," "never fails," "basically," "the kind that," "something about" — real editor language
- Be specific: "camel-toned blazer over a white ribbed tank" not "a blazer over a top"
- No filler. Every word earns its place.
- Em dashes for asides — they signal confidence

TEMPORAL RULES:
- Today is ${now}. Write for Spring 2026.
- Never write "2024" as current. Say "last year" or skip it.
- Seasonal context must match the current month.

CONTENT RULES:
1. BANNED OPENERS: "I've been styling clients", "you've come to the right place", "look no further", "let's dive in", "without further ado"
2. Every item MUST use specific details from its evidence card: exact colors, fabrics, accessories.
3. Intro: 2-3 sentences, first-person, relatable moment or observation. Under 60 words.
4. Outro: 1-2 sentences, one specific actionable tip. Under 40 words. No "happy styling!"

READABILITY (non-negotiable):
- Max 20 words per sentence.
- Item "content": exactly 3 short sentences, 60-80 words total.
- Zero chunky paragraphs.
- Active voice only.

IMAGE RULES:
- Each image_prompt: 60-80 words, hyper-realistic editorial photo of a real stylish woman, exact outfit with colors and fabrics, specific location, lighting, camera angle.`;

    const evidenceSummary = evidencePack ? `
LIVE RESEARCH DATA — current as of ${now} (prioritise this over your training data):
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
TODAY'S DATE: ${now}
KEYWORD: "${keyword}"
${briefSummary}
${evidenceSummary}

INTRO HOOK INSTRUCTION: ${hookStyle}

ITEM EVIDENCE CARDS — write exactly ${itemCardsJson.length} listicle items, one per card, in order:
${JSON.stringify(itemCardsJson, null, 2)}

OUTPUT REQUIREMENTS per listicle_item:
- "title": Specific, compelling headline (e.g. "The Oversized Blazer Method" not "Look 1: Blazer")
- "content": Exactly 3 SHORT sentences (max 20 words each, 60-80 words total). Reference colors, textures, accessories from styling_notes. Cite one trend_support point.
- "has_swap": true if card has optional_swap
- "image_prompt": 60-80 word Imagen prompt — exact outfit, colors, fabric, woman's pose, specific location, lighting, 35mm lens bokeh.
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
