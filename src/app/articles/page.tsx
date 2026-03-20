"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import { regenerateText, generateImage } from "@/lib/ai";
import {
    Trash2,
    Globe,
    FileText,
    ExternalLink,
    FilePlus,
    Search,
    Download,
    CheckCircle2,
    XCircle,
    RefreshCw,
    Image as ImageIcon
} from "lucide-react";
import Link from "next/link";
import { listArticles, deleteArticle, saveArticle, buildArticleHtml, type GeneratedArticle } from "@/lib/articleStore";

function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
}

function copyHtml(article: GeneratedArticle) {
    if (!article.html) { toast.error("No HTML available for this article."); return; }
    navigator.clipboard.writeText(article.html);
    toast.success("HTML copied to clipboard!");
}

async function compressImageBase64(base64: string, maxWidth = 800, quality = 0.8): Promise<string> {
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

export default function ArticlesLibrary() {
    const [articles, setArticles] = useState<GeneratedArticle[]>([]);
    const [search, setSearch] = useState("");
    const [selected, setSelected] = useState<GeneratedArticle | null>(null);
    const [regeneratingIdx, setRegeneratingIdx] = useState<{ type: 'text' | 'image', idx: number } | null>(null);

    const load = async () => {
        const data = await listArticles();
        setArticles(data);
    };

    const [wpSites, setWpSites] = useState<any[]>([]);
    const [targetSiteId, setTargetSiteId] = useState<string>("");

    useEffect(() => {
        load();
        const s = JSON.parse(localStorage.getItem("pinlisticle_settings") || "{}");
        if (s.wpSites && s.wpSites.length > 0) {
            setWpSites(s.wpSites);
            setTargetSiteId(s.wpSites[0].id);
        } else if (s.wpUrl) {
            setWpSites([{ id: "legacy", name: "Default", url: s.wpUrl, user: s.wpUser, appPassword: s.wpAppPassword }]);
            setTargetSiteId("legacy");
        }
    }, []);

    const filtered = articles.filter((a) =>
        a.topic.toLowerCase().includes(search.toLowerCase()) ||
        (a.data?.seo_title || "").toLowerCase().includes(search.toLowerCase())
    );

    const handleDelete = async (id: string) => {
        await deleteArticle(id);
        if (selected?.id === id) setSelected(null);
        await load();
        toast.success("Article deleted.");
    };

    const handlePushWP = async (article: GeneratedArticle) => {
        const targetSite = wpSites.find(s => s.id === targetSiteId);
        if (!targetSite) {
            toast.error("No WordPress site selected. Go to Settings to add one.");
            return;
        }
        if (!article.data) { toast.error("Article data is incomplete."); return; }

        const loadingId = toast.loading(`Preparing article for ${targetSite.name}…`);
        try {
            let firstAttachmentId: null | number = null;
            let updatedArticle = { ...article };
            let hasNewUploads = false;

            // 1. Upload any pending base64 images to WordPress
            for (let i = 0; i < updatedArticle.data!.listicle_items.length; i++) {
                const item = updatedArticle.data!.listicle_items[i];
                if (item.image_base64 && !item.wp_attachment_id) {
                    toast.loading(`Uploading image ${i + 1} to WordPress…`, { id: loadingId });
                    
                    const uploadRes = await fetch("/api/wordpress", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            action: "upload_media",
                            wpUrl: targetSite.url,
                            wpUser: targetSite.user,
                            wpAppPassword: targetSite.appPassword,
                            payload: { base64: item.image_base64, filename: `generated-${Date.now()}-${i}.jpg` },
                        }),
                    });

                    let uploadJson;
                    try {
                        uploadJson = await uploadRes.json();
                    } catch (e) {
                        throw new Error(`Failed to upload Image ${i + 1}.`);
                    }

                    if (uploadJson.success) {
                        item.wp_attachment_id = uploadJson.data.id;
                        item.wp_source_url = uploadJson.data.source_url;
                        hasNewUploads = true;
                        if (!firstAttachmentId) firstAttachmentId = uploadJson.data.id;
                    } else {
                        throw new Error(uploadJson.error || "WordPress Media API error.");
                    }
                } else if (item.wp_attachment_id && !firstAttachmentId) {
                    firstAttachmentId = item.wp_attachment_id;
                }
            }

            // 2. Rebuild HTML if new URLs were acquired
            if (hasNewUploads) {
                toast.loading(`Rebuilding HTML payload…`, { id: loadingId });
                const settings = JSON.parse(localStorage.getItem("pinlisticle_settings") || "{}");
                updatedArticle.html = buildArticleHtml(updatedArticle.data!, settings.amazonTag);
                await saveArticle(updatedArticle);
                if (selected?.id === updatedArticle.id) setSelected(updatedArticle);
            }

            if (!updatedArticle.html) throw new Error("Article has no HTML body.");

            // 3. Create the Draft Post in WordPress
            toast.loading(`Creating WordPress Draft…`, { id: loadingId });
            const payload: any = {
                title: updatedArticle.data!.seo_title,
                content: updatedArticle.html,
                status: "draft",
                excerpt: updatedArticle.data!.seo_desc,
                meta: {
                    pinlisticle_seo_title: updatedArticle.data!.seo_title,
                    pinlisticle_seo_desc: updatedArticle.data!.seo_desc,
                    pinlisticle_pinterest_title: updatedArticle.data!.pinterest_title,
                    pinlisticle_pinterest_desc: updatedArticle.data!.pinterest_desc,
                },
            };
            if (firstAttachmentId) payload.featured_media = firstAttachmentId;

            const res = await fetch("/api/wordpress", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action: "create_post",
                    wpUrl: targetSite.url,
                    wpUser: targetSite.user,
                    wpAppPassword: targetSite.appPassword,
                    payload,
                }),
            });
            const json = await res.json();
            
            if (json.success) {
                updatedArticle.wpPostUrl = json.data?.link;
                await saveArticle(updatedArticle);
                if (selected?.id === updatedArticle.id) setSelected(updatedArticle);
                toast.success(`Draft created successfully in ${targetSite.name}!`, { id: loadingId });
            } else {
                toast.error(json.error || "WordPress Post API error.", { id: loadingId });
            }
        } catch (e: any) {
            toast.error(e.message, { id: loadingId });
        }
    };

    const handleRegenerateText = async (idx: number) => {
        if (!selected || !selected.data) return;
        const item = selected.data.listicle_items[idx];
        setRegeneratingIdx({ type: 'text', idx });
        const settings = JSON.parse(localStorage.getItem("pinlisticle_settings") || "{}");

        try {
            const articleData = await regenerateText({
                topic: selected.topic,
                itemTitle: item.title,
                itemContent: item.content,
                apiKey: settings.geminiKey,
                modelPrefix: settings.preferredModel || "pro"
            });
            
            const newArticle = { ...selected };
            if (newArticle.data) {
                newArticle.data.listicle_items[idx].title = articleData.title;
                newArticle.data.listicle_items[idx].content = articleData.content;
                newArticle.html = buildArticleHtml(newArticle.data, settings.amazonTag);
                await saveArticle(newArticle);
                setSelected(newArticle);
                toast.success("Text regenerated successfully!");
            }
        } catch (e: any) {
            toast.error(e.message);
        }
        setRegeneratingIdx(null);
    };

    const handleRegenerateImage = async (idx: number) => {
        if (!selected || !selected.data) return;
        const item = selected.data.listicle_items[idx];
        if (!item.image_prompt) {
            toast.error("No image prompt available to regenerate.");
            return;
        }
        setRegeneratingIdx({ type: 'image', idx });
        const settings = JSON.parse(localStorage.getItem("pinlisticle_settings") || "{}");

        try {
            const rawImageBase64 = await generateImage({
                prompt: item.image_prompt,
                apiKey: settings.geminiKey,
                preferredModel: settings.preferredImagenModel || "auto"
            });

            if (rawImageBase64) {
                const compressedBase64 = await compressImageBase64(rawImageBase64);
                const newArticle = { ...selected };
                if (newArticle.data) {
                    newArticle.data.listicle_items[idx].image_base64 = compressedBase64;
                    delete newArticle.data.listicle_items[idx].wp_attachment_id;
                    delete newArticle.data.listicle_items[idx].wp_source_url;
                    newArticle.html = buildArticleHtml(newArticle.data, settings.amazonTag);
                    await saveArticle(newArticle);
                    setSelected(newArticle);
                    toast.success("Image regenerated successfully!");
                }
            }
        } catch (e: any) {
            toast.error(e.message);
        }
        setRegeneratingIdx(null);
    };

    return (
        <div className="space-y-6 pb-12">
            <div className="flex items-end justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Articles Library</h1>
                    <p className="text-sm text-slate-500 mt-0.5">
                        {articles.length} article{articles.length !== 1 ? "s" : ""} saved locally
                    </p>
                </div>
                <Link href="/batch" className="premium-button premium-button-primary gap-2 h-9 text-sm">
                    <FilePlus size={14} /> New Batch
                </Link>
            </div>

            {articles.length === 0 ? (
                <div className="glass-panel p-12 text-center">
                    <FileText size={40} className="text-slate-300 mx-auto mb-3" />
                    <p className="text-slate-500 font-medium mb-1">No articles yet</p>
                    <p className="text-sm text-slate-400 mb-5">
                        Head to Batch Generator to create your first set of articles.
                    </p>
                    <Link href="/batch" className="premium-button premium-button-primary gap-2 h-10 text-sm">
                        <FilePlus size={14} /> Launch Batch Generator
                    </Link>
                </div>
            ) : (
                <div className="grid grid-cols-1 lg:grid-cols-5 gap-5 items-start">
                    {/* List */}
                    <div className="lg:col-span-2 glass-panel overflow-hidden">
                        {/* Search */}
                        <div className="p-3 border-b border-slate-100">
                            <div className="relative">
                                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                                <input
                                    type="text"
                                    placeholder="Search articles…"
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                    className="premium-input pl-8 text-xs h-8"
                                />
                            </div>
                        </div>

                        <div className="overflow-y-auto" style={{ maxHeight: "65vh" }}>
                            {filtered.map((a) => (
                                <button
                                    key={a.id}
                                    onClick={() => setSelected(a)}
                                    className={`w-full text-left px-4 py-3 border-b border-slate-50 transition-colors ${selected?.id === a.id
                                        ? "bg-purple-50 border-l-2 border-l-purple-500"
                                        : "hover:bg-slate-50 border-l-2 border-l-transparent"
                                        }`}
                                >
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="min-w-0">
                                            <p className="text-xs font-semibold text-slate-800 truncate">
                                                {a.data?.seo_title || a.topic}
                                            </p>
                                            <p className="text-xs text-slate-500 mt-0.5 truncate">{a.topic}</p>
                                        </div>
                                        {a.status === "success" ? (
                                            <CheckCircle2 size={14} className="text-emerald-500 flex-shrink-0 mt-0.5" />
                                        ) : (
                                            <XCircle size={14} className="text-red-400 flex-shrink-0 mt-0.5" />
                                        )}
                                    </div>
                                    <p className="text-[0.65rem] text-slate-400 mt-1">{formatDate(a.generatedAt)}</p>
                                </button>
                            ))}
                            {filtered.length === 0 && (
                                <p className="text-xs text-slate-400 p-4 text-center">No results for "{search}"</p>
                            )}
                        </div>
                    </div>

                    {/* Detail panel */}
                    <div className="lg:col-span-3">
                        {!selected ? (
                            <div className="glass-panel p-10 text-center text-slate-400">
                                <FileText size={32} className="mx-auto mb-2 opacity-30" />
                                <p className="text-sm">Select an article to preview</p>
                            </div>
                        ) : (
                            <div className="glass-panel overflow-hidden animate-fade-in">
                                <div className="px-5 py-4 border-b border-slate-100">
                                    <div className="flex items-start justify-between gap-3">
                                        <div>
                                            <h2 className="text-sm font-semibold text-slate-800">
                                                {selected.data?.seo_title || selected.topic}
                                            </h2>
                                            <p className="text-xs text-slate-500 mt-0.5">{formatDate(selected.generatedAt)}</p>
                                        </div>
                                        <div className="flex gap-1.5 flex-shrink-0 items-center">
                                            {selected.status === "success" && (
                                                <>
                                                    <button
                                                        onClick={() => copyHtml(selected)}
                                                        className="premium-button premium-button-secondary gap-1.5 h-7 text-xs px-2.5"
                                                    >
                                                        <Download size={11} /> Copy HTML
                                                    </button>
                                                    {wpSites.length > 0 && (
                                                        <select
                                                            className="premium-input text-[10px] h-7 px-2 py-0 min-w-[120px]"
                                                            value={targetSiteId}
                                                            onChange={(e) => setTargetSiteId(e.target.value)}
                                                        >
                                                            {wpSites.map(site => (
                                                                <option key={site.id} value={site.id}>{site.name}</option>
                                                            ))}
                                                        </select>
                                                    )}
                                                    <button
                                                        onClick={() => handlePushWP(selected)}
                                                        className="premium-button premium-button-secondary gap-1.5 h-7 text-xs px-2.5"
                                                    >
                                                        <Globe size={11} /> Push to WP
                                                    </button>
                                                </>
                                            )}
                                            <button
                                                onClick={() => handleDelete(selected.id)}
                                                className="premium-button premium-button-danger h-7 w-7 p-0"
                                            >
                                                <Trash2 size={12} />
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                {selected.status === "error" ? (
                                    <div className="px-5 py-6 text-sm text-red-600">
                                        <XCircle size={16} className="inline mr-2" />
                                        Generation failed: {selected.errorMessage}
                                    </div>
                                ) : (
                                    <div className="p-5 space-y-4 overflow-y-auto" style={{ maxHeight: "60vh" }}>
                                        {selected.data?.seo_desc && (
                                            <div className="bg-slate-50 rounded-lg p-3">
                                                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">SEO Description</p>
                                                <p className="text-sm text-slate-700">{selected.data.seo_desc}</p>
                                            </div>
                                        )}

                                        {selected.data?.pinterest_title && (
                                            <div className="bg-pink-50 rounded-lg p-3">
                                                <p className="text-xs font-semibold text-pink-500 uppercase tracking-wider mb-1">Pinterest Title</p>
                                                <p className="text-sm text-slate-700">{selected.data.pinterest_title}</p>
                                            </div>
                                        )}

                                        {selected.data?.article_intro && (
                                            <div>
                                                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Introduction</p>
                                                <p className="text-sm text-slate-700 leading-relaxed">{selected.data.article_intro}</p>
                                            </div>
                                        )}

                                        {selected.data?.listicle_items && selected.data.listicle_items.length > 0 && (
                                            <div>
                                                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
                                                    Listicle Items ({selected.data.listicle_items.length})
                                                </p>
                                                <div className="space-y-6">
                                                    {selected.data.listicle_items.map((item, idx) => (
                                                        <div key={idx} className="border border-slate-100 rounded-lg p-5 bg-white">
                                                            <div className="flex flex-col gap-6">

                                                                {/* Title at the top */}
                                                                <div className="w-full">
                                                                    <h3 className="text-lg font-bold text-slate-900 mb-2 leading-tight">
                                                                        {idx + 1}. {item.title}
                                                                    </h3>
                                                                </div>

                                                                {/* Image positioned BELOW the title */}
                                                                <div className="w-full max-w-sm mx-auto">
                                                                    {item.image_base64 ? (
                                                                        <div className="rounded-2xl overflow-hidden shadow-md aspect-[9/16] bg-slate-100">
                                                                            <img
                                                                                src={`data:image/jpeg;base64,${item.image_base64}`}
                                                                                alt={item.title}
                                                                                className="w-full h-full object-cover"
                                                                            />
                                                                        </div>
                                                                    ) : (
                                                                        <div className="rounded-2xl shadow-md aspect-[9/16] bg-slate-50 border border-slate-100 border-dashed flex items-center justify-center text-slate-300 text-xs text-center p-4">
                                                                            <p>No image generated for this item</p>
                                                                        </div>
                                                                    )}
                                                                    <button
                                                                        onClick={() => handleRegenerateImage(idx)}
                                                                        disabled={regeneratingIdx?.idx === idx && regeneratingIdx.type === 'image'}
                                                                        className="premium-button premium-button-ghost bg-white shadow-sm hover:shadow-md border border-slate-200 mt-3 w-full gap-2 h-9 text-xs"
                                                                    >
                                                                        {regeneratingIdx?.idx === idx && regeneratingIdx.type === 'image' ? (
                                                                            <><span className="spinner w-3 h-3 border-slate-500 border-t-transparent" /> Regenerating Image...</>
                                                                        ) : (
                                                                            <><ImageIcon size={14} /> Regenerate Image</>
                                                                        )}
                                                                    </button>
                                                                </div>

                                                                {/* Content Side BELOW the image */}
                                                                <div className="w-full">
                                                                    <p className="text-sm text-slate-600 leading-relaxed mb-4">{item.content}</p>

                                                                    {/* Shop Look Block */}
                                                                    {item.product_recommendations && item.product_recommendations.length > 0 && (
                                                                        <div className="bg-slate-50 rounded-xl p-4 mt-2 border border-slate-100 flex flex-col items-center">
                                                                            <p className="text-sm font-bold text-slate-900 mb-3">🛍️ Recreate this look</p>
                                                                            <div className="flex flex-wrap justify-center gap-2">
                                                                                {item.product_recommendations.map((p, pi) => (
                                                                                    <span key={pi} className="px-3 py-1.5 rounded-full bg-gradient-to-r from-orange-500 to-pink-500 text-white text-xs font-semibold shadow-sm hover:-translate-y-0.5 transition-transform cursor-default">
                                                                                        {p.product_name}
                                                                                    </span>
                                                                                ))}
                                                                            </div>
                                                                        </div>
                                                                    )}
                                                                    <div className="mt-4 flex justify-start">
                                                                        <button
                                                                            onClick={() => handleRegenerateText(idx)}
                                                                            disabled={regeneratingIdx?.idx === idx && regeneratingIdx.type === 'text'}
                                                                            className="premium-button premium-button-ghost gap-2 h-8 text-xs font-semibold px-4"
                                                                        >
                                                                            {regeneratingIdx?.idx === idx && regeneratingIdx.type === 'text' ? (
                                                                                <><span className="spinner w-3 h-3 border-purple-500 border-t-transparent" /> Rewriting...</>
                                                                            ) : (
                                                                                <><RefreshCw size={13} /> Rewrite Text</>
                                                                            )}
                                                                        </button>
                                                                    </div>
                                                                </div>

                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {selected.wpPostUrl && (
                                            <a
                                                href={selected.wpPostUrl}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="premium-button premium-button-ghost gap-1.5 h-8 text-xs inline-flex"
                                            >
                                                <ExternalLink size={11} /> View on WordPress
                                            </a>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
