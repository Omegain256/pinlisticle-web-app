// STAGE 1: Article Brief (Topic Classification)

// STAGE 1: Article Brief (Topic Classification)
export const TopicClassificationSchema = {
  type: "OBJECT",
  properties: {
    topic_type: { type: "STRING", enum: ["evergreen", "seasonal", "trend-sensitive", "shopping-led"] },
    freshness_tier: { type: "STRING", enum: ["low", "medium", "high"] },
    niche: { type: "STRING", enum: ["fashion", "home-decor", "beauty", "food", "travel", "wellness", "diy", "parenting"] },
    search_intent: { type: "STRING", enum: ["inspirational", "informational", "transactional", "mixed"] },
    recommended_article_archetype: { type: "STRING", enum: ["wearable-ideas", "mistakes-to-avoid", "capsule-wardrobe", "budget-vs-elevated", "occasion-based", "trend-explainer", "body-aware", "weather-specific"] },
    recommended_list_length: { type: "INTEGER" },
    seasonality_notes: { type: "STRING" },
    risk_flags: { type: "ARRAY", items: { type: "STRING" } }
  },
  required: ["topic_type", "freshness_tier", "niche", "search_intent", "recommended_article_archetype", "recommended_list_length", "seasonality_notes", "risk_flags"]
};

// STAGE 2: Web Research Evidence Pack
export const EvidencePackSchema = {
  type: "OBJECT",
  properties: {
    sources_used: { type: "INTEGER" },
    consensus_points: { type: "ARRAY", items: { type: "STRING" } },
    emerging_angles: { type: "ARRAY", items: { type: "STRING" } },
    specific_product_mentions: { type: "ARRAY", items: { type: "STRING" } },
    what_to_avoid: { type: "ARRAY", items: { type: "STRING" } },
    freshness_date: { type: "STRING" },
    source_urls: { type: "ARRAY", items: { type: "STRING" } }
  },
  required: ["sources_used", "consensus_points", "emerging_angles", "specific_product_mentions", "what_to_avoid", "freshness_date", "source_urls"]
};

// STAGE 3: Item Cards Array
export const ItemCardsSchema = {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    properties: {
      item_index: { type: "INTEGER" },
      item_name: { type: "STRING" },
      why_it_works: { type: "ARRAY", items: { type: "STRING" } },
      trend_support: { type: "ARRAY", items: { type: "STRING" } },
      styling_notes: {
        type: "OBJECT",
        properties: {
          colors: { type: "ARRAY", items: { type: "STRING" } },
          fabrics: { type: "ARRAY", items: { type: "STRING" } },
          accessories: { type: "ARRAY", items: { type: "STRING" } },
          optional_swap: { type: "STRING" }
        },
        required: ["colors", "fabrics", "accessories", "optional_swap"]
      },
      reader_value: { type: "STRING" },
      freshness_signal: { type: "STRING" },
      image_prompt_seed: {
        type: "OBJECT",
        properties: {
          subject: { type: "STRING" },
          setting: { type: "STRING" },
          shot: { type: "STRING" },
          lighting: { type: "STRING" },
          camera: { type: "STRING" }
        },
        required: ["subject", "setting", "shot", "lighting", "camera"]
      }
    },
    required: ["item_index", "item_name", "why_it_works", "trend_support", "styling_notes", "reader_value", "freshness_signal", "image_prompt_seed"]
  }
};

// STAGE 4: Final Draft Article Output
export const DraftArticleSchema = {
  type: "OBJECT",
  properties: {
    seo_title: { type: "STRING" },
    seo_desc: { type: "STRING" },
    pinterest_title: { type: "STRING" },
    article_intro: { type: "STRING" },
    article_outro: { type: "STRING" },
    listicle_items: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          title: { type: "STRING" },
          content: { type: "STRING" },
          has_swap: { type: "BOOLEAN" },
          image_prompt: { type: "STRING" },
          product_recommendations: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                product_name: { type: "STRING" },
                amazon_search_term: { type: "STRING" }
              },
              required: ["product_name", "amazon_search_term"]
            }
          }
        },
        required: ["title", "content", "has_swap", "image_prompt", "product_recommendations"]
      }
    }
  },
  required: ["seo_title", "seo_desc", "pinterest_title", "article_intro", "article_outro", "listicle_items"]
};

// STAGE 5: Editorial QA Scorer
export const QAScoreSchema = {
  type: "OBJECT",
  properties: {
    source_depth: { type: "OBJECT", properties: { score: { type: "INTEGER" }, notes: { type: "STRING" } }, required: ["score", "notes"] },
    freshness: { type: "OBJECT", properties: { score: { type: "INTEGER" }, notes: { type: "STRING" } }, required: ["score", "notes"] },
    specificity: { type: "OBJECT", properties: { score: { type: "INTEGER" }, notes: { type: "STRING" } }, required: ["score", "notes"] },
    redundancy: { type: "OBJECT", properties: { score: { type: "INTEGER" }, notes: { type: "STRING" } }, required: ["score", "notes"] },
    reader_usefulness: { type: "OBJECT", properties: { score: { type: "INTEGER" }, notes: { type: "STRING" } }, required: ["score", "notes"] },
    pinterest_hook_strength: { type: "OBJECT", properties: { score: { type: "INTEGER" }, notes: { type: "STRING" } }, required: ["score", "notes"] },
    overall: { type: "INTEGER" },
    pass: { type: "BOOLEAN" },
    weak_sections: { type: "ARRAY", items: { type: "INTEGER" } },
    repair_instructions: { type: "STRING" }
  },
  required: ["source_depth", "freshness", "specificity", "redundancy", "reader_usefulness", "pinterest_hook_strength", "overall", "pass", "weak_sections", "repair_instructions"]
};

// STAGE 6: Style DNA
export const StyleDNASchema = {
  type: "OBJECT",
  properties: {
    article_id: { type: "STRING" },
    style_family: { type: "STRING" },
    base_subject: { type: "STRING" },
    composition_pool: { type: "ARRAY", items: { type: "STRING" } },
    camera_pool: { type: "ARRAY", items: { type: "STRING" } },
    lighting_pool: { type: "ARRAY", items: { type: "STRING" } },
    palette_base: { type: "ARRAY", items: { type: "STRING" } },
    setting_pool: { type: "ARRAY", items: { type: "STRING" } },
    realism_constraints: { type: "ARRAY", items: { type: "STRING" } },
    diversity_rotation: {
      type: "OBJECT",
      properties: {
        age_range: { type: "STRING" },
        body_types: { type: "ARRAY", items: { type: "STRING" } },
        hair_textures: { type: "ARRAY", items: { type: "STRING" } }
      },
      required: ["age_range", "body_types", "hair_textures"]
    },
    do_not_use: { type: "ARRAY", items: { type: "STRING" } },
    model: { type: "STRING" },
    negative_prompt: { type: "STRING" }
  },
  required: ["article_id", "style_family", "base_subject", "composition_pool", "camera_pool", "lighting_pool", "palette_base", "setting_pool", "realism_constraints", "diversity_rotation", "do_not_use", "model", "negative_prompt"]
};
