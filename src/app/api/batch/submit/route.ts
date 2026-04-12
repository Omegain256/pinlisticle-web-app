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

export const maxDuration = 300; // 5 min Render limit for pro plan; adjust if on free tier

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { topic, keyword, tone, count, apiKey, modelPrefix, amazonTag } = body;

        if (!topic && !keyword) {
            return NextResponse.json({ success: false, error: "Topic or keyword required" }, { status: 400 });
        }
        if (!apiKey) {
            return NextResponse.json({ success: false, error: "API Key required" }, { status: 400 });
        }

        const targetKeyword = keyword || topic;
        const itemCount = count || 7;

        // ── Stage 1: Brief / Classify ────────────────────────────────────────
        let brief: any;
        try {
            brief = await pipelineClassifyTopic(targetKeyword, apiKey);
        } catch (e: any) {
            return NextResponse.json({ success: false, stage: "classify", error: e.message }, { status: 500 });
        }

        // ── Stage 2: Evidence via Web Search ──────────────────────────────────
        let evidence_pack: any;
        try {
            evidence_pack = await pipelineSearchEvidence(targetKeyword, brief, apiKey);
        } catch (e: any) {
            // Evidence is non-fatal, use a minimal fallback
            console.warn("Evidence search failed, using fallback:", e.message);
            evidence_pack = { trending_angles: [], top_sources: [], seasonal_context: "", audience_pain_points: [], competitive_gaps: "", key_statistics: [] };
        }

        // ── Stage 3: Style DNA ────────────────────────────────────────────────
        let style_dna: any;
        try {
            style_dna = await pipelineGenerateStyleDNA(targetKeyword, brief, apiKey);
        } catch (e: any) {
            console.warn("Style DNA failed, using fallback:", e.message);
            style_dna = { style_family: "editorial", realism_constraints: ["hyper-realistic", "photographic"], color_story: "neutral" };
        }

        // ── Stage 4: Item Evidence Cards ──────────────────────────────────────
        let item_cards: any[];
        try {
            item_cards = await pipelineGenerateItemCards(targetKeyword, itemCount, brief, evidence_pack, apiKey, modelPrefix || "pro");
        } catch (e: any) {
            return NextResponse.json({ success: false, stage: "item_cards", error: e.message }, { status: 500 });
        }

        if (!item_cards || item_cards.length === 0) {
            return NextResponse.json({ success: false, stage: "item_cards", error: "No item cards generated." }, { status: 500 });
        }

        // ── Stage 2.5: Visual Intelligence ──────────────────────────────────────
        // Fetch real fashion reference images, analyze with Gemini Vision,
        // and enrich item_cards with grounded VisualDNA + precision image_prompts.
        let enriched_item_cards = item_cards;
        try {
            const visualResult = await pipelineVisualIntelligence(targetKeyword, item_cards, apiKey, style_dna);
            if (visualResult && visualResult.length > 0) {
                enriched_item_cards = visualResult;
                console.log(`[S2.5] Item cards enriched with Visual Intelligence.`);
            }
        } catch (e: any) {
            // Visual Intelligence is fully non-fatal — pipeline continues with original cards
            console.warn("Visual Intelligence skipped:", e.message);
        }

        // ── Stage 5: Draft Article ────────────────────────────────────────────
        let article_draft: any;
        try {
            article_draft = await pipelineDraftArticle(targetKeyword, tone || "conversational", brief, enriched_item_cards, evidence_pack, apiKey, modelPrefix || "pro");
        } catch (e: any) {
            return NextResponse.json({ success: false, stage: "draft", error: e.message }, { status: 500 });
        }

        // ── Stage 6: QA Score (soft-gate, non-blocking) ───────────────────────
        let qa_score: any = { pass: true };
        try {
            qa_score = await pipelineScoreEditorialQA(article_draft, item_cards, apiKey);
            if (!qa_score?.pass) {
                console.warn("QA soft-fail:", qa_score?.weak_sections);
            }
        } catch (e: any) {
            console.warn("QA scorer skipped:", e.message);
        }

        // ── Stage 7: Images ───────────────────────────────────────────────────
        const image_results: string[] = [];
        const imageSources = article_draft?.listicle_items || item_cards;
        for (let i = 0; i < imageSources.length; i++) {
            // Prefer the rich image_prompt written by the draft stage; fall back to item card seed
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
                image_results.push(""); // non-fatal
            }
        }

        // Stitch images into article items
        if (article_draft?.listicle_items) {
            for (let j = 0; j < article_draft.listicle_items.length; j++) {
                if (image_results[j]) {
                    article_draft.listicle_items[j].image_base64 = image_results[j];
                }
            }
            if (image_results[0]) {
                article_draft.featured_image_base64 = image_results[0];
            }
        }

        return NextResponse.json({
            success: true,
            article: article_draft,
            qa_score,
            stages_completed: ["classify", "evidence", "style_dna", "item_cards", "visual_intelligence", "draft", "qa", "images"],
        });

    } catch (error: any) {
        console.error("Pipeline error:", error);
        return NextResponse.json({ success: false, error: error.message || "Unknown pipeline error" }, { status: 500 });
    }
}
