import { pipelineSearchImages } from '../src/lib/imageSearch';

// We do NOT mock `fetch` entirely this time. We will let DDG traffic go through to the internet!
// We only mock Gemini's Vision Matcher since we don't have the API key to do multimodal LLM calls.

const originalFetch = global.fetch;
global.fetch = async (url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const urlStr = url.toString();

    // Let all DDG traffic through, there is no AI matching anymore!
    return originalFetch(url, init);
};

async function runDemo() {
    console.log("🚀 Running Sniper 5.0 Local Test (1:1 Native Resolution)...\n");

    const itemCards = [
        { item_index: 0, item_name: "Trench Coat outfit", styling_notes: "..." },
        { item_index: 1, item_name: "Denim tank top", styling_notes: "..." },
        { item_index: 2, item_name: "Trench Coat outfit", styling_notes: "..." }, // duplicate name to test deduplication!
    ];

    // Intentionally pass an empty article_pool to force SNIPER DDG to run
    const evidencePack = {
        article_pool: [] 
    };

    try {
        const result = await pipelineSearchImages("Trench Fall", itemCards, evidencePack, "fake-api-key");
        
        console.log("\n✅ PIPELINE COMPLETED");
        
        const withImages = result.filter((c: any) => c.web_image !== null);
        console.log(`- Items with images: ${withImages.length}/${itemCards.length}`);
        
        if (withImages.length > 0 && withImages[0].web_image.image_base64) {
             const base64Len = withImages[0].web_image.image_base64.length;
             console.log(`\n🎉 SUCCESS! Real image downloaded from DDG Sniper! Base64 Length: ${base64Len} bytes.`);
             console.log(`- Source URL: ${withImages[0].web_image.original_url}`);
             console.log(`- Size: ${withImages[0].web_image.file_size_kb} KB`);
        }

    } catch (e) {
        console.error("\n❌ PIPELINE CRASHED:", e);
    }
}

runDemo();
