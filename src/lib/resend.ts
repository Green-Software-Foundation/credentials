import { Resend } from "resend";

type EmailSendStatus =
  | { status: "sent" }
  | { status: "skipped"; reason: string }
  | { status: "failed"; reason: string };

let resendClient: Resend | undefined;

function getResendApiKey(): string | undefined {
  return import.meta.env.RESEND_API_KEY || process.env.RESEND_API_KEY;
}

function getFromAddress(): string | undefined {
  return import.meta.env.RESEND_FROM_EMAIL || process.env.RESEND_FROM_EMAIL;
}

function getResendClient(): Resend | undefined {
  if (resendClient) return resendClient;

  const apiKey = getResendApiKey();
  if (!apiKey) return undefined;

  resendClient = new Resend(apiKey);
  return resendClient;
}

export async function sendAwardNotification({
  to,
  recipientName,
  credentialName,
  verificationCode,
  badgeUrl,
  personalizedDescription,
  certificateUrl,
}: {
  to: string;
  recipientName: string;
  credentialName: string;
  verificationCode: string;
  badgeUrl: string;
  personalizedDescription?: string;
  certificateUrl?: string;
}): Promise<EmailSendStatus> {
  const resend = getResendClient();
  const from = getFromAddress();

  if (!resend || !from) {
    return { status: "skipped", reason: "Resend not configured (missing API key or from address)" };
  }

  const subject = `Your ${credentialName} badge from Green Software Foundation`;
  const previewText = `Congrats ${recipientName}! Your badge is ready: ${badgeUrl}`;
  const description = personalizedDescription
    ? personalizedDescription
    : `Recognized for successfully completing the ${credentialName} certification program.`;

  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<title>Your Badge Award</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Nunito+Sans:wght@400;600;700;800&display=swap');
</style>
</head>
<body style="margin: 0; padding: 0; background-color: #f2f8f7; font-family: 'Nunito Sans', Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased;">
  <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f2f8f7; padding: 40px 0;">
    <tr>
      <td align="center">
        <!-- Main Card -->
        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="600" style="background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 12px rgba(0, 55, 52, 0.08); width: 100%; max-width: 600px;">
           <!-- Header -->
           <tr>
             <td align="center" style="background-color: #006d69; padding: 40px;">
                <h1 style="color: #ffffff; font-size: 24px; font-weight: 800; margin: 0; letter-spacing: -0.5px;">Green Software Foundation</h1>
             </td>
           </tr>
           
           <!-- Body Content -->
           <tr>
             <td style="padding: 40px;">
               <h2 style="color: #003734; font-size: 26px; font-weight: 800; margin-top: 0; margin-bottom: 16px; text-align: center;">Congratulations, ${recipientName}!</h2>
               
               <p style="color: #606060; font-size: 16px; line-height: 26px; margin-bottom: 32px; text-align: center;">
                 ${description}
               </p>
               
               <!-- Badge Details Box -->
               <div style="background-color: #f7faee; border-radius: 12px; padding: 32px; margin-bottom: 32px; border: 1px solid #ebf2d4;">
                 <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                   <tr>
                     <td style="padding-bottom: 20px;">
                       <p style="margin: 0 0 4px 0; font-size: 12px; color: #576629; font-weight: 700; text-transform: uppercase; letter-spacing: 1px;">Credential Awarded</p>
                       <p style="margin: 0; font-size: 20px; color: #003734; font-weight: 800;">${credentialName}</p>
                     </td>
                   </tr>
                   <tr>
                     <td style="border-top: 1px solid #d7e6a9; padding-top: 20px;">
                       <p style="margin: 0 0 8px 0; font-size: 12px; color: #576629; font-weight: 700; text-transform: uppercase; letter-spacing: 1px;">Verification Code</p>
                       <span style="font-size: 16px; color: #003734; font-family: 'Courier New', monospace; background: #ffffff; padding: 6px 12px; border-radius: 6px; display: inline-block; border: 1px solid #d7e6a9; font-weight: 600;">${verificationCode}</span>
                     </td>
                   </tr>
                 </table>
               </div>

               <!-- Call to Action Buttons -->
               <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                 <tr>
                   <td align="center" style="padding-bottom: 16px;">
                     <a href="${badgeUrl}" style="display: inline-block; background-color: #006d69; color: #ffffff; font-size: 16px; font-weight: 700; text-decoration: none; padding: 16px 36px; border-radius: 50px; box-shadow: 0 4px 6px rgba(0, 109, 105, 0.2);">View Your Badge</a>
                   </td>
                 </tr>
                 ${
                   certificateUrl
                     ? `
                 <tr>
                   <td align="center">
                    <a href="${certificateUrl}" style="display: inline-block; color: #006d69; font-size: 15px; font-weight: 600; text-decoration: none; padding: 12px 24px;">
                      <span style="border-bottom: 1px solid #006d69;">View/Download Certificate</span>
                    </a>
                  </td>
                </tr>`
                     : ""
                 }
               </table>
             </td>
           </tr>
           
           <!-- Footer -->
           <tr>
             <td style="background-color: #f9fafb; padding: 32px; text-align: center; border-top: 1px solid #f0f0f0;">
               <p style="color: #9ca3af; font-size: 14px; margin: 0 0 12px 0; font-weight: 600;">Keep building sustainable software.</p>
               <p style="color: #d1d5db; font-size: 12px; margin: 0;">
                 © ${new Date().getFullYear()} Green Software Foundation. All rights reserved.
               </p>
             </td>
           </tr>
        </table>
        
        <!-- Unsubscribe/Address (Optional - placeholder) -->
        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
          <tr>
            <td align="center" style="padding-top: 24px;">
              <p style="color: #9ca3af; font-size: 12px; margin: 0;">
                 Sent with 💚 by Green Software Foundation
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;

  try {
    const result = await resend.emails.send({
      from,
      to,
      subject,
      text: [
        `Hi ${recipientName},`,
        "",
        `Congratulations on earning the ${credentialName} badge!`,
        description,
        "",
        `Verification code: ${verificationCode}`,
        `View your badge: ${badgeUrl}`,
        certificateUrl ? `Certificate: ${certificateUrl}` : undefined,
        "",
        "— Green Software Foundation",
      ]
        .filter(Boolean)
        .join("\n"),
      html: htmlContent,
    });

    if (result.error) {
      return {
        status: "failed",
        reason: result.error.message || "Domain not verified or other Resend error",
      };
    }

    return { status: "sent" };
  } catch (error) {
    console.error("Failed to send award notification email", error);
    return {
      status: "failed",
      reason: error instanceof Error ? error.message : "Unknown error sending email",
    };
  }
}

export type { EmailSendStatus };
