"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  FilePlus,
  Library,
  Settings,
  Globe,
  Zap,
  FileText,
  Image as ImageIcon,
  X,
  ChevronRight,
  Layers,
} from "lucide-react";
import { listArticles } from "@/lib/articleStore";

export default function Dashboard() {
  const [articleCount, setArticleCount] = useState(0);
  const [successCount, setSuccessCount] = useState(0);
  const [hasWPConfig, setHasWPConfig] = useState(false);
  const [showBanner, setShowBanner] = useState(true);

  useEffect(() => {
    async function initStats() {
      const articles = await listArticles();
      setArticleCount(articles.length);
      setSuccessCount(articles.filter((a) => a.status === "success").length);
    }
    initStats();

    const config = localStorage.getItem("pinlisticle_settings");
    if (config) {
      const p = JSON.parse(config);
      setHasWPConfig(!!(p.geminiKey && p.wpUrl && p.wpUser && p.wpAppPassword));
    }

    const bannerDismissed = sessionStorage.getItem("banner_dismissed");
    if (bannerDismissed) setShowBanner(false);
  }, []);

  const dismissBanner = () => {
    setShowBanner(false);
    sessionStorage.setItem("banner_dismissed", "1");
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Dashboard</h1>
        <p className="text-sm text-slate-500 mt-0.5">Welcome back — your AI listicle studio.</p>
      </div>

      {/* Top Banner */}
      {showBanner && (
        <div className="highlight-banner animate-slide-up">
          <div className="flex items-center gap-3">
            <div className="bg-white/15 p-2 rounded-lg">
              <Zap size={20} className="text-white" />
            </div>
            <div>
              <p className="text-sm font-semibold text-white">
                Batch Mode is now standalone — no WordPress required!
              </p>
              <p className="text-xs text-white/70 mt-0.5">
                Generate unlimited articles and optionally push to WordPress, Shopify, and more.
              </p>
            </div>
          </div>
          <button
            onClick={dismissBanner}
            className="text-white/60 hover:text-white transition-colors ml-4 flex-shrink-0"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* Feature Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Content Engine */}
        <div className="feature-card">
          <div className="flex items-start justify-between mb-4">
            <div className="feature-card-icon bg-blue-50">
              <FileText size={22} className="text-blue-600" />
            </div>
            <span className="badge badge-success">Active</span>
          </div>
          <h3 className="text-base font-semibold text-slate-900 mb-1">Content Engine</h3>
          <p className="text-sm text-slate-500 mb-4 leading-relaxed">
            Powered by Gemini 1.5 Flash. Generates structured JSON with strict word count for optimal Pinterest readability.
          </p>
          <div className="flex items-center gap-2 mt-auto">
            <Link
              href="/batch"
              className="premium-button premium-button-primary text-sm gap-1.5 h-9"
            >
              <FilePlus size={14} /> Open Batch Generator
            </Link>
          </div>
        </div>

        {/* Integration Hub */}
        <div className="feature-card">
          <div className="flex items-start justify-between mb-4">
            <div className="feature-card-icon bg-indigo-50">
              <Globe size={22} className="text-indigo-600" />
            </div>
            <span className={`badge ${hasWPConfig ? "badge-success" : "badge-queued"}`}>
              {hasWPConfig ? "Connected" : "Not configured"}
            </span>
          </div>
          <h3 className="text-base font-semibold text-slate-900 mb-1">Integration Hub</h3>
          <p className="text-sm text-slate-500 mb-4 leading-relaxed">
            Connect WordPress, Shopify, and more. Articles are saved locally first — push when ready.
          </p>
          <div className="flex items-center gap-2">
            <Link href="/settings" className="premium-button premium-button-secondary text-sm gap-1.5 h-9">
              <Settings size={14} /> Configure
            </Link>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div>
        <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">Quick Actions</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Link href="/batch" className="quick-action-tile">
            <FilePlus size={18} className="text-purple-500" />
            <span className="tile-count">{articleCount}</span>
            <span>Batch Generator</span>
          </Link>
          <Link href="/articles" className="quick-action-tile">
            <Library size={18} className="text-blue-500" />
            <span className="tile-count">{successCount}</span>
            <span>Articles Library</span>
          </Link>
          <Link href="/settings" className="quick-action-tile">
            <Globe size={18} className="text-indigo-500" />
            <span className="tile-count">{hasWPConfig ? "✓" : "—"}</span>
            <span>WordPress</span>
          </Link>
          <Link href="/settings" className="quick-action-tile">
            <Settings size={18} className="text-slate-400" />
            <span className="tile-count">→</span>
            <span>Settings</span>
          </Link>
        </div>
      </div>

      {/* How it Works */}
      <div className="glass-panel p-6">
        <div className="flex items-center gap-2 mb-4">
          <Layers size={18} className="text-purple-500" />
          <h2 className="text-base font-semibold text-slate-800">How Batch Mode Works</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            {
              step: "1",
              title: "Enter Keywords",
              desc: "Provide any number of target keywords — one per line. An article will be generated for each.",
              color: "bg-purple-50 text-purple-600",
            },
            {
              step: "2",
              title: "Review & Edit",
              desc: "Preview the queue before generating. Adjust tone, item count, or SEO keyword for each article.",
              color: "bg-blue-50 text-blue-600",
            },
            {
              step: "3",
              title: "Generate & Publish",
              desc: "Articles are saved locally. Optionally push to WordPress, Shopify, or download as HTML.",
              color: "bg-emerald-50 text-emerald-600",
            },
          ].map(({ step, title, desc, color }) => (
            <div key={step} className="flex gap-3">
              <div className={`w-8 h-8 rounded-lg ${color} flex items-center justify-center font-bold text-sm flex-shrink-0`}>
                {step}
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-800 mb-0.5">{title}</p>
                <p className="text-xs text-slate-500 leading-relaxed">{desc}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-5 pt-4 border-t border-slate-100">
          <Link
            href="/batch"
            className="premium-button premium-button-primary text-sm gap-2 h-10 px-6"
          >
            <FilePlus size={15} /> Launch Batch Generator <ChevronRight size={14} />
          </Link>
        </div>
      </div>
    </div>
  );
}
