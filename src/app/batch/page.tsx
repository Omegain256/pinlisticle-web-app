/* eslint-disable */
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
type ImageMode = "ai" | "web";

interface QueueRow {
    id: string;
    keyword: string;
    tone: Tone;
    count: number;
    seoKeyword: string;
    amazonTag: string;
    imageMode: ImageMode;
    status: "queued" | "processing" | "success" | "error";
    message?: string;
    articleId?: string;
    jobId?: string;
    category?: "fashion" | "beauty";
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
    imageMode,
    onImageModeChange,
    category,
    onCategoryChange,
    onNext,
}: {
    value: string;
    onChange: (v: string) => void;
    batchAmazonTag: string;
    onBatchAmazonTagChange: (v: string) => void;
    imageMode: ImageMode;
    onImageModeChange: (v: ImageMode) => void;
    category: "fashion" | "beauty";
    onCategoryChange: (v: "fashion" | "beauty") => void;
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

            {/* Category Selection */}
            <div className="glass-panel p-6">
                <div className="mb-4">
                    <label className="text-sm font-semibold text-slate-800">Content Category</label>
                    <p className="text-xs text-slate-500 mt-0.5">Select the aesthetic focus for this batch.</p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {(["fashion", "beauty"] as const).map(cat => (
                        <label
                            key={cat}
                            className={`flex items-start gap-3 p-4 rounded-xl border-2 cursor-pointer transition-all ${
                                category === cat
                                    ? "border-purple-500 bg-purple-50"
                                    : "border-slate-200 bg-white hover:border-slate-300"
                            }`}
                        >
                            <input
                                type="radio"
                                name="category"
                                value={cat}
                                checked={category === cat}
                                onChange={() => onCategoryChange(cat)}
                                className="mt-0.5 accent-purple-600"
                            />
                            <div>
                                <p className="text-sm font-semibold text-slate-800 capitalize">
                                    {cat === "fashion" ? "👗 Fashion" : "✨ Beauty"}
                                </p>
                                <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                                    {cat === "fashion"
                                        ? "Full-body outfit focus, style combinations, and wardrobe concepts."
                                        : "Macro detailing, hairstyles, nail precision, and makeup applications."
                                    }
                                </p>
                            </div>
                        </label>
                    ))}
                </div>
            </div>

            {/* Image Source */}
            <div className="glass-panel p-6">
                <div className="mb-4">
                    <label className="text-sm font-semibold text-slate-800">Image Source</label>
                    <p className="text-xs text-slate-500 mt-0.5">Choose how images are sourced for each article in this batch.</p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {(["ai", "web"] as ImageMode[]).map(mode => (
                        <label
                            key={mode}
                            className={`flex items-start gap-3 p-4 rounded-xl border-2 cursor-pointer transition-all ${
                                imageMode === mode
                                    ? "border-purple-500 bg-purple-50"
                                    : "border-slate-200 bg-white hover:border-slate-300"
                            }`}
                        >
                            <input
                                type="radio"
                                name="imageMode"
                                value={mode}
                                checked={imageMode === mode}
                                onChange={() => onImageModeChange(mode)}
                                className="mt-0.5 accent-purple-600"
                            />
                            <div>
                                <p className="text-sm font-semibold text-slate-800">
                                    {mode === "ai" ? "🤖 AI Generated" : "🌐 Web Search"}
                                </p>
                                <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                                    {mode === "ai"
                                        ? "Imagen 4 generates original photorealistic outfit photos."
                                        : "Finds real photos from competitor fashion blogs. Each image includes source attribution."
                                    }
                                </p>
                            </div>
                        </label>
                    ))}
                </div>
            </div>

            <div className="flex justify-end">
                <button
                    onClick={onNext}
                    disabled={keywordCount === 0}
                    className="premium-button premium-button-primary gap-2 h-11 px-7 text-sm"
                >
                    Preview &amp; Edit Queue <ChevronRight size={16} />
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
                        <h2 className="text-sm font-semibold text-slate-800">Review &amp; Edit Queue</h2>
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
                                <th>Images</th>
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
                                    <td className="min-w-[90px]">
                                        <select
                                            value={row.imageMode}
                                            onChange={(e) => onChange(row.id, "imageMode", e.target.value as ImageMode)}
                                            className="premium-input text-xs h-8 pr-2"
                                        >
                                            <option value="ai">🤖 AI</option>
                                            <option value="web">🌐 Web</option>
                                        </select>
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
                                <th>Images</th>
                                <th>Status</th>
                                <th>Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((row) => (
                                <tr key={row.id}>
                                    <td className="font-medium text-slate-800 text-xs">{row.keyword}</td>
                                    <td className="text-xs text-slate-500">{row.tone}</td>
                                    <td className="text-xs text-slate-500">{row.imageMode === "web" ? "🌐 Web" : "🤖 AI"}</td>
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
    const [imageMode, setImageMode] = useState<ImageMode>("ai");
    const [category, setCategory] = useState<"fashion" | "beauty">("fashion");

    // Step 2 state
    const [rows, setRows] = useState<QueueRow[]>([]);

    // Step 3 state
    const [isProcessing, setIsProcessing] = useState(false);
    const [progress, setProgress] = useState(0);
    // Track active stream controller so it can be aborted on navigation
    const [activeController, setActiveController] = useState<AbortController | null>(null);

    // Abort any in-flight stream when the component unmounts (page navigation)
    useEffect(() => {
        return () => { activeController?.abort(); };
    }, [activeController]);

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
            imageMode,
            category,
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

        for (let i = 0; i < current.length; i++) {
            if (current[i].status !== "queued") continue;

            current[i] = { ...current[i], status: "processing", message: "Starting pipeline…" };
            setRows([...current]);

            try {
                const controller = new AbortController();
                setActiveController(controller);

                const response = await fetch('/api/batch/submit', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    signal: controller.signal,
                    body: JSON.stringify({
                        topic: current[i].keyword,
                        keyword: current[i].seoKeyword || current[i].keyword,
                        tone: current[i].tone,
                        count: current[i].count,
                        apiKey,
                        modelPrefix: modelToUse,
                        amazonTag: current[i].amazonTag,
                        imageMode: current[i].imageMode,
                        category: current[i].category || "fashion",
                    })
                });

                if (!response.ok || !response.body) {
                    throw new Error(`Server error (HTTP ${response.status}) — check Render logs.`);
                }

                // ── Read the SSE stream line by line ────────────────────────────
                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let buffer = "";
                let finalData: any = null;

                streamLoop: while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    buffer += decoder.decode(value, { stream: true });
                    const chunks = buffer.split("\n\n");
                    buffer = chunks.pop() ?? "";

                    for (const chunk of chunks) {
                        const eventMatch = chunk.match(/^event: (\w+)/m);
                        const dataMatch  = chunk.match(/^data: (.+)$/m);
                        if (!dataMatch) continue;

                        let payload: any;
                        try { payload = JSON.parse(dataMatch[1]); } catch { continue; }

                        const eventType = eventMatch?.[1];
                        if (eventType === "progress") {
                            current[i] = { ...current[i], message: payload.message || "Working…" };
                            setRows([...current]);
                        } else if (eventType === "done") {
                            finalData = payload;
                            break streamLoop;
                        } else if (eventType === "error") {
                            throw new Error(payload.error || "Pipeline error");
                        }
                    }
                }

                if (!finalData?.success) throw new Error(finalData?.error || "Pipeline returned no result.");

                const articleData = finalData.article;
                if (!articleData) throw new Error("Pipeline returned no article data.");

                // Strip raw base64 image data before saving to IndexedDB.
                // These blobs are the primary cause of OOM (Error code: 5).
                // The HTML already has the images embedded or WP URLs are stored separately.
                const articleDataStripped = {
                    ...articleData,
                    featured_image_base64: undefined,
                    listicle_items: (articleData.listicle_items || []).map((item: any) => ({
                        ...item,
                        image_base64: undefined,
                        web_image: item.web_image ? {
                            ...item.web_image,
                            image_base64: "[STRIPPED]", // keep attribution but drop the blob
                        } : undefined,
                    })),
                };

                const html = buildArticleHtml(articleData, current[i].amazonTag, settings.internalLinks);
                const articleId = `article-${Date.now()}-${i}`;
                await saveArticle({
                    id: articleId,
                    topic: current[i].keyword,
                    tone: current[i].tone,
                    count: current[i].count,
                    generatedAt: new Date().toISOString(),
                    status: "success",
                    data: articleDataStripped,
                    html,
                } as any);
                current[i] = { ...current[i], status: "success", message: "Done ✓", articleId };
                setActiveController(null);

            } catch (e: any) {
                current[i] = { ...current[i], status: "error", message: e.message };
            }

            setProgress(Math.round(((i + 1) / current.length) * 100));
            setRows([...current]);
        }

        setIsProcessing(false);
        const successCount = current.filter(r => r.status === "success").length;
        const errorCount = current.filter(r => r.status === "error").length;
        const firstError = current.find(r => r.status === "error")?.message;

        if (successCount > 0 && errorCount === 0) toast.success("Batch complete! All articles saved to library.");
        else if (successCount > 0 && errorCount > 0) toast.success(`Batch partial: ${successCount} saved, ${errorCount} failed. ${firstError ? `Error: ${firstError}` : ""}`);
        else toast.error(`Batch failed. ${firstError || "Unknown error — check Render logs."}`);
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
                    imageMode={imageMode}
                    onImageModeChange={setImageMode}
                    category={category}
                    onCategoryChange={setCategory}
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
