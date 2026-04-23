/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
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
    StyleDNASchema,
    VisualIntelligenceSchema,
} from "./schemas";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

// Current date injected into every prompt so Gemini knows it's 2026, not 2024.
function getNow(): string {
    return new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

// Server-safe model resolution — does NOT rely on localStorage (which is client-only).
function resolveModelId(modelPrefix: "pro" | "lite", forceFlash: boolean = false): string {
    const prefix = forceFlash ? "lite" : modelPrefix;
    const modelId = MODELS_DEFAULT[prefix as keyof typeof MODELS_DEFAULT] || MODELS_DEFAULT.pro;
    return sanitizeModelId(modelId);
}

/** 
 * Utility to strip heavy base64 data and massive prompts before sending to LLM.
 * This prevents reaching the MAX_API_PAYLOAD_SIZE (1MB usually).
 */
export function stripHeavyData(obj: any): any {
    if (!obj) return obj;
    if (Array.isArray(obj)) return obj.map((item: any) => stripHeavyData(item));
    if (typeof obj !== "object") return obj;

    const stripped = { ...obj };
    const heavyFields = ["image_base64", "imageBase64", "web_image", "visual_dna", "image_results"];
    
    for (const field of heavyFields) {
        if (field in stripped) {
            // Keep the metadata but remove the actual base64
            if (field === "web_image" && stripped[field]?.image_base64) {
                stripped[field] = { ...stripped[field], image_base64: "[STRIPPED_FOR_LLM]" };
            } else {
                stripped[field] = "[STRIPPED]";
            }
        }
    }
    
    // Recursively strip nested objects
    for (const key in stripped) {
        if (typeof stripped[key] === "object") {
            stripped[key] = stripHeavyData(stripped[key]);
        }
    }
    
    return stripped;
}

// Stage 1: Classify Topic (Brief)
export async function pipelineClassifyTopic(keyword: string, apiKey: string, category: "fashion" | "beauty" = "fashion") {
    const modelId = resolveModelId("lite", true); // Classification is simple, use flash
    const urlTemplate = `${GEMINI_BASE}/${modelId}:generateContent?key=API_KEY_PLACEHOLDER`;

    const systemInstructionFashion = `You are a high-end fashion editor. Your job is to transform a simple keyword into a "Real Wardrobe Problem" worth solving.
    
    EDITORIAL MISSION: 
    Help women aged 26-44 make faster, smarter wardrobe decisions. Translate inspiration into wardrobes that work for real mornings, real budgets, and real schedules.

    OBJECTIVE:
    1. Identify the core "Wardrobe Tension" or "Problem" behind this keyword.
    2. Determine the "Style Logic" required to solve it.
    3. Define the "Reader Outcome" (how they feel more capable).
    4. Categorize the style archetype as ONLY ONE of: "casual", "luxury", or "sporty".
    5. Identify if the keyword implies a specific "subject_demographic" (e.g. "plus size", "petite", "mature", "tall", "hourglass"). If none, use "universal".
    
    Return a JSON brief.`;

    const systemInstructionBeauty = `You are a high-end beauty editor. Your job is to transform a simple beauty keyword into an expert technical execution guide.
    
    EDITORIAL MISSION:
    Focus on macro details, performance, and technique. Identify technique clusters, finish types, and aesthetic categories.

    OBJECTIVE:
    1. Identify the core "Beauty Tension" or "Performance Goal".
    2. Determine the "Technique/Product Logic" required.
    3. Define the "Reader Outcome" (confidence, skill, or aesthetic perfection).
    4. Categorize the style archetype as ONLY ONE of: "face", "eye", or "hair".
    5. Identify if the keyword implies a specific "subject_demographic" (e.g. "plus size", "oily skin", "dark skin", "mature skin", "curly hair"). If none, use "universal".
    
    Return a JSON brief.`;

    const systemInstruction = category === "beauty" ? systemInstructionBeauty : systemInstructionFashion;
    const prompt = `Classify this keyword/topic: "${keyword}". Identify the real-life problem it solves.`;

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

// ─────────────────────────────────────────────────────────────────────────────
// Jina AI Reader — Free web-to-markdown proxy. No API key required.
// Fetches any public URL and returns full article content as clean markdown.
// ─────────────────────────────────────────────────────────────────────────────
const JINA_BASE = "https://r.jina.ai/";
const JINA_TIMEOUT_MS = 10000; // 10s per page

/** Fashion article sources to prioritise when selecting page URLs to read */
const FASHION_SOURCE_PRIORITY = [
    "whowhatwear.com",
    "vogue.com",
    "harpersbazaar.com",
    "refinery29.com",
    "instyle.com",
    "elle.com",
    "glamour.com",
    "pinterest.com",
    "byrdie.com",
    "thezoereport.com",
];

/** Fetch a URL via Jina AI Reader and return the markdown content */
async function fetchViaJina(pageUrl: string): Promise<string | null> {
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), JINA_TIMEOUT_MS);
        const res = await fetch(`${JINA_BASE}${pageUrl}`, {
            signal: controller.signal,
            headers: {
                "Accept": "text/markdown, text/plain, */*",
                "X-Return-Format": "markdown",
                "X-Image-Caption": "true", // include image captions with URLs
            },
        });
        clearTimeout(timer);
        if (!res.ok) return null;
        const text = await res.text();
        return text.slice(0, 8000); // cap at 8K chars per article to stay within context
    } catch {
        return null;
    }
}

/** Fetch search results (with snippets and images) for a keyword via Jina AI Search */
export async function searchViaJina(query: string): Promise<string | null> {
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), JINA_TIMEOUT_MS);
        const encodedQuery = encodeURIComponent(query);
        const res = await fetch(`https://s.jina.ai/${encodedQuery}`, {
            signal: controller.signal,
            headers: {
                "Accept": "text/markdown, text/plain, */*",
                "X-Return-Format": "markdown"
            },
        });
        clearTimeout(timer);
        if (!res.ok) return null;
        return await res.text();
    } catch (e) {
        console.warn(`[JinaSearch] failed for "${query}":`, e);
        return null;
    }
}

/** Extract image URLs from Jina-returned markdown */
export function extractImagesFromMarkdown(markdown: string): string[] {
    const urls: string[] = [];
    // Match markdown image syntax: ![alt](url)
    const mdImgs = markdown.matchAll(/!\[[^\]]*\]\((https?:\/\/[^)\s?#]+(?:[^)\s]*))\)/g);
    for (const m of mdImgs) {
        const url = m[1];
        if (/\.(jpg|jpeg|png|webp|avif)/i.test(url)) urls.push(url);
    }

    // Match Pinterest image CDN
    const pinImgs = markdown.matchAll(/https?:\/\/i\.pinimg\.com\/[^\s"')]+\.(?:jpg|jpeg|png|webp)/gi);
    for (const m of pinImgs) urls.push(m[0]);

    // Match generic fashion CDN patterns (ignoring trailing parens)
    const cdnImgs = markdown.matchAll(/https?:\/\/[^\s"')(]+\.(?:jpg|jpeg|png|webp)(?:\?[^\s"')(]*)?/gi);
    for (const m of cdnImgs) urls.push(m[0]);

    // Match common lazy-load patterns
    const lazyImgs = markdown.matchAll(/(?:data-src|data-lazy|data-original|data-srcset)=["'](https?:\/\/[^\s"']+)["']/gi);
    for (const m of lazyImgs) urls.push(m[1]);

    // Pinterest / Social "media=" parameter extraction (High-res source)
    const mediaParams = markdown.matchAll(/[?&]media=([^&"'\s]+\.(?:jpg|jpeg|png|webp|avif)(?:\?[^&"'\s]*)?)/gi);
    for (const m of mediaParams) {
        try {
            urls.push(decodeURIComponent(m[1]));
        } catch {
            urls.push(m[1]);
        }
    }

    // Match CDN images that use parameters instead of extensions (e.g. ?format=webp)
    const paramImgs = markdown.matchAll(/https?:\/\/[^\s"')(]+\.[a-z0-9]{2,5}(?:\?[^\s"')(]*?(?:format|width|height|width|resize)=[^&"'\s]+)/gi);
    for (const m of paramImgs) urls.push(m[0]);

    // Pinterest Pin resolver: if a pin URL is found, we should ideally visit it
    // For now, extract potential image IDs from the URL and guestimate CDN URLs
    const pinIds = markdown.matchAll(/pinterest\.com\/pin\/(\d+)/gi);
    for (const m of pinIds) {
        const pinId = m[1];
        // We know standard Pinterest structure: originals/xx/yy/zz/...
        // But better is to just add the PIN URL to the list and let the sniper handle it
        urls.push(`https://www.pinterest.com/pin/${pinId}/`);
    }

    return [...new Set(urls)].slice(0, 60); // Even higher cap for Zero-Fail
}

/** Extract page URLs from Gemini groundingChunks and rank by fashion source priority */
function extractAndRankPageUrls(groundingData: any): string[] {
    const chunks: any[] = groundingData?.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
    const urls: string[] = [];
    for (const chunk of chunks) {
        const uri: string = chunk?.web?.uri || "";
        // EXCLUSION: Filter out internal Google Search grounding redirect URLs.
        // These URLs are not scrapeable by Jina and result in 403 or hang errors.
        if (uri && uri.startsWith("http") && !uri.includes("vertexaisearch.cloud.google.com")) {
            urls.push(uri);
        }
    }
    // Also pull from search suggestions
    const suggestions = groundingData?.candidates?.[0]?.groundingMetadata?.webSearchQueries || [];
    
    return urls.sort((a, b) => {
        const rankA = FASHION_SOURCE_PRIORITY.findIndex(s => a.includes(s));
        const rankB = FASHION_SOURCE_PRIORITY.findIndex(s => b.includes(s));
        return (rankA === -1 ? 99 : rankA) - (rankB === -1 ? 99 : rankB);
    });
}

// Stage 2: Web Search Evidence Pack (Jina AI enhanced)
// Flow: googleSearch grounding → extract real article URLs → Jina reads full article text
// → Gemini synthesises structured evidence from REAL content → returns with reference_image_urls
export async function pipelineSearchEvidence(keyword: string, briefJson: any, apiKey: string) {
    const modelId = resolveModelId("lite", true);
    const urlTemplate = `${GEMINI_BASE}/${modelId}:generateContent?key=API_KEY_PLACEHOLDER`;
    const now = getNow();

    // ── Step A: Run grounded search to discover top article page URLs ──────────
    console.log(`[S2] Running grounded search for: "${keyword}"...`);
    let groundingData: any = null;
    let pageUrls: string[] = [];

    try {
        const searchData = await fetchWithKeyRotation(apiKey, urlTemplate, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                system_instruction: { parts: [{ text: `You are a research assistant. Today is ${now}. Search for the most current 2026 fashion articles, outfit ideas, and trend reports for the given keyword. Focus on authoritative fashion sources.` }] },
                contents: [{ parts: [{ text: `Search for the very latest 2026 fashion content about: "${keyword}". Find the top articles from Vogue, Who What Wear, Harper's Bazaar, Refinery29, InStyle, Elle, and Pinterest.` }] }],
                tools: [{ googleSearch: {} }],
                generationConfig: { temperature: 0.1 },
            }),
        });
        groundingData = searchData;
        pageUrls = extractAndRankPageUrls(searchData);
        console.log(`[S2] Grounded search found ${pageUrls.length} article URLs.`);
    } catch (e: any) {
        console.warn(`[S2] Grounded search failed: ${e.message}. Proceeding with Jina fallback.`);
    }

    // ── Step B: Deep-read top 4 articles via Jina AI Reader (free) ────────────
    const MAX_PAGES = 4;
    const articleContents: Array<{ url: string; title: string, markdown: string }> = [];
    let allReferenceImageUrls: string[] = [];

    // If grounded search found no URLs, use a direct Jina search on key fashion sites
    if (pageUrls.length === 0) {
        const fallbackUrls = [
            `https://www.whowhatwear.com/search?q=${encodeURIComponent(keyword)}`,
            `https://www.refinery29.com/en-us/search?q=${encodeURIComponent(keyword)}`,
            `https://www.vogue.com/search?q=${encodeURIComponent(keyword)}`,
        ];
        pageUrls = fallbackUrls;
    }

    // Filter for editorial article URLs — reject search pages, homepages, generic nav
    const EDITORIAL_PATTERNS = [/\/\d{4}\//, /\/article\//i, /\/style\//i, /\/fashion\//i, /\/outfits?\//i, /\/lookbook\//i, /\/what-to-wear/i, /\/trend/i, /\/best-/i, /\/spring-/i, /\/summer-/i, /\/fall-/i, /\/winter-/i, /\d{1,2}-[a-z]+-/];
    const REJECT_PATTERNS = [/\/search[/?]/i, /\?q=/i, /\?s=/i, /\/page\//i];
    const editorialUrls = pageUrls.filter(u =>
        !REJECT_PATTERNS.some(p => p.test(u)) &&
        (EDITORIAL_PATTERNS.some(p => p.test(u)) || FASHION_SOURCE_PRIORITY.some(s => u.includes(s)))
    );
    const filteredUrls = editorialUrls.length >= 2 ? editorialUrls : pageUrls;
    const topUrls = filteredUrls.slice(0, MAX_PAGES);
    console.log(`[S2] Reading ${topUrls.length} editorial articles via Jina (${editorialUrls.length}/${pageUrls.length} editorial)...`);

    // Fetch pages sequentially to avoid rate limits
    for (const url of topUrls) {
        const markdown = await fetchViaJina(url);
        if (markdown && markdown.length > 200) {
            // Extract title from markdown h1 or first line
            const match = markdown.match(/^#\s+(.+)$/m) || markdown.match(/^(.+)$/m);
            const title = match ? match[1].trim() : "Fashion Article";
            
            articleContents.push({ url, title, markdown });
            const imgUrls = extractImagesFromMarkdown(markdown);
            allReferenceImageUrls.push(...imgUrls);
            console.log(`[S2] ✓ Jina read ${url.slice(0, 60)}... (${markdown.length} chars, ${imgUrls.length} images)`);
        } else {
            const reason = !markdown ? "Empty/Null Response" : `Too short (${markdown.length} chars)`;
            console.log(`[S2] ✗ Jina could not read: ${url.slice(0, 60)}... [${reason}]`);
        }
        await sleep(300); // gentle pacing
    }

    // ── Step B.5: Harvest Grounding Images (Snippets) ────────────────────────
    // These are "unblockable" thumbnails indexed by Google Search/Search metadata
    if (groundingData) {
        const metadata = groundingData?.candidates?.[0]?.groundingMetadata;
        // Search suggestions often contain image thumbnails or references
        const stringified = JSON.stringify(metadata);
        const groundingImgs = extractImagesFromMarkdown(stringified);
        allReferenceImageUrls.push(...groundingImgs);
        console.log(`[S2] Harvested ${groundingImgs.length} images from grounding metadata.`);
    }

    // Deduplicate image URLs
    allReferenceImageUrls = [...new Set(allReferenceImageUrls)];
    console.log(`[S2] Total reference images harvested: ${allReferenceImageUrls.length}`);

    // ── Step C: Synthesise structured evidence from REAL article content ───────
    const hasRealContent = articleContents.length > 0;
    const realContentBlock = hasRealContent
        ? articleContents.map(a => `SOURCE: ${a.url}\n${a.markdown}`).join("\n\n---\n\n")
        : "No article content available — use your training knowledge for Spring 2026.";

    const systemInstruction = `You are a senior fashion research editor. Today is ${now}.
Your job: synthesize structured intelligence from real fashion articles for a listicle writer.
Be HIGHLY SPECIFIC — name exact brands, specific color codes, exact garment names from the actual articles.
Do NOT generalise. Do NOT hallucinate statistics. Attribute every claim to its source URL.
Output ONLY valid JSON, no markdown fences, no extra text.`;

    const synthesisPrompt = `
Today: ${now}
Keyword: "${keyword}"
Brief: ${JSON.stringify(briefJson)}

REAL ARTICLE CONTENT FROM TOP FASHION SOURCES (${articleContents.length} articles read):
${realContentBlock}

Based on this REAL content, return a JSON object with:
- "trending_angles": string[] (3-5 SPECIFIC trends from the actual articles above — quote exact outfit combos or brand names found)
- "top_sources": string[] (URLs of sources actually read)
- "seasonal_context": string (exact season/context from the articles — include specific event references if found)
- "audience_pain_points": string[] (real problems mentioned in the articles or comments)
- "competitive_gaps": string (what angle these articles MISSED that we can own)
- "key_statistics": string[] (any specific numbers, percentages, product names with prices — quote source)
- "specific_outfits": string[] (exact outfit combinations mentioned in articles — brand + garment + styling)
`.trim();

    try {
        const synthesisData = await fetchWithKeyRotation(apiKey, urlTemplate, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                system_instruction: { parts: [{ text: systemInstruction }] },
                contents: [{ parts: [{ text: synthesisPrompt }] }],
                generationConfig: { temperature: 0.3 },
            }),
        });

        const result = extractJSONDataFreeForm(synthesisData);
        // Attach the harvested image URLs and full articles so Image Search can use them
        return {
            ...result,
            reference_image_urls: allReferenceImageUrls,
            article_pool: articleContents, // Full markdown and URLs
        };
    } catch (e: any) {
        console.warn(`[S2] Synthesis failed: ${e.message}. Using fallback evidence.`);
        return {
            trending_angles: [`${keyword} styling trends for ${now}`],
            top_sources: topUrls,
            seasonal_context: now,
            audience_pain_points: [],
            competitive_gaps: "",
            key_statistics: [],
            specific_outfits: [],
            reference_image_urls: allReferenceImageUrls,
            article_pool: articleContents, 
        };
    }
}

/**
 * Fetch an image URL as base64, using TWO strategies:
 * 1. Direct fetch (works for most editorial sites, Pinterest CDN when URLs are correct)
 * 2. Jina proxy: https://r.jina.ai/{url} — routes through Jina which retrieves the raw image
 *    even for some hotlink-protected sources.
 */
async function fetchImageAsBase64WithFallback(
    url: string,

    timeoutMs = 8000
): Promise<{ data: string; mimeType: string; strategy: string } | null> {
    // Strategy 1: Direct fetch with browser-like headers
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const res = await fetch(url, {
            signal: controller.signal,
            headers: {
                "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
                "Accept": "image/webp,image/apng,image/*,*/*;q=0.8",
                "Referer": "https://www.google.com/",
            },
        });
        clearTimeout(timer);
        if (res.ok) {
            const contentType = res.headers.get("content-type") || "image/jpeg";
            if (contentType.startsWith("image/")) {
                const buffer = await res.arrayBuffer();
                if (buffer.byteLength > 1000) { // skip empty/tiny responses
                    return {
                        data: Buffer.from(buffer).toString("base64"),
                        mimeType: contentType.split(";")[0],
                        strategy: "direct",
                    };
                }
            }
        }
    } catch {
        // Fall through to strategy 2
    }

    // Strategy 2: Jina proxy (bypasses hotlink protection for many sites)
    try {
        const jinaUrl = `${JINA_BASE}${url}`;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const res = await fetch(jinaUrl, {
            signal: controller.signal,
            headers: { "Accept": "image/webp,image/apng,image/*,*/*;q=0.8" },
        });
        clearTimeout(timer);
        if (res.ok) {
            const contentType = res.headers.get("content-type") || "image/jpeg";
            if (contentType.startsWith("image/")) {
                const buffer = await res.arrayBuffer();
                if (buffer.byteLength > 1000) {
                    return {
                        data: Buffer.from(buffer).toString("base64"),
                        mimeType: contentType.split(";")[0],
                        strategy: "jina-proxy",
                    };
                }
            }
        }
    } catch {
        // Both strategies failed
    }

    return null;
}
export async function pipelineVisualIntelligence(
    keyword: string,
    itemCards: any[],
    apiKey: string,
    styleDna: any,
    referenceUrls: string[],
    briefJson: any,
    category: "fashion" | "beauty" = "fashion"
): Promise<any[]> {
    const modelId = resolveModelId("lite", true); // flash is sufficient for vision
    const urlTemplate = `${GEMINI_BASE}/${modelId}:generateContent?key=API_KEY_PLACEHOLDER`;
    const itemCount = itemCards.length;

    // ── Step A: Use pre-harvested image URLs from Stage 2 (Evidence Pack) ──────
    let candidateUrls: string[] = [...referenceUrls];

    // If evidence pack provided no images (e.g. fallback path), do a targeted Jina read
    if (candidateUrls.length === 0) {
        console.log(`[S4.5] No reference images from evidence pack. Running targeted Jina search...`);
        try {
            const fallbackPages = [
                `https://www.whowhatwear.com/search?q=${encodeURIComponent(keyword + " outfits 2026")}`,
                `https://www.refinery29.com/en-us/search?q=${encodeURIComponent(keyword)}`,
                `https://www.vogue.com/search?q=${encodeURIComponent(keyword)}`,
            ];
            for (const pageUrl of fallbackPages) {
                const md = await fetchViaJina(pageUrl);
                if (md) {
                    const imgs = extractImagesFromMarkdown(md);
                    candidateUrls.push(...imgs);
                    if (candidateUrls.length >= 6) break;
                }
                await sleep(300);
            }
        } catch (e: any) {
            console.warn(`[S4.5] Fallback Jina search failed: ${e.message}.`);
        }
    }

    // Prefer i.pinimg.com CDN direct URLs (higher resolution, direct access)
    candidateUrls.sort((a, b) => {
        const aPin = a.includes("pinimg.com") ? -1 : 0;
        const bPin = b.includes("pinimg.com") ? -1 : 0;
        return aPin - bPin;
    });

    console.log(`[S4.5] ${candidateUrls.length} candidate image URLs to try.`);

    // ── Step B: Fetch up to 4 images using direct + Jina proxy dual strategy ───
    const MAX_IMAGES = 4;
    const validImages: Array<{ data: string; mimeType: string; sourceUrl: string; strategy: string }> = [];

    for (const url of candidateUrls) {
        if (validImages.length >= MAX_IMAGES) break;
        try {
            const result = await fetchImageAsBase64WithFallback(url);
            if (result) {
                validImages.push({ ...result, sourceUrl: url });
                const hostname = new URL(url).hostname;
                console.log(`[S4.5] ✓ [${result.strategy}] Image fetched from ${hostname}`);
            } else {
                console.log(`[S4.5] ✗ Both strategies failed for: ${url.slice(0, 70)}...`);
            }
        } catch {
            // Malformed URL or other error — skip silently
        }
        await sleep(200); // gentle pacing between fetches
    }

    console.log(`[S4.5] Successfully fetched ${validImages.length}/${MAX_IMAGES} reference images.`);

    // ── Step C: Template selection ──────────────────────────
    const archetype = (briefJson?.style_archetype || "casual").toLowerCase();
    
    const C1_IDENTITY = styleDna?.subject_definition || "Character C1 (female model, middle-parted deep brunette hair, hazel-brown eyes, prominent high cheekbones, natural fair skin texture)";
    const E4_ENVIRONMENT = "Environment E4 (sterile minimalist bedroom, white walls, light oak wood floors, a neatly made low bed with white duvet, and a clean empty corner to ensure a sharp body silhouette)";

    const ANATOMY_LOCKDOWN_FASHION = `
STRICT ANATOMY (NON-NEGOTIABLE): This is a natural human with exactly two arms, two hands, and two legs. 
- One hand holds the smartphone taking the picture in the mirror, while the other hand rests naturally.
- Ensure sharp, continuous silhouette.
- The image must feature exactly one person.`;

    const TEMPLATES_FASHION = {
        casual: `Full-body candid portrait of ${C1_IDENTITY} modeling a casual everyday outfit.
PHOTOGRAPHY STYLE (HEAD TO TOE): Captured like a real iPhone 16 Pro photo using the 24mm Fusion camera at f/1.78, vertical 9:16. The framing must show her entire outfit from the top of her head down to her shoes (full body, head-to-toe shot). She is wearing stylish shoes. Captured as a mirror selfie holding a [PHONE_COLOR] smartphone; the mirror frame is clearly visible.
${ANATOMY_LOCKDOWN_FASHION}
AESTHETIC: High-quality unedited smartphone photo, authentic social media post style. Natural indoor lighting with subtle shadows.
She is standing in ${E4_ENVIRONMENT}. There is clear white empty space between her body and the background to ensure a sharp, clean silhouette.
OUTFIT: [OUTFIT] | POSE: [POSE].
Result must look like a real, non-AI person's candid photo with authentic skin texture and perfect anatomical limb placement.`,
        
        luxury: `Full-body candid portrait of ${C1_IDENTITY} modeling a quiet luxury outfit.
PHOTOGRAPHY STYLE (HEAD TO TOE): Captured like a real iPhone 16 Pro photo using the 24mm Fusion camera at f/1.78, vertical 9:16. The framing must show her entire outfit from the top of her head down to her shoes (full body, head-to-toe shot). She is wearing stylish shoes. Captured as a mirror selfie holding a [PHONE_COLOR] smartphone; the mirror frame is clearly visible.
${ANATOMY_LOCKDOWN_FASHION}
AESTHETIC: Premium unedited smartphone photography, authentic personal outfit post aesthetic. Soft natural lighting, realistic skin with visible pores, no smoothing.
She is standing in ${E4_ENVIRONMENT} with clear separation from all furniture.
OUTFIT: [OUTFIT] | POSE: [POSE].
Ensure the final image looks like a genuine high-end smartphone capture with perfect anatomical accuracy.`,
        
        sporty: `Full-body candid portrait of ${C1_IDENTITY} modeling a sporty streetwear outfit.
PHOTOGRAPHY STYLE (HEAD TO TOE): Captured like a real iPhone 16 Pro photo using the 24mm Fusion camera at f/1.78, vertical 9:16. The framing must show her entire outfit from the top of her head down to her shoes (full body, head-to-toe shot). She is wearing stylish shoes. Captured as a mirror selfie holding a [PHONE_COLOR] smartphone; the mirror frame is clearly visible.
${ANATOMY_LOCKDOWN_FASHION}
AESTHETIC: Candid unedited smartphone photo, authentic handheld street-style aesthetic. Authentic iPhone color processing, natural daylight, no AI smoothing.
She is standing in ${E4_ENVIRONMENT}. Body is clearly separated from background walls.
OUTFIT: [OUTFIT] | POSE: [POSE].
The final result must be indistinguishable from a real social media photo with perfect anatomical integrity.`,
    };

    const TEMPLATES_BEAUTY = {
        face: `Close-up beauty portrait of a young adult woman. FRAMING: Crop from top of forehead to collarbone only. Neutral seamless background. Single subject, single face, centered.
[SUBJECT_DETAILS] wearing [MAKEUP_PHILOSOPHY].
Shot on an iPhone 15 Pro Max using the native camera system (24–28mm equivalent), deep depth of field, true mobile perspective with slight lens distortion at edges.
Lighting is natural or practical (window light or indoor ambient) with directional lighting (45° key light, soft fill), slightly uneven with soft falloff, mild highlight clipping on high points (nose bridge, forehead), and natural shadow noise in darker areas. No studio lighting or artificial glow. White balance slightly imperfect, preserving real-world color inconsistency.
Color rendering follows smartphone HDR processing: realistic but slightly compressed contrast, mild sharpening artifacts, and subtle noise in shadows. Skin retains natural tonal variation without plastic smoothing or excessive clarity, featuring visible pores, natural skin texture, freckles, scars, and subtle wrinkles.
Expression is neutral or subtly engaged, avoiding exaggerated emotion. Pose is casual with small, believable head movement. Composition slightly off-center with loose framing, allowing minor cropping inconsistencies.
Style: [STYLE_ANCHOR]. Emotion: [EMOTION]. Aspect ratio 9:16.
This is a single-subject close-up photograph of one human face. The frame captures from the chest up exclusively.`,

        eye: `Extreme macro close-up of a single eye and surrounding skin. FRAMING: Fill the frame with the eye area only — from brow to upper cheek, temple to temple.
[PRODUCT_TYPE] with [FORMULATION_COLOR]. [SUBJECT_DETAILS].
Lighting: [LIGHTING] to preserve lash definition and iris texture.
Camera: High-resolution full-frame digital camera, 100mm macro lens, f/8, [ANGLE] angle.
Texture: Fine cinematic grain, lash fiber detail, skin pore texture visible.
Style: [STYLE_ANCHOR]. Aspect ratio 9:16.
One eye only, centered. Single continuous photograph. Only the eye and surrounding skin are visible.`,

        hair: `Close-up beauty portrait photograph of a young adult woman focusing entirely on her face and hairstyle. Hair described as [HAIR_TYPE], styled as [SPECIFIC_STYLE].
FRAMING: Head and face portrait. The full face and the entire hairstyle must be completely visible within the frame. DO NOT crop the face. DO NOT crop the top or sides of the hair. Both the face and the hair must be 100% visible in the picture. Crop just below the chin or collarbone. Show absolutely no body, no torso, and no arms.
ANATOMY: Only the head and face are visible. No hands or arms in the frame. Ensure exactly one person and correct human anatomy.
Shot on an iPhone 15 Pro Max using the native camera system (24–28mm equivalent), deep depth of field, true mobile perspective with slight lens distortion at edges.
Lighting is natural or practical (window light or indoor ambient) with directional lighting (45° key light, soft fill), slightly uneven with soft falloff, mild highlight clipping on high points (nose bridge, forehead), and natural shadow noise in darker areas. No studio lighting or artificial glow. White balance slightly imperfect, preserving real-world color inconsistency.
Color rendering follows smartphone HDR processing: realistic but slightly compressed contrast, mild sharpening artifacts, and subtle noise in shadows. Skin retains natural tonal variation without plastic smoothing or excessive clarity, featuring visible pores, natural skin texture, freckles, scars, and subtle wrinkles.
Expression is neutral or subtly engaged, avoiding exaggerated emotion. Pose is casual with small, believable head movement. Composition slightly off-center with loose framing, allowing minor cropping inconsistencies.
BACKGROUND: Real indoor environment — simple wall, soft room depth. Background gently out of focus.
Aspect ratio 9:16. Single continuous photograph.`,


    };

    const activeTemplate = category === "beauty" 
        ? (TEMPLATES_BEAUTY[archetype as keyof typeof TEMPLATES_BEAUTY] || TEMPLATES_BEAUTY.face)
        : (TEMPLATES_FASHION[archetype as keyof typeof TEMPLATES_FASHION] || TEMPLATES_FASHION.casual);

    // ── Step D: Build VisualDNA for all items in a single Gemini Vision call ───
    const visionParts: any[] = [];

    const systemTextFashion = `You are a professional fashion photo analyst and AI image prompt engineer.
STRICT SHOT MATRIX COMPLIANCE (MANDATORY):
- SUBJECT: Always use ${C1_IDENTITY}. NO IDENTITY DRIFTING.
- ENVIRONMENT: Always use ${E4_ENVIRONMENT}.
- MIRROR: Mirror frame must be clearly visible in every single shot.
- OUTFIT: Specific styling derived from reference images.

RULES FOR EACH FIELD:
- phone_color: Rotate between "White Titanium" and "Desert Titanium".
- pose: Accurate descriptions: "relaxed stance", "casual stance", or "easy mirror-selfie stance". 
- image_prompt: Assemble as:
${activeTemplate}
...where [OUTFIT] is a specific description of the garments, [PHONE_COLOR] is the assigned color, and [POSE] is the pose described above.`;

    const systemTextBeauty = `You are a professional beauty photo analyst and AI image prompt engineer.
STRICT CATEGORY ISOLATION (NON-NEGOTIABLE):
- SUBJECT: Always a single young adult woman. One person only.
- DEMOGRAPHIC LOCKDOWN: The article subject is defined as: ${briefJson?.subject_demographic || "universal"}.
  - If the focus is "plus size", you MUST strictly describe the subject with a soft, rounder jawline and full cheeks. Absolutely NO prominent high cheekbones or thin, gaunt facial structures.
- FRAMING: NEVER full-body. NEVER show feet or legs. NEVER show multiple angles or collages.
  - face/eye/makeup items → close-up portrait from forehead to collarbone only
  - hair items → strict face and hair focus only; no torso, no extended arms, no body below collarbone
- BACKGROUND: Always neutral, seamless, and uncluttered. No props, no furniture, no scene.
- ANATOMY: Exactly one head, exactly two arms, exactly two hands. No extra limbs.

VARIABLE SELECTION RULES:
For each item, strictly rotate and select exactly ONE option from these arrays for AESTHETIC vars only:
- [ANGLE]: "straight-on", "15° tilt", or "side-frontal"
- [LIGHTING]: "flat beauty", "top clinical", or "rim sculpted"
- [FILL_TYPE]: "silver reflector fill", "white card bounce", or "ambient diffusion"
- [EMOTION]: "neutral", "detached", or "assertive"
- [STYLE_ANCHOR]: "clinical beauty", "luxury campaign", "backstage editorial", or "dermal macro realism"

ADDITIONAL BEAUTY VARS (Replace if applicable):
- [HAIR_TYPE]: specific description derived from item_name (e.g. "long wavy brunette")
- [SPECIFIC_STYLE]: specific style derived from item_name (e.g. "loose beach waves", "sleek low bun")
- [HAIR_FINISH]: "wet", "matte", or "glossy"
- [AIRFLOW_MOTION]: "static" or "subtle wind-blown motion"
- [SURFACE_OBJECTION]: "glass interaction", "fabric resting", or "skin contact"

- image_prompt: Assemble the prompt EXACTLY using the active template below. Replace ALL bracketed placeholders with specific details derived from the item_name.
${activeTemplate}`;

    const systemText = category === "beauty" ? systemTextBeauty : systemTextFashion;
    const systemPromptSuffix = `\nRETURN ONLY a raw JSON array with exactly ${itemCount} VisualDNA objects. No markdown, no code fences, no extra text.`;

    visionParts.push({ text: systemText + systemPromptSuffix });

    // Attach real reference images inline (up to 3 for context window efficiency)
    for (const img of validImages.slice(0, 3)) {
        visionParts.push({
            inlineData: { mimeType: img.mimeType, data: img.data }
        });
    }

    // Append target outfit items for Gemini to analyze against the reference images
    const itemSummary = itemCards.map((card: any, i: number) => ({
        outfit_id: i + 1,
        item_name: card.item_name || `Outfit ${i + 1}`,
        styling_notes: card.styling_notes || {},
        trend_support: card.trend_support || [],
        image_prompt_seed: card.image_prompt_seed || {},
        // Pass any specific_outfits from evidence pack if stored on the card
        evidence_context: card.evidence_context || "",
    }));
    visionParts.push({ text: `\nOUTFIT ITEMS TO ANALYZE:\n${JSON.stringify(itemSummary, null, 2)}` });

    let visualDNAArray: any[] = [];

    try {
        const analysisData = await fetchWithKeyRotation(apiKey, urlTemplate, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [{ parts: visionParts }],
                generationConfig: {
                    responseMimeType: "application/json",
                    responseSchema: VisualIntelligenceSchema,
                    temperature: 0.55,
                },
            }),
        });

        const parsed = extractJSONData(analysisData);
        if (Array.isArray(parsed) && parsed.length > 0) {
            visualDNAArray = parsed;
            console.log(`[S4.5] ✓ Vision analysis complete. ${visualDNAArray.length} VisualDNA objects generated.`);
            if (validImages.length > 0) {
                console.log(`[S4.5] ✓ Analysis was grounded in ${validImages.length} real reference images.`);
            }
        }
    } catch (e: any) {
        console.warn(`[S4.5] Vision analysis failed: ${e.message}. Falling back to seed-based prompts.`);
        return []; // Caller will use original seed-based prompts — non-fatal
    }

    // ── Step D: Merge VisualDNA back into item cards ──────────────────────────
    const enrichedCards = itemCards.map((card: any, i: number) => {
        const dna = visualDNAArray.find((d: any) => d.outfit_id === i + 1) || visualDNAArray[i];
        if (!dna?.image_prompt) return card; // keep original if this item failed
        return {
            ...card,
            visual_dna: dna,
            image_prompt_seed: {
                ...card.image_prompt_seed,
                outfit_description: dna.key_pieces?.join(", ") || card.image_prompt_seed?.outfit_description,
                engineered_image_prompt: dna.image_prompt, // used verbatim by draft stage
            },
        };
    });

    return enrichedCards;
}

// Stage 3: Item Cards
export async function pipelineGenerateItemCards(keyword: string, count: number, briefJson: any, evidencePackJson: any, apiKey: string, modelPrefix: "pro" | "lite", category: "fashion" | "beauty" = "fashion") {
    const modelId = resolveModelId(modelPrefix);
    const urlTemplate = `${GEMINI_BASE}/${modelId}:generateContent?key=API_KEY_PLACEHOLDER`;

    const systemInstructionFashion = `You are a SHARP WARDROBE EDITOR building content skeleton cards for a fashion listicle. Audience: women 26-44.

EDITORIAL MISSION: Help women make faster, smarter wardrobe decisions for real mornings, real budgets, real schedules.

FOR EACH ITEM CARD:
1. item_name: Specific named outfit — include the defining garment (e.g. "Belted Trench + Slim Ankle Pant" not "Rainy Look").
2. why_it_works: 2-3 reasons grounded in Hook/Meaning/Utility/Direction logic — not aesthetic adjectives.
3. trend_support: Quote SPECIFIC data from the evidence pack (source + stat). Do NOT invent statistics.
4. styling_notes: Fabric-specific colors, fabrics, accessories. Colors as precise names or hex codes.
5. reader_value: The concrete outcome — what becomes easier for the reader after reading this.
6. freshness_signal: One angle most competitor articles on this keyword are missing.

SHOT MATRIX RULES (MANDATORY — these feed the image generation):
- CHARACTER ID: C1 (Match reference precisely: lock facial structure, skin tone, and hair). NO IDENTITY DRIFTING.
- ENVIRONMENT ID: E4 (Match scene reference precisely as a sterile, editorial setting). NO ENVIRONMENTAL DRIFTING (Do not add furniture, plants, or windows).
- POSE ID: P1 (Standing straight, front).
- ANGLE ID: A1 (Full body, head-to-toe).
- OUTFIT_DESCRIPTION: Explicit styling for the clothing layers ONLY.

STRICTLY BANNED WORDS (any field):
obsessed, game-changer, must-have, stunning, viral, fashionista, flawlessly, look expensive, trendy girl, delve, elevate, chic, essential, timeless, effortless, versatile, curated, luxe, statement, iconic, investment piece.`;

    const systemInstructionBeauty = `You are a HIGH-END BEAUTY EDITOR building content skeleton cards for a beauty and hairstyle listicle. Audience: women 26-44.
DEMOGRAPHIC FOCUS: ${briefJson?.subject_demographic || "universal"}.

EDITORIAL MISSION: Focus on technical execution, macro details, and performance. Help women understand the "Why" behind the aesthetic.

FOR EACH ITEM CARD:
1. item_name: Specific named look or hairstyle (e.g. "French Glossy Bob" or "Double-Winged Eyeliner").
2. why_it_works: 2-3 reasons grounded in Performance/Symmetry/Texture/Tone logic.
3. trend_support: Quote SPECIFIC data from the evidence pack (source + stat). Do NOT invent statistics.
4. styling_notes: Specific products, tools, and application techniques.
5. reader_value: The concrete aesthetic outcome.
6. freshness_signal: One angle most competitor articles on this keyword are missing.

SHOT MATRIX RULES (MANDATORY — these feed the image generation):
- CHARACTER ID: C1 (Match demographic context: ${briefJson?.subject_demographic || "universal"}).
- ENVIRONMENT ID: E4 (Match scene reference precisely as a sterile, editorial setting). NO ENVIRONMENTAL DRIFTING.
- POSE ID: Neutral head and shoulder posture.
- ANGLE ID: Extreme close-up focused strictly on the FACE and HAIR.
- NO FULL BODY. No outfits. No shoes.

STRICTLY BANNED WORDS: same as fashion.`;

    const systemInstruction = category === "beauty" ? systemInstructionBeauty : systemInstructionFashion;

    const rotationInstruction = category === "beauty" 
        ? "Rotation: ensure a mix of straight-on, 15° angled, and side-frontal headshots across the list. Focus strictly on the face and hair."
        : "Rotation: ensure a mix of Full-body, Medium, and Detail shots across the list.";

    const prompt = `
KEYWORD: "${keyword}"
ARTICLE BRIEF:
${JSON.stringify(briefJson, null, 2)}

WEB RESEARCH:
${JSON.stringify(evidencePackJson, null, 2)}

Generate exactly ${count} item evidence cards. ${rotationInstruction}
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
            return pipelineGenerateItemCards(keyword, count, briefJson, evidencePackJson, apiKey, "lite", category);
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

DEMOGRAPHIC LOCKDOWN:
If the BRIEF identifies a "subject_demographic" (e.g., "plus size", "mature", "oily skin"), the "subject_definition" MUST strictly reflect this. For "plus size", describe facial features consistent with a soft, rounder jawline and fuller cheeks.

VOICE & AESTHETIC GOAL: 
Create a cohesive "Visual Identity" for this article. Select ONE consistent vibe from these categories as inspiration:
1. SUBJECT: Define the person (Age, Ethnicity, Body Type/Facial Structure matching the demographic, unique feature like 'sharp bob' or 'visible laugh lines').
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

        // Pacing delay to avoid concurrent limit spikes on rapid batch calls
        if (i < chunks.length - 1) {
            await sleep(1000);
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
    
    const primaryModelId = resolveModelId(modelPrefix);
    const secondaryPrefix = modelPrefix === "lite" ? "pro" : "lite";
    const secondaryModelId = resolveModelId(secondaryPrefix);

    const urlTemplate = `${GEMINI_BASE}/${primaryModelId}:generateContent?key=API_KEY_PLACEHOLDER`;
    const alternativeUrlTemplate = `${GEMINI_BASE}/${secondaryModelId}:generateContent?key=API_KEY_PLACEHOLDER`;

    const systemInstruction = `You are a SHARP WARDROBE EDITOR. Audience: women (26-44), real style decisions.

════ EDITORIAL PROMISE ════
Every item: (1) Names a real wardrobe problem. (2) Explains the style logic. (3) Leaves the reader MORE CAPABLE.

════ BANNED WORDS — CHECK BEFORE RETURNING ════
chic, elevate, essential, game-changer, viral, obsessed, timeless, effortless, versatile,
statement, curated, luxe, chicness, wardrobe staple, must-have, stunning, take your look,
style moment, fashion-forward, trendy, delve, look expensive, fashionista, flawlessly,
elevated, iconic, investment piece, Amazon hack, trendy girl.

USE INSTEAD: polished, grounded, deliberate, sharp, balanced, clean line, sensible,
intentional, practical, specific, honest, considered.

════ SENTENCE FORMULA — MANDATORY ════
EXACTLY 3 sentences per item content. No more, no less:
  S1 HOOK: Name the real wardrobe tension or problem the reader is experiencing.
  S2 MEANING + UTILITY: Explain the style logic AND give a specific action.
  S3 DIRECTION: Brand the outcome. What does the reader now have or understand?

════ FORMATTING ════
- title: NO NUMBERS. Specific. Name a garment or outfit combo.
- seo_title: NO NUMBERS. (Example: "Winter Outfits With Trench Coats").
- pinterest_title: NO NUMBERS.
- article_intro: MAX 2 sentences. State the real wardrobe problem this article solves.
- No padding sentences. No vague opener ("This look is perfect for...").

════ IMAGE PROMPT MASTER STRUCTURE ════
Formula: [SHOT_TYPE] of [SUBJECT] wearing [FABRICS+DRAPE]. [LOCATION]. [LIGHTING]. [CAMERA]. [TEXTURE]. [QUALITY].

  SHOT_TYPE: "Full-length frame, shoes to crown, mid-stride" — ALWAYS. Feet MUST be visible. No exceptions.
  SUBJECT: ${styleDNA?.subject_definition || "A woman, 28-40, natural makeup, modern unforced style"}
  FABRICS+DRAPE: Name specific fabrics (e.g. "matte nylon anorak, straight-leg dark denim, rubber Cherokee boots").
  LOCATION: Specific + varied — ROTATE across list. Do NOT repeat. Pool: [fog-slicked cobblestone, timber-clad coffee shop doorway, brutalist concrete stair, moss-covered stone wall, rail platform at rush hour, wet asphalt parking garage, candlelit bistro window, art museum marble hallway, sun-drenched conservatory].
  LIGHTING: ${styleDNA?.lighting_and_weather || "Overcast daylight, soft even shadows, no blown highlights"}
  CAMERA: ${styleDNA?.camera_and_aesthetic || "Sony A7RV 85mm f/1.4, ISO 800"}
  TEXTURE: ${styleDNA?.texture_and_finish || "Visible pores, honest skin, subtle halation on highlights"}
  QUALITY: Photorealistic, 4K UHD, no AI artifacts, no text, no watermarks, no cropped feet.

If a batch item has "image_prompt_seed.engineered_image_prompt", use it VERBATIM for that item's image_prompt. Do NOT modify.
`;

    const instructions = isFirst
        ? `Draft the START of a ${totalItems}-item listicle. Generate: SEO metadata, article_intro (max 2 sentences), first ${batch.length} items.`
        : isLast
        ? `Draft the END of a ${totalItems}-item listicle. Generate: final ${batch.length} items + article_outro.`
        : `Draft a MIDDLE section of a ${totalItems}-item listicle. Generate ${batch.length} items only.`;

    const prompt = `
${instructions}
KEYWORD: "${keyword}"
EVIDENCE (cite specific facts — not summaries): ${JSON.stringify(evidencePack)}
BATCH ITEMS: ${JSON.stringify(batch, null, 2)}

CRITICAL OUTPUT RULES:
1. item_index: Copy EXACTLY from the BATCH ITEMS provided.
2. title: Specific. NO NUMBERS. Name a garment or outfit combo.
3. content: EXACTLY 3 sentences. Hook → Meaning+Utility → Direction.
4. image_prompt: If item has image_prompt_seed.engineered_image_prompt, copy it VERBATIM. Otherwise use MASTER STRUCTURE.
5. Scan every field for BANNED WORDS before returning. Replace any found.
6. article_intro (first batch only): Max 2 sentences naming the wardrobe problem.

Return JSON matching the schema.
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
    }, alternativeUrlTemplate)) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };

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
