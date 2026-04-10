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
2. LOCATION: Define the specific setting (e.g. 'produce aisle of a grocery store', 'minimalist brutalist concrete loft').
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

    // Hook strategies focused on naming a "Real Wardrobe Problem"
    const hookStyles = [
        "Name a common wardrobe tension this keyword creates (e.g., 'Looking polished while staying comfortable').",
        "Point out a specific style error people make with this topic and how to fix it with logic.",
        "Ask a punchy question about the functional reality of this wardrobe piece in a busy morning.",
        "Identify a counter-intuitive observation that validates the reader's private style struggle.",
        "Bridge the gap between a high-fashion inspiration and the practical reality of a 26-44 lifestyle."
    ];
    const hookStyle = hookStyles[Math.floor(Math.random() * hookStyles.length)];

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

    - SHOT_TYPE: Must ALWAYS be 'Full-length frame showing shoes to crown, mid-stride'. The feet and shoes MUST be visible in every single image.
    - SUBJECT: Use the consistent "subject_definition" from Style DNA.
    - OUTFIT: Use the "outfit_description" from the item card styling notes.
    - LOCATION: Use the "location_definition" from Style DNA.
    - LIGHTING_AND_WEATHER: Use "lighting_and_weather" from Style DNA.
    - CAMERA_AND_AESTHETIC: Use "camera_and_aesthetic" from Style DNA.
    - TEXTURE_AND_FINISH: Use "texture_and_finish" from Style DNA.

    AESTHETIC: 100% human, unposed, realistic skin texture, candid photography, influencer-style (street or mirror).
    
    EDITORIAL BANNED ACTIONS (STRICTLY PROHIBITED):
    - DO NOT drift into influencer tone ("I'm obsessed", "You guys need this").
    - DO NOT over-explain trends without providing utility/logic.
    - DO NOT write long intros (Keep under 60 words).
    - DO NOT create list items that repeat styling advice or items from previous cards.
    - DO NOT mix different image locations within one article (Keep location consistent).
    - DO NOT promise personal wear-tests or claim you've worn the items unless verified in research.
    `;

    const evidenceSummary = evidencePack ? `
LIVE RESEARCH DATA — current as of ${now} (prioritise this over your training data):
- Trending angles: ${(evidencePack.trending_angles || []).join("; ")}
- Audience pain points: ${(evidencePack.audience_pain_points || []).join("; ")}` : "";

    const prompt = `
KEYWORD: "${keyword}"
${evidenceSummary}

ITEM EVIDENCE CARDS:
${JSON.stringify(itemCardsJson, null, 2)}

OUTPUT REQUIREMENTS per listicle_item:
- "title": Specific, compelling headline.
- "content": Exactly 3 SHORT sentences. Formula: Hook (tension) → Meaning (logic) → Utility (action) → Direction (branding).
- "has_swap": true if card has optional_swap.
- "image_prompt": ASSEMBLE the prompt using the MASTER STRUCTURE described in system instructions.
- "product_recommendations": 3 specific real-world items (top, bottom, shoes) matching the image_prompt.
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
                    responseSchema: DraftArticleSchema,
                    temperature: 0.9,
                },
            }),
        });

        return extractJSONData(data);
    } catch (err: any) {
        if (err instanceof ModelOverloadedError && modelPrefix === "pro") {
            console.warn(`[Resilience] Gemini Pro overloaded during article drafting. Falling back to Gemini Flash.`);
            return pipelineDraftArticle(keyword, tone, briefJson, itemCardsJson, evidencePack, apiKey, "lite");
        }
        throw err;
    }
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
