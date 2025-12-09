import { readFile } from "fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import puppeteer from "puppeteer";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

const CERT_BUCKET = "certificates";
const MODULE_DIR = fileURLToPath(new URL(".", import.meta.url));
const ROOT_DIR = path.resolve(MODULE_DIR, "..", "..");
const PUBLIC_DIR = path.resolve(ROOT_DIR, "public");
const TEMPLATE_HTML_PATH = path.resolve(PUBLIC_DIR, "certificate-preview.html");

type GenerateOptions = {
  recipientName: string;
  issuedAt: string;
  verificationCode: string;
  badgeTitle: string;
};

function formatIssuedDate(issuedAt: string): string {
  const issuedDate = new Date(issuedAt);
  return issuedDate.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

async function ensurePublicBucket(): Promise<void> {
  const supabase = getSupabaseAdminClient();

  const { data, error } = await supabase.storage.getBucket(CERT_BUCKET);
  if (data) return;

  if (error) {
    const status =
      (error as { status?: number | string; statusCode?: number | string }).status ??
      (error as { status?: number | string; statusCode?: number | string }).statusCode;

    // Only ignore "not found" errors; surface everything else.
    if (status !== 404 && status !== "404") {
      throw new Error(`Failed to check bucket: ${error.message}`);
    }
  }

  const { error: createError } = await supabase.storage.createBucket(CERT_BUCKET, {
    public: true,
  });
  if (createError) {
    throw new Error(`Failed to create bucket '${CERT_BUCKET}': ${createError.message}`);
  }
}

function injectAwardLine(template: string, recipientName: string, issuedDateLabel: string): string {
  const line = `Awarded to ${recipientName} on ${issuedDateLabel}`;
  const replaced = template.replace(/Awarded to[^<]+/g, line);
  if (!replaced.includes(line)) {
    throw new Error("Failed to inject name/date into certificate template");
  }
  return replaced;
}

function injectBadgeTitle(template: string, badgeTitle: string): string {
  const badgeTitleUpper = badgeTitle.toUpperCase();
  const replaced = template.replace(/GREEN SOFTWARE PRACTITIONER/g, badgeTitleUpper);
  if (!replaced.includes(badgeTitleUpper)) {
    throw new Error("Failed to inject badge title into certificate template");
  }
  return replaced;
}

function injectBaseHref(template: string): string {
  const baseHref = pathToFileURL(PUBLIC_DIR + path.sep).href;
  const baseTag = `<base href="${baseHref}">`;
  if (template.includes(baseTag)) return template;
  if (template.includes("<base")) return template;
  return template.replace("<head>", `<head>${baseTag}`);
}

function mimeTypeFor(filename: string): string {
  if (filename.endsWith(".svg")) return "image/svg+xml";
  if (filename.endsWith(".png")) return "image/png";
  if (filename.endsWith(".jpg") || filename.endsWith(".jpeg")) return "image/jpeg";
  return "application/octet-stream";
}

async function inlineAssetSources(html: string): Promise<string> {
  const matches = [...html.matchAll(/src="\/?(assets\/[^"]+)"/g)];
  if (!matches.length) return html;

  let result = html;
  for (const match of matches) {
    const relativeSrc = match[1];
    const absolutePath = path.resolve(PUBLIC_DIR, relativeSrc);
    const data = await readFile(absolutePath);
    const mimeType = mimeTypeFor(relativeSrc);
    const dataUri = `data:${mimeType};base64,${data.toString("base64")}`;
    result = result.replaceAll(`src="${relativeSrc}"`, `src="${dataUri}"`);
  }
  return result;
}

export async function buildCertificateHtml(options: {
  recipientName: string;
  issuedDateLabel: string;
  badgeTitle: string;
}): Promise<string> {
  const template = await readFile(TEMPLATE_HTML_PATH, "utf8");
  const withBase = injectBaseHref(template);
  const withAwardLine = injectAwardLine(withBase, options.recipientName, options.issuedDateLabel);
  const withBadge = injectBadgeTitle(withAwardLine, options.badgeTitle);
  return inlineAssetSources(withBadge);
}

async function htmlToPdf(html: string): Promise<Uint8Array> {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on("request", async (request) => {
      const url = request.url();
      const assetIndex = url.indexOf("/assets/");
      if (assetIndex === -1) {
        return request.continue();
      }

      const relativeSrc = url.slice(assetIndex + 1); // remove leading slash
      const absolutePath = path.resolve(PUBLIC_DIR, relativeSrc);

      try {
        const data = await readFile(absolutePath);
        const mimeType = mimeTypeFor(relativeSrc);
        return request.respond({
          status: 200,
          contentType: mimeType,
          body: data,
        });
      } catch {
        return request.continue();
      }
    });

    await page.setViewport({ width: 1200, height: 675 });
    await page.setContent(html, { waitUntil: "networkidle0" });
    await page.emulateMediaType("screen");

    const pdfBuffer = await page.pdf({
      printBackground: true,
      width: "1200px",
      height: "675px",
      margin: { top: "0px", right: "0px", bottom: "0px", left: "0px" },
      pageRanges: "1",
      preferCSSPageSize: true,
    });

    return pdfBuffer;
  } finally {
    await browser.close();
  }
}

export async function generateCertificatePdf(options: GenerateOptions): Promise<Uint8Array> {
  const issuedDateLabel = formatIssuedDate(options.issuedAt);
  const html = await buildCertificateHtml({
    recipientName: options.recipientName,
    issuedDateLabel,
    badgeTitle: options.badgeTitle,
  });
  return htmlToPdf(html);
}

export async function generateCertificateAndUpload(options: GenerateOptions) {
  const { verificationCode } = options;
  const issuedDateLabel = formatIssuedDate(options.issuedAt);

  const pdfBytes = await generateCertificatePdf(options);
  const pdfBuffer = Buffer.from(pdfBytes);

  await ensurePublicBucket();
  const supabase = getSupabaseAdminClient();
  const storagePath = `awards/${verificationCode}.pdf`;

  const { error: uploadError } = await supabase.storage
    .from(CERT_BUCKET)
    .upload(storagePath, pdfBuffer, {
      contentType: "application/pdf",

      cacheControl: "0",
      upsert: true,
    });

  if (uploadError) {
    throw new Error(`Failed to upload certificate: ${uploadError.message}`);
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from(CERT_BUCKET).getPublicUrl(storagePath);

  return { publicUrl, storagePath, issuedDateLabel };
}
