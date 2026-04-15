/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { Queue } from "bullmq";
import Redis from "ioredis";

// Create a robust IORedis client using the full URL, avoiding manual URL property extraction bugs.
export const redisConnection = process.env.REDIS_URL
    ? new Redis(process.env.REDIS_URL, {
        maxRetriesPerRequest: null,
        family: 0, // Force IPv4/IPv6 compatibility
        tls: process.env.REDIS_URL.startsWith('rediss') ? { rejectUnauthorized: false } : undefined,
        retryStrategy(times) {
            if (times > 50) {
                console.error("Redis connection failed. Max retries reached.");
                return null;
            }
            return Math.min(times * 1000, 5000);
        }
    })
    : new Redis({
        host: process.env.REDIS_HOST || "localhost",
        port: parseInt(process.env.REDIS_PORT || "6379", 10),
        username: process.env.REDIS_USERNAME || "default",
        password: process.env.REDIS_PASSWORD || "",
        tls: process.env.REDIS_TLS === "true" ? { rejectUnauthorized: false } : undefined,
        maxRetriesPerRequest: null,
        retryStrategy(times) {
            if (times > 50) return null;
            return Math.min(times * 1000, 5000);
        }
    });

// Define Job Payload Types for strict typings in the worker Let's define
export interface PublishPipelineData {
    topic: string;
    keyword?: string;
    tone: string;
    count: number;
    apiKey: string; 
    modelPrefix: "pro" | "lite";
    category?: "fashion" | "beauty";
    
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
