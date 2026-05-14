import { get, set, del, keys } from 'idb-keyval';
import { compressArticleImages, base64ToBlob, blobToBase64 } from '@/lib/image';

export interface ArticleMetadata {
    id: string;
    topic: string;
    generatedAt: string;
    status: "success" | "error";
    seoTitle?: string; // Cache for list display/search
}

export interface GeneratedArticle extends ArticleMetadata {
    keyword?: string;
    tone?: string;
    count?: number;
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

const META_STORE_KEY = "pinlisticle_articles_metadata";
const LEGACY_STORE_KEY = "pinlisticle_articles";
const DATA_PREFIX = "pinlisticle_data_";
const BINARY_PREFIX = "pinlisticle_bin_";

// Session-scoped guard: migration only runs ONCE per page load, not on every saveArticle
let _migrationCheckedThisSession = false;

function isClient() {
    return typeof window !== "undefined";
}

/** Direct metadata read — does NOT trigger migration. Used internally by saveArticle/deleteArticle. */
async function getMetadataDirect(): Promise<ArticleMetadata[]> {
    try {
        const val = await get(META_STORE_KEY);
        return Array.isArray(val) ? val : [];
    } catch {
        return [];
    }
}

/**
 * Migration: Checks if old massive storage exists and splits it into the new sharded format.
 * This is the critical fix for "Page Unresponsive" errors on existing bloated databases.
 */
async function runMigrationIfNeeded() {
    if (!isClient()) return;
    // Only run once per page session — prevents repeated DB locking on every saveArticle
    if (_migrationCheckedThisSession) return;
    _migrationCheckedThisSession = true;

    const legacyData = await get(LEGACY_STORE_KEY);
    
    // If legacy data is an array, we need to shard it
    if (Array.isArray(legacyData) && legacyData.length > 0) {
        console.log(`[Storage] Sharding legacy database (${legacyData.length} items)...`);
        
        const metadataList: ArticleMetadata[] = [];
        
        for (const fullArticle of legacyData) {
            // Fast shard — no compression here. Old images are compressed lazily on first access via getArticle.
            const meta: ArticleMetadata = {
                id: fullArticle.id,
                topic: fullArticle.topic,
                generatedAt: fullArticle.generatedAt,
                status: fullArticle.status,
                seoTitle: fullArticle.data?.seo_title
            };
            metadataList.push(meta);
            
            // Save article to its own key
            await set(`${DATA_PREFIX}${fullArticle.id}`, fullArticle);

            // Yield: let the browser process other events between each article
            await new Promise(r => setTimeout(r, 0));
        }
        
        // Save the new metadata list
        await set(META_STORE_KEY, metadataList);
        
        // Clear legacy key to prevent future migrations
        await del(LEGACY_STORE_KEY);
        console.log(`[Storage] Migration complete.`);
    }
}

/**
 * Lists ONLY metadata for all articles. Fast and lightweight.
 */
export async function listArticles(): Promise<ArticleMetadata[]> {
    if (!isClient()) return [];
    
    // Always trigger migration check on list load
    await runMigrationIfNeeded();
    
    try {
        const val = await get(META_STORE_KEY);
        return Array.isArray(val) ? val : [];
    } catch {
        return [];
    }
}

/**
 * Saves an article with Binary Sharding.
 * Heavy images are converted to binary Blobs and stored separately to keep JSON small.
 */
export async function saveArticle(article: GeneratedArticle): Promise<void> {
    if (!isClient()) return;
    
    // 1. Extract and store images as binary Blobs
    const binaryWrites: Promise<void>[] = [];
    
    if (article.data) {
        // Handle featured image
        if (article.data.featured_image_base64 && article.data.featured_image_base64.length > 50) {
            const blob = base64ToBlob(article.data.featured_image_base64);
            const binKey = `${BINARY_PREFIX}${article.id}_featured`;
            binaryWrites.push(set(binKey, blob));
            article.data.featured_image_base64 = "[BINARY_POINTER]";
        }

        // Handle listicle items
        for (let i = 0; i < article.data.listicle_items.length; i++) {
            const item = article.data.listicle_items[i];
            
            // AI Images
            if (item.image_base64 && item.image_base64.length > 50 && item.image_base64 !== "[BINARY_POINTER]") {
                const blob = base64ToBlob(item.image_base64);
                const binKey = `${BINARY_PREFIX}${article.id}_item_${i}`;
                binaryWrites.push(set(binKey, blob));
                item.image_base64 = "[BINARY_POINTER]";
            }

            // Web Images
            if (item.web_image?.image_base64 && item.web_image.image_base64.length > 50 && item.web_image.image_base64 !== "[BINARY_POINTER]") {
                const blob = base64ToBlob(item.web_image.image_base64, item.web_image.mime_type);
                const binKey = `${BINARY_PREFIX}${article.id}_web_${i}`;
                binaryWrites.push(set(binKey, blob));
                item.web_image.image_base64 = "[BINARY_POINTER]";
            }
        }
    }

    // 2. Update metadata
    const metadata = await getMetadataDirect();
    const metaObj: ArticleMetadata = {
        id: article.id,
        topic: article.topic,
        generatedAt: article.generatedAt,
        status: article.status,
        seoTitle: article.data?.seo_title
    };
    
    const idx = metadata.findIndex((m) => m.id === article.id);
    if (idx >= 0) {
        metadata[idx] = metaObj;
    } else {
        metadata.unshift(metaObj);
    }
    
    // 3. Save everything
    await Promise.all([
        ...binaryWrites,
        set(META_STORE_KEY, metadata),
        set(`${DATA_PREFIX}${article.id}`, article)
    ]);
}

/**
 * Retrieves full article data by ID.
 * Performs lazy one-time compression if images are still oversized (pre-fix articles).
 */
/**
 * Retrieves full article data and re-hydrates binary images.
 */
export async function getArticle(id: string): Promise<GeneratedArticle | undefined> {
    if (!isClient()) return undefined;
    try {
        const article = await get(`${DATA_PREFIX}${id}`) as GeneratedArticle | undefined;
        if (!article || !article.data) return article;

        // Re-hydrate images from binary storage
        const hydrationTasks: Promise<void>[] = [];

        // Featured image
        if (article.data.featured_image_base64 === "[BINARY_POINTER]") {
            hydrationTasks.push((async () => {
                const blob = await get(`${BINARY_PREFIX}${id}_featured`) as Blob;
                if (blob) article.data!.featured_image_base64 = await blobToBase64(blob);
            })());
        }

        // Listicle items
        for (let i = 0; i < article.data.listicle_items.length; i++) {
            const item = article.data.listicle_items[i];
            
            if (item.image_base64 === "[BINARY_POINTER]") {
                hydrationTasks.push((async (idx: number) => {
                    const blob = await get(`${BINARY_PREFIX}${id}_item_${idx}`) as Blob;
                    if (blob) article.data!.listicle_items[idx].image_base64 = await blobToBase64(blob);
                })(i));
            }

            if (item.web_image?.image_base64 === "[BINARY_POINTER]") {
                hydrationTasks.push((async (idx: number) => {
                    const blob = await get(`${BINARY_PREFIX}${id}_web_${idx}`) as Blob;
                    if (blob) article.data!.listicle_items[idx].web_image!.image_base64 = await blobToBase64(blob);
                })(i));
            }
        }

        if (hydrationTasks.length > 0) {
            await Promise.all(hydrationTasks);
        }

        return article;
    } catch (err) {
        console.error("[Storage] Failed to hydrate article:", err);
        return undefined;
    }
}

/**
 * Deletes an article and its sharded data.
 */
/**
 * Deletes an article and all associated binary binary Blobs.
 */
export async function deleteArticle(id: string): Promise<void> {
    if (!isClient()) return;
    const metadata = await getMetadataDirect();
    const updated = metadata.filter((m) => m.id !== id);
    
    // Find all binary keys for this article
    const allKeys = await keys();
    const binaryKeysToDelete = allKeys.filter(k => 
        typeof k === 'string' && k.startsWith(`${BINARY_PREFIX}${id}`)
    );

    await Promise.all([
        set(META_STORE_KEY, updated),
        del(`${DATA_PREFIX}${id}`),
        ...binaryKeysToDelete.map(k => del(k))
    ]);
}

/**
 * Rebuilds the HTML block for WordPress. (Untouched logic)
 */
export function buildArticleHtml(data: GeneratedArticle["data"], amazonTag?: string, internalLinks?: string): string {
    if (!data) return "";
    let html = `<!-- wp:paragraph {"dropCap":true} -->\n<p class="has-drop-cap">${data.article_intro}</p>\n<!-- /wp:paragraph -->\n\n`;

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
        html += `<!-- wp:group {"className":"pinlisticle-item-row"} -->\n<div class="wp-block-group pinlisticle-item-row">\n`;
        html += `<!-- wp:heading -->\n<h2 class="wp-block-heading" style="text-transform: uppercase;">${index + 1}. ${item.title}</h2>\n<!-- /wp:heading -->\n\n`;

        if (item.wp_attachment_id && item.wp_source_url) {
            html += `<!-- wp:image {"id":${item.wp_attachment_id},"sizeSlug":"large","linkDestination":"none","className":"pinlisticle-item-img"} -->\n<figure class="wp-block-image size-large pinlisticle-item-img"><img src="${item.wp_source_url}" alt="${item.title}" class="wp-image-${item.wp_attachment_id}"/></figure>\n<!-- /wp:image -->\n`;
        } else if (item.web_image) {
            const imgData = item.web_image.image_base64;
            const fallbackUrl = item.web_image.attribution?.sourceUrl || item.web_image.original_url;
            const mimeType = item.web_image.mime_type || "image/jpeg";
            const credit = item.web_image.attribution?.creditLine || item.web_image.attribution?.siteName || "";

            html += `<!-- wp:html -->\n`;
            html += `<figure class="wp-block-image pinlisticle-item-img" style="margin-bottom:0.5rem">\n`;
            if (imgData && imgData !== "[STRIPPED]" && imgData !== "[STRIPPED_FOR_LLM]") {
                html += `  <img src="data:${mimeType};base64,${imgData}" alt="${item.title}" style="width:100%;height:auto;display:block;"/>\n`;
            } else if (fallbackUrl) {
                html += `  <img src="${fallbackUrl}" alt="${item.title}" style="width:100%;height:auto;display:block;opacity:0.6;"/>\n`;
                html += `  <p style="font-size:0.6rem;color:red;">[Preview Only - Real Photo Delayed]</p>\n`;
            }
            if (credit) {
                html += `  <figcaption style="font-size:0.7rem;color:#888;margin-top:0.25rem;text-align:right;">${credit}</figcaption>\n`;
            }
            html += `</figure>\n`;
            html += `<!-- /wp:html -->\n`;
        } else if (item.image_base64) {
            html += `<!-- wp:image {"className":"pinlisticle-item-img"} -->\n<figure class="wp-block-image pinlisticle-item-img"><img src="data:image/jpeg;base64,${item.image_base64}" alt="${item.title}"/></figure>\n<!-- /wp:image -->\n`;
        }

        html += `<!-- wp:paragraph -->\n<p>${item.content}</p>\n<!-- /wp:paragraph -->\n\n`;
        html += `</div>\n<!-- /wp:group -->\n\n`;

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
