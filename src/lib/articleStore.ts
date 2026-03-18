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

export function buildArticleHtml(data: GeneratedArticle["data"], amazonTag?: string): string {
    if (!data) return "";
    let html = `<!-- wp:paragraph {"dropCap":true} -->\n<p class="has-drop-cap">${data.article_intro}</p>\n<!-- /wp:paragraph -->\n\n`;

    data.listicle_items.forEach((item, index) => {
        // Wrap everything in a standard block group
        html += `<!-- wp:group {"className":"pinlisticle-item-row"} -->\n<div class="wp-block-group pinlisticle-item-row">\n`;

        // 1. H2 Title (Uppercase handled in CSS or via text-transform mapping, but usually kept native to the string)
        html += `<!-- wp:heading -->\n<h2 class="wp-block-heading" style="text-transform: uppercase;">${index + 1}. ${item.title}</h2>\n<!-- /wp:heading -->\n\n`;

        // 2. Image (Moved here: below heading, above content)
        if (item.wp_attachment_id && item.wp_source_url) {
            // WordPress context (use attachment ID block)
            html += `<!-- wp:image {"id":${item.wp_attachment_id},"sizeSlug":"large","linkDestination":"none","className":"pinlisticle-item-img"} -->\n<figure class="wp-block-image size-large pinlisticle-item-img"><img src="${item.wp_source_url}" alt="${item.title}" class="wp-image-${item.wp_attachment_id}"/></figure>\n<!-- /wp:image -->\n`;
        } else if (item.image_base64) {
            // Local fallback
            html += `<!-- wp:image {"className":"pinlisticle-item-img"} -->\n<figure class="wp-block-image pinlisticle-item-img"><img src="data:image/jpeg;base64,${item.image_base64}" alt="${item.title}"/></figure>\n<!-- /wp:image -->\n`;
        }

        // 3. Paragraph Content
        html += `<!-- wp:paragraph -->\n<p>${item.content}</p>\n<!-- /wp:paragraph -->\n\n`;

        html += `</div>\n<!-- /wp:group -->\n\n`;

        if (item.product_recommendations && item.product_recommendations.length > 0 && amazonTag) {
            const products = item.product_recommendations.slice(0, 3);

            // Output pure, unadulterated HTML wrapped in a Gutenberg Custom HTML block with inline CSS
            html += `<!-- wp:html -->\n`;
            html += `<div style="margin: 2.5rem 0; padding: 2rem; background: #fafaf9; border: 1px solid #f0efed; border-radius: 12px;">\n`;
            html += `  <h3 style="font-size: 1rem; font-weight: 800; letter-spacing: 0.15em; color: #111; margin-bottom: 1.5rem; text-transform: uppercase;">RECREATE THIS LOOK</h3>\n`;
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
    });

    return html;
}
