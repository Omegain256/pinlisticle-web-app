/**
 * LOCAL DIAGNOSTIC SCRIPT — Run this before pushing to production
 * Tests image discovery steps individually so we can see exactly where it fails.
 * 
 * Usage: GEMINI_API_KEY=your_key node scratch/test_image_pipeline.mjs
 */

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) { console.error("❌  GEMINI_API_KEY env var not set. e.g. GEMINI_API_KEY=xxx node ..."); process.exit(1); }

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const JINA_BASE   = "https://r.jina.ai/";
const JINA_SEARCH = "https://s.jina.ai/";
const TOPIC = "Denim Tank Top Outfit Ideas Women";

// ─── Helper: fetch with a timeout ─────────────────────────────────────────────
async function fetchT(url, opts = {}, ms = 12000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
        const r = await fetch(url, { ...opts, signal: ctrl.signal });
        clearTimeout(t);
        return r;
    } catch (e) { clearTimeout(t); throw e; }
}

// ─── Test 1: Gemini Grounded Search ──────────────────────────────────────────
async function testGrounding() {
    console.log("\n━━━━ TEST 1: Gemini Grounded Search ━━━━");
    const res = await fetchT(`${GEMINI_BASE}/gemini-1.5-flash:generateContent?key=${API_KEY}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            contents: [{ parts: [{ text: `Search for the best fashion blog articles about: "${TOPIC}"` }] }],
            tools: [{ googleSearch: {} }],
            generationConfig: { temperature: 0.1 },
        }),
    });
    const data = await res.json();
    const chunks = data?.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
    const urls = chunks.map(c => c?.web?.uri).filter(Boolean);
    console.log(`✅ Found ${urls.length} grounded article URLs:`);
    urls.slice(0, 5).forEach(u => console.log("  -", u));
    return urls;
}

// ─── Test 2: Jina Reader ──────────────────────────────────────────────────────
async function testJinaReader(articleUrl) {
    console.log(`\n━━━━ TEST 2: Jina Reader for ${articleUrl.slice(0, 60)}... ━━━━`);
    try {
        const res = await fetchT(`${JINA_BASE}${articleUrl}`, {
            headers: { "Accept": "text/markdown", "X-Return-Format": "markdown", "X-Image-Caption": "true" }
        });
        const text = await res.text();
        const imageUrls = [];
        // Simple regex to find .jpg/.png/.webp URLs
        for (const m of text.matchAll(/https?:\/\/[^\s"')(]+\.(?:jpg|jpeg|png|webp)(?:\?[^\s"')(]*)?/gi)) {
            imageUrls.push(m[0]);
        }
        // Pinterest CDNs
        for (const m of text.matchAll(/https?:\/\/i\.pinimg\.com\/[^\s"')]+\.(?:jpg|jpeg|png|webp)/gi)) {
            imageUrls.push(m[0]);
        }
        const deduped = [...new Set(imageUrls)];
        console.log(`  Status: ${res.status} | Length: ${text.length} chars | Images found: ${deduped.length}`);
        deduped.slice(0, 5).forEach(u => console.log("  IMG:", u.slice(0, 100)));
        return deduped;
    } catch (e) {
        console.log(`  ❌ BLOCKED: ${e.message}`);
        return [];
    }
}

// ─── Test 3: Direct image download ───────────────────────────────────────────
async function testImageDownload(imageUrl) {
    console.log(`\n━━━━ TEST 3: Download ${imageUrl.slice(0, 60)}... ━━━━`);
    try {
        const res = await fetchT(imageUrl, {
            headers: {
                "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
                "Accept": "image/*,*/*;q=0.8",
                "Referer": "https://www.google.com/",
            }
        });
        const ct = res.headers.get("content-type") || "";
        const buf = await res.arrayBuffer();
        console.log(`  Status: ${res.status} | Content-Type: ${ct} | Size: ${Math.round(buf.byteLength / 1024)}KB`);
        if (ct.startsWith("image/") && buf.byteLength > 15000) {
            console.log("  ✅ VALID IMAGE — would be included in article");
            return true;
        } else {
            console.log("  ⚠️  Too small or wrong content-type — REJECTED");
            return false;
        }
    } catch (e) {
        console.log(`  ❌ DOWNLOAD FAILED: ${e.message}`);
        return false;
    }
}

// ─── Test 4: Jina Search (s.jina.ai) ─────────────────────────────────────────
async function testJinaSearch() {
    console.log(`\n━━━━ TEST 4: Jina Search (s.jina.ai) ━━━━`);
    try {
        const query = encodeURIComponent(`${TOPIC} blog photo outfit`);
        const res = await fetchT(`${JINA_SEARCH}${query}`, {
            headers: { "Accept": "text/markdown", "X-Return-Format": "markdown" }
        });

        if (res.status === 401) {
            console.log("  ❌ BLOCKED (401 Unauthorized) — Jina Search requires API key. This is why Sniper Mode was failing!");
            return;
        }

        const text = await res.text();
        console.log(`  Status: ${res.status} | Length: ${text.length} chars`);
        const imageUrls = [];
        for (const m of text.matchAll(/https?:\/\/[^\s"')(]+\.(?:jpg|jpeg|png|webp)/gi)) {
            imageUrls.push(m[0]);
        }
        console.log(`  Images found: ${imageUrls.length}`);
    } catch (e) {
        console.log(`  ❌ FAILED: ${e.message}`);
    }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
(async () => {
    console.log(`\n🔍 FASHION IMAGE PIPELINE DIAGNOSTIC`);
    console.log(`   Topic: "${TOPIC}"`);
    console.log(`   API Key: ${API_KEY.slice(0,8)}...`);

    // Test 1: Grounding
    const articleUrls = await testGrounding();

    // Test 2: Jina Reader on first URL
    if (articleUrls.length > 0) {
        const imageUrls = await testJinaReader(articleUrls[0]);
        
        // Test 3: Download first image
        if (imageUrls.length > 0) {
            await testImageDownload(imageUrls[0]);
        } else {
            console.log("\n⚠️  No images found from first article. The Jina reader is being blocked or articles have no images.");
            // Try a second article
            if (articleUrls.length > 1) {
                const imgs2 = await testJinaReader(articleUrls[1]);
                if (imgs2.length > 0) await testImageDownload(imgs2[0]);
            }
        }
    }

    // Test 4: Jina Search
    await testJinaSearch();

    console.log("\n✅ Diagnostic complete. Review the output above to see exactly where the pipeline fails.");
})();
