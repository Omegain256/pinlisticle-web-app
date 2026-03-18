"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Save, Key, Link as LinkIcon, Globe, Cpu, CheckCircle2, Plus, Trash2 } from "lucide-react";

const MODELS = [
    {
        id: "pro",
        name: "Gemini 2.5 Pro",
        badge: "Best Quality",
        desc: "Highest quality output with advanced reasoning. Best for premium listicles. Slower but superior results.",
        color: "border-purple-400 bg-purple-50",
        badgeClass: "badge-primary",
    },
    {
        id: "lite",
        name: "Gemini 2.0 Flash-Lite",
        badge: "Fast & Bulk",
        desc: "Lightweight and very fast. Best for large batch jobs where speed matters more than depth.",
        color: "border-blue-400 bg-blue-50",
        badgeClass: "badge-queued",
    },
];

export default function Settings() {
    const [formData, setFormData] = useState({
        geminiKey: "",
        amazonTag: "",
        wpSites: [] as { id: string; name: string; url: string; user: string; appPassword: string }[],
        preferredModel: "pro",
    });
    const [isLoaded, setIsLoaded] = useState(false);
    const [testingId, setTestingId] = useState<string | null>(null);

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
                
                setFormData({ preferredModel: "pro", wpSites: [], ...parsed });
            } catch {
                /* ignore */
            }
        }
        setIsLoaded(true);
    }, []);

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
                <div className="glass-panel p-5">
                    <div className="flex items-center gap-2 mb-4 text-indigo-600">
                        <Cpu size={17} />
                        <h2 className="text-sm font-semibold">Generation Model</h2>
                    </div>
                    <p className="text-xs text-slate-500 mb-3">
                        Choose the default model for listicle generation. Can be overridden per batch.
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {MODELS.map((m) => (
                            <button
                                key={m.id}
                                type="button"
                                onClick={() => setFormData((prev) => ({ ...prev, preferredModel: m.id }))}
                                className={`rounded-lg border-2 p-4 text-left transition-all ${formData.preferredModel === m.id
                                        ? m.color
                                        : "border-slate-200 bg-white hover:border-slate-300"
                                    }`}
                            >
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-sm font-semibold text-slate-800">{m.name}</span>
                                    <div className="flex items-center gap-1.5">
                                        <span className={`badge ${m.badgeClass} text-[0.6rem]`}>{m.badge}</span>
                                        {formData.preferredModel === m.id && (
                                            <CheckCircle2 size={14} className="text-purple-600" />
                                        )}
                                    </div>
                                </div>
                                <p className="text-xs text-slate-500 leading-relaxed">{m.desc}</p>
                            </button>
                        ))}
                    </div>
                </div>

                {/* ── Affiliate ──────────────────────────────────────── */}
                <div className="glass-panel p-5">
                    <div className="flex items-center gap-2 mb-4 text-pink-600">
                        <LinkIcon size={17} />
                        <h2 className="text-sm font-semibold">Affiliate Tracking</h2>
                    </div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1 uppercase tracking-wider">
                        Amazon Associate Tag
                    </label>
                    <input
                        type="text"
                        name="amazonTag"
                        value={formData.amazonTag}
                        onChange={handleChange}
                        placeholder="mystore-20"
                        className="premium-input"
                    />
                    <p className="text-xs text-slate-400 mt-1.5">
                        Appended to all product recommendation links automatically.
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
