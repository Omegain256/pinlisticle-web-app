/**
 * Unified image utility for compression and resizing.
 * Designed to resolve OOM (Error 5) issues by shrinking images before state storage.
 */

export async function compressImageBase64(
    base64: string, 
    maxWidth = 1024, 
    quality = 0.75
): Promise<string> {
    if (typeof window === "undefined") return base64; // Fallback for server-side
    
    // Strip prefix if present (e.g., "data:image/jpeg;base64,")
    const cleanBase64 = base64.includes(",") ? base64.split(",")[1] : base64;
    
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            let width = img.width;
            let height = img.height;
            
            // Only resize if it's larger than the target
            if (width > maxWidth) {
                height = Math.round((height * maxWidth) / width);
                width = maxWidth;
            }
            
            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            
            const ctx = canvas.getContext("2d");
            if (!ctx) {
                console.warn("[ImageUtil] Canvas context failed, returning original.");
                return resolve(cleanBase64);
            }
            
            // Draw and re-encode as JPEG with specific quality
            ctx.drawImage(img, 0, 0, width, height);
            const dataUrl = canvas.toDataURL("image/jpeg", quality);
            
            // Return only the base64 portion
            resolve(dataUrl.split(",")[1]);
        };
        
        img.onerror = (err) => {
            console.error("[ImageUtil] Failed to load image for compression:", err);
            resolve(cleanBase64);
        };
        
        img.src = `data:image/jpeg;base64,${cleanBase64}`;
    });
}

/**
 * Iterates through an entire article object and compresses all contained images.
 */
export async function compressArticleImages(article: any): Promise<any> {
    if (!article || !article.listicle_items) return article;
    
    const startTime = Date.now();
    console.log(`[ImageUtil] Starting article compression...`);

    // 1. Compress featured image
    if (article.featured_image_base64) {
        article.featured_image_base64 = await compressImageBase64(article.featured_image_base64);
    }

    // 2. Compress item images
    for (let i = 0; i < article.listicle_items.length; i++) {
        const item = article.listicle_items[i];
        
        // AI Generated images
        if (item.image_base64) {
            item.image_base64 = await compressImageBase64(item.image_base64);
        }
        
        // Scraped web images (if present in the same field or web_image field)
        if (item.web_image?.image_base64 && item.web_image.image_base64 !== "[STRIPPED]") {
            item.web_image.image_base64 = await compressImageBase64(item.web_image.image_base64);
        }
    }

    console.log(`[ImageUtil] Compression complete in ${Date.now() - startTime}ms.`);
    return article;
}
