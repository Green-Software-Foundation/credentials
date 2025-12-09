import type { Credential } from "./credentials";
import { supabase } from "@/lib/supabase";

export type Award = {
  /**
   * Unique identifier used in the URL, e.g. /awards/{uuid}
   */
  id: string;
  /**
   * Full name of the person who earned the credential.
   */
  recipientName: string;
  /**
   * Slug of the associated credential/badge (see credentials.yaml).
   */
  credentialSlug: string;
  /**
   * ISO 8601 date string when the credential was issued.
   */
  issuedAt: string;
  /**
   * Optional custom message to highlight on the certificate.
   */
  personalizedDescription?: string;
  /**
   * Public URL of the generated certificate asset (PDF).
   */
  certificateUrl?: string;
};

export type AwardWithCredential = Award & {
  credential: Credential;
};

export async function getAwards(): Promise<Award[]> {
  const { data, error } = await supabase
    .from("awards")
    .select(
      `
      id,
      issued_at,
      personalized_description,
      people (name),
      badges (slug)
    `,
    )
    .order("issued_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to fetch awards: ${error.message}`);
  }

  return data.map((award) => ({
    id: award.id,
    recipientName: Array.isArray(award.people)
      ? (award.people as any)[0]?.name
      : (award.people as any)?.name,
    credentialSlug: Array.isArray(award.badges)
      ? (award.badges as any)[0]?.slug
      : (award.badges as any)?.slug,
    issuedAt: award.issued_at,
    personalizedDescription: award.personalized_description,
    certificateUrl: supabase.storage.from("certificates").getPublicUrl(`awards/${award.id}.pdf`)
      .data.publicUrl,
  }));
}

export async function getAwardById(id: string): Promise<Award | undefined> {
  const { data, error } = await supabase
    .from("awards")
    .select(
      `
      id,
      issued_at,
      personalized_description,
      people (name),
      badges (slug)
    `,
    )
    .eq("id", id)
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      return undefined; // Not found
    }
    throw new Error(`Failed to fetch award: ${error.message}`);
  }

  return {
    id: data.id,
    recipientName: Array.isArray(data.people)
      ? (data.people as any)[0]?.name
      : (data.people as any)?.name,
    credentialSlug: Array.isArray(data.badges)
      ? (data.badges as any)[0]?.slug
      : (data.badges as any)?.slug,
    issuedAt: data.issued_at,
    personalizedDescription: data.personalized_description,
    certificateUrl: supabase.storage.from("certificates").getPublicUrl(`awards/${data.id}.pdf`).data
      .publicUrl,
  };
}
