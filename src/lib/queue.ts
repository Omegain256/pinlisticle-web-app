/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { Queue } from "bullmq";
import Redis from "ioredis";

// ─────────────────────────────────────────────────────────────────────────────
// LAZY REDIS FACTORY
// NEVER create a Redis instance at module evaluation time.
// Next.js evaluates every imported module during static build/prerender —
// creating a socket here would fire connect attempts immediately, before any
// environment variables are reliably set and before the network is reachable.
// Instead, export a factory that callers invoke at request time.
// ─────────────────────────────────────────────────────────────────────────────

export function createRedisClient(): Redis {
    if (process.env.REDIS_URL) {
        return new Redis(process.env.REDIS_URL, {
            maxRetriesPerRequest: null,
            family: 0,           // support both IPv4 and IPv6
            tls: process.env.REDIS_URL.startsWith("rediss")
                ? { rejectUnauthorized: false }
                : undefined,
            retryStrategy(times) {
                if (times > 20) return null; // give up after ~100 s
                return Math.min(times * 1000, 5000);
            },
            reconnectOnError(err) {
                // Reconnect on READONLY errors (common on Redis replicas)
                return err.message.includes("READONLY");
            },
        });
    }

    return new Redis({
        host: process.env.REDIS_HOST || "localhost",
        port: parseInt(process.env.REDIS_PORT || "6379", 10),
        username: process.env.REDIS_USERNAME || "default",
        password: process.env.REDIS_PASSWORD || "",
        tls: process.env.REDIS_TLS === "true" ? { rejectUnauthorized: false } : undefined,
        maxRetriesPerRequest: null,
        retryStrategy(times) {
            if (times > 20) return null;
            return Math.min(times * 1000, 5000);
        },
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// LAZY QUEUE SINGLETON
// The Queue is only constructed once, on first demand, at actual request time.
// ─────────────────────────────────────────────────────────────────────────────

let _queue: Queue<PublishPipelineData> | null = null;

export function getGenerationQueue(): Queue<PublishPipelineData> {
    if (!_queue) {
        _queue = new Queue<PublishPipelineData>(GENERATION_QUEUE_NAME, {
            connection: createRedisClient(),
        });

        // Swallow background errors so they never crash the Next.js process.
        // These fire when Redis temporarily drops the heartbeat connection.
        _queue.on("error", (err) => {
            console.error("BullMQ generationQueue background error:", err.message);
        });
    }
    return _queue;
}

// Keep the old name as a compatibility shim so existing imports don't break.
// It now delegates to the lazy getter instead of holding an open socket.
/** @deprecated Use getGenerationQueue() instead */
export const generationQueue = {
    getJob: (...args: any[]) => getGenerationQueue().getJob(...args as [any]),
    add:    (...args: any[]) => getGenerationQueue().add(...args as [any, any]),
    on:     (...args: any[]) => getGenerationQueue().on(...args as [any, any]),
} as unknown as Queue<PublishPipelineData>;

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export const GENERATION_QUEUE_NAME = "pinlisticle-generation";

export interface PublishPipelineData {
    topic: string;
    keyword?: string;
    tone: string;
    count: number;
    apiKey: string;
    modelPrefix: "pro" | "lite";
    category?: "fashion" | "beauty";

    pipeline_state?: {
        brief?: any;
        evidence_pack?: any;
        item_cards?: any[];
        article_draft?: any;
        qa_score?: any;
        style_dna?: any;
        image_results?: string[];
    };

    aborted?: boolean;
    abort_reason?: string;
}
