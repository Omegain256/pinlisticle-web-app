/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { Worker, Job } from "bullmq";
import { GENERATION_QUEUE_NAME, PublishPipelineData } from "./lib/queue";
import {
    pipelineClassifyTopic,
    pipelineSearchEvidence,
    pipelineGenerateItemCards,
    pipelineDraftArticle,
    pipelineScoreEditorialQA,
    pipelineGenerateStyleDNA,
    pipelineVisualIntelligence,
} from "./lib/pipeline";
import { generateImage } from "./lib/ai";

console.log("Starting PinListicle BullMQ Worker...");

// Default to local redis if REDIS_URL isn't set
const redisConnection = process.env.REDIS_URL ? 
    new URL(process.env.REDIS_URL) : 
    { host: "localhost", port: 6379 };


interface ArticleDraft {
    listicle_items: Array<{
        image_prompt: string;
    }>;
}

interface WorkerState {
    brief?: unknown;
    evidence_pack?: unknown;
    style_dna?: unknown;
    visual_dna_applied?: boolean; // flag: have we run Visual Intelligence?
    item_cards?: Array<{
        image_prompt_seed: {
            subject: string;
            setting: string;
            shot: string;
            lighting: string;
            camera: string;
            engineered_image_prompt?: string; // set by Visual Intelligence stage
        };
        visual_dna?: unknown;
    }>;
    article_draft?: ArticleDraft;
    qa_score?: {
        pass: boolean;
        overall: number;
        note?: string;
        soft_fail_note?: string;
        weak_sections?: string[];
    };
    image_results?: string[];
}

const worker = new Worker<PublishPipelineData>(
    GENERATION_QUEUE_NAME,
    async (job: Job<PublishPipelineData>) => {
        const data = job.data;
        const targetToken = data.keyword || data.topic;
        console.log(`[Job ${job.id}] Processing for keyword: ${targetToken}`);
        
        // Initialize state
        data.pipeline_state = data.pipeline_state || {};
        const state = data.pipeline_state as WorkerState;

        try {
            await job.updateProgress(10);
            
            // S1: Brief / Classify
            if (!state.brief) {
                console.log(`[Job ${job.id}] S1: Classifying topic...`);
                state.brief = await pipelineClassifyTopic(targetToken, data.apiKey);
                await job.updateData(data); // persist state in redis
            }
            await job.updateProgress(20);

            // S2: Evidence Pack
            if (!state.evidence_pack && state.brief) {
                console.log(`[Job ${job.id}] S2: Gathering evidence via Grounded Search...`);
                state.evidence_pack = await pipelineSearchEvidence(targetToken, state.brief, data.apiKey);
                await job.updateData(data);
            }
            await job.updateProgress(30);

            // S2.5: Visual Intelligence — placed AFTER evidence pack but BEFORE item cards.
            // This pre-fetches and pools reference images so we have them ready for analysis.
            // (Note: item card enrichment happens after S4 completes below.)
            await job.updateProgress(30);

            // S3: Style DNA
            if (!state.style_dna && state.brief) {
                console.log(`[Job ${job.id}] S3: Generating Style DNA...`);
                state.style_dna = await pipelineGenerateStyleDNA(targetToken, state.brief, data.apiKey);
                await job.updateData(data);
            }
            await job.updateProgress(40);

            // S4: Item Cards
            if (!state.item_cards && state.brief && state.evidence_pack) {
                console.log(`[Job ${job.id}] S4: Generating ${data.count} Item Evidence Cards...`);
                // item_cards is an array as per ItemCardsSchema
                state.item_cards = (await pipelineGenerateItemCards(targetToken, data.count, state.brief, state.evidence_pack, data.apiKey, data.modelPrefix)) as WorkerState["item_cards"];
                await job.updateData(data);
            }
            await job.updateProgress(50);

            // S4.5: Visual Intelligence — enriches item cards with VisualDNA from real reference images
            if (!state.visual_dna_applied && state.item_cards && state.item_cards.length > 0) {
                console.log(`[Job ${job.id}] S4.5: Running Visual Intelligence on ${state.item_cards.length} item cards...`);
                try {
                    const enriched = await pipelineVisualIntelligence(
                        targetToken,
                        state.item_cards,
                        data.apiKey,
                        state.style_dna
                    );
                    if (enriched && enriched.length > 0) {
                        state.item_cards = enriched as WorkerState["item_cards"];
                        console.log(`[Job ${job.id}] S4.5: Visual Intelligence complete — ${enriched.length} cards enriched with VisualDNA.`);
                    }
                } catch (visErr: unknown) {
                    const msg = visErr instanceof Error ? visErr.message : "Unknown error";
                    console.warn(`[Job ${job.id}] S4.5: Visual Intelligence non-fatal error: ${msg}. Continuing with seed-based prompts.`);
                }
                state.visual_dna_applied = true;
                await job.updateData(data);
            }
            await job.updateProgress(62);

            // S5: Draft Article
            if (!state.article_draft && state.brief && state.item_cards && state.evidence_pack) {
                console.log(`[Job ${job.id}] S5: Drafting Article from Cards...`);
                state.article_draft = (await pipelineDraftArticle(targetToken, data.tone, state.brief, state.item_cards as any, state.evidence_pack, data.apiKey, data.modelPrefix)) as ArticleDraft;
                await job.updateData(data);
            }
            await job.updateProgress(75);


            // S6: Quality Assurance (soft-gate: warns but does NOT fail the job)
            if (!state.qa_score && state.article_draft && state.item_cards) {
                console.log(`[Job ${job.id}] S6: Running Editorial QA Scorer...`);
                try {
                    state.qa_score = (await pipelineScoreEditorialQA(state.article_draft, state.item_cards as any, data.apiKey)) as WorkerState["qa_score"];
                } catch (qaErr: unknown) {
                    const msg = qaErr instanceof Error ? qaErr.message : "Unknown error";
                    console.warn(`[Job ${job.id}] QA scorer non-fatal error: ${msg}. Continuing.`);
                    state.qa_score = { pass: true, overall: 0, note: "QA skipped due to scorer error" };
                }
                if (state.qa_score && !state.qa_score.pass) {
                    // Soft-warn only — don't fail the job
                    console.warn(`[Job ${job.id}] QA soft-fail. Score: ${state.qa_score.overall}. Publishing anyway.`);
                    state.qa_score.soft_fail_note = `QA flagged: ${state.qa_score.weak_sections?.join(", ")}`;
                }
                await job.updateData(data);
            }
            await job.updateProgress(80);

            // S7: Images Generation
            if (!state.image_results) {
                console.log(`[Job ${job.id}] S7: Generating images using Master Structure...`);
                state.image_results = [];
                const items = state.article_draft?.listicle_items || [];
                
                for (let i = 0; i < items.length; i++) {
                    const item = items[i];
                    console.log(`[Job ${job.id}] Generating image ${i + 1}/${items.length}...`);
                    
                    // Use the image_prompt directly from the drafted article (Master Structure)
                    const b64 = await generateImage({ 
                        prompt: item.image_prompt, 
                        apiKey: data.apiKey 
                    });
                    state.image_results.push(b64);
                }
                await job.updateData(data);
            }
            await job.updateProgress(100);

            console.log(`[Job ${job.id}] Pipeline Success!`);
            return data;
            
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : "Unknown error";
            console.error(`[Job ${job.id}] Error: ${msg}`);
            // Let it bubble up so BullMQ handles exponential backoff retries automatically!
            throw error;
        }
    },
    {
        connection: redisConnection as any,
        concurrency: 2, // process up to 2 heavy LLM pipelines at once
    }
);

worker.on("completed", (job) => {
    console.log(`Job ${job.id} has completed successfully.`);
});

worker.on("failed", (job, err) => {
    console.log(`Job ${job?.id} has failed with ${err.message}`);
});
