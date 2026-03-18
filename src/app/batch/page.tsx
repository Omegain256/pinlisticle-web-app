"use client";

import { useState, useEffect } from "react";
import { generateContent, generateImage } from "@/lib/ai";
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
    buildArticleHtml,
    type GeneratedArticle,
} from "@/lib/articleStore";

// ─── Types ────────────────────────────────────────────────────

type Integration = "none" | "wordpress";
type Tone = "Casual" | "Professional" | "Fun" | "Minimal";

interface QueueRow {
    id: string;
    keyword: string;
    tone: Tone;
    count: number;
    seoKeyword: string;
    status: "queued" | "processing" | "success" | "error";
    message?: string;
    articleId?: string;
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
    integration,
    onIntegrationChange,
    wpSites,
    selectedWpSite,
    onWpSiteChange,
    onNext,
}: {
    value: string;
    onChange: (v: string) => void;
    integration: Integration;
    onIntegrationChange: (v: Integration) => void;
    wpSites: any[];
    selectedWpSite: string;
    onWpSiteChange: (id: string) => void;
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
                    They are created in the background which means you can leave and come back later to see the results.
                    Even better, you can choose an integration to automatically create drafts in WordPress, Shopify, and more.
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

            {/* Integration selector */}
            <div className="glass-panel p-6">
                <label className="text-sm font-semibold text-slate-800 block mb-1">
                    Integration
                </label>
                <p className="text-xs text-slate-500 mb-3">
                    Choose how generated articles should be saved or published.
                </p>
                <div className="flex gap-2">
                    <button
                        className={`integration-pill ${integration === "none" ? "selected" : ""}`}
                        onClick={() => onIntegrationChange("none")}
                    >
                        <FileText size={15} /> Local Only
                    </button>
                    <button
                        className={`integration-pill ${integration === "wordpress" ? "selected" : ""}`}
                        onClick={() => onIntegrationChange("wordpress")}
                    >
                        <Globe size={15} /> WordPress
                    </button>
                    <button className="integration-pill disabled">
                        + Shopify <span className="badge badge-queued ml-1" style={{ fontSize: "0.6rem" }}>Soon</span>
                    </button>
                </div>

                {/* Inline WP Configuration selector */}
                {integration === "wordpress" && (
                    <div className="mt-4 pt-4 border-t border-slate-100 animate-slide-up">
                        {wpSites.length === 0 ? (
                            <div className="text-sm text-amber-600 bg-amber-50 p-3 rounded border border-amber-200">
                                No WordPress sites configured. Please visit Settings.
                            </div>
                        ) : (
                            <div>
                                <label className="block text-xs font-semibold text-slate-500 mb-1 uppercase tracking-wider">Target WordPress Site</label>
                                <select
                                    className="premium-input text-sm"
                                    value={selectedWpSite}
                                    onChange={(e) => onWpSiteChange(e.target.value)}
                                >
                                    {wpSites.map(site => (
                                        <option key={site.id} value={site.id}>{site.name} ({site.url})</option>
                                    ))}
                                </select>
                            </div>
                        )}
                    </div>
                )}
            </div>

            <div className="flex justify-end">
                <button
                    onClick={onNext}
                    disabled={keywordCount === 0 || (integration === "wordpress" && wpSites.length === 0)}
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
    integration,
}: {
    rows: QueueRow[];
    progress: number;
    isProcessing: boolean;
    onRetry: (id: string) => void;
    onReset: () => void;
    integration: Integration;
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
    const [integration, setIntegration] = useState<Integration>("none");
    const [wpSites, setWpSites] = useState<any[]>([]);
    const [selectedWpSite, setSelectedWpSite] = useState<string>("");
    const [selectedModel, setSelectedModel] = useState<"pro" | "lite">("pro");

    // Step 2 state
    const [rows, setRows] = useState<QueueRow[]>([]);

    // Step 3 state
    const [isProcessing, setIsProcessing] = useState(false);
    const [progress, setProgress] = useState(0);

    // Pre-fill from settings
    useEffect(() => {
        const s = getSettings();
        if (s.wpSites && s.wpSites.length > 0) {
            setWpSites(s.wpSites);
            setSelectedWpSite(s.wpSites[0].id);
            setIntegration("wordpress");
        } else if (s.wpUrl) {
            const fallback = { id: "legacy", name: "Default", url: s.wpUrl, user: s.wpUser, appPassword: s.wpAppPassword };
            setWpSites([fallback]);
            setSelectedWpSite("legacy");
            setIntegration("wordpress");
        }
        if (s.preferredModel === "lite") setSelectedModel("lite");
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
            status: "queued",
        }));

        if (integration === "wordpress") {
            const site = wpSites.find(s => s.id === selectedWpSite);
            if (!site || !site.url || !site.user || !site.appPassword) {
                toast.error("WordPress site selected is invalid or missing credentials. Please check Settings.");
                return;
            }
        }

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
        let completed = 0;
        const current: QueueRow[] = items.map((r) => ({ ...r, status: "queued" as QueueRow["status"] }));
        setRows([...current]);

        const settings = getSettings();
        const apiKey = settings.geminiKey;
        const amazonTag = settings.amazonTag || "";
        const modelToUse = selectedModel;

        const site = wpSites.find(s => s.id === selectedWpSite);
        const effectiveWP = integration === "wordpress" && site
            ? { url: site.url, user: site.user, pass: site.appPassword }
            : { url: "", user: "", pass: "" };

        for (let i = 0; i < current.length; i++) {
            current[i] = { ...current[i], status: "processing", message: "Generating…" };
            setRows([...current]);

            try {
                const articleId = `article-${Date.now()}-${i}`;

                // 1. Generate text
                const articleData = await generateContent({
                    topic: current[i].keyword,
                    keyword: current[i].seoKeyword || current[i].keyword,
                    tone: current[i].tone,
                    count: current[i].count,
                    apiKey,
                    modelPrefix: modelToUse,
                });

                // 2. Generate images for EVERY listicle item
                let firstAttachmentId: null | number = null;

                for (let j = 0; j < articleData.listicle_items.length; j++) {
                    const item = articleData.listicle_items[j];
                    if (item.image_prompt) {
                        current[i].message = `Generating image ${j + 1}/${articleData.listicle_items.length}…`;
                        setRows([...current]);
                        try {
                            const rawImageBase64 = await generateImage({
                                prompt: item.image_prompt,
                                apiKey,
                            });

                            if (rawImageBase64) {
                                current[i].message = `Compressing image ${j + 1}…`;
                                setRows([...current]);
                                
                                const compressedBase64 = await compressImageBase64(rawImageBase64);

                                // Save the image directly to the item object
                                item.image_base64 = compressedBase64;

                                // Set the first generated image as the featured image
                                if (!articleData.featured_image_base64) {
                                    articleData.featured_image_base64 = compressedBase64;
                                }

                                if (integration === "wordpress") {
                                    current[i].message = `Uploading image ${j + 1}…`;
                                    setRows([...current]);
                                    const uploadRes = await fetch("/api/wordpress", {
                                        method: "POST",
                                        headers: { "Content-Type": "application/json" },
                                        body: JSON.stringify({
                                            action: "upload_media",
                                            wpUrl: effectiveWP.url,
                                            wpUser: effectiveWP.user,
                                            wpAppPassword: effectiveWP.pass,
                                            payload: { base64: compressedBase64, filename: `pinlisticle-${Date.now()}-${j}.jpg` },
                                        }),
                                    });
                                    let uploadJson;
                                    try {
                                        uploadJson = await uploadRes.json();
                                    } catch (e) {
                                        const errorText = uploadRes.status === 413 ? "Payload too large for Vercel limit" : "Invalid response from server (Timeout/504?)";
                                        throw new Error(errorText);
                                    }
                                    if (uploadJson.success) {
                                        item.wp_attachment_id = uploadJson.data.id;
                                        if (!firstAttachmentId) firstAttachmentId = uploadJson.data.id;
                                    }
                                }
                            }
                        } catch (e: any) {
                            if (e.name === "QuotaExceededError") throw e;
                            // Single image failure is non-fatal; continue to next item
                        }
                    }
                }

                // 3. Build HTML
                const html = buildArticleHtml(articleData, amazonTag);

                // 4. Save locally (always)
                const article: GeneratedArticle = {
                    id: articleId,
                    topic: current[i].keyword,
                    tone: current[i].tone,
                    count: current[i].count,
                    generatedAt: new Date().toISOString(),
                    status: "success",
                    data: articleData,
                    html,
                };
                await saveArticle(article);

                // 5. Push to WordPress (optional)
                if (integration === "wordpress") {
                    current[i].message = "Pushing to WordPress…";
                    setRows([...current]);
                    const payload: any = {
                        title: articleData.seo_title,
                        content: html,
                        status: "publish",
                        excerpt: articleData.seo_desc,
                        meta: {
                            pinlisticle_seo_title: articleData.seo_title,
                            pinlisticle_seo_desc: articleData.seo_desc,
                            pinlisticle_pinterest_title: articleData.pinterest_title,
                            pinlisticle_pinterest_desc: articleData.pinterest_desc,
                        },
                    };
                    if (firstAttachmentId) payload.featured_media = firstAttachmentId;

                    const postRes = await fetch("/api/wordpress", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            action: "create_post",
                            wpUrl: effectiveWP.url,
                            wpUser: effectiveWP.user,
                            wpAppPassword: effectiveWP.pass,
                            payload,
                        }),
                    });
                    
                    let postJson;
                    try {
                        postJson = await postRes.json();
                    } catch (e) {
                        const errorText = postRes.status === 413 ? "Payload too large for Vercel limit" : "Invalid response from server (Timeout/504?)";
                        throw new Error(errorText);
                    }
                    
                    if (postJson.success && postJson.data?.link) {
                        article.wpPostUrl = postJson.data.link;
                        saveArticle(article);
                    }
                }

                current[i] = { ...current[i], status: "success", message: "Done", articleId };
            } catch (e: any) {
                const errArticle: GeneratedArticle = {
                    id: `article-err-${Date.now()}-${i}`,
                    topic: current[i].keyword,
                    generatedAt: new Date().toISOString(),
                    status: "error",
                    errorMessage: e.message,
                };
                saveArticle(errArticle);
                current[i] = { ...current[i], status: "error", message: e.message };

                if (e.name === "QuotaExceededError") {
                    toast.error("Quota Exceeded: Halting remaining batch articles to save credits.");
                    setRows([...current]);
                    setIsProcessing(false);
                    return;
                }
            }

            completed++;
            setProgress(Math.round((completed / current.length) * 100));
            setRows([...current]);
        }

        setIsProcessing(false);
        toast.success("Batch complete! Articles saved to library.");
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
        setIntegration("none");
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
                    integration={integration}
                    onIntegrationChange={setIntegration}
                    wpSites={wpSites}
                    selectedWpSite={selectedWpSite}
                    onWpSiteChange={setSelectedWpSite}
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
                    integration={integration}
                />
            )}
        </div>
    );
}
