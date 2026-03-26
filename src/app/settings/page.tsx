"use client";

import { useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { Save, Key, Link as LinkIcon, Globe, Cpu, CheckCircle2, Plus, Trash2, RefreshCw } from "lucide-react";
import { fetchAvailableModels, getCachedModels, type DiscoveredModel } from "@/lib/ai";

const MODELS = [
    {
        id: "pro",
        name: "Gemini 1.5 Pro",
        badge: "Best Quality",
        desc: "Highest quality output with advanced reasoning. Verified stable legacy standard.",
        color: "border-purple-400 bg-purple-50",
        badgeClass: "badge-primary",
    },
    {
        id: "lite",
        name: "Gemini 1.5 Flash",
        badge: "Fast & Bulk",
        desc: "Lightweight and exceptionally fast. Best for large batch jobs or quick drafts.",
        color: "border-blue-400 bg-blue-50",
        badgeClass: "badge-queued",
    },
];

const IMAGEN_MODELS = [
    { id: "auto", name: "Auto-Rotate (Max Capacity)", badge: "Recommended", desc: "Cycles through ALL Imagen 4 & 3 models to maximize your daily quota.", color: "border-emerald-400 bg-emerald-50", badgeClass: "badge-success" },
    { id: "imagen-4.0-ultra-generate-001", name: "Imagen 4 Ultra", badge: "Best Quality", desc: "Highest prompt adherence. Best for ultra-realistic textures.", color: "border-purple-200 bg-white", badgeClass: "badge-secondary" },
    { id: "imagen-4.0-generate-001", name: "Imagen 4 Standard", badge: "Balanced", desc: "Great for general fashion. Reliable and high quality.", color: "border-slate-200 bg-white", badgeClass: "badge-primary" },
    { id: "imagen-4.0-fast-generate-001", name: "Imagen 4 Fast", badge: "Fast", desc: "Low latency version of Imagen 4.", color: "border-amber-200 bg-white", badgeClass: "badge-queued" },
    { id: "imagen-3.0-generate-001", name: "Imagen 3 Standard", badge: "Classic", desc: "High quality fallback with an independent quota.", color: "border-blue-200 bg-white", badgeClass: "badge-primary" },
    { id: "imagen-3.0-fast-generate-001", name: "Imagen 3 Fast", badge: "Legacy Fast", desc: "Reliable high-speed fallback engine.", color: "border-slate-100 bg-white", badgeClass: "badge-queued" },
];

export default function Settings() {
    const [formData, setFormData] = useState({
        geminiKey: "",
        amazonTag: "",
        brandVoice: "",
        internalLinks: "",
        wpSites: [] as { id: string; name: string; url: string; user: string; appPassword: string }[],
        preferredModel: "pro",
        preferredImagenModel: "auto",
    });
    const [isLoaded, setIsLoaded] = useState(false);
    const [testingId, setTestingId] = useState<string | null>(null);
    const [discovered, setDiscovered] = useState<DiscoveredModel[]>([]);
    const [isSyncing, setIsSyncing] = useState(false);
    const syncTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    const performSync = async (key: string) => {
        if (!key || isSyncing) return;
        setIsSyncing(true);
        const models = await fetchAvailableModels(key);
        if (models.length > 0) setDiscovered(models);
        setIsSyncing(false);
    };

    useEffect(() => {
        const saved = localStorage.getItem("pinlisticle_settings");
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                
                // Migrate from single site to multi-site
                if (parsed.wpUrl && !parsed.wpSites) {
                    parsed.wpSites = [{
                        id: Date.now().toString(),
                        name: "My Website",
                        url: parsed.wpUrl,
                        user: parsed.wpUser,
                        appPassword: parsed.wpAppPassword
                    }];
                    delete parsed.wpUrl;
                    delete parsed.wpUser;
                    delete parsed.wpAppPassword;
                }
                
                // Auto-migrate any deprecated model stored in localStorage
                const DEPRECATED_MODELS: Record<string, string> = {
                    "gemini-2.0-flash": "gemini-2.5-flash",
                    "gemini-2.0-flash-lite": "gemini-2.5-flash",
                    "gemini-2.0-flash-exp": "gemini-2.5-flash",
                    "gemini-1.5-pro": "gemini-2.5-pro",
                    "gemini-1.5-pro-002": "gemini-2.5-pro",
                    "gemini-1.5-flash": "gemini-2.5-flash",
                    "gemini-1.5-flash-002": "gemini-2.5-flash",
                    "gemini-2.1-pro": "gemini-2.5-pro",
                };
                if (parsed.preferredModel && DEPRECATED_MODELS[parsed.preferredModel]) {
                    parsed.preferredModel = DEPRECATED_MODELS[parsed.preferredModel];
                    // Persist the fix so it never triggers again
                    localStorage.setItem("pinlisticle_settings", JSON.stringify({ ...parsed }));
                }
                
                setFormData({ preferredModel: "pro", preferredImagenModel: "auto", wpSites: [], ...parsed });
            } catch {
                /* ignore */
            }
        }
        setDiscovered(getCachedModels());
        setIsLoaded(true);
    }, []);

    // Auto-sync when API key changes (debounced)
    useEffect(() => {
        if (!isLoaded) return;
        if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
        
        syncTimeoutRef.current = setTimeout(() => {
            if (formData.geminiKey) performSync(formData.geminiKey);
        }, 1500);

        return () => {
            if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
        };
    }, [formData.geminiKey, isLoaded]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setFormData((prev) => ({ ...prev, [e.target.name]: e.target.value }));
    };

    const handleSiteChange = (id: string, field: string, value: string) => {
        setFormData(prev => ({
            ...prev,
            wpSites: prev.wpSites.map(site => site.id === id ? { ...site, [field]: value } : site)
        }));
    };

    const addSite = () => {
        setFormData(prev => ({
            ...prev,
            wpSites: [...prev.wpSites, { id: Date.now().toString(), name: "New Site", url: "", user: "", appPassword: "" }]
        }));
    };

    const removeSite = (id: string) => {
        setFormData(prev => ({
            ...prev,
            wpSites: prev.wpSites.filter(s => s.id !== id)
        }));
    };

    const handleSave = (e: React.FormEvent) => {
        e.preventDefault();
        localStorage.setItem("pinlisticle_settings", JSON.stringify(formData));
        toast.success("Settings saved successfully!");
    };

    const handleTestWP = async (site: any) => {
        if (!site.url || !site.user || !site.appPassword) {
            toast.error("Fill in all WordPress fields for this site first.");
            return;
        }
        setTestingId(site.id);
        try {
            const res = await fetch("/api/wordpress", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action: "test_connection",
                    wpUrl: site.url,
                    wpUser: site.user,
                    wpAppPassword: site.appPassword,
                    payload: {},
                }),
            });
            if (res.ok) {
                toast.success(`Connection to ${site.name} looks good!`);
            } else {
                const data = await res.json();
                const errMsg = data.error || data.wp_message || "Invalid credentials";
                toast.error(`Auth Failed: ${errMsg}`);
            }
        } catch {
            toast.error(`Could not reach ${site.name}. Check the URL.`);
        } finally {
            setTestingId(null);
        }
    };

    if (!isLoaded)
        return (
            <div className="animate-pulse space-y-4 p-8">
                {[1, 2, 3].map((i) => (
                    <div key={i} className="h-10 bg-slate-200 rounded-lg w-full" />
                ))}
            </div>
        );

    return (
        <div className="space-y-7 pb-12">
            <div>
                <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Settings</h1>
                <p className="text-sm text-slate-500 mt-0.5">API keys, model preferences, and integrations.</p>
            </div>

            <form onSubmit={handleSave} className="space-y-5">
                {/* ── API Key ─────────────────────────────────────────── */}
                <div className="glass-panel p-5">
                    <div className="flex items-center gap-2 mb-4 text-purple-600">
                        <Key size={17} />
                        <h2 className="text-sm font-semibold">Gemini API</h2>
                    </div>
                    <div>
                        <label className="block text-xs font-semibold text-slate-600 mb-1 uppercase tracking-wider">
                            API Keys
                        </label>
                        <textarea
                            name="geminiKey"
                            value={formData.geminiKey}
                            onChange={(e) => setFormData((prev) => ({ ...prev, [e.target.name]: e.target.value }))}
                            placeholder={`AIzaSy...\nAIzaSy...`}
                            className="premium-input font-mono text-xs min-h-[80px] resize-y"
                        />
                        <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
                            Used for both text generation (Gemini) and image generation (Imagen). 
                            <br/>
                            <span className="text-purple-600 font-medium">Pro Tip:</span> Enter multiple API keys (separated by commas or newlines) to automatically load balance requests. This permanently bypasses the 70 requests/day Imagen quota by pooling multiple free Google accounts.
                        </p>
                    </div>
                </div>

                {/* ── Model Selection ─────────────────────────────────── */}
                <div className="glass-panel p-5 space-y-6">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-indigo-600">
                            <Cpu size={17} />
                            <h2 className="text-sm font-semibold">Model Health & Quota Pooling</h2>
                        </div>
                        <div className="flex gap-2">
                            <button 
                                type="button"
                                onClick={() => performSync(formData.geminiKey)} 
                                disabled={isSyncing}
                                className="text-[10px] font-bold text-purple-600 hover:text-purple-700 bg-purple-50 px-2 py-1 rounded-full border border-purple-100 flex items-center gap-1 transition-all active:scale-95 disabled:opacity-50"
                            >
                                <RefreshCw className={`w-2.5 h-2.5 ${isSyncing ? 'animate-spin' : ''}`} />
                                {isSyncing ? 'Syncing...' : 'Force Sync'}
                            </button>
                            <span className={`text-[10px] font-bold px-2 py-1 rounded-full border ${discovered.length > 0 ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-amber-50 text-amber-600 border-amber-100'}`}>
                                {discovered.length} Models Detected
                            </span>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Gemini Pool */}
                        <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Gemini Standard (API v1)</span>
                                <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                            </div>
                            <div className="text-xs text-slate-700 flex flex-wrap gap-2">
                                {["gemini-2.5-flash", "gemini-2.5-pro"].map(m => (
                                    <span key={m} className={`px-2 py-0.5 rounded-md border ${discovered.some(dm => dm.id === m) ? 'bg-white border-purple-200 text-purple-700 font-medium' : 'bg-slate-100 border-slate-200 text-slate-400'}`}>
                                        {m}
                                    </span>
                                ))}
                            </div>
                        </div>

                        {/* Imagen Pool */}
                        <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Imagen 4 Capacity Pool</span>
                                <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                            </div>
                            <div className="text-xs text-slate-700 flex flex-wrap gap-2">
                                {["imagen-4.0-ultra-generate-001", "imagen-4.0-generate-001", "imagen-4.0-fast-generate-001", "imagen-3.0-generate-001"].map(m => (
                                    <span key={m} className={`px-2 py-0.5 rounded-md border ${discovered.some(dm => dm.id === m) ? 'bg-white border-emerald-200 text-emerald-700 font-medium' : 'bg-slate-100 border-slate-200 text-slate-400'}`}>
                                        {m}
                                    </span>
                                ))}
                            </div>
                            <p className="text-[10px] text-slate-500 mt-2 italic">
                                * Automatically rotating through these variants to bypass the 70-image per-model limit.
                            </p>
                        </div>
                    </div>

                    <hr className="border-slate-100" />

                    <div>
                        <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Default Text Generation Model</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {(discovered.length > 0 
                                ? discovered.filter(m => m.id.includes("gemini") && !["gemini-2.0-flash", "gemini-2.0-flash-exp", "gemini-2.0-flash-lite", "gemini-1.5-pro", "gemini-1.5-flash", "gemini-1.5-pro-002", "gemini-1.5-flash-002", "gemini-2.1-pro"].includes(m.id))
                                : MODELS
                            ).map((m) => (
                                <button
                                    key={m.id}
                                    type="button"
                                    onClick={() => setFormData((prev) => ({ ...prev, preferredModel: m.id }))}
                                    className={`rounded-lg border-2 p-4 text-left transition-all ${formData.preferredModel === m.id
                                            ? (m as any).color || "border-purple-400 bg-purple-50"
                                            : "border-slate-200 bg-white hover:border-slate-300"
                                        }`}
                                >
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-sm font-bold text-slate-800 tracking-tight">{(m as any).name || m.id}</span>
                                        <div className="flex items-center gap-1.5">
                                            <span className={`badge ${(m as any).badgeClass || "badge-primary"} text-[0.6rem]`}>{(m as any).badge || "Detected"}</span>
                                            {formData.preferredModel === m.id && (
                                                <CheckCircle2 size={14} className="text-purple-600" />
                                            )}
                                        </div>
                                    </div>
                                    <p className="text-xs text-slate-500 leading-relaxed font-medium">{(m as any).desc || (m as any).description || "Available for generation."}</p>
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {/* ── Imagen Model Preference ────────────────────────── */}
                <div className="glass-panel p-5">
                    <div className="flex items-center gap-2 mb-4 text-emerald-600">
                        <Globe size={17} />
                        <h2 className="text-sm font-semibold">Imagen Generation Tier</h2>
                    </div>
                    <p className="text-xs text-slate-500 mb-3">
                        Select a specific generation engine or use <b>Auto-Rotate</b> to pool all three quotas into one (Max Capacity).
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <button
                            type="button"
                            onClick={() => setFormData((prev) => ({ ...prev, preferredImagenModel: "auto" }))}
                            className={`rounded-lg border-2 p-3 text-left transition-all ${formData.preferredImagenModel === "auto"
                                    ? "border-emerald-400 bg-emerald-50"
                                    : "border-slate-100 bg-white hover:border-slate-200"
                                }`}
                        >
                            <div className="flex items-center justify-between mb-1.5">
                                <span className="text-sm font-bold text-slate-800 tracking-tight italic">Auto-Rotate (Max Capacity)</span>
                                <div className="flex items-center gap-1.5">
                                    <span className="badge badge-success text-[0.6rem]">Recommended</span>
                                    {formData.preferredImagenModel === "auto" && (
                                        <CheckCircle2 size={14} className="text-emerald-600" />
                                    )}
                                </div>
                            </div>
                            <p className="text-[0.7rem] text-slate-500 leading-tight font-medium">Cycles through ALL available Imagen models to maximize your daily quota.</p>
                        </button>

                        {(discovered.length > 0 
                            ? discovered.filter(m => m.id.includes("imagen"))
                            : IMAGEN_MODELS.filter(m => m.id !== "auto")
                        ).map((m) => (
                            <button
                                key={m.id}
                                type="button"
                                onClick={() => setFormData((prev) => ({ ...prev, preferredImagenModel: m.id }))}
                                className={`rounded-lg border-2 p-3 text-left transition-all ${formData.preferredImagenModel === m.id
                                        ? (m as any).color || "border-slate-400 bg-slate-50"
                                        : "border-slate-100 bg-white hover:border-slate-200"
                                    }`}
                            >
                                <div className="flex items-center justify-between mb-1.5">
                                    <span className="text-sm font-semibold text-slate-800 tracking-tight">{(m as any).name || m.id}</span>
                                    <div className="flex items-center gap-1.5">
                                        <span className={`badge ${(m as any).badgeClass || "badge-primary"} text-[0.6rem]`}>{(m as any).badge || "Detected"}</span>
                                        {formData.preferredImagenModel === m.id && (
                                            <CheckCircle2 size={14} className="text-emerald-600" />
                                        )}
                                    </div>
                                </div>
                                <p className="text-[0.7rem] text-slate-500 leading-tight font-medium truncate">{(m as any).desc || "High-quality Image Generation."}</p>
                            </button>
                        ))}
                    </div>
                </div>

                {/* ── Brand Voice DNA ──────────────────────────────────────── */}
                <div className="glass-panel p-5">
                    <div className="flex items-center gap-2 mb-4 text-emerald-600">
                        <Cpu size={17} />
                        <h2 className="text-sm font-semibold">Brand Voice DNA</h2>
                    </div>
                    <div>
                        <label className="block text-xs font-semibold text-slate-600 mb-1 uppercase tracking-wider">
                            Writing Samples
                        </label>
                        <textarea
                            name="brandVoice"
                            value={formData.brandVoice}
                            onChange={(e) => setFormData((prev) => ({ ...prev, [e.target.name]: e.target.value }))}
                            placeholder="Paste 2-3 paragraphs of your best writing here. The AI will analyze and clone this exact tone, vocabulary, and sentence structure for all generated articles."
                            className="premium-input text-sm min-h-[120px] resize-y"
                        />
                        <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
                            Leave blank to use the standard AI editorial tone.
                        </p>
                    </div>
                </div>

                {/* ── SEO Internal Links ──────────────────────────────────────── */}
                <div className="glass-panel p-5">
                    <div className="flex items-center gap-2 mb-4 text-amber-600">
                        <LinkIcon size={17} />
                        <h2 className="text-sm font-semibold">SEO Internal Links</h2>
                    </div>
                    <div>
                        <label className="block text-xs font-semibold text-slate-600 mb-1 uppercase tracking-wider">
                            Target URLs & Keywords
                        </label>
                        <textarea
                            name="internalLinks"
                            value={formData.internalLinks}
                            onChange={(e) => setFormData((prev) => ({ ...prev, [e.target.name]: e.target.value }))}
                            placeholder="https://mysite.com/best-watches | luxury watches&#10;https://mysite.com/style-guide | men's style guide"
                            className="premium-input font-mono text-xs min-h-[100px] resize-y leading-relaxed"
                        />
                        <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
                            Paste one URL and keyword pair per line. The AI will naturally weave 1-2 of these links into the body paragraphs of your new articles to dramatically boost SEO domain authority.
                        </p>
                    </div>
                </div>

                {/* ── Affiliate ──────────────────────────────────────── */}
                <div className="glass-panel p-5">
                    <div className="flex items-center gap-2 mb-4 text-pink-600">
                        <LinkIcon size={17} />
                        <h2 className="text-sm font-semibold">Affiliate Tracking</h2>
                    </div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1 uppercase tracking-wider">
                        Default Amazon Associate Tag
                    </label>
                    <input
                        type="text"
                        name="amazonTag"
                        value={formData.amazonTag}
                        onChange={handleChange}
                        placeholder="mystore-20"
                        className="premium-input"
                    />
                    <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
                        This tag will be used as the default when generating articles. You can override it per-article on the Batch Generation page.
                    </p>
                </div>

                {/* ── WordPress Sites ─────────────────────────────────────── */}
                <div className="glass-panel p-5 border-l-4 border-l-indigo-500">
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2 text-indigo-700">
                            <Globe size={17} />
                            <h2 className="text-sm font-semibold">WordPress Integrations</h2>
                        </div>
                        <button type="button" onClick={addSite} className="premium-button premium-button-ghost h-8 text-xs gap-1.5 px-3">
                            <Plus size={12} /> Add Site
                        </button>
                    </div>

                    <div className="space-y-6">
                        {formData.wpSites.length === 0 && (
                            <p className="text-sm text-slate-500 italic text-center py-4 bg-slate-50 rounded-lg">No WordPress sites configured. Add one to enable direct publishing.</p>
                        )}
                        {formData.wpSites.map((site, idx) => (
                            <div key={site.id} className="p-4 border rounded-xl bg-slate-50 relative">
                                <button type="button" onClick={() => removeSite(site.id)} className="absolute top-4 right-4 text-slate-400 hover:text-red-500 transition-colors">
                                    <Trash2 size={16} />
                                </button>
                                <div className="space-y-4 pr-6">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                        <div>
                                            <label className="block text-xs font-semibold text-slate-600 mb-1 uppercase tracking-wider">Site Name</label>
                                            <input type="text" value={site.name} onChange={(e) => handleSiteChange(site.id, 'name', e.target.value)} placeholder="e.g. My Fashion Blog" className="premium-input" />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-semibold text-slate-600 mb-1 uppercase tracking-wider">Site URL</label>
                                            <input type="url" value={site.url} onChange={(e) => handleSiteChange(site.id, 'url', e.target.value)} placeholder="https://yourwebsite.com" className="premium-input" />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-semibold text-slate-600 mb-1 uppercase tracking-wider">Admin Username</label>
                                            <input type="text" value={site.user} onChange={(e) => handleSiteChange(site.id, 'user', e.target.value)} placeholder="admin" className="premium-input" />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-semibold text-slate-600 mb-1 uppercase tracking-wider">Application Password</label>
                                            <input type="password" value={site.appPassword} onChange={(e) => handleSiteChange(site.id, 'appPassword', e.target.value)} placeholder="xxxx xxxx xxxx xxxx" className="premium-input font-mono" />
                                        </div>
                                    </div>
                                    <div className="flex justify-end pt-2 border-t border-slate-200">
                                        <button type="button" onClick={() => handleTestWP(site)} disabled={testingId === site.id} className="premium-button premium-button-ghost h-8 text-xs gap-1.5 px-3">
                                            {testingId === site.id ? <span className="spinner" /> : <Globe size={12} />}
                                            Test Connection
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="flex justify-end pt-1">
                    <button type="submit" className="premium-button premium-button-primary gap-2 h-11 px-8 text-sm">
                        <Save size={15} /> Save Settings
                    </button>
                </div>
            </form>
        </div>
    );
}
