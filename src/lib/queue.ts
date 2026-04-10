/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { Queue, ConnectionOptions } from "bullmq";

const redisConnection: ConnectionOptions = {
    host: process.env.REDIS_HOST || "localhost",
    port: parseInt(process.env.REDIS_PORT || "6379"),
    username: process.env.REDIS_USERNAME || "default",
    password: process.env.REDIS_PASSWORD || "",
    tls: process.env.REDIS_TLS === "true" ? {} : undefined,
    maxRetriesPerRequest: null,
    retryStrategy(times) {
        if (times > 3) {
            console.error("Redis connection failed. Max retries reached.");
            return null; // Stop retrying and throw error
        }
        return Math.min(times * 500, 2000);
    }
};

// Fallback to REDIS_URL if provided (common on Render)
if (process.env.REDIS_URL) {
    try {
        const url = new URL(process.env.REDIS_URL);
        redisConnection.host = url.hostname;
        redisConnection.port = parseInt(url.port);
        redisConnection.username = url.username;
        redisConnection.password = url.password;
        if (url.protocol === 'rediss:') {
            redisConnection.tls = {};
        }
    } catch (e) {
        console.error("Invalid REDIS_URL provided:", process.env.REDIS_URL);
    }
}

// Define Job Payload Types for strict typings in the worker Let's define
export interface PublishPipelineData {
    topic: string;
    keyword?: string;
    tone: string;
    count: number;
    apiKey: string; 
    modelPrefix: "pro" | "lite";
    
    // Internal state carried across jobs within a pipeline execution
    pipeline_state?: {
        brief?: any;
        evidence_pack?: any;
        item_cards?: any[];
        article_draft?: any;
        qa_score?: any;
        style_dna?: any;
        image_results?: string[];
    };
    
    // If the entire article generation failed or we want to abort early
    aborted?: boolean;
    abort_reason?: string;
}

export const GENERATION_QUEUE_NAME = "pinlisticle-generation";

// Singleton queue instance
export const generationQueue = new Queue<PublishPipelineData>(GENERATION_QUEUE_NAME, {
    connection: redisConnection,
});

// VERY IMPORTANT: Catch background Redis errors so Node doesn't trigger an Unhandled Exception crash
// which causes Next.js to return the 500 HTML `<DOCTYPE...` page instead of our JSON.
generationQueue.on('error', (error) => {
    console.error("BullMQ generationQueue background error:", error.message);
});

/**
 * Helper to dispatch a full generation pipeline as a single parent job,
 * or we use BullMQ flows if we want to separate them.
 * Given we want independent retries, using BullMQ Flows (FlowProducer) is best,
 * but for simplicity and passing state easily, a single job that executes 
 * steps sequentially out of the worker.ts is sometimes easier.
 * However, the user specifically asked for an independent retryable job graph.
 * We'll use BullMQ Flows to sequence them if needed, or dispatch child jobs.
 */
