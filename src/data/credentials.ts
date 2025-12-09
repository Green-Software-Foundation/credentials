import { supabase } from "@/lib/supabase";

export type Credential = {
  slug: string;
  title: string;
  shortDescription: string;
  longDescription: string;
  badgeLabel: string;
  heroDescription: string;
  aboutParagraphs: string[];
  whatYoullLearn: string[];
  duration: string;
  cost: string;
  earningCriteria: string[];
  primaryCtaText?: string;
  primaryCtaUrl?: string;
  secondaryCtaText?: string;
  secondaryCtaUrl?: string;
};

export async function getCredentials(): Promise<Credential[]> {
  const { data, error } = await supabase.from("badges").select("*").order("name");

  if (error) {
    throw new Error(`Failed to fetch credentials: ${error.message}`);
  }

  return data.map((badge) => ({
    slug: badge.slug,
    title: badge.name,
    shortDescription: badge.description,
    longDescription: badge.long_description,
    badgeLabel: badge.badge_label,
    heroDescription: badge.hero_description,
    aboutParagraphs: badge.about_paragraphs || [],
    whatYoullLearn: badge.what_youll_learn || [],
    duration: badge.duration,
    cost: badge.cost,
    earningCriteria: badge.earning_criteria || [],
    primaryCtaText: badge.primary_cta_text,
    primaryCtaUrl: badge.primary_cta_url,
    secondaryCtaText: badge.secondary_cta_text,
    secondaryCtaUrl: badge.secondary_cta_url,
  }));
}

export async function getCredentialBySlug(slug: string): Promise<Credential | undefined> {
  const { data, error } = await supabase.from("badges").select("*").eq("slug", slug).single();

  if (error) {
    if (error.code === "PGRST116") {
      return undefined; // Not found
    }
    throw new Error(`Failed to fetch credential: ${error.message}`);
  }

  return {
    slug: data.slug,
    title: data.name,
    shortDescription: data.description,
    longDescription: data.long_description,
    badgeLabel: data.badge_label,
    heroDescription: data.hero_description,
    aboutParagraphs: data.about_paragraphs || [],
    whatYoullLearn: data.what_youll_learn || [],
    duration: data.duration,
    cost: data.cost,
    earningCriteria: data.earning_criteria || [],
    primaryCtaText: data.primary_cta_text,
    primaryCtaUrl: data.primary_cta_url,
    secondaryCtaText: data.secondary_cta_text,
    secondaryCtaUrl: data.secondary_cta_url,
  };
}

// Static export for backwards compatibility with components
// This will be populated at build time
export let credentials: Credential[] = [];

export async function initializeCredentials() {
  credentials = await getCredentials();
}
