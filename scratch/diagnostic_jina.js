import fetch from "node-fetch";

const JINA_BASE = "https://r.jina.ai/";
const TEST_KEYWORD = "Silver Ballet Flats Outfit ideas";

async function testJinaResearch() {
    console.log(`[Diagnostic] Testing Jina Research for: ${TEST_KEYWORD}`);
    
    // Step 1: Simulated search
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(TEST_KEYWORD + " 2026 fashion blog")}`;
    console.log(`[Diagnostic] Searching...`);
    
    // In actual code, we use Jina for the search too sometimes
    try {
        const jinaSearchUrl = `https://s.jina.ai/${encodeURIComponent(TEST_KEYWORD + " outfit ideas blog post")}`;
        const res = await fetch(jinaSearchUrl, {
            headers: { "X-Return-Format": "markdown" }
        });
        const markdown = await res.text();
        console.log(`[Diagnostic] Jina Search returned ${markdown.length} chars.`);
        
        // Extract URLs
        const urlMatches = markdown.matchAll(/\[.*?\]\((https?:\/\/[^)\s]+)\)/g);
        const urls = [...urlMatches].map(m => m[1]).filter(u => !u.includes("google.com"));
        console.log(`[Diagnostic] Found ${urls.length} candidate URLs.`);
        
        if (urls.length === 0) {
            console.error("[FAIL] No URLs found in search results.");
            return;
        }

        // Test Extraction from the first one
        const targetUrl = urls[0];
        console.log(`[Diagnostic] Attempting to read first URL: ${targetUrl}`);
        const readRes = await fetch(`${JINA_BASE}${targetUrl}`, {
             headers: { "X-Return-Format": "markdown", "X-Image-Caption": "true" }
        });
        const pageMd = await readRes.text();
        console.log(`[Diagnostic] Read success. ${pageMd.length} chars.`);
        
        // Test our regex
        const urlsFound = [];
        const mdImgs = pageMd.matchAll(/!\[[^\]]*\]\((https?:\/\/[^)\s?#]+(?:[^)\s]*))\)/g);
        for (const m of mdImgs) urlsFound.push(m[1]);
        
        const pinImgs = pageMd.matchAll(/https?:\/\/i\.pinimg\.com\/[^\s"')]+\.(?:jpg|jpeg|png|webp)/gi);
        for (const m of pinImgs) urlsFound.push(m[0]);
        
        const lazyImgs = pageMd.matchAll(/(?:data-src|data-lazy|data-original|data-srcset)=["'](https?:\/\/[^)\s'"]+)["']/gi);
        for (const m of lazyImgs) urlsFound.push(m[1]);

        const unique = [...new Set(urlsFound)];
        console.log(`[Diagnostic] Found ${unique.length} unique image URLs via regex.`);
        unique.slice(0, 5).forEach(u => console.log(` - ${u}`));

    } catch (e) {
        console.error(`[FAIL] Diagnostic error: ${e.message}`);
    }
}

testJinaResearch();
