"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import {
    PlayCircle,
    CheckCircle2,
    Clock,
    XCircle,
    Globe,
    ChevronRight,
    ChevronLeft,
    Trash2,
    RefreshCw,
    ExternalLink,
    FileText,
    Plus,
} from "lucide-react";
import Link from "next/link";
import {
    saveArticle,
    getArticle,
    buildArticleHtml,
    type GeneratedArticle,
} from "@/lib/articleStore";

// ─── Types ────────────────────────────────────────────────────

type Tone = "Casual" | "Professional" | "Fun" | "Minimal";

interface QueueRow {
    id: string;
    keyword: string;
    tone: Tone;
    count: number;
    seoKeyword: string;
    amazonTag: string;
    status: "queued" | "processing" | "success" | "error";
    message?: string;
    articleId?: string;
    jobId?: string;
}

// ─── Helpers ──────────────────────────────────────────────────

function getSettings() {
    try {
        return JSON.parse(localStorage.getItem("pinlisticle_settings") || "{}");
    } catch {
        return {};
    }
}

async function compressImageBase64(base64: string, maxWidth = 800, quality = 0.7): Promise<string> {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            let width = img.width;
            let height = img.height;
            if (width > maxWidth) {
                height = Math.round((height * maxWidth) / width);
                width = maxWidth;
            }
            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext("2d");
            if (!ctx) return resolve(base64);
            ctx.drawImage(img, 0, 0, width, height);
            resolve(canvas.toDataURL("image/jpeg", quality).split(",")[1]);
        };
        img.onerror = () => resolve(base64);
        img.src = `data:image/jpeg;base64,${base64}`;
    });
}

// ─── Sub-components ───────────────────────────────────────────

function StepIndicator({ step }: { step: 1 | 2 | 3 }) {
    const steps = ["Keywords", "Review & Edit", "Generating"];
    return (
        <div className="step-indicator">
            {steps.map((label, i) => {
                const n = i + 1;
                const state =
                    step > n ? "done" : step === n ? "active" : "upcoming";
                return (
                    <div key={n} className="contents">
                        <div className={`step-item ${state}`}>
                            <div className="step-circle">
                                {state === "done" ? <CheckCircle2 size={14} /> : n}
                            </div>
                            <span className="hidden sm:inline">{label}</span>
                        </div>
                        {i < steps.length - 1 && (
                            <div className={`step-connector ${state === "done" ? "done" : ""}`} />
                        )}
                    </div>
                );
            })}
        </div>
    );
}

function StatusBadge({ status, message }: { status: QueueRow["status"]; message?: string }) {
    if (status === "queued")
        return <span className="badge badge-queued"><Clock size={10} /> Queued</span>;
    if (status === "processing")
        return <span className="badge badge-processing"><span className="spinner" /> Generating…</span>;
    if (status === "success")
        return <span className="badge badge-success"><CheckCircle2 size={10} /> Done</span>;
    return (
        <span className="badge badge-error" title={message}>
            <XCircle size={10} /> Failed
        </span>
    );
}

// ─── Step 1: Keywords ─────────────────────────────────────────

function Step1({
    value,
    onChange,
    batchAmazonTag,
    onBatchAmazonTagChange,
    onNext,
}: {
    value: string;
    onChange: (v: string) => void;
    batchAmazonTag: string;
    onBatchAmazonTagChange: (v: string) => void;
    onNext: () => void;
}) {
    const keywordCount = value.split("\n").filter((l) => l.trim().length > 0).length;

    return (
        <div className="space-y-6 animate-fade-in">
            {/* Explainer */}
            <div className="glass-panel p-5 border-l-4 border-l-purple-500">
                <p className="text-sm text-slate-700 leading-relaxed font-medium">
                    Use this mode to generate any number of articles at once.
                </p>
                <p className="text-sm text-slate-500 mt-1 leading-relaxed">
                    They are created in the background which means you can leave and come back later to see the results. Once generated, head over to the Articles Library to visually review and perfect the article before manually publishing to your WordPress site.
                </p>
            </div>

            {/* Keywords input */}
            <div className="glass-panel p-6">
                <div className="flex items-center justify-between mb-1">
                    <label className="text-sm font-semibold text-slate-800">
                        Target Keywords
                    </label>
                    {keywordCount > 0 && (
                        <span className="badge badge-primary">
                            {keywordCount} keyword{keywordCount !== 1 ? "s" : ""}
                        </span>
                    )}
                </div>
                <p className="text-xs text-slate-500 mb-3">
                    Get started by providing an unlimited number of keywords. Put each keyword on a new line — an article will be written for each.
                </p>
                <textarea
                    className="premium-input"
                    style={{ height: "11rem", resize: "vertical", paddingTop: "0.625rem", paddingBottom: "0.625rem" }}
                    placeholder={"Best indoor plants for apartments\nEasy vegan dinner recipes\nFall fashion trends for 2025\nMinimalist home office setup ideas"}
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                />
            </div>

            {/* Amazon Tag input */}
            <div className="glass-panel p-6">
                <div className="flex items-center justify-between mb-1">
                    <label className="text-sm font-semibold text-slate-800">
                        Batch Amazon Affiliate Tag
                    </label>
                </div>
                <p className="text-xs text-slate-500 mb-3">
                    Applied to all articles in this batch. You can edit this per-article in the next step.
                </p>
                <input
                    type="text"
                    className="premium-input"
                    placeholder="e.g. mystore-20"
                    value={batchAmazonTag}
                    onChange={(e) => onBatchAmazonTagChange(e.target.value)}
                />
            </div>

            <div className="flex justify-end">
                <button
                    onClick={onNext}
                    disabled={keywordCount === 0}
                    className="premium-button premium-button-primary gap-2 h-11 px-7 text-sm"
                >
                    Preview & Edit Queue <ChevronRight size={16} />
                </button>
            </div>
        </div>
    );
}

// ─── Step 2: Review & Edit ────────────────────────────────────

function Step2({
    rows,
    onChange,
    onDelete,
    onBack,
    onStart,
}: {
    rows: QueueRow[];
    onChange: (id: string, field: keyof QueueRow, value: any) => void;
    onDelete: (id: string) => void;
    onBack: () => void;
    onStart: () => void;
}) {
    return (
        <div className="space-y-6 animate-fade-in">
            <div className="glass-panel overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                    <div>
                        <h2 className="text-sm font-semibold text-slate-800">Review & Edit Queue</h2>
                        <p className="text-xs text-slate-500 mt-0.5">
                            Adjust tone, item count, or SEO keyword for each article before generating.
                        </p>
                    </div>
                    <span className="badge badge-primary">{rows.length} articles</span>
                </div>

                <div className="overflow-x-auto">
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>Keyword / Topic</th>
                                <th>SEO Keyword</th>
                                <th>Amazon Tag</th>
                                <th>Tone</th>
                                <th># Items</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((row) => (
                                <tr key={row.id}>
                                    <td className="min-w-[180px]">
                                        <input
                                            value={row.keyword}
                                            onChange={(e) => onChange(row.id, "keyword", e.target.value)}
                                            className="premium-input text-xs h-8"
                                            placeholder="Keyword / topic"
                                        />
                                    </td>
                                    <td className="min-w-[160px]">
                                        <input
                                            value={row.seoKeyword}
                                            onChange={(e) => onChange(row.id, "seoKeyword", e.target.value)}
                                            className="premium-input text-xs h-8"
                                            placeholder="Optional override"
                                        />
                                    </td>
                                    <td className="min-w-[120px]">
                                        <input
                                            value={row.amazonTag}
                                            onChange={(e) => onChange(row.id, "amazonTag", e.target.value)}
                                            className="premium-input text-xs h-8"
                                            placeholder="Tag"
                                        />
                                    </td>
                                    <td className="min-w-[120px]">
                                        <select
                                            value={row.tone}
                                            onChange={(e) => onChange(row.id, "tone", e.target.value)}
                                            className="premium-input text-xs h-8 pr-2"
                                        >
                                            {(["Casual", "Professional", "Fun", "Minimal"] as Tone[]).map((t) => (
                                                <option key={t} value={t}>{t}</option>
                                            ))}
                                        </select>
                                    </td>
                                    <td className="min-w-[80px]">
                                        <input
                                            type="number"
                                            min={1}
                                            max={20}
                                            value={row.count}
                                            onChange={(e) => onChange(row.id, "count", Number(e.target.value))}
                                            className="premium-input text-xs h-8 w-16"
                                        />
                                    </td>
                                    <td>
                                        <button
                                            onClick={() => onDelete(row.id)}
                                            className="premium-button premium-button-danger h-8 w-8 p-0"
                                            title="Remove"
                                        >
                                            <Trash2 size={13} />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            <div className="flex justify-between">
                <button
                    onClick={onBack}
                    className="premium-button premium-button-ghost gap-2 h-10 text-sm"
                >
                    <ChevronLeft size={16} /> Back
                </button>
                <button
                    onClick={onStart}
                    disabled={rows.length === 0}
                    className="premium-button premium-button-primary gap-2 h-11 px-7 text-sm"
                >
                    <PlayCircle size={16} /> Start Generation
                </button>
            </div>
        </div>
    );
}

// ─── Step 3: Progress ─────────────────────────────────────────

function Step3({
    rows,
    progress,
    isProcessing,
    onRetry,
    onReset,
}: {
    rows: QueueRow[];
    progress: number;
    isProcessing: boolean;
    onRetry: (id: string) => void;
    onReset: () => void;
}) {
    const done = rows.filter((r) => r.status === "success").length;
    const failed = rows.filter((r) => r.status === "error").length;

    return (
        <div className="space-y-6 animate-fade-in">
            {/* Progress summary */}
            <div className="glass-panel p-5">
                <div className="flex items-center justify-between mb-2">
                    <h2 className="text-sm font-semibold text-slate-800">
                        {isProcessing ? "Generating articles…" : "Batch complete"}
                    </h2>
                    <span className="text-sm font-bold text-purple-600">{progress}%</span>
                </div>
                <div className="progress-bar-track mb-3">
                    <div className="progress-bar-fill" style={{ width: `${progress}%` }} />
                </div>
                <div className="flex gap-4 text-xs text-slate-500">
                    <span><strong className="text-slate-800">{rows.length}</strong> total</span>
                    <span><strong className="text-emerald-600">{done}</strong> done</span>
                    {failed > 0 && <span><strong className="text-red-600">{failed}</strong> failed</span>}
                </div>
            </div>

            {/* Queue table */}
            <div className="glass-panel overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>Keyword</th>
                                <th>Tone</th>
                                <th>Status</th>
                                <th>Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((row) => (
                                <tr key={row.id}>
                                    <td className="font-medium text-slate-800 text-xs">{row.keyword}</td>
                                    <td className="text-xs text-slate-500">{row.tone}</td>
                                    <td>
                                        <StatusBadge status={row.status} message={row.message} />
                                        {row.status === "error" && (
                                            <p className="text-xs text-red-500 mt-1 max-w-xs truncate">{row.message}</p>
                                        )}
                                    </td>
                                    <td>
                                        <div className="flex gap-1.5">
                                            {row.status === "success" && row.articleId && (
                                                <Link
                                                    href={`/articles?highlight=${row.articleId}`}
                                                    className="premium-button premium-button-ghost h-7 text-xs gap-1 px-2"
                                                >
                                                    <ExternalLink size={11} /> View
                                                </Link>
                                            )}
                                            {row.status === "error" && (
                                                <button
                                                    onClick={() => onRetry(row.id)}
                                                    disabled={isProcessing}
                                                    className="premium-button premium-button-ghost h-7 text-xs gap-1 px-2"
                                                >
                                                    <RefreshCw size={11} /> Retry
                                                </button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {!isProcessing && (
                <div className="flex justify-between items-center">
                    <Link href="/articles" className="premium-button premium-button-secondary gap-2 h-10 text-sm">
                        <FileText size={14} /> View Articles Library
                    </Link>
                    <button onClick={onReset} className="premium-button premium-button-ghost gap-2 h-10 text-sm">
                        <Plus size={14} /> New Batch
                    </button>
                </div>
            )}
        </div>
    );
}

// ─── Main Page ────────────────────────────────────────────────

export default function BatchPage() {
    const [step, setStep] = useState<1 | 2 | 3>(1);

    // Step 1 state
    const [keywordText, setKeywordText] = useState("");
    const [batchAmazonTag, setBatchAmazonTag] = useState("");
    const [selectedModel, setSelectedModel] = useState<"pro" | "lite">("pro");

    // Step 2 state
    const [rows, setRows] = useState<QueueRow[]>([]);

    // Step 3 state
    const [isProcessing, setIsProcessing] = useState(false);
    const [progress, setProgress] = useState(0);

    // Pre-fill from settings
    useEffect(() => {
        const s = getSettings();
        if (s.preferredModel === "lite") setSelectedModel("lite");
        if (s.amazonTag) setBatchAmazonTag(s.amazonTag);
    }, []);

    // Step 1 → 2
    const handleKeywordsNext = () => {
        const lines = keywordText.split("\n").filter((l) => l.trim().length > 0);
        if (!lines.length) { toast.error("Enter at least one keyword."); return; }

        const settings = getSettings();
        const newRows: QueueRow[] = lines.map((line, i) => ({
            id: `row-${Date.now()}-${i}`,
            keyword: line.trim(),
            tone: "Casual",
            count: 1,
            seoKeyword: "",
            amazonTag: batchAmazonTag,
            status: "queued",
        }));



        if (!settings.geminiKey) {
            toast.error("Gemini API key is missing. Go to Settings first.");
            return;
        }

        setRows(newRows);
        setStep(2);
    };

    // Edit a row field
    const handleRowChange = (id: string, field: keyof QueueRow, value: any) => {
        setRows((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
    };

    const handleRowDelete = (id: string) =>
        setRows((prev) => prev.filter((r) => r.id !== id));

    // Step 2 → 3: start generation
    const handleStart = () => { setStep(3); processQueue(rows); };

    const processQueue = async (items: QueueRow[]) => {
        setIsProcessing(true);
        const current: QueueRow[] = items.map((r) => ({ ...r, status: "queued" as QueueRow["status"] }));
        setRows([...current]);

        const settings = getSettings();
        const apiKey = settings.geminiKey;
        const modelToUse = selectedModel;

        // 1. Dispatch jobs
        for (let i = 0; i < current.length; i++) {
            if (current[i].status !== "queued") continue;
            
            try {
                current[i] = { ...current[i], status: "processing", message: "Dispatching..." };
                setRows([...current]);

                const response = await fetch('/api/batch/submit', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        topic: current[i].keyword,
                        keyword: current[i].seoKeyword || current[i].keyword,
                        tone: current[i].tone,
                        count: current[i].count,
                        apiKey,
                        modelPrefix: modelToUse
                    })
                });
                const data = await response.json();
                
                if (data.success) {
                    current[i] = { ...current[i], jobId: data.jobId, message: "Queued..." };
                } else {
                    current[i] = { ...current[i], status: "error", message: data.error };
                }
            } catch (e: any) {
                current[i] = { ...current[i], status: "error", message: e.message };
            }
        }
        setRows([...current]);

        // 2. Poll progress
        let allDone = false;
        while (!allDone) {
            allDone = true;
            let completed = 0;
            
            for (let i = 0; i < current.length; i++) {
                const row = current[i];
                if (row.status === "success" || row.status === "error") {
                    completed++;
                    continue;
                }

                if (!row.jobId) {
                    current[i] = { ...current[i], status: "error", message: "No job ID attached" };
                    completed++;
                    continue;
                }

                allDone = false;

                try {
                    const res = await fetch(`/api/batch/status?jobId=${row.jobId}`);
                    const data = await res.json();
                    
                    if (data.success) {
                        if (data.status === 'completed') {
                            const result = data.result;
                            const articleData = result.pipeline_state.article_draft;
                            
                            if (articleData && result.pipeline_state.image_results) {
                                for (let j = 0; j < articleData.listicle_items.length; j++) {
                                    articleData.listicle_items[j].image_base64 = result.pipeline_state.image_results[j];
                                }
                                articleData.featured_image_base64 = result.pipeline_state.image_results[0];
                            }

                            const html = buildArticleHtml(articleData, row.amazonTag);
                            const articleId = `article-${Date.now()}-${i}`;
                            const article = {
                                id: articleId,
                                topic: row.keyword,
                                tone: row.tone,
                                count: row.count,
                                generatedAt: new Date().toISOString(),
                                status: "success",
                                data: articleData,
                                html,
                            };
                            await saveArticle(article as any);
                            current[i] = { ...current[i], status: "success", message: "Done", articleId };
                            completed++;
                        } else if (data.status === 'failed') {
                            current[i] = { ...current[i], status: "error", message: data.failedReason };
                            completed++;
                        } else {
                            current[i] = { ...current[i], message: `Progress: ${data.progress || 0}%` };
                        }
                    }
                } catch (e: any) {
                    // Ignore poll network error and retry next tick
                }
            }
            
            setRows([...current]);
            setProgress(Math.round((completed / current.length) * 100));
            
            if (!allDone) {
                await new Promise(r => setTimeout(r, 2000)); // poll every 2s
            }
        }

        setIsProcessing(false);
        const successCount = current.filter(r => r.status === "success").length;
        const errorCount = current.filter(r => r.status === "error").length;
        const firstError = current.find(r => r.status === "error")?.message;

        if (successCount > 0 && errorCount === 0) toast.success("Batch complete! All articles saved to library.");
        else if (successCount > 0 && errorCount > 0) toast.success(`Batch partial: ${successCount} saved, ${errorCount} failed. ${firstError ? `First error: ${firstError}` : ""}`);
        else toast.error(`Batch failed. ${firstError || "Check status column for details."}`);
    };

    // Retry a single failed item
    const handleRetry = (id: string) => {
        const target = rows.find((r) => r.id === id);
        if (!target) return;
        setIsProcessing(true);
        const updated = rows.map((r) => (r.id === id ? { ...r, status: "queued" as const } : r));
        setRows(updated);
        processQueue([{ ...target, status: "queued" }]);
    };

    const handleReset = () => {
        setStep(1);
        setKeywordText("");
        setRows([]);
        setProgress(0);
    };

    return (
        <div className="space-y-6 pb-12">
            <div>
                <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Batch Generator</h1>
                <p className="text-sm text-slate-500 mt-0.5">
                    Generate unlimited Pinterest-optimized listicles simultaneously.
                </p>
            </div>

            <StepIndicator step={step} />

            {step === 1 && (
                <Step1
                        value={keywordText}
                        onChange={setKeywordText}
                        batchAmazonTag={batchAmazonTag}
                        onBatchAmazonTagChange={setBatchAmazonTag}
                        onNext={handleKeywordsNext}
                    />
            )}

            {step === 2 && (
                <Step2
                    rows={rows}
                    onChange={handleRowChange}
                    onDelete={handleRowDelete}
                    onBack={() => setStep(1)}
                    onStart={handleStart}
                />
            )}

            {step === 3 && (
                <Step3
                    rows={rows}
                    progress={progress}
                    isProcessing={isProcessing}
                    onRetry={handleRetry}
                    onReset={handleReset}
                />
            )}
        </div>
    );
}
