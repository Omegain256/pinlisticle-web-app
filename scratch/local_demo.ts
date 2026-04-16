ISimport { pipelineSearchImages } from '../src/lib/imageSearch';

// Minimal fetch mock
const originalFetch = global.fetch;
global.fetch = async (url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const urlStr = url.toString();

    // 1. Mock Jina Image Download
    if (urlStr.includes('r.jina.ai')) {
        return new Response(Buffer.from('mock_image_data_that_is_large_enough_to_pass_validation_mock_image_data_that_is_large_enough_to_pass_validation'.repeat(200)), {
            status: 200,
            headers: new Headers({ 'content-type': 'image/jpeg' })
        });
    }

    // 2. Mock Gemini Vision Matching
    if (urlStr.includes('gemini-1.5-flash:generateContent')) {
        const isSniper = typeof init?.body === 'string' && init.body.includes('Sniper');
        if (isSniper) {
            return new Response(JSON.stringify({
                candidates: [{
                    groundingMetadata: { searchQueries: ["test fashion photo"] }
                }]
            }), { status: 200, headers: new Headers({ 'content-type': 'application/json' }) });
        }

        const mockAssignments = { "0": 0 }; // Only matched item 0 with image 0
        const fakeMarkdown = `\`\`\`json\n${JSON.stringify(mockAssignments)}\n\`\`\``;
        return new Response(JSON.stringify({
            candidates: [{ content: { parts: [{ text: fakeMarkdown }] } }]
        }), { status: 200, headers: new Headers({ 'content-type': 'application/json' }) });
    }

    if (urlStr.includes('test-image')) {
        return new Response(Buffer.from('mock_image_data'.repeat(200)), {
            status: 200,
            headers: new Headers({ 'content-type': 'image/jpeg' })
        });
    }

    return originalFetch(url, init);
};

async function runDemo() {
    console.log("🚀 Running Local Zero-Fail Demo...\n");

    const itemCards = [
        { item_index: 0, item_name: "Denim Tank Top", styling_notes: "..." },
        { item_index: 1, item_name: "Pleated Trousers", styling_notes: "..." },
        { item_index: 2, item_name: "Ballet Flats", styling_notes: "..." }
    ];

    const evidencePack = {
        article_pool: [
            {
                url: "https://www.vogue.com/test-article",
                title: "Vogue Denim Top Looks",
                markdown: "Here are some styles. ![Look 1](https://www.vogue.com/test-image1.jpg) ![Look 2](https://www.vogue.com/test-image2.jpg)"
            }
        ]
    };

    console.log("📦 INPUT DATA:");
    console.log(`- Items to enrich: ${itemCards.length}`);
    console.log(`- Sources provided: ${evidencePack.article_pool.length}`);
    console.log("--------------------------------------------------\n");

    try {
        const result = await pipelineSearchImages("Denim outfit", itemCards, evidencePack, "fake-api-key");

        console.log("\n✅ PIPELINE COMPLETED SUCCESSFULLY");
        console.log("📊 RESULT ANALYSIS:");

        const withImages = result.filter((c: any) => c.web_image !== null);
        console.log(`- Items with images: ${withImages.length}/${itemCards.length} (Expected 100% due to Zero-Fail Fallback)`);

        if (withImages.length === itemCards.length) {
            console.log("\n✅ ZERO-FAIL POLICY IS WORKING PERFECTLY.");
            console.log("Resulting output structure:");
            console.log(JSON.stringify(result, null, 2));
        } else {
            console.error("\n❌ ZERO-FAIL POLICY FAILED. Missing images.");
        }

    } catch (e) {
        console.error("\n❌ PIPELINE CRASHED:", e);
    }
}

runDemo();
