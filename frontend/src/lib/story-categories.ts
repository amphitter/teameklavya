/**
 * Central category → Material Symbols icon mapping (Part 8 §39).
 *
 * "Do not hard-code icons in individual pages."
 *
 * The server owns the same vocabulary (backend/controllers/story.controller.js
 * CATEGORY_ICONS) and returns `categoryIcon` on every story, so the rail does
 * not need this map for story data. This module exists for the two places that
 * DO need a local answer:
 *   1. rendering before/without a server response (optimistic, offline)
 *   2. the composer's category picker
 *
 * Both sides normalise to the same key so a category named "Hackathon" in one
 * place and "hackathon" in another resolves to the same icon.
 */

export const STORY_CATEGORY_ICONS: Record<string, string> = {
  entertainment: "celebration",
  hackathon: "code",
  workshop: "school",
  sports: "sports_soccer",
  music: "music_note",
  campus: "school",
  robotics: "smart_toy",
  ai: "auto_awesome",
  "ai/ml": "neurology",
  aiml: "neurology",
  ml: "neurology",
  design: "palette",
  tech: "terminal",
  technology: "terminal",
  cultural: "theater_comedy",
  business: "trending_up",
  networking: "groups",
  conference: "mic",
  dance: "music_note",
  photography: "photo_camera",
  gaming: "sports_esports",
  literature: "menu_book",
  art: "brush",
  food: "restaurant",
  travel: "flight",
  fitness: "fitness_center",
  coding: "terminal",
  webinar: "video_call",
  competition: "emoji_events",
};

export const STORY_CATEGORY_LABELS: Record<string, string> = {
  entertainment: "Entertainment",
  hackathon: "Hackathon",
  workshop: "Workshop",
  sports: "Sports",
  music: "Music",
  campus: "Campus",
  robotics: "Robotics",
  ai: "AI / ML",
  "ai/ml": "AI / ML",
  aiml: "AI / ML",
  ml: "AI / ML",
  design: "Design",
  tech: "Tech",
  technology: "Tech",
  cultural: "Cultural",
  business: "Business",
  networking: "Networking",
  conference: "Conference",
  dance: "Dance",
  photography: "Photography",
  gaming: "Gaming",
  literature: "Literature",
  art: "Art",
  food: "Food",
  travel: "Travel",
  fitness: "Fitness",
  coding: "Coding",
  webinar: "Webinar",
  competition: "Competition",
};

/** Fallback for anything unrecognised — never a letter, never a blank. */
export const DEFAULT_STORY_ICON = "auto_awesome";
export const DEFAULT_STORY_LABEL = "Other";

/** Normalise a raw category string to its canonical lowercase key. */
export function categoryKey(category?: string | null): string {
  return String(category || "").toLowerCase().trim();
}

/** Material Symbols ligature name for a category (§39). */
export function storyCategoryIcon(category?: string | null): string {
  return STORY_CATEGORY_ICONS[categoryKey(category)] || DEFAULT_STORY_ICON;
}

/** Human label for a category. Falls back to the raw value, title-cased. */
export function storyCategoryLabel(category?: string | null): string {
  const key = categoryKey(category);
  if (STORY_CATEGORY_LABELS[key]) return STORY_CATEGORY_LABELS[key];
  const raw = String(category || "").trim();
  return raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : DEFAULT_STORY_LABEL;
}

/** Categories offered in the story composer, in presentation order. */
export const PICKABLE_STORY_CATEGORIES = [
  "hackathon",
  "workshop",
  "campus",
  "tech",
  "ai/ml",
  "design",
  "entertainment",
  "sports",
  "music",
  "cultural",
  "robotics",
  "networking",
  "competition",
  "conference",
];
