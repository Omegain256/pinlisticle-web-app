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
                headers: {
                    "Accept": "text/markdown, image/webp, image/*, */*",
                    "X-Return-Format": "markdown",
                },
            });
            clearTimeout(timer);
            if (res.ok) {
                const ct = res.headers.get("content-type") || "";
                
                // Case A: Jina returned an image directly
                if (ct.startsWith("image/")) {
                    const buf = await res.arrayBuffer();
                    if (buf.byteLength > 15000) { // Slightly lower threshold for web mode
                        imageBuffer = Buffer.from(buf);
                        mimeType = ct.split(";")[0];
                    }
                } 
                // Case B: Jina returned markdown (e.g. from Pinterest Pin page)
                else {
                    const markdown = await res.text();
                    const extracted = extractImagesFromMarkdown(markdown);
                    if (extracted.length > 0) {
                        // Recurse once with the direct URL
                        return await downloadAndCompress({
                            imageUrl: extracted[0],
                            pageUrl,
                            siteName,
                            articleTitle
                        });
                    }
                }
            }
        } catch {
            // Direct fetch fallback for images...
            try {
                const res = await fetch(imageUrl, {
                    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36" }
                });
                if (res.ok && res.headers.get("content-type")?.startsWith("image/")) {
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

/** Uses DuckDuckGo Image Search to directly find high-resolution raw image URLs */
async function sniperSearchDDG(card: any): Promise<ArticleImagePool[]> {
    const query = `${card.item_name} fashion outfit blog photo`;
    
    try {
        console.log(`[Sniper DDG] Fetching VQD token for: "${query}"`);
        const vqdRes = await fetch(`https://duckduckgo.com/?q=${encodeURIComponent(query)}`, {
            headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }
        });
        const html = await vqdRes.text();
        const vqdMatch = html.match(/vqd=([\'\"]?)([^\'&\"\s]+)\1/);
        
        if (!vqdMatch) {
            console.warn(`[Sniper DDG] Failed to extract VQD token for ${card.item_name}`);
            return [];
        }
        
        const vqd = vqdMatch[2];
        console.log(`[Sniper DDG] Token acquired. Querying DDG Image Search...`);
        
        const imgRes = await fetch(`https://duckduckgo.com/i.js?l=us-en&o=json&q=${encodeURIComponent(query)}&vqd=${vqd}&f=,,,,,&p=1`, {
            headers: { 
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
                "Accept": "application/json"
            }
        });
        
        const imgData = await imgRes.json();
        const results = imgData?.results || [];
        
        return results.map((r: any) => ({
            imageUrl: r.image, // The raw .jpg or .png URL
            pageUrl: r.url,    // The source page
            siteName: new URL(r.url).hostname.replace("www.", ""),
            articleTitle: r.title || `Sniper: ${card.item_name}`
        }));
    } catch (e) {
        console.warn(`[Sniper DDG] Search failed for ${card.item_name}:`, e);
        return [];
    }
}

export async function pipelineSearchImages(
    keyword: string,
    itemCards: any[],
    evidencePack: any,
    apiKey: string
): Promise<any[]> {
    console.log(`[ImgSearch] Starting pipeline for: "${keyword}"`);

    // A. Build candidate pool from article_pool in evidence pack
    const sources: Array<{ url: string; title: string; markdown: string }> = evidencePack?.article_pool || [];
    const allCandidates: ArticleImagePool[] = [];

    for (const source of sources) {
        try {
            const imageUrls = extractImagesFromMarkdown(source.markdown);
            const hostname = new URL(source.url).hostname.replace("www.", "");
            imageUrls.forEach(imageUrl => allCandidates.push({
                imageUrl,
                pageUrl: source.url,
                siteName: hostname,
                articleTitle: source.title || "Fashion Article"
            }));
        } catch { /* skip bad URLs */ }
    }

    console.log(`[ImgSearch] ${allCandidates.length} image candidates from ${sources.length} research articles.`);

    // B. Download + compress candidates
    const targetImageCount = Math.min(itemCards.length * 3, 15);
    const imagePool: WebImage[] = [];

    for (const candidate of allCandidates) {
        if (imagePool.length >= targetImageCount) break;
        const img = await downloadAndCompress(candidate);
        if (img) {
            imagePool.push(img);
            console.log(`[ImgSearch] ✅ Pooled: ${img.attribution.siteName} — ${img.fileSizeKb}KB`);
        }
        await sleep(200);
    }

    // C. SNIPER MODE: if article pool failed, do per-item grounding search
    if (imagePool.length === 0) {
        console.warn("[ImgSearch] Article pool yielded 0 images. Entering SNIPER MODE 4.0 (DuckDuckGo)...");
        for (let i = 0; i < itemCards.length && imagePool.length < 10; i++) {
            const card = itemCards[i];
            console.log(`[ImgSearch] Sniper DDG: "${card.item_name}"`);
            const sniperCandidates = await sniperSearchDDG(card);
            
            for (const cand of sniperCandidates.slice(0, 4)) {
                const img = await downloadAndCompress(cand);
                if (img) imagePool.push(img);
            }
            await sleep(300);
        }
    }

    if (imagePool.length === 0) {
        console.warn("[ImgSearch] ALL strategies failed — no images found. Returning items without images.");
        return itemCards;
    }

    console.log(`[ImgSearch] Image pool ready: ${imagePool.length} images for ${itemCards.length} items.`);

    // D. Vision-powered matching
    const finalAssignments = await matchImagesToItems(itemCards, imagePool, apiKey);

    // ─── Step F: Greedy Best-Fit Fallback (Zero-Fail Policy) ────────────────
    // Ensure 100% of items have an image assigned. 
    // If the AI was too picky, we force-assign the remaining images.
    const enriched = itemCards.map((card, i) => {
        let match = finalAssignments.get(i);
        
        if (!match) {
            console.log(`[ImgSearch] Force-assigning candidate for Item ${i} (AI was too picky)`);
            // Find any unused image or just use the pool sequentially
            match = imagePool[i % imagePool.length];
        }

        return {
            ...card,
            web_image: match ? {
                image_base64: match.imageBase64,
                mime_type: match.mimeType,
                original_url: match.originalUrl,
                file_size_kb: match.fileSizeKb,
                attribution: match.attribution,
            } : null
        };
    });

    const matched = enriched.filter((c: any) => c.web_image).length;
    console.log(`[ImgSearch] Pipeline complete. ${matched}/${itemCards.length} items have visual matches.`);
    return enriched;
}
