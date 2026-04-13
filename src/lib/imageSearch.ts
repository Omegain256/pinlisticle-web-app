/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * imageSearch.ts — Web Image Pipeline (Sniper 5.0 Direct-Mapping Architecture)
 *
 * Scrapes DuckDuckGo strictly for 1:1 image resolution per item.
 * Eliminates multimodal LLM matching to completely bypass all
 * Base64 memory bloating (OOM limit crashes).
 */

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ─── Step A: Search for precise raw images via DuckDuckGo Image proxy ──────────

export interface ArticleImagePool {
    imageUrl: string;
    pageUrl: string;
    siteName: string;
    articleTitle: string;
}

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

/** Uses DuckDuckGo Image Search to directly find high-resolution raw image URLs */
async function sniperSearchDDG(query: string): Promise<ArticleImagePool[]> {
    try {
        console.log(`[Sniper DDG] Fetching VQD token for: "${query}"`);
        const vqdRes = await fetch(`https://duckduckgo.com/?q=${encodeURIComponent(query)}`, {
            headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }
        });
        const html = await vqdRes.text();
        const vqdMatch = html.match(/vqd=([\'\"]?)([^\'&\"\s]+)\1/);
        
        if (!vqdMatch) {
            console.warn(`[Sniper DDG] Failed to extract VQD token for ${query}`);
            return [];
        }
        
        const vqd = vqdMatch[2];
        
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
            siteName: new URL(r.url).hostname.replace(/^www\./, ""),
            articleTitle: r.title || `Found: ${query}`
        }));
    } catch (e) {
        console.warn(`[Sniper DDG] Search failed for ${query}:`, e);
        return [];
    }
}

// ─── Step B: Download & Compress  ──────────────────────────────────────────

async function downloadAndCompress(candidate: ArticleImagePool): Promise<WebImage | null> {
    const { imageUrl, pageUrl, siteName, articleTitle } = candidate;

    let imageBuffer: Buffer | null = null;
    let mimeType = "image/jpeg";

    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000); // 8 second strict timeout
        const res = await fetch(imageUrl, {
            signal: controller.signal,
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
                "Accept": "image/webp,image/apng,image/*,*/*;q=0.8",
                "Referer": "https://www.pinterest.com/",
            },
        });
        clearTimeout(timer);
        if (res.ok) {
            const ct = res.headers.get("content-type") || "image/jpeg";
            if (ct.startsWith("image/")) {
                const buf = await res.arrayBuffer();
                if (buf.byteLength > 15000) { // Reject extreme tiny thumbnails
                    imageBuffer = Buffer.from(buf);
                    mimeType = ct.split(";")[0];
                }
            }
        }
    } catch {
        return null; // Silent catch, we rotate immediately
    }

    if (!imageBuffer) return null;

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
            creditLine: siteName,
        },
    };
}

// ─── Main export: pipelineSearchImages (Sniper 5.0) ─────────────────────────

export async function pipelineSearchImages(
    keyword: string, // Main article topic
    itemCards: any[],
    evidencePack: any, // Kept for interface compatibility
    apiKey: string     // Kept for interface compatibility
): Promise<any[]> {
    console.log(`[ImgSearch] Starting Sniper 5.0 Direct-Mapping for ${itemCards.length} items`);

    const usedUrls = new Set<string>();
    const enrichedCards = [];

    // Process consecutively to strictly control Memory (prevent OOM Spikes)
    for (let i = 0; i < itemCards.length; i++) {
        const card = itemCards[i];
        console.log(`[ImgSearch] Resolving image for [${i}/${itemCards.length}]: "${card.item_name}"`);

        // Query combining article topic and item name for extreme visual accuracy
        const searchQuery = `${keyword} ${card.item_name} fashion outfit pinterest blog photo`;
        
        let match: WebImage | null = null;
        const candidates = await sniperSearchDDG(searchQuery);

        for (const candidate of candidates) {
            // Prevent duplicated images completely
            if (usedUrls.has(candidate.imageUrl)) continue;

            const img = await downloadAndCompress(candidate);
            if (img) {
                match = img;
                usedUrls.add(candidate.imageUrl);
                break; // We only need ONE perfect match per item!
            }
            await sleep(200); // polite delay between checks
        }

        // Attach WebImage natively without any AI Processing Context
        enrichedCards.push({
            ...card,
            web_image: match ? {
                image_base64: match.imageBase64,
                mime_type: match.mimeType,
                original_url: match.originalUrl,
                file_size_kb: match.fileSizeKb,
                attribution: match.attribution,
            } : null
        });

        // Small garbage collection rest
        await sleep(400); 
    }

    const matchedCount = enrichedCards.filter(c => c.web_image !== null).length;
    console.log(`[ImgSearch] Pipeline complete. ${matchedCount}/${itemCards.length} items have 1:1 precise visual matches.`);

    return enrichedCards;
}
