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

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const JINA_BASE = "https://r.jina.ai/";
const MODEL_FLASH = "gemini-2.5-flash";

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

// ─── Step A: Find competitor article URLs via grounded search ───────────────

async function findCompetitorArticleUrls(keyword: string, apiKey: string): Promise<string[]> {
    const urlTemplate = `${GEMINI_BASE}/${MODEL_FLASH}:generateContent?key=API_KEY_PLACEHOLDER`;
    const searchQuery = `"${keyword}" outfit ideas blog 2026`;

    try {
        const data = await fetchWithKeyRotation(apiKey, urlTemplate, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [{ parts: [{ text: `Find the top blog articles and listicles about: ${searchQuery}. Focus on fashion blogs, style sites, and editorial publications that include real outfit photos.` }] }],
                tools: [{ googleSearch: {} }],
                generationConfig: { temperature: 0.1 },
            }),
        });

        const chunks: any[] = data?.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
        const urls: string[] = [];
        for (const chunk of chunks) {
            const uri: string = chunk?.web?.uri || "";
            if (uri && uri.startsWith("http")) urls.push(uri);
        }

        // Filter for editorial article URLs
        const EDITORIAL_PATTERNS = [
            /\/\d{4}\//,
            /\/article\//i,
            /\/style\//i,
            /\/fashion\//i,
            /\/outfits?\//i,
            /\/lookbook\//i,
            /\/what-to-wear/i,
            /\/trend/i,
            /\/best-/i,
            /\/spring-/i,
            /\/summer-/i,
            /\/fall-/i,
            /\/winter-/i,
            /\d{1,2}-[a-z]+-/,
        ];
        const REJECT_PATTERNS = [/\/search[/?]/i, /\?q=/i, /\?s=/i, /\/page\//i, /\/tag\//i];

        const editorial = urls
            .filter(u =>
                !REJECT_PATTERNS.some(p => p.test(u)) &&
                (EDITORIAL_PATTERNS.some(p => p.test(u)) || IMAGE_SOURCE_PRIORITY.some(s => u.includes(s)))
            )
            .sort((a, b) => {
                const ra = IMAGE_SOURCE_PRIORITY.findIndex(s => a.includes(s));
                const rb = IMAGE_SOURCE_PRIORITY.findIndex(s => b.includes(s));
                return (ra === -1 ? 99 : ra) - (rb === -1 ? 99 : rb);
            });

        console.log(`[ImgSearch] Found ${editorial.length} editorial article URLs.`);
        return editorial.slice(0, 5);
    } catch (e: any) {
        console.warn(`[ImgSearch] Grounded search failed: ${e.message}`);
        return [];
    }
}

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

            const imageUrls: string[] = [];

            // Markdown image syntax: ![alt](url)
            const mdImgs = markdown.matchAll(/!\[[^\]]*\]\((https?:\/\/[^)]+)\)/g);
            for (const m of mdImgs) {
                const url = m[1];
                if (/\.(jpg|jpeg|png|webp)/i.test(url) && !url.includes("logo") && !url.includes("icon") && !url.includes("avatar")) {
                    imageUrls.push(url);
                }
            }

            // Pinterest CDN (pinimg.com) inline URLs
            const pinImgs = markdown.matchAll(/https?:\/\/i\.pinimg\.com\/[^\s"')]+/g);
            for (const m of pinImgs) imageUrls.push(m[0]);

            // Generic image CDN patterns
            const cdnImgs = markdown.matchAll(/https?:\/\/[^\s"')]+\.(?:jpg|jpeg|png|webp)(?:\?[^\s"')]*)?/gi);
            for (const m of cdnImgs) {
                const url = m[0];
                if (!url.includes("logo") && !url.includes("icon") && !url.includes("banner") && !url.includes("avatar")) {
                    imageUrls.push(url);
                }
            }

            const deduped = [...new Set(imageUrls)].slice(0, 8);
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
            return null;
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
            creditLine: `Image via <a href="${pageUrl}" target="_blank" rel="noopener">${siteName}</a>`,
        },
    };
}

// ─── Step E: Match images to item cards via Gemini ───────────────────────────

async function matchImagesToItems(
    itemCards: any[],
    imagePool: WebImage[],
    apiKey: string
): Promise<Map<number, WebImage>> {
    if (imagePool.length === 0 || itemCards.length === 0) return new Map();

    const urlTemplate = `${GEMINI_BASE}/${MODEL_FLASH}:generateContent?key=API_KEY_PLACEHOLDER`;

    const prompt = `You are a fashion photo editor. Match each outfit item to the most relevant image from the pool.

OUTFIT ITEMS:
${JSON.stringify(itemCards.map((c: any, i: number) => ({ id: i, name: c.item_name, notes: c.styling_notes })), null, 2)}

IMAGE POOL (by index):
${imagePool.map((img, i) => `[${i}] From: ${img.attribution.siteName} — "${img.attribution.articleTitle}" (${img.fileSizeKb}KB)`).join("\n")}

Return a JSON object where keys are outfit item IDs (0-indexed) and values are image pool indices.
Each item should get exactly one image. Distribute images across items — do not assign the same image to multiple items if possible.
If there are fewer images than items, some items may have no match (omit them from output).
Return ONLY the JSON object, no markdown.`;

    try {
        const data = await fetchWithKeyRotation(apiKey, urlTemplate, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { temperature: 0.1 },
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
        console.log(`[ImgSearch] Matched ${result.size}/${itemCards.length} items to images.`);
        return result;
    } catch (e: any) {
        console.warn(`[ImgSearch] Image matching failed: ${e.message}. Using sequential assignment.`);
        // Fallback: sequential assignment
        const result = new Map<number, WebImage>();
        imagePool.slice(0, itemCards.length).forEach((img, i) => result.set(i, img));
        return result;
    }
}

// ─── Main export: pipelineSearchImages ───────────────────────────────────────

export async function pipelineSearchImages(
    keyword: string,
    itemCards: any[],
    apiKey: string
): Promise<any[]> {
    console.log(`[ImgSearch] Starting web image pipeline for: "${keyword}"`);

    // A. Find competitor article URLs
    const articleUrls = await findCompetitorArticleUrls(keyword, apiKey);
    if (articleUrls.length === 0) {
        console.warn("[ImgSearch] No article URLs found. Returning original cards.");
        return itemCards;
    }

    // B. Read articles + extract image candidates
    const allCandidates: ArticleImagePool[] = [];
    for (const url of articleUrls) {
        const candidates = await extractImagesFromArticle(url);
        allCandidates.push(...candidates);
        await sleep(400);
        if (allCandidates.length >= 20) break; // cap total candidates
    }

    if (allCandidates.length === 0) {
        console.warn("[ImgSearch] No images found in articles. Returning original cards.");
        return itemCards;
    }

    console.log(`[ImgSearch] ${allCandidates.length} image candidates from ${articleUrls.length} articles.`);

    // C+D. Download + compress up to N images (target: 1–2 per item card)
    const targetImageCount = Math.min(itemCards.length * 2, 16);
    const imagePool: WebImage[] = [];

    for (const candidate of allCandidates) {
        if (imagePool.length >= targetImageCount) break;
        const img = await downloadAndCompress(candidate);
        if (img) {
            imagePool.push(img);
            console.log(`[ImgSearch] ✓ ${img.attribution.siteName} — ${img.fileSizeKb}KB`);
        }
        await sleep(250);
    }

    if (imagePool.length === 0) {
        console.warn("[ImgSearch] All image downloads failed. Returning original cards.");
        return itemCards;
    }

    // E. Match images to item cards
    const assignments = await matchImagesToItems(itemCards, imagePool, apiKey);

    // F. Merge web images into item cards
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
    console.log(`[ImgSearch] Pipeline complete. ${matched}/${itemCards.length} items have web images.`);
    return enriched;
}
