import { readFile } from "fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { TextDecoder } from "node:util";

import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

const CERT_BUCKET = "certificates";
const MODULE_DIR = fileURLToPath(new URL(".", import.meta.url));
const ROOT_DIR = path.resolve(MODULE_DIR, "..", "..");
const PUBLIC_DIR = path.resolve(ROOT_DIR, "public");
const TEMPLATE_STORAGE_PATH = "templates/certificate-preview.html";
const NAME_PLACEHOLDER = "${Name}";
const DATE_PLACEHOLDER = "{Date}";
const COURSE_PLACEHOLDER = "${CourseName}";
const textDecoder = new TextDecoder();
const DEFAULT_ASSET_BASE = "https://gsf-credentials.netlify.app/";

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

async function downloadTemplateFromStorage(): Promise<string> {
  const supabase = getSupabaseAdminClient();
  await ensurePublicBucket();

  const { data, error } = await supabase.storage.from(CERT_BUCKET).download(TEMPLATE_STORAGE_PATH);
  if (error) {
    const status =
      (error as { status?: number | string; statusCode?: number | string }).status ??
      (error as { status?: number | string; statusCode?: number | string }).statusCode;
    if (status === 404 || status === "404") {
      throw new Error(
        `Certificate template not found in storage at '${TEMPLATE_STORAGE_PATH}'. ` +
          "Upload the latest template before generating certificates.",
      );
    }
    throw new Error(`Failed to download certificate template: ${error.message}`);
  }

  if (!data) {
    throw new Error("Certificate template download returned empty response");
  }

  const buffer = await data.arrayBuffer();
  return textDecoder.decode(buffer);
}

function replacePlaceholders(
  template: string,
  {
    recipientName,
    issuedDateLabel,
    badgeTitle,
  }: { recipientName: string; issuedDateLabel: string; badgeTitle: string },
): string {
  const badgeTitleUpper = badgeTitle.toUpperCase();
  const replacements: Array<[string, string]> = [
    [NAME_PLACEHOLDER, recipientName],
    [DATE_PLACEHOLDER, issuedDateLabel],
    [COURSE_PLACEHOLDER, badgeTitleUpper],
  ];

  let result = template;
  for (const [placeholder, value] of replacements) {
    if (!result.includes(placeholder)) {
      throw new Error(`Certificate template missing placeholder ${placeholder}`);
    }
    result = result.replaceAll(placeholder, value);
  }

  return result;
}

function injectBaseHref(template: string): string {
  const baseHref = pathToFileURL(PUBLIC_DIR + path.sep).href;
  const baseTag = `<base href="${baseHref}">`;
  if (template.includes(baseTag)) return template;
  if (template.includes("<base")) return template;
  return template.replace("<head>", `<head>${baseTag}`);
}

function getAssetBaseUrl(preferred?: string): string {
  const envBase =
    preferred ||
    import.meta.env.PUBLIC_SITE_URL ||
    process.env.PUBLIC_SITE_URL ||
    process.env.URL ||
    process.env.DEPLOY_URL ||
    process.env.DEPLOY_PRIME_URL;
  const base = envBase || DEFAULT_ASSET_BASE;
  return base.endsWith("/") ? base : `${base}/`;
}

function mimeTypeFor(filename: string): string {
  if (filename.endsWith(".svg")) return "image/svg+xml";
  if (filename.endsWith(".png")) return "image/png";
  if (filename.endsWith(".jpg") || filename.endsWith(".jpeg")) return "image/jpeg";
  return "application/octet-stream";
}

async function fetchAsset(relativeSrc: string, assetBaseUrl?: string): Promise<Buffer> {
  const absolutePath = path.resolve(PUBLIC_DIR, relativeSrc);
  try {
    return await readFile(absolutePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }

  const baseUrl = getAssetBaseUrl(assetBaseUrl);
  const url = `${baseUrl}${relativeSrc}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch asset from ${url}: ${response.status} ${response.statusText}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function inlineAssetSources(html: string, assetBaseUrl?: string): Promise<string> {
  const matches = [...html.matchAll(/src="\/?(assets\/[^"]+)"/g)];
  if (!matches.length) return html;

  let result = html;
  for (const match of matches) {
    const relativeSrc = match[1];
    const data = await fetchAsset(relativeSrc, assetBaseUrl);
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
  assetBaseUrl?: string;
}): Promise<string> {
  const template = await downloadTemplateFromStorage();
  const withBase = injectBaseHref(template);
  const withValues = replacePlaceholders(withBase, options);
  return inlineAssetSources(withValues, options.assetBaseUrl);
}

async function launchBrowser() {
  const executablePath = await chromium.executablePath();
  const headless = (chromium as unknown as { headless?: boolean }).headless ?? true;
  return puppeteer.launch({
    args: chromium.args,
    defaultViewport: { width: 1200, height: 675 },
    executablePath,
    headless,
  });
}

async function htmlToPdf(html: string): Promise<Uint8Array> {
  const browser = await launchBrowser();

  try {
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on("request", async (request) => {
      const url = request.url();
      const assetIndex = url.indexOf("/assets/");
      if (assetIndex === -1) {
        return request.continue();
      }

      const relativeSrc = url.slice(assetIndex + 1);

      try {
        const data = await fetchAsset(relativeSrc);
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

export async function generateCertificatePdf(
  options: GenerateOptions & { assetBaseUrl?: string },
): Promise<Uint8Array> {
  const issuedDateLabel = formatIssuedDate(options.issuedAt);
  const html = await buildCertificateHtml({
    recipientName: options.recipientName,
    issuedDateLabel,
    badgeTitle: options.badgeTitle,
    assetBaseUrl: options.assetBaseUrl,
  });
  return htmlToPdf(html);
}

export async function generateCertificateAndUpload(
  options: GenerateOptions & { assetBaseUrl?: string },
) {
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
