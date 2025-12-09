import type { APIContext } from "astro";
import { z } from "zod";

import { generateCertificateAndUpload } from "@/lib/certificatePdf";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { sendAwardNotification, type EmailSendStatus } from "@/lib/resend";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const directPayloadSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  badgeSlug: z.string().optional(),
  courseId: z.string().optional(),
  courseName: z.string().optional(),
  personalizedDescription: z.string().optional(),
});

// Schema for Supabase database webhooks
const supabaseWebhookSchema = z.object({
  type: z.string(),
  table: z.string(),
  schema: z.string(),
  record: z.object({
    course_id: z.string(),
    course_name: z.string().optional(),
    user_email: z.string().email(),
    user_name: z.string(),
    metadata: z.record(z.any()).optional(),
  }),
  old_record: z.any().nullable(),
});

const COURSE_TO_BADGE_SLUG: Record<string, string> = {
  // Primary mapping for the practitioner course.
  "green-software-practitioner": "green-software-practitioner",
  "green software practitioner": "green-software-practitioner",
  "green-software-for-practitioners": "green-software-practitioner",
  "green software for practitioners": "green-software-practitioner",
  gsp: "green-software-practitioner",
  // Sustainable Cloud Specialist.
  "sustainable-cloud-specialist": "sustainable-cloud-specialist",
  "sustainable cloud specialist": "sustainable-cloud-specialist",
  scs: "sustainable-cloud-specialist",
};

const DEFAULT_BADGE_SLUG = "green-software-practitioner";

function normalize(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value.trim().toLowerCase();
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
    },
  });
}

function resolveBadgeSlug(params: {
  badgeSlug?: string;
  courseId?: string;
  courseName?: string;
}): string | undefined {
  const candidates = [
    normalize(params.badgeSlug),
    normalize(params.courseId),
    normalize(params.courseName),
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    if (COURSE_TO_BADGE_SLUG[candidate]) return COURSE_TO_BADGE_SLUG[candidate];
  }

  // Fallback to default badge if nothing else is provided.
  return DEFAULT_BADGE_SLUG;
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function POST({ request }: APIContext) {
  let json: unknown;

  try {
    json = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON payload" }, 400);
  }

  // Try to parse as Supabase webhook payload first
  const supabaseParsed = supabaseWebhookSchema.safeParse(json);
  let name: string,
    email: string,
    badgeSlug: string | undefined,
    courseId: string | undefined,
    courseName: string | undefined,
    personalizedDescription: string | undefined;

  if (supabaseParsed.success) {
    // Handle Supabase webhook payload
    const record = supabaseParsed.data.record;
    name = record.user_name;
    email = record.user_email;
    courseId = record.course_id;
    courseName = record.course_name;
    personalizedDescription = record.metadata?.personalizedDescription;
  } else {
    // Try to parse as direct payload
    const directParsed = directPayloadSchema.safeParse(json);
    if (!directParsed.success) {
      return jsonResponse(
        {
          error: "Invalid payload - must be either Supabase webhook or direct API format",
          details: directParsed.error.flatten(),
        },
        400,
      );
    }

    // Handle direct API payload
    const data = directParsed.data;
    name = data.name;
    email = data.email;
    badgeSlug = data.badgeSlug;
    courseId = data.courseId;
    courseName = data.courseName;
    personalizedDescription = data.personalizedDescription;
  }

  // Always generate personalized description using course name
  if (courseName) {
    personalizedDescription = `Recognized for successfully completing the ${courseName} certification program.`;
  }

  const supabase = getSupabaseAdminClient();

  const resolvedBadgeSlug = resolveBadgeSlug({ badgeSlug, courseId, courseName });
  if (!resolvedBadgeSlug) {
    return jsonResponse({ error: "Badge could not be resolved from payload" }, 400);
  }

  // Look up the target badge.
  const { data: badge, error: badgeError } = await supabase
    .from("badges")
    .select("id, slug, name")
    .eq("slug", resolvedBadgeSlug)
    .single();

  if (badgeError || !badge) {
    return jsonResponse(
      { error: `Badge '${resolvedBadgeSlug}' not found`, details: badgeError?.message },
      404,
    );
  }

  // Upsert person by email.
  const normalizedEmail = normalize(email) || email.toLowerCase();
  const { data: existingPerson, error: personLookupError } = await supabase
    .from("people")
    .select("id, name")
    .eq("email", normalizedEmail)
    .maybeSingle();

  if (personLookupError) {
    return jsonResponse(
      { error: "Failed to lookup person", details: personLookupError.message },
      500,
    );
  }

  let personId = existingPerson?.id;

  if (!personId) {
    const { data: createdPerson, error: createPersonError } = await supabase
      .from("people")
      .insert({ name, email: normalizedEmail })
      .select("id")
      .single();

    if (createPersonError || !createdPerson) {
      return jsonResponse(
        { error: "Failed to create person", details: createPersonError?.message },
        500,
      );
    }

    personId = createdPerson.id;
  }

  // Make webhook idempotent: reuse existing award for this badge+person when present.
  const { data: existingAward, error: awardLookupError } = await supabase
    .from("awards")
    .select("id, issued_at")
    .eq("person_id", personId)
    .eq("badge_id", badge.id)
    .maybeSingle();

  if (awardLookupError) {
    return jsonResponse(
      { error: "Failed to lookup existing award", details: awardLookupError.message },
      500,
    );
  }

  const baseUrl = new URL(request.url);
  const issuedAt = new Date().toISOString();

  let awardRecord = existingAward;
  let emailStatus: EmailSendStatus = { status: "skipped", reason: "existing award reused" };
  let certificateUrl: string | undefined;

  if (!awardRecord) {
    const { data: createdAward, error: createAwardError } = await supabase
      .from("awards")
      .insert({
        person_id: personId,
        badge_id: badge.id,
        issued_at: issuedAt,
        personalized_description: personalizedDescription,
      })
      .select("id, issued_at")
      .single();

    if (createAwardError || !createdAward) {
      return jsonResponse(
        { error: "Failed to create award", details: createAwardError?.message },
        500,
      );
    }

    awardRecord = createdAward;
  }

  // Always (re)generate/upload the certificate for this award.
  const badgeUrl = `${baseUrl.origin}/awards/${awardRecord.id}`;
  const issuedAtForCertificate = awardRecord.issued_at ?? issuedAt;
  try {
    const certificate = await generateCertificateAndUpload({
      recipientName: name,
      issuedAt: issuedAtForCertificate,
      verificationCode: awardRecord.id,
      badgeTitle: badge.name,
    });
    certificateUrl = certificate.publicUrl;
  } catch (err) {
    console.error(
      "Failed to generate or upload certificate SVG - check SUPABASE_SERVICE_ROLE_KEY",
      err,
    );
  }

  const emailResult = await sendAwardNotification({
    to: normalizedEmail,
    recipientName: name,
    credentialName: badge.name,
    verificationCode: awardRecord.id,
    badgeUrl,
    personalizedDescription,
    certificateUrl,
  });
  emailStatus = emailResult;

  return jsonResponse({
    status: "ok",
    badgeSlug: badge.slug,
    recipientEmail: normalizedEmail,
    recipientName: name,
    award: {
      id: awardRecord.id,
      verificationCode: awardRecord.id,
      issuedAt: awardRecord.issued_at ?? issuedAt,
      personalizedDescription,
      url: badgeUrl,
      certificateUrl,
    },
    email: emailStatus,
  });
}
