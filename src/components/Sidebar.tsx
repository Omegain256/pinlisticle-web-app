"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
    LayoutDashboard,
    FilePlus,
    Settings,
    BookOpen,
    Library,
    Globe,
    ShoppingBag,
} from "lucide-react";
import React from "react";

function NavLabel({ children }: { children: React.ReactNode }) {
    return <span className="nav-section-label">{children}</span>;
}

function NavItem({
    href,
    icon: Icon,
    children,
    disabled = false,
    badge,
}: {
    href: string;
    icon: any;
    children: React.ReactNode;
    disabled?: boolean;
    badge?: string;
}) {
    const pathname = usePathname();
    const isActive = pathname === href || (href !== "/" && pathname.startsWith(href));

    if (disabled) {
        return (
            <div className="side-nav-item side-nav-item-disabled">
                <Icon size={16} />
                <span>{children}</span>
                {badge && (
                    <span className="ml-auto text-[0.6rem] font-bold uppercase bg-white/10 text-white/40 px-1.5 py-0.5 rounded">
                        {badge}
                    </span>
                )}
            </div>
        );
    }

    return (
        <Link href={href} className={`side-nav-item ${isActive ? "active" : ""}`}>
            <Icon size={16} />
            <span>{children}</span>
            {badge && (
                <span className="ml-auto text-[0.6rem] font-bold uppercase bg-purple-500/30 text-purple-300 px-1.5 py-0.5 rounded">
                    {badge}
                </span>
            )}
        </Link>
    );
}

export default function Sidebar() {
    return (
        <aside className="sidebar">
            <div className="sidebar-logo">
                <h1>
                    <BookOpen size={18} className="text-purple-400" />
                    PinListicle
                </h1>
                <p>AI Listicle Studio</p>
            </div>

            <nav className="sidebar-nav">
                <NavLabel>MAIN</NavLabel>
                <NavItem href="/" icon={LayoutDashboard}>Dashboard</NavItem>
                <NavItem href="/batch" icon={FilePlus}>Batch Generator</NavItem>
                <NavItem href="/articles" icon={Library}>Articles Library</NavItem>

                <NavLabel>INTEGRATIONS</NavLabel>
                <NavItem href="/settings" icon={Globe}>WordPress</NavItem>
                <NavItem href="/settings" icon={ShoppingBag} disabled badge="Soon">
                    Shopify
                </NavItem>

                <NavLabel>ACCOUNT</NavLabel>
                <NavItem href="/settings" icon={Settings}>Settings</NavItem>
            </nav>

            <div className="sidebar-footer">v0.2.0 &nbsp;·&nbsp; AI Standalone Mode</div>
        </aside>
    );
}
