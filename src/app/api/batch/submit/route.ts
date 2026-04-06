import { NextRequest, NextResponse } from "next/server";
import { generationQueue, PublishPipelineData } from "@/lib/queue";

export async function POST(req: NextRequest) {
    try {
        const body: PublishPipelineData = await req.json();

        if (!body.topic && !body.keyword) {
            return NextResponse.json({ success: false, error: "Topic or keyword required" }, { status: 400 });
        }
        if (!body.apiKey) {
            return NextResponse.json({ success: false, error: "API Key required" }, { status: 400 });
        }

        // Enqueue the massive multi-stage job with automatic retries on rate limits
        const job = await generationQueue.add(
            `generate-${Date.now()}`,
            body,
            {
                attempts: 5,
                backoff: {
                    type: "exponential",
                    delay: 2000, 
                },
                removeOnComplete: { age: 120 }, // Keep for 2 min so UI can poll result
                removeOnFail: { count: 10 },      // Keep last 10 failed jobs for debugging
            }
        );

        return NextResponse.json({ success: true, jobId: job.id });
    } catch (error: any) {
        console.error("Queue submission error:", error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
