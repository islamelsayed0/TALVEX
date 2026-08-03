import type { LegalDocument } from '@/lib/legal/documents'

/**
 * Privacy Policy, as drafted, pasted verbatim. Same two structural moves as
 * _content/terms.ts and the same rules: no word edited, the no hyphen house
 * rule does not reach legal prose, and the transparency note stays.
 */
export const PRIVACY: LegalDocument = {
  title: 'Talvex Privacy Policy',
  description:
    'What data Talvex collects, why we hold it, and the choices you have over it.',
  source: `**Effective date:** August 3, 2026

**Last updated:** August 3, 2026

> **Transparency note:** This policy was prepared with AI assistance and has not yet been reviewed by an attorney. It describes our actual practices while the Service is free, and it will be updated when professional review is complete.

This Privacy Policy describes how Islam Elsayed, doing business as Talvex ("Talvex," "we," "us," or "our") collects, uses, and shares personal information when you use the Talvex platform, including uptime monitoring, incident management, ticketing, AI assisted support chat, status pages, and related services (the "Service"), or visit our websites.

If you use the Service as a member or end user of an organization (for example, an employee submitting a ticket to your company's IT team), that organization controls its workspace and its data. This Policy describes our practices; your organization's own policies govern how it handles your information.

## 1. Information We Collect

**Account and profile information.** When you sign in, our authentication provider (Clerk) collects your name, email address, and profile image, including information received from Google if you use Google sign in. We receive organization membership and role information to control access.

**Content you submit.** Tickets, incident notes, chat messages, monitor configurations, status page content, and any other content you or your organization submit to the Service.

**AI provider keys.** If your organization supplies its own AI provider API key, we store it in encrypted form and use it only to make requests to that provider on your organization's behalf.

**Usage and device information.** Log data such as IP address, browser type, pages viewed, actions taken, timestamps, and feature usage metering. We use this to operate, secure, and improve the Service.

**Cookies.** We use cookies and similar technologies that are necessary for the Service to function, such as authentication session cookies. We do not use advertising cookies. If we adopt analytics cookies in the future, we will update this Policy and provide any required consent mechanism.

## 2. How We Use Information

We use personal information to: provide, maintain, and secure the Service; authenticate users and enforce organization level access; deliver alerts, notifications, and support; process AI feature requests through the applicable AI provider; monitor usage, prevent abuse, and debug issues; communicate with you about the Service, including security and legal notices; and comply with law. We do not sell personal information and we do not use your content to train AI models.

## 3. AI Features

When you use AI features, your prompts and related content are transmitted to the third party AI provider configured for your organization (such as Anthropic, OpenAI, or Google) for processing. Those providers handle that data under their own terms and privacy policies. Do not submit sensitive personal information, and never submit protected health information, to AI features.

## 4. How We Share Information

We share personal information only with: **service providers** that host and operate the Service on our behalf, currently including Vercel (hosting), Supabase (database), Clerk (authentication), and the AI providers described above, each bound to use the data only to provide their service; **your organization**, since administrators of your organization can see content and activity within their workspace; **legal recipients** where required by law, legal process, or to protect rights, safety, or the integrity of the Service; and **a successor entity** in connection with a merger, acquisition, or sale of assets, in which case this Policy continues to apply until amended. The providers named above are our current subprocessors, and we will update this Policy if they change.

## 5. Status Pages

Status pages are designed to be viewed by your organization's clients. Information your organization chooses to publish on a status page, such as component names and incident updates, is visible to anyone with access to that page. Do not publish personal information on status pages.

## 6. Data Retention

We retain personal information for as long as your organization's account is active or as needed to provide the Service, comply with legal obligations, resolve disputes, and enforce agreements. When an organization is deleted, we delete or deidentify its content within a reasonable period, except for limited records we are required or permitted to keep.

## 7. Security

We use administrative, technical, and organizational safeguards, including encryption in transit, tenant isolation enforced at the database layer, and encrypted storage of AI provider keys. No method of transmission or storage is completely secure, and we cannot guarantee absolute security. We will notify affected parties of a breach as required by applicable law.

## 8. Your Rights and Choices

Depending on where you live, you may have rights to access, correct, delete, or receive a copy of your personal information, and to object to or restrict certain processing. You can exercise these rights by contacting us at islamelsayed02@gmail.com. If you are an end user of an organization, we may direct your request to that organization, since it controls its workspace. We will not discriminate against you for exercising your rights. If you are in the European Economic Area or United Kingdom, our processing of organization content is generally performed as a processor on the organization's behalf under our terms and, where applicable, a data processing agreement, and you may also lodge a complaint with your supervisory authority.

## 9. International Transfers

We are based in the United States and process data in the United States. If you access the Service from elsewhere, you understand that your information is transferred to and processed in the United States, where privacy laws may differ from those of your jurisdiction.

## 10. Children

The Service is intended for business use by adults. We do not knowingly collect personal information from anyone under 18. If you believe a minor has provided us information, contact us and we will delete it.

## 11. Changes to This Policy

We may update this Policy from time to time. Material changes will be announced through the Service or by email, and the date at the top will be updated. Continued use after the effective date constitutes acceptance.

## Contact

Islam Elsayed, doing business as Talvex
islamelsayed02@gmail.com`,
}
