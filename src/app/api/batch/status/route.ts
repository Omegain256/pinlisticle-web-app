import { NextRequest, NextResponse } from "next/server";
import { generationQueue } from "@/lib/queue";

export async function GET(req: NextRequest) {
    try {
        const jobId = req.nextUrl.searchParams.get("jobId");
        if (!jobId) {
            return NextResponse.json({ success: false, error: "Missing jobId" }, { status: 400 });
        }

        const job = await generationQueue.getJob(jobId);
        if (!job) {
            return NextResponse.json({ success: false, error: "Job not found" }, { status: 404 });
        }

        const state = await job.getState();
        const progress = job.progress;
        const failedReason = job.failedReason || "(no reason stored)";
        const stacktrace = job.stacktrace?.[0] || null;
        const returnvalue = job.returnvalue;
        const attemptsMade = job.attemptsMade;

        return NextResponse.json({
            success: true,
            status: state,
            progress,
            failedReason,
            stacktrace,
            attemptsMade,
            result: returnvalue
        });

    } catch (error: any) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
