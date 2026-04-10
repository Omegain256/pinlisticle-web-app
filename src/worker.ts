import { Worker, Job } from "bullmq";
import { GENERATION_QUEUE_NAME, PublishPipelineData } from "./lib/queue";
import {
    pipelineClassifyTopic,
    pipelineSearchEvidence,
    pipelineGenerateItemCards,
    pipelineDraftArticle,
    pipelineScoreEditorialQA,
    pipelineGenerateStyleDNA
} from "./lib/pipeline";
import { generateImage } from "./lib/ai";

console.log("Starting PinListicle BullMQ Worker...");

// Default to local redis if REDIS_URL isn't set
const redisConnection = process.env.REDIS_URL ? 
    new URL(process.env.REDIS_URL) : 
    { host: "localhost", port: 6379 };

const worker = new Worker<PublishPipelineData>(
    GENERATION_QUEUE_NAME,
    async (job: Job<PublishPipelineData>) => {
        const data = job.data;
        const targetToken = data.keyword || data.topic;
        console.log(`[Job ${job.id}] Processing for keyword: ${targetToken}`);
        
        // Initialize state
        data.pipeline_state = data.pipeline_state || {};
        const state = data.pipeline_state;

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
            if (!state.evidence_pack) {
                console.log(`[Job ${job.id}] S2: Gathering evidence via Grounded Search...`);
                state.evidence_pack = await pipelineSearchEvidence(targetToken, state.brief, data.apiKey);
                await job.updateData(data);
            }
            await job.updateProgress(30);

            // S3: Style DNA
            if (!state.style_dna) {
                console.log(`[Job ${job.id}] S3: Generating Style DNA...`);
                state.style_dna = await pipelineGenerateStyleDNA(targetToken, state.brief, data.apiKey);
                await job.updateData(data);
            }
            await job.updateProgress(40);

            // S4: Item Cards
            if (!state.item_cards) {
                console.log(`[Job ${job.id}] S4: Generating ${data.count} Item Evidence Cards...`);
                state.item_cards = await pipelineGenerateItemCards(targetToken, data.count, state.brief, state.evidence_pack, data.apiKey, data.modelPrefix);
                await job.updateData(data);
            }
            await job.updateProgress(50);

            // S5: Draft Article
            if (!state.article_draft) {
                console.log(`[Job ${job.id}] S5: Drafting Article from Cards...`);
                state.article_draft = await pipelineDraftArticle(targetToken, data.tone, state.brief, state.item_cards!, state.evidence_pack, data.apiKey, data.modelPrefix);
                await job.updateData(data);
            }
            await job.updateProgress(65);

            // S6: Quality Assurance (soft-gate: warns but does NOT fail the job)
            if (!state.qa_score) {
                console.log(`[Job ${job.id}] S6: Running Editorial QA Scorer...`);
                try {
                    state.qa_score = await pipelineScoreEditorialQA(state.article_draft, state.item_cards!, data.apiKey);
                } catch (qaErr: any) {
                    console.warn(`[Job ${job.id}] QA scorer non-fatal error: ${qaErr.message}. Continuing.`);
                    state.qa_score = { pass: true, overall: 0, note: "QA skipped due to scorer error" };
                }
                if (!state.qa_score?.pass) {
                    // Soft-warn only — don't fail the job
                    console.warn(`[Job ${job.id}] QA soft-fail. Score: ${state.qa_score?.overall}. Publishing anyway.`);
                    state.qa_score.soft_fail_note = `QA flagged: ${state.qa_score?.weak_sections?.join(", ")}`;
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
            
        } catch (error: any) {
            console.error(`[Job ${job.id}] Error: ${error.message}`);
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
