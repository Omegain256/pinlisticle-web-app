import { NextRequest, NextResponse } from "next/server";
import {
    pipelineClassifyTopic,
    pipelineSearchEvidence,
    pipelineGenerateItemCards,
    pipelineDraftArticle,
    pipelineScoreEditorialQA,
    pipelineGenerateStyleDNA,
    pipelineVisualIntelligence,
} from "@/lib/pipeline";
import { generateImage } from "@/lib/ai";
import { pipelineSearchImages } from "@/lib/imageSearch";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { topic, keyword, tone, count, apiKey, modelPrefix, amazonTag, imageMode } = body;
        // imageMode: "ai" (default) | "web" (real images from competitor articles, credited)

        if (!topic && !keyword) {
            return NextResponse.json({ success: false, error: "Topic or keyword required" }, { status: 400 });
        }
        if (!apiKey) {
            return NextResponse.json({ success: false, error: "API Key required" }, { status: 400 });
        }

        const targetKeyword = keyword || topic;
        const itemCount = count || 7;
        const useWebImages = imageMode === "web";

        // ── Stage 1: Brief / Classify ───────────────────────────────────────
        let brief: any;
        try {
            brief = await pipelineClassifyTopic(targetKeyword, apiKey);
        } catch (e: any) {
            return NextResponse.json({ success: false, stage: "classify", error: e.message }, { status: 500 });
        }

        // ── Stage 2: Evidence via Web Search (Jina AI enhanced) ─────────────
        let evidence_pack: any;
        try {
            evidence_pack = await pipelineSearchEvidence(targetKeyword, brief, apiKey);
        } catch (e: any) {
            console.warn("Evidence search failed, using fallback:", e.message);
            evidence_pack = { trending_angles: [], top_sources: [], seasonal_context: "", audience_pain_points: [], competitive_gaps: "", key_statistics: [], reference_image_urls: [] };
        }

        // ── Stage 3: Style DNA ───────────────────────────────────────────────
        let style_dna: any;
        try {
            style_dna = await pipelineGenerateStyleDNA(targetKeyword, brief, apiKey);
        } catch (e: any) {
            console.warn("Style DNA failed, using fallback:", e.message);
            style_dna = { style_family: "editorial", realism_constraints: ["hyper-realistic", "photographic"], color_story: "neutral" };
        }

        // ── Stage 4: Item Evidence Cards ────────────────────────────────────
        let item_cards: any[];
        try {
            item_cards = await pipelineGenerateItemCards(targetKeyword, itemCount, brief, evidence_pack, apiKey, modelPrefix || "pro");
        } catch (e: any) {
            return NextResponse.json({ success: false, stage: "item_cards", error: e.message }, { status: 500 });
        }
        if (!item_cards || item_cards.length === 0) {
            return NextResponse.json({ success: false, stage: "item_cards", error: "No item cards generated." }, { status: 500 });
        }

        // ── Stage 4.5: Image Enrichment (mode-dependent) ────────────────────
        let enriched_item_cards = item_cards;

        if (useWebImages) {
            // WEB IMAGE MODE: scrape competitor articles → real photos + attribution
            console.log("[S4.5] Web Image Mode: searching competitor articles for real outfit photos...");
            try {
                const webResult = await pipelineSearchImages(targetKeyword, item_cards, apiKey);
                if (webResult && webResult.length > 0) {
                    enriched_item_cards = webResult;
                    const matched = webResult.filter((c: any) => c.web_image).length;
                    console.log(`[S4.5] Web images: ${matched}/${item_cards.length} items matched.`);
                }
            } catch (e: any) {
                console.warn("Web image search skipped:", e.message);
            }
        } else {
            // AI IMAGE MODE: VisualDNA analysis → engineered Imagen prompts
            console.log("[S4.5] AI Image Mode: running Visual Intelligence...");
            try {
                const referenceImgUrls: string[] = evidence_pack?.reference_image_urls ?? [];
                const visualResult = await pipelineVisualIntelligence(
                    targetKeyword, item_cards, apiKey, style_dna, referenceImgUrls
                );
                if (visualResult && visualResult.length > 0) {
                    enriched_item_cards = visualResult;
                    console.log(`[S4.5] AI Visual Intelligence: ${referenceImgUrls.length} reference images used.`);
                }
            } catch (e: any) {
                console.warn("Visual Intelligence skipped:", e.message);
            }
        }

        // ── Stage 5: Draft Article ───────────────────────────────────────────
        let article_draft: any;
        try {
            article_draft = await pipelineDraftArticle(targetKeyword, tone || "conversational", brief, enriched_item_cards, evidence_pack, apiKey, modelPrefix || "pro");
        } catch (e: any) {
            return NextResponse.json({ success: false, stage: "draft", error: e.message }, { status: 500 });
        }

        // ── Stage 6: QA Score (soft-gate, non-blocking) ─────────────────────
        let qa_score: any = { pass: true };
        try {
            qa_score = await pipelineScoreEditorialQA(article_draft, item_cards, apiKey);
            if (!qa_score?.pass) console.warn("QA soft-fail:", qa_score?.weak_sections);
        } catch (e: any) {
            console.warn("QA scorer skipped:", e.message);
        }

        // ── Stage 7: Finalize Images ─────────────────────────────────────────
        if (useWebImages) {
            // WEB MODE: copy web_image data from enriched_item_cards into article_draft using item_index
            if (article_draft?.listicle_items) {
                article_draft.listicle_items = article_draft.listicle_items.map((item: any) => {
                    const index = item.item_index;
                    const enriched = enriched_item_cards.find((c: any) => c.item_index === index);
                    if (enriched?.web_image) {
                        return { ...item, web_image: enriched.web_image };
                    }
                    return item;
                });
                const firstWebImg = enriched_item_cards.find((c: any) => c.web_image);
                if (firstWebImg?.web_image && !article_draft.featured_image_base64) {
                    article_draft.featured_image_base64 = firstWebImg.web_image.image_base64;
                }
            }
        } else {
            // AI MODE: generate images via Imagen for each item
            const image_results: string[] = [];
            const imageSources = article_draft?.listicle_items || item_cards;
            for (let i = 0; i < imageSources.length; i++) {
                const draftItem = article_draft?.listicle_items?.[i];
                const card = item_cards[i];
                const seed = card?.image_prompt_seed;
                const finalPrompt = draftItem?.image_prompt
                    || (seed ? `${seed.subject}. ${seed.setting}. ${seed.shot} shot. ${seed.lighting}. Hyper-realistic editorial photography.` : null);

                if (!finalPrompt) { image_results.push(""); continue; }
                try {
                    const b64 = await generateImage({ prompt: finalPrompt, apiKey });
                    image_results.push(b64 || "");
                } catch (imgErr: any) {
                    console.warn(`Image ${i + 1} failed: ${imgErr.message}`);
                    image_results.push("");
                }
            }

            if (article_draft?.listicle_items) {
                for (let j = 0; j < article_draft.listicle_items.length; j++) {
                    if (image_results[j]) article_draft.listicle_items[j].image_base64 = image_results[j];
                }
                if (image_results[0]) article_draft.featured_image_base64 = image_results[0];
            }
        }

        return NextResponse.json({
            success: true,
            article: article_draft,
            qa_score,
            image_mode: useWebImages ? "web" : "ai",
            stages_completed: ["classify", "evidence", "style_dna", "item_cards", "visual_intelligence", "draft", "qa", "images"],
        });

    } catch (error: any) {
        console.error("Pipeline error:", error);
        return NextResponse.json({ success: false, error: error.message || "Unknown pipeline error" }, { status: 500 });
    }
}
