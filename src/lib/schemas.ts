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
    style_archetype: { type: "STRING", enum: ["casual", "luxury", "sporty", "face", "eye", "hair", "nails"] },
    subject_demographic: { type: "STRING" }, // e.g. "plus size", "mature women", "teens"
    recommended_list_length: { type: "INTEGER" },
    seasonality_notes: { type: "STRING" },
    risk_flags: { type: "ARRAY", items: { type: "STRING" } }
  },
  required: ["topic_type", "freshness_tier", "niche", "search_intent", "recommended_article_archetype", "style_archetype", "recommended_list_length", "seasonality_notes", "risk_flags"]
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
          shot_type: { type: "STRING" }, // e.g. "Full-body", "Medium", "Detail"
          outfit_description: { type: "STRING" },
          pose_instruction: { type: "STRING" }
        },
        required: ["shot_type", "outfit_description", "pose_instruction"]
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
          item_index: { type: "INTEGER" },
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
        required: ["item_index", "title", "content", "has_swap", "image_prompt", "product_recommendations"]
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
    subject_definition: { type: "STRING" }, // Article-wide consistent person
    location_definition: { type: "STRING" }, // Article-wide consistent location
    lighting_and_weather: { type: "STRING" }, // Article-wide consistent lighting
    camera_and_aesthetic: { type: "STRING" }, // Article-wide consistent tech vibe
    texture_and_finish: { type: "STRING" }, // Article-wide consistent skin/film texture
    palette_base: { type: "ARRAY", items: { type: "STRING" } },
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
    negative_prompt: { type: "STRING" }
  },
  required: ["article_id", "style_family", "subject_definition", "location_definition", "lighting_and_weather", "camera_and_aesthetic", "texture_and_finish", "palette_base", "realism_constraints", "diversity_rotation", "negative_prompt"]
};

// STAGE 2.5: Visual Intelligence — Per-outfit Visual DNA derived from real reference images
export const VisualDNAItemSchema = {
  type: "OBJECT",
  properties: {
    outfit_id:     { type: "INTEGER" },
    title:         { type: "STRING" },
    key_pieces:    { type: "ARRAY", items: { type: "STRING" } },
    color_palette: { type: "ARRAY", items: { type: "STRING" } }, // hex codes or descriptive names
    aesthetic:     { type: "STRING" }, // e.g. "quiet luxury, minimalist"
    composition:   { type: "STRING" }, // e.g. "full body, street style"
    lighting:      { type: "STRING" }, // e.g. "natural daylight, soft shadows"
    phone_color:   { type: "STRING", enum: ["White Titanium", "Desert Titanium"] },
    pose:          { type: "STRING" }, // natural stance description
    image_prompt:  { type: "STRING" }, // fully assembled Imagen-ready prompt
  },
  required: ["outfit_id", "title", "key_pieces", "color_palette", "aesthetic", "composition", "lighting", "phone_color", "pose", "image_prompt"],
};

export const VisualIntelligenceSchema = {
  type: "ARRAY",
  items: VisualDNAItemSchema,
};

