// Article Store — localStorage-backed persistence for standalone (non-WordPress) mode

export interface GeneratedArticle {
    id: string;
    topic: string;
    keyword?: string;
    tone?: string;
    count?: number;
    generatedAt: string;
    status: "success" | "error";
    data?: {
        seo_title: string;
        seo_desc: string;
        pinterest_title: string;
        pinterest_desc: string;
        article_intro: string;
        featured_image_base64?: string;
        listicle_items: Array<{
            title: string;
            content: string;
            image_prompt?: string;
            image_base64?: string;
            wp_attachment_id?: number;
            wp_source_url?: string;
            web_image?: {
                image_base64: string;
                mime_type: string;
                original_url: string;
                file_size_kb: number;
                attribution: {
                    siteName: string;
                    articleTitle: string;
                    sourceUrl: string;
                    creditLine: string;
                };
            };
            product_recommendations?: Array<{
                product_name: string;
                amazon_search_term: string;
            }>;
        }>;
    };
    html?: string;
    errorMessage?: string;
    wpPostUrl?: string;
}

import { get, set } from 'idb-keyval';

const STORE_KEY = "pinlisticle_articles";

function isClient() {
    return typeof window !== "undefined";
}

export async function listArticles(): Promise<GeneratedArticle[]> {
    if (!isClient()) return [];
    try {
        const val = await get(STORE_KEY);
        return Array.isArray(val) ? val : [];
    } catch {
        return [];
    }
}

export async function saveArticle(article: GeneratedArticle): Promise<void> {
    if (!isClient()) return;
    const articles = await listArticles();
    const idx = articles.findIndex((a) => a.id === article.id);
    if (idx >= 0) {
        articles[idx] = article;
    } else {
        articles.unshift(article);
    }
    await set(STORE_KEY, articles);
}

export async function getArticle(id: string): Promise<GeneratedArticle | undefined> {
    const articles = await listArticles();
    return articles.find((a) => a.id === id);
}

export async function deleteArticle(id: string): Promise<void> {
    if (!isClient()) return;
    const articles = await listArticles();
    const updated = articles.filter((a) => a.id !== id);
    await set(STORE_KEY, updated);
}

export function buildArticleHtml(data: GeneratedArticle["data"], amazonTag?: string, internalLinks?: string): string {
    if (!data) return "";
    let html = `<!-- wp:paragraph {"dropCap":true} -->\n<p class="has-drop-cap">${data.article_intro}</p>\n<!-- /wp:paragraph -->\n\n`;

    // Parse internal links once — format expected: one URL per line (optional label after space)
    const parsedLinks: { url: string; label: string }[] = [];
    if (internalLinks) {
        internalLinks.split("\n").forEach(line => {
            const trimmed = line.trim();
            if (!trimmed) return;
            const [url, ...rest] = trimmed.split(" ");
            parsedLinks.push({ url, label: rest.join(" ") || url });
        });
    }


    data.listicle_items.forEach((item, index) => {
        // Wrap everything in a standard block group
        html += `<!-- wp:group {"className":"pinlisticle-item-row"} -->\n<div class="wp-block-group pinlisticle-item-row">\n`;

        // 1. H2 Title
        html += `<!-- wp:heading -->\n<h2 class="wp-block-heading" style="text-transform: uppercase;">${index + 1}. ${item.title}</h2>\n<!-- /wp:heading -->\n\n`;

        // 2. Image (priority: WP uploaded > web_image with attribution > AI-generated base64)
        if (item.wp_attachment_id && item.wp_source_url) {
            html += `<!-- wp:image {"id":${item.wp_attachment_id},"sizeSlug":"large","linkDestination":"none","className":"pinlisticle-item-img"} -->\n<figure class="wp-block-image size-large pinlisticle-item-img"><img src="${item.wp_source_url}" alt="${item.title}" class="wp-image-${item.wp_attachment_id}"/></figure>\n<!-- /wp:image -->\n`;
        } else if (item.web_image?.image_base64) {
            // Web image: render with attribution figcaption
            const mimeType = item.web_image.mime_type || "image/jpeg";
            const credit = item.web_image.attribution?.creditLine || "";
            html += `<!-- wp:html -->\n`;
            html += `<figure class="wp-block-image pinlisticle-item-img" style="margin-bottom:0.5rem">\n`;
            html += `  <img src="data:${mimeType};base64,${item.web_image.image_base64}" alt="${item.title}" style="width:100%;height:auto;display:block;"/>\n`;
            if (credit) {
                html += `  <figcaption style="font-size:0.7rem;color:#888;margin-top:0.25rem;text-align:right;">${credit}</figcaption>\n`;
            }
            html += `</figure>\n`;
            html += `<!-- /wp:html -->\n`;
        } else if (item.image_base64) {
            html += `<!-- wp:image {"className":"pinlisticle-item-img"} -->\n<figure class="wp-block-image pinlisticle-item-img"><img src="data:image/jpeg;base64,${item.image_base64}" alt="${item.title}"/></figure>\n<!-- /wp:image -->\n`;
        }

        // 3. Paragraph Content
        html += `<!-- wp:paragraph -->\n<p>${item.content}</p>\n<!-- /wp:paragraph -->\n\n`;

        html += `</div>\n<!-- /wp:group -->\n\n`;

        // 4. Shop This Look (after each item if amazonTag present)
        if (item.product_recommendations && item.product_recommendations.length > 0 && amazonTag) {
            const products = item.product_recommendations.slice(0, 3);
            html += `<!-- wp:html -->\n`;
            html += `<div style="margin: 2.5rem 0; padding: 2rem; background: #fafaf9; border: 1px solid #f0efed; border-radius: 12px;">\n`;
            html += `  <h3 style="font-size: 1rem; font-weight: 800; letter-spacing: 0.15em; color: #111; margin-bottom: 1.5rem; text-transform: uppercase;">SHOP THIS LOOK</h3>\n`;
            html += `  <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1.25rem;">\n`;
            products.forEach(prod => {
                const searchUrl = `https://www.amazon.com/s?k=${encodeURIComponent(prod.amazon_search_term)}&tag=${amazonTag}`;
                html += `    <div style="background: #fff; border: 1px solid #eae8e4; border-radius: 8px; padding: 1.25rem; display: flex; flex-direction: column; justify-content: space-between; gap: 1.25rem; box-shadow: 0 4px 12px rgba(0,0,0,0.03);">\n`;
                html += `      <span style="font-size: 0.95rem; color: #333; font-weight: 600; line-height: 1.4;">${prod.product_name}</span>\n`;
                html += `      <a href="${searchUrl}" target="_blank" rel="nofollow" style="display: block; text-align: center; background: #000; color: #fff; font-size: 0.8rem; font-weight: 700; text-decoration: none; padding: 0.75rem 1rem; border-radius: 6px; letter-spacing: 0.5px; text-transform: uppercase; margin-top: auto;">SHOP ITEM &rarr;</a>\n`;
                html += `    </div>\n`;
            });
            html += `  </div>\n`;
            html += `  <p style="font-size: 0.65rem; color: #888; margin-top: 1rem; text-transform: uppercase;">*AS AN AMAZON ASSOCIATE, WE EARN FROM QUALIFYING PURCHASES.</p>\n`;
            html += `</div>\n`;
            html += `<!-- /wp:html -->\n\n`;
        }

        // 5. "Keep Exploring" internal link block — injected after the 3rd item (index 2) and 9th item (index 8)
        const showKeepExploring = (index === 2 || index === 8) && parsedLinks.length > 0;
        if (showKeepExploring) {
            html += `<!-- wp:html -->\n`;
            html += `<div style="margin: 2rem 0; padding: 1.5rem 2rem; background: #f5f3ff; border-left: 4px solid #7c3aed; border-radius: 0 8px 8px 0;">\n`;
            html += `  <p style="font-size: 0.75rem; font-weight: 800; letter-spacing: 0.12em; color: #7c3aed; text-transform: uppercase; margin-bottom: 0.75rem;">Keep Exploring</p>\n`;
            html += `  <ul style="list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.5rem;">\n`;
            parsedLinks.forEach(link => {
                html += `    <li><a href="${link.url}" style="color: #1e1b4b; font-size: 0.9rem; font-weight: 600; text-decoration: none;">${link.label}</a></li>\n`;
            });
            html += `  </ul>\n`;
            html += `</div>\n`;
            html += `<!-- /wp:html -->\n\n`;
        }
    });

    return html;
}

