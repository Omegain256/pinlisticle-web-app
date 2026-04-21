import { NextRequest } from "next/server";
import {
    pipelineClassifyTopic,
    pipelineSearchEvidence,
    pipelineGenerateItemCards,
    pipelineDraftArticle,
    pipelineScoreEditorialQA,
    pipelineGenerateStyleDNA,
    pipelineVisualIntelligence,
    stripHeavyData,
} from "@/lib/pipeline";
import { generateImage, getShotMatrixReferences } from "@/lib/ai";
import { pipelineSearchImages } from "@/lib/imageSearch";

export const maxDuration = 300;

// ─────────────────────────────────────────────────────────────────────────────
// STREAMING SUBMIT ROUTE
// Converts the pipeline to a Server-Sent Events stream so that Render's
// 30-second HTTP idle timeout never triggers. Each pipeline stage sends a
// progress event, keeping the socket alive. The final event carries the full
// article payload. The browser reads this with a streaming fetch loop.
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
    const body = await req.json();
    const { topic, keyword, tone, count, apiKey, modelPrefix, amazonTag, imageMode, category } = body;

    if ((!topic && !keyword) || !apiKey) {
        return new Response(
            JSON.stringify({ success: false, error: "Topic/keyword and API Key required" }),
            { status: 400, headers: { "Content-Type": "application/json" } }
        );
    }

    const targetKeyword = keyword || topic;
    const itemCount     = count || 7;
    const useWebImages  = imageMode === "web";
    const cat           = category || "fashion";

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
        async start(controller) {
            const send = (event: string, data: unknown) => {
                try {
                    controller.enqueue(
                        encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
                    );
                } catch { /* stream already closed */ }
            };

            try {
                // Stage 1 ──────────────────────────────────────────────────
                send("progress", { stage: "classify", pct: 5, message: "Classifying topic…" });
                const brief = await pipelineClassifyTopic(targetKeyword, apiKey, cat);
                send("progress", { stage: "classify", pct: 12, message: "Topic classified." });

                // Stage 2 ──────────────────────────────────────────────────
                send("progress", { stage: "evidence", pct: 15, message: "Gathering research…" });
                let evidence_pack: any;
                try {
                    evidence_pack = await pipelineSearchEvidence(targetKeyword, brief, apiKey, cat);
                } catch {
                    evidence_pack = { trending_angles: [], top_sources: [], seasonal_context: "", audience_pain_points: [], competitive_gaps: "", key_statistics: [], reference_image_urls: [] };
                }
                send("progress", { stage: "evidence", pct: 25, message: "Research gathered." });

                // Stage 3 ──────────────────────────────────────────────────
                send("progress", { stage: "style_dna", pct: 27, message: "Building style DNA…" });
                let style_dna: any;
                try {
                    style_dna = await pipelineGenerateStyleDNA(targetKeyword, brief, apiKey);
                } catch {
                    style_dna = { style_family: "editorial", realism_constraints: ["hyper-realistic"], color_story: "neutral" };
                }
                send("progress", { stage: "style_dna", pct: 33, message: "Style DNA ready." });

                // Stage 4 ──────────────────────────────────────────────────
                send("progress", { stage: "item_cards", pct: 35, message: `Generating ${itemCount} item cards…` });
                const item_cards = await pipelineGenerateItemCards(targetKeyword, itemCount, brief, evidence_pack, apiKey, modelPrefix || "pro", cat);
                if (!item_cards?.length) throw new Error("No item cards generated.");
                send("progress", { stage: "item_cards", pct: 50, message: "Item cards ready." });

                // Stage 4.5 ────────────────────────────────────────────────
                let enriched_item_cards = item_cards;
                if (useWebImages) {
                    send("progress", { stage: "images_web", pct: 53, message: "Searching web images…" });
                    try {
                        const webResult = await pipelineSearchImages(targetKeyword, item_cards, evidence_pack, apiKey);
                        if (webResult?.length) enriched_item_cards = webResult;
                    } catch { /* non-fatal */ }
                    send("progress", { stage: "images_web", pct: 60, message: "Web images fetched." });
                } else {
                    send("progress", { stage: "visual_intelligence", pct: 53, message: "Visual intelligence…" });
                    try {
                        const refUrls: string[] = evidence_pack?.reference_image_urls ?? [];
                        const vis = await pipelineVisualIntelligence(targetKeyword, item_cards, apiKey, style_dna, refUrls, brief, cat);
                        if (vis?.length) enriched_item_cards = vis;
                    } catch { /* non-fatal */ }
                    send("progress", { stage: "visual_intelligence", pct: 60, message: "Visual intelligence done." });
                }

                // Stage 5 ──────────────────────────────────────────────────
                send("progress", { stage: "draft", pct: 62, message: "Drafting article…" });
                const strippedCards = stripHeavyData(enriched_item_cards);
                const article_draft = await pipelineDraftArticle(targetKeyword, tone || "conversational", brief, strippedCards, evidence_pack, apiKey, modelPrefix || "pro");
                send("progress", { stage: "draft", pct: 78, message: "Draft complete." });

                // Stage 6 ──────────────────────────────────────────────────
                send("progress", { stage: "qa", pct: 80, message: "Quality check…" });
                let qa_score: any = { pass: true };
                try { qa_score = await pipelineScoreEditorialQA(article_draft, item_cards, apiKey); } catch { /* non-fatal */ }
                send("progress", { stage: "qa", pct: 84, message: "QA done." });

                // Stage 7 — Images ───────────────────────────────────────
                // CRITICAL: Each image is sent as its OWN SSE event immediately.
                // The client saves it straight to IndexedDB and discards the reference.
                // This prevents the browser from ever holding a 40-80MB JSON blob in memory.
                if (useWebImages) {
                    if (article_draft?.listicle_items) {
                        article_draft.listicle_items = article_draft.listicle_items.map((item: any, idx: number) => {
                            const enriched = enriched_item_cards.find((c: any) => c.item_index === item.item_index);
                            if (enriched?.web_image) {
                                const b64 = enriched.web_image.image_base64;
                                // Stream image out immediately, then remove from article object
                                send("image", { idx, image_base64: b64, mime_type: enriched.web_image.mime_type || "image/jpeg" });
                                return { ...item, web_image: { ...enriched.web_image, image_base64: "[streamed]" }, image_base64: undefined, image_prompt: enriched.image_prompt_seed?.engineered_image_prompt || item.image_prompt };
                            }
                            return item;
                        });
                        const first = enriched_item_cards.find((c: any) => c.web_image);
                        if (first?.web_image?.image_base64 && !article_draft.featured_image_base64) {
                            send("image", { idx: -1, image_base64: first.web_image.image_base64, mime_type: "image/jpeg", isFeatured: true });
                            article_draft.featured_image_base64 = undefined;
                        }
                    }
                } else {
                    const imageSources = article_draft?.listicle_items || item_cards;
                    for (let i = 0; i < imageSources.length; i++) {
                        send("progress", { stage: "images_ai", pct: 85 + Math.round((i / imageSources.length) * 12), message: `Generating image ${i + 1}/${imageSources.length}…` });
                        const draftItem = article_draft?.listicle_items?.[i];
                        const card      = item_cards[i];
                        const seed      = card?.image_prompt_seed;
                        const finalPrompt = draftItem?.image_prompt || (seed ? `${seed.subject}. ${seed.setting}. ${seed.shot} shot. ${seed.lighting}. Hyper-realistic editorial photography.` : null);
                        if (!finalPrompt) continue;
                        try {
                            const refs = await getShotMatrixReferences();
                            const b64  = await generateImage({ prompt: finalPrompt, apiKey, referenceImages: refs, category: cat });
                            if (b64) {
                                // Stream image immediately — do NOT accumulate in article_draft
                                send("image", { idx: i, image_base64: b64, mime_type: "image/jpeg" });
                                if (i === 0) send("image", { idx: -1, image_base64: b64, mime_type: "image/jpeg", isFeatured: true });
                                // Keep b64 in article_draft for html building, but it will be stripped in done event
                                if (article_draft?.listicle_items?.[i]) article_draft.listicle_items[i].image_base64 = b64;
                                if (i === 0 && article_draft && !article_draft.featured_image_base64) article_draft.featured_image_base64 = b64;
                            }
                        } catch { /* non-fatal per image */ }
                    }
                }

                // Done — send article WITHOUT image payloads to keep the event small
                // Images were already individually streamed above.
                const articleForClient = {
                    ...article_draft,
                    featured_image_base64: undefined, // strip — already streamed
                    listicle_items: article_draft?.listicle_items?.map((item: any) => ({
                        ...item,
                        image_base64: undefined, // strip — already streamed
                        web_image: item.web_image ? { ...item.web_image, image_base64: undefined } : undefined,
                    }))
                };

                send("done", {
                    success: true,
                    article: articleForClient,
                    qa_score,
                    image_mode: useWebImages ? "web" : "ai",
                    stages_completed: ["classify", "evidence", "style_dna", "item_cards", "visual_intelligence", "draft", "qa", "images"],
                });

            } catch (err: any) {
                send("error", { success: false, error: err.message || "Unknown pipeline error" });
            } finally {
                controller.close();
            }
        }
    });

    return new Response(stream, {
        headers: {
            "Content-Type":  "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            "Connection":    "keep-alive",
            "X-Accel-Buffering": "no", // disable Nginx/proxy buffering on Render
        },
    });
}
