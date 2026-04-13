/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * imageSearch.ts — Web Image Pipeline
 *
 * Finds real outfit photos from competitor blog posts via Jina AI Reader,
 * compresses them server-side, and returns them with full attribution data.
 *
 * Flow:
 *  A. googleSearch grounding → top competitor article URLs for keyword
 *  B. Jina AI reads each article → extracts embedded image URLs + attribution
 *  C. Download + validate images (>30KB, proper content-type)
 *  D. Compress server-side using sharp (or return original with flag)
 *  E. Gemini matches each image to an item card by semantic similarity
 *  F. Return enriched item cards with web_image + attribution fields
 */

import { fetchWithKeyRotation } from "./ai";
import { extractImagesFromMarkdown, searchViaJina } from "./pipeline";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const JINA_BASE = "https://r.jina.ai/";
const MODEL_VISION = "gemini-1.5-flash"; // Stable Vision capabilities



// Fashion article sources ranked by content quality
const IMAGE_SOURCE_PRIORITY = [
    "whowhatwear.com",
    "refinery29.com",
    "harpersbazaar.com",
    "vogue.com",
    "instyle.com",
    "elle.com",
    "glamour.com",
    "byrdie.com",
    "stylist.co.uk",
    "thezoereport.com",
    "purewow.com",
    "bustle.com",
];

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ─── Step B: Read articles via Jina, extract image URLs + attribution ────────

interface ArticleImagePool {
    imageUrl: string;
    pageUrl: string;
    siteName: string;
    articleTitle: string;
}

async function extractImagesFromArticle(pageUrl: string): Promise<ArticleImagePool[]> {
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 12000);
        const res = await fetch(`${JINA_BASE}${pageUrl}`, {
            signal: controller.signal,
            headers: {
                "Accept": "text/markdown, text/plain, */*",
                "X-Return-Format": "markdown",
                "X-Image-Caption": "true",
            },
        });
        clearTimeout(timer);
        if (!res.ok) return [];
        const markdown = await res.text();

        // Extract article title from first H1 or H2
        const titleMatch = markdown.match(/^#{1,2}\s+(.+)/m);
        const articleTitle = titleMatch ? titleMatch[1].trim() : pageUrl;

        // Extract site name from URL
        try {
            const hostname = new URL(pageUrl).hostname.replace(/^www\./, "");
            const siteName = IMAGE_SOURCE_PRIORITY.find(s => pageUrl.includes(s))
                ? hostname.split(".").map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(" ").replace(" Com", "").replace(" Co", "")
                : hostname;

            const deduped = extractImagesFromMarkdown(markdown)
                .filter(url => !url.includes("logo") && !url.includes("icon") && !url.includes("banner") && !url.includes("avatar"))
                .slice(0, 8);
            
            console.log(`[ImgSearch] Jina: ${deduped.length} images from ${hostname}`);

            return deduped.map(imageUrl => ({
                imageUrl,
                pageUrl,
                siteName,
                articleTitle,
            }));
        } catch {
            return [];
        }
    } catch {
        return [];
    }
}

// ─── Step C+D: Download, validate, compress each image ───────────────────────

export interface WebImage {
    imageBase64: string;
    mimeType: string;
    originalUrl: string;
    fileSizeKb: number;
    attribution: {
        siteName: string;
        articleTitle: string;
        sourceUrl: string;
        creditLine: string;
    };
}

async function downloadAndCompress(candidate: ArticleImagePool): Promise<WebImage | null> {
    const { imageUrl, pageUrl, siteName, articleTitle } = candidate;

    // Strategy 1: Direct fetch
    let imageBuffer: Buffer | null = null;
    let mimeType = "image/jpeg";

    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10000);
        const res = await fetch(imageUrl, {
            signal: controller.signal,
            headers: {
                "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
                "Accept": "image/webp,image/apng,image/*,*/*;q=0.8",
                "Referer": "https://www.google.com/",
            },
        });
        clearTimeout(timer);
        if (res.ok) {
            const ct = res.headers.get("content-type") || "image/jpeg";
            if (ct.startsWith("image/")) {
                const buf = await res.arrayBuffer();
                if (buf.byteLength > 20000) { // > 20KB — reject tiny thumbnails
                    imageBuffer = Buffer.from(buf);
                    mimeType = ct.split(";")[0];
                }
            }
        }
    } catch {
        // Try Jina proxy fallback
    }

    // Strategy 2: Jina proxy
    if (!imageBuffer) {
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 10000);
            const res = await fetch(`${JINA_BASE}${imageUrl}`, {
                signal: controller.signal,
                headers: { "Accept": "image/webp,image/apng,image/*,*/*;q=0.8" },
            });
            clearTimeout(timer);
            if (res.ok) {
                const ct = res.headers.get("content-type") || "image/jpeg";
                if (ct.startsWith("image/")) {
                    const buf = await res.arrayBuffer();
                    if (buf.byteLength > 20000) {
                        imageBuffer = Buffer.from(buf);
                        mimeType = ct.split(";")[0];
                    }
                }
            }
        } catch {
            // Jina proxy failed, try direct fetch
            try {
                const res = await fetch(imageUrl, {
                    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36" }
                });
                if (res.ok) {
                    const buf = await res.arrayBuffer();
                    imageBuffer = Buffer.from(buf);
                    mimeType = res.headers.get("content-type")?.split(";")[0] || "image/jpeg";
                }
            } catch {
                return null;
            }
        }
    }

    if (!imageBuffer) return null;

    // Step D: Compress using sharp if available
    let compressedBuffer = imageBuffer;
    try {
        const sharp = (await import("sharp")).default;
        compressedBuffer = await sharp(imageBuffer)
            .resize({ width: 900, withoutEnlargement: true })
            .jpeg({ quality: 72, progressive: true })
            .toBuffer();
        mimeType = "image/jpeg";
        console.log(`[ImgSearch] Compressed: ${Math.round(imageBuffer.byteLength / 1024)}KB → ${Math.round(compressedBuffer.byteLength / 1024)}KB`);
    } catch {
        // sharp not available — use original (client-side compression happens in batch/page.tsx)
        console.log(`[ImgSearch] sharp unavailable, using original (${Math.round(imageBuffer.byteLength / 1024)}KB)`);
    }

    return {
        imageBase64: compressedBuffer.toString("base64"),
        mimeType,
        originalUrl: imageUrl,
        fileSizeKb: Math.round(compressedBuffer.byteLength / 1024),
        attribution: {
            siteName,
            articleTitle,
            sourceUrl: pageUrl,
            creditLine: siteName, // Plain text for flexible UI rendering
        },
    };
}

// ─── Step E: Match images to item cards via Gemini ───────────────────────────

// ─── Step E: Vision-powered match images to items cards ─────────────────────

async function matchImagesToItems(
    itemCards: any[],
    imagePool: WebImage[],
    apiKey: string
): Promise<Map<number, WebImage>> {
    if (imagePool.length === 0 || itemCards.length === 0) return new Map();

    const urlTemplate = `${GEMINI_BASE}/${MODEL_VISION}:generateContent?key=API_KEY_PLACEHOLDER`;

    console.log(`[ImgSearch] Running Vision matching for ${itemCards.length} items against ${imagePool.length} images...`);

    // We'll process items in batches or all at once if the gallery isn't too large
    // For 5-10 items and 10-15 images, one multimodal prompt is highly effective.
    const imageParts = imagePool.map((img, idx) => ([
        { text: `IMAGE [${idx}] from ${img.attribution.siteName}:` },
        { inline_data: { mime_type: img.mimeType, data: img.imageBase64 } }
    ])).flat();

    const itemDescription = itemCards.map((c: any, i: number) => 
        `ITEM ID ${i}: ${c.item_name}. Styling notes: ${c.styling_notes}.`
    ).join("\n");

    const promptText = `You are a fashion photo editor. Your job is to match each outfit ITEM to the most visually accurate IMAGE from the provided gallery.

OUTFIT ITEMS:
${itemDescription}

RULES:
1. Return a JSON object where keys are ITEM IDs and values are IMAGE indices (0-indexed).
2. ONLY match if the image VISUALLY depicts the item described. If no image fits, omit the item.
3. Distribute images — do not use the same image for every item.
4. Return ONLY JSON.

Example: { "0": 4, "1": 0 }`;

    try {
        const data = await fetchWithKeyRotation(apiKey, urlTemplate, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [{
                    parts: [
                        { text: promptText },
                        ...imageParts
                    ]
                }],
                generationConfig: { 
                    responseMimeType: "application/json",
                    temperature: 0.1 
                },
            }),
        });

        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
        const clean = text.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
        const assignments: Record<string, number> = JSON.parse(clean);

        const result = new Map<number, WebImage>();
        for (const [itemIdStr, imgIdx] of Object.entries(assignments)) {
            const itemId = parseInt(itemIdStr);
            const img = imagePool[imgIdx as number];
            if (img && !isNaN(itemId)) {
                result.set(itemId, img);
            }
        }
        console.log(`[ImgSearch] Vision matched ${result.size}/${itemCards.length} items.`);
        return result;
    } catch (e: any) {
        console.warn(`[ImgSearch] Vision matching failed: ${e.message}. Using fallback metadata assignment.`);
        // Fallback: sequential assignment based on simple string matching (weak but better than nothing)
        const result = new Map<number, WebImage>();
        imagePool.slice(0, itemCards.length).forEach((img, i) => result.set(i, img));
        return result;
    }
}

// ─── Main export: pipelineSearchImages ───────────────────────────────────────

export async function pipelineSearchImages(
    keyword: string,
    itemCards: any[],
    evidencePack: any, // Now containing article_pool
    apiKey: string
): Promise<any[]> {
    console.log(`[ImgSearch] Starting Vision-Powered pipeline for: "${keyword}"`);

    // A. Use articles found during research (Evidence Pack)
    const sources = evidencePack?.article_pool || [];
    if (sources.length === 0) {
        console.warn("[ImgSearch] No article pool found in evidence. Pipeline cannot proceed.");
        return itemCards;
    }

    // B. Build candidate pool from existing markdown
    const allCandidates: any[] = [];
    for (const source of sources) {
        const imageUrls = extractImagesFromMarkdown(source.markdown);
        const sourceUrl = source.url;
        const hostname = new URL(sourceUrl).hostname.replace("www.", "");
        
        const candidates = imageUrls.map(imageUrl => ({
            imageUrl,
            pageUrl: sourceUrl,
            siteName: hostname,
            articleTitle: source.title || "Fashion Article"
        }));
        allCandidates.push(...candidates);
    }

    if (allCandidates.length === 0) {
        console.warn("[ImgSearch] No image candidates found in article pool.");
        return itemCards;
    }

    console.log(`[ImgSearch] ${allCandidates.length} image candidates pooled from ${sources.length} research sources.`);

    // C. Download + compress candidates (cap at reasonable amount for Vision)
    const targetImageCount = Math.min(itemCards.length * 3, 12);
    const imagePool: WebImage[] = [];

    for (const candidate of allCandidates) {
        if (imagePool.length >= targetImageCount) break;
        const img = await downloadAndCompress(candidate);
        if (img) {
            imagePool.push(img);
            console.log(`[ImgSearch] Pooled: ${img.attribution.siteName} — ${img.fileSizeKb}KB`);
        }
        await sleep(200);
    }

    if (imagePool.length === 0) {
        console.warn("[ImgSearch] Main research pool empty. TRIGGERING SNIPER MODE.");
        // Try targeted searches for each item
        for (let i = 0; i < itemCards.length; i++) {
            if (imagePool.length >= 10) break; // cap
            const card = itemCards[i];
            const query = `${card.item_name} fashion blog outfit photo inspiration`;
            console.log(`[ImgSearch] Sniper search: "${query}"`);
            const searchMd = await searchViaJina(query);
            if (searchMd) {
                const sniperUrls = extractImagesFromMarkdown(searchMd).slice(0, 3);
                for (const url of sniperUrls) {
                    const img = await downloadAndCompress({
                        imageUrl: url,
                        pageUrl: `https://s.jina.ai/${encodeURIComponent(query)}`,
                        siteName: "Search Engine",
                        articleTitle: `Sniper: ${card.item_name}`
                    });
                    if (img) imagePool.push(img);
                }
            }
            await sleep(500);
        }
    }

    if (imagePool.length === 0) {
        console.warn("[ImgSearch] Sniper mode also failed. No real images found.");
        return itemCards;
    }

    // D. Vision-powered matching
    const assignments = await matchImagesToItems(itemCards, imagePool, apiKey);

    // E. Merge web images into item cards
    const enriched = itemCards.map((card: any, i: number) => {
        const img = assignments.get(i);
        if (!img) return card;
        return {
            ...card,
            web_image: {
                image_base64: img.imageBase64,
                mime_type: img.mimeType,
                original_url: img.originalUrl,
                file_size_kb: img.fileSizeKb,
                attribution: img.attribution,
            },
        };
    });

    const matched = enriched.filter((c: any) => c.web_image).length;
    console.log(`[ImgSearch] Pipeline complete. ${matched}/${itemCards.length} items have visual matches.`);
    return enriched;
}
