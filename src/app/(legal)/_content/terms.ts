import type { LegalDocument } from '@/lib/legal/documents'

/**
 * Terms of Service, as drafted, pasted verbatim.
 *
 * Nothing here is edited, summarised, or reworded. Two structural moves only,
 * neither of which changes a word:
 *
 * 1. The document's own "# Talvex Terms of Service" line is lifted into
 *    `title` and renders as the page h1, so it is not repeated in the body.
 * 2. The effective and last updated lines are separated by a blank line.
 *    Markdown joins adjacent lines into one paragraph, which would have run
 *    the two dates together on a single line. The blank line is whitespace;
 *    every word is untouched, and tests/legal-pages.test.ts asserts that by
 *    comparing the words of this source against the drafted document.
 *
 * The no hyphen house rule does not reach this string. Legal prose is not
 * reworded to satisfy a style guide.
 *
 * THE TRANSPARENCY NOTE IS DELIBERATE. The document states that it has not yet
 * been reviewed by an attorney, and that renders on the public page as written.
 * Removing it would present an unreviewed agreement as a settled one. It comes
 * out when a lawyer has actually read this, and not before, at which point the
 * effective date changes too. See docs/DECISIONS.md.
 */
export const TERMS: LegalDocument = {
  title: 'Talvex Terms of Service',
  description: 'The terms that govern use of the Talvex platform.',
  source: `**Effective date:** August 3, 2026

**Last updated:** August 3, 2026

> **Transparency note:** These terms were prepared with AI assistance and have not yet been reviewed by an attorney. They are the agreement that governs use of the Service while it is free, and they will be updated when professional review is complete.

These Terms of Service (the "Terms") are a binding agreement between you and Islam Elsayed, doing business as Talvex ("Talvex," "we," "us," or "our") governing your access to and use of the Talvex platform, including uptime monitoring, incident management, ticketing, AI assisted support chat, status pages, and related services (collectively, the "Service").

By creating an account, clicking to accept, or using the Service, you agree to these Terms. If you are accepting on behalf of a company or organization, you represent that you have authority to bind that organization, and "you" refers to that organization. If you do not agree, do not use the Service.

## 1. The Service

Talvex provides a multitenant IT operations platform. We may add, modify, or remove features at any time. The Service is intended for business use by organizations, not for personal or household use.

**The Service uses artificial intelligence.** Certain features, including the support chat, generate responses using automated AI systems rather than a human. AI generated content in the Service may be labeled as such, and Section 4 governs your use of these features.

**The Service is a business operations tool only. It is not designed, certified, or intended for use in emergency services, life safety systems, medical devices, patient care, or any environment where a failure of the Service could lead to death, personal injury, or physical or environmental damage. You must not use the Service for any such purpose.**

## 2. Eligibility, Accounts, and Organizations

You must be at least 18 years old and able to form a binding contract to use the Service. You must provide accurate registration information and keep it current. You are responsible for all activity that occurs under your organization's accounts, including activity by your members, agents, and end users. You must safeguard your credentials and notify us promptly of any unauthorized access. We are not liable for losses arising from unauthorized use of your account where we have complied with these Terms.

## 3. Monitoring, Alerts, and Incident Data

The Service performs periodic checks of endpoints you configure and generates alerts, incidents, and status information based on those checks.

You acknowledge and agree that:

(a) monitoring checks are performed on a best effort basis and may be delayed, throttled, or missed due to network conditions, third party infrastructure, maintenance, or other factors;

(b) we do not guarantee that any outage, degradation, or event will be detected, or that any alert or notification will be generated or delivered, or delivered within any particular time;

(c) uptime figures, response times, and status information are estimates and may be inaccurate or incomplete; and

(d) you remain solely responsible for the operation, security, and availability of your own systems and for maintaining independent means of detecting and responding to failures. The Service supplements, and does not replace, your own operational judgment and safeguards.

## 4. AI Features and Bring Your Own Key (BYOK)

The Service includes optional AI features, including an AI support chat, that generate content using large language models operated by third party providers such as Anthropic, OpenAI, or Google (each an "AI Provider"). Responses from these features are generated by automated systems, may be produced without human review, and are transmitted to and processed by the applicable AI Provider.

**4.1 Your API keys.** Where you supply your own AI Provider API key ("Customer Key"), you represent that you are authorized to use that key, and you are solely responsible for: (a) the security and validity of the key; (b) all usage, charges, rate limits, and billing incurred with the AI Provider through that key, including usage initiated by your members and end users through the Service; (c) compliance with the AI Provider's terms of service, usage policies, and applicable law; and (d) revoking the key if you suspect compromise. We store Customer Keys using encryption and use them only to make requests to the applicable AI Provider on your behalf. We are not a party to your agreement with any AI Provider and have no responsibility for any AI Provider's acts, omissions, pricing, availability, or data handling.

**4.2 AI output.** Content generated by AI features ("Output") is produced by automated systems and may be inaccurate, incomplete, biased, outdated, or misleading, and may resemble content generated for others. Output is provided for informational purposes only. **Output is not professional advice of any kind, including legal, medical, dental, financial, or security advice, and must not be relied on as such.** You are solely responsible for reviewing and verifying Output before relying on it or acting on it, and for all decisions made or actions taken based on Output. We disclaim all liability arising from Output or your use of it.

**4.3 Input.** You are solely responsible for the prompts, tickets, messages, and other content submitted to AI features ("Input") and for ensuring that Input does not violate law, third party rights, or Section 7 (Prohibited Data) below. You acknowledge that Input is transmitted to the applicable AI Provider for processing under that provider's terms, and that we do not control how AI Providers handle data once transmitted.

## 5. Customer Content, Data, and Security

**5.1 Ownership.** You retain all rights in the content and data you or your end users submit to the Service ("Customer Content"). You grant us a limited license to host, process, transmit, and display Customer Content solely to provide, secure, and improve the Service and as otherwise permitted by these Terms and our Privacy Policy.

**5.2 Responsibility.** You are solely responsible for the accuracy, legality, and appropriateness of Customer Content, and for obtaining all rights and consents needed for us to process it, including any consents required from your end users.

**5.3 Backups.** While we take commercially reasonable measures to protect data, you are responsible for maintaining independent backups of Customer Content that is critical to your business. We are not liable for loss or corruption of data except as expressly required by applicable law.

**5.4 Security; no guarantee.** We implement administrative, technical, and organizational safeguards designed to protect Customer Content, including encryption in transit, tenant isolation enforced at the database layer, and encrypted storage of Customer Keys. **However, no method of transmission over the internet and no method of electronic storage is completely secure. We cannot and do not guarantee absolute security of any data, and you acknowledge that you provide Customer Content at your own risk.** We will notify you of a security breach affecting your personal data as required by applicable law. Our safeguards do not create any warranty, and Sections 16 and 17 apply to all security matters.

## 6. Acceptable Use

You must not, and must not permit anyone to: (a) use the Service to violate law or third party rights; (b) probe, scan, or test the vulnerability of the Service or circumvent authentication or tenant isolation; (c) access data of another tenant or attempt to; (d) monitor endpoints you do not own or lack authorization to monitor; (e) use the Service to send spam or abusive content; (f) resell or provide the Service to third parties except as expressly permitted; (g) reverse engineer the Service except where such restriction is prohibited by law; (h) use the Service to build a competing product; (i) use AI features to generate unlawful, infringing, or harmful content; or (j) impose an unreasonable load on our infrastructure. We may suspend or terminate access immediately for violations.

## 7. Prohibited Data; No PHI Without a BAA

The Service is not intended to store or process regulated categories of sensitive data. You must not submit to the Service: (a) protected health information ("PHI") as defined under HIPAA, unless and until we have signed a Business Associate Agreement ("BAA") with you in writing; (b) payment card numbers or full financial account credentials; (c) government issued identification numbers; or (d) any data whose processing would impose regulatory obligations on us that we have not expressly agreed to in writing.

**Talvex is not a HIPAA covered entity or business associate by default and does not sign a BAA unless expressly agreed in a separate written document. If you are a medical, dental, or other healthcare practice, do not include patient names, health conditions, or any other PHI in tickets, chat messages, monitor names, or any other field unless a BAA is in place.** You agree that you are solely responsible for any regulated data you submit in violation of this Section, and that this Section survives termination.

## 8. Fees and Payment

Paid plans, if offered, are billed as described at the time of purchase. Except where required by law, fees are not refundable. We may change pricing with notice effective at your next renewal. Free plans, trials, and beta features may be modified, limited, or discontinued at any time without liability.

## 9. Beta and Early Access

Features identified as beta, preview, or early access are provided for evaluation, may be unstable, and may be changed or removed at any time. Beta features are excluded from any availability or support commitments and are provided entirely at your own risk.

## 10. Intellectual Property

We and our licensors own the Service, including all software, design, and documentation, and all related intellectual property rights. These Terms grant you only a limited, revocable, nonexclusive, nontransferable right to access and use the Service during your subscription. Feedback you provide may be used by us without restriction or obligation.

## 11. Copyright Complaints (DMCA)

We respect intellectual property rights and respond to notices of alleged copyright infringement that comply with the Digital Millennium Copyright Act. If you believe content on the Service infringes your copyright, send a notice to islamelsayed02@gmail.com including: (a) your physical or electronic signature; (b) identification of the copyrighted work; (c) identification and location of the allegedly infringing material; (d) your contact information; (e) a statement of good faith belief that the use is not authorized; and (f) a statement, under penalty of perjury, that the notice is accurate and you are authorized to act for the copyright owner. We may remove content and may terminate accounts of repeat infringers.

## 12. Third Party Services

The Service depends on and interoperates with third party services, including hosting infrastructure, authentication providers, and AI Providers. We are not responsible for third party services, their availability, or their handling of data, and your use of them may be subject to their own terms. Links to third party sites are provided for convenience and are used at your own risk.

## 13. Accessibility

We are committed to making the Service usable by as many people as possible, including people with disabilities. We aim to conform to the Web Content Accessibility Guidelines (WCAG) 2.2 Level AA and design with keyboard navigation, screen reader compatibility, and sufficient color contrast in mind. Accessibility is an ongoing effort, and portions of the Service may not yet fully conform. If you encounter an accessibility barrier or need assistance or an accommodation, contact us at islamelsayed02@gmail.com and we will make reasonable efforts to provide the information or function you need through an alternative method. This Section describes our goals and does not create a warranty or expand our obligations beyond applicable law.

## 14. Communications and Alert Delivery

By creating an account you consent to receive transactional and service communications from us, including alerts, incident notifications, security notices, and account messages, by email and, where you enable it, by SMS or other channels. Message and data rates from your carrier may apply to SMS. You may opt out of nonessential communications at any time; **opting out of alert channels may prevent delivery of monitoring alerts, and we are not liable for alerts not received as a result.** Delivery of email and SMS depends on third party networks and is not guaranteed.

## 15. Privacy

Our Privacy Policy, available at /privacy, describes how we collect, use, and share personal information, including the use of cookies and similar technologies. By using the Service you agree to the Privacy Policy. If you submit personal information of your end users or clients, you are responsible for having a lawful basis and any required notices or consents.

## 16. Disclaimer of Warranties

**THE SERVICE, INCLUDING ALL AI FEATURES, OUTPUT, AND SECURITY MEASURES, IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, WHETHER EXPRESS, IMPLIED, STATUTORY, OR OTHERWISE. WE SPECIFICALLY DISCLAIM ALL IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, AND NONINFRINGEMENT, AND ANY WARRANTIES ARISING FROM COURSE OF DEALING OR USAGE OF TRADE. WE DO NOT WARRANT THAT THE SERVICE WILL BE UNINTERRUPTED, TIMELY, SECURE, OR ERROR FREE, THAT DEFECTS WILL BE CORRECTED, THAT ANY OUTAGE WILL BE DETECTED, THAT ANY ALERT WILL BE DELIVERED, THAT DATA WILL BE ABSOLUTELY SECURE, OR THAT ANY OUTPUT WILL BE ACCURATE OR RELIABLE. SOME JURISDICTIONS DO NOT ALLOW CERTAIN WARRANTY DISCLAIMERS, SO SOME OF THE ABOVE MAY NOT APPLY TO YOU.**

## 17. Limitation of Liability

**TO THE MAXIMUM EXTENT PERMITTED BY LAW:**

**(a) IN NO EVENT WILL WE BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, EXEMPLARY, OR PUNITIVE DAMAGES, OR FOR ANY LOSS OF PROFITS, REVENUE, GOODWILL, BUSINESS OPPORTUNITY, OR DATA, ARISING OUT OF OR RELATED TO THESE TERMS OR THE SERVICE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGES, AND REGARDLESS OF THE THEORY OF LIABILITY.**

**(b) OUR TOTAL AGGREGATE LIABILITY FOR ALL CLAIMS ARISING OUT OF OR RELATED TO THESE TERMS OR THE SERVICE WILL NOT EXCEED THE GREATER OF (i) THE AMOUNTS YOU PAID US FOR THE SERVICE IN THE TWELVE MONTHS PRECEDING THE EVENT GIVING RISE TO THE CLAIM, OR (ii) ONE HUNDRED US DOLLARS ($100).**

**(c) WITHOUT LIMITING THE FOREGOING, WE WILL HAVE NO LIABILITY FOR: MISSED, DELAYED, OR INACCURATE MONITORING CHECKS, ALERTS, OR STATUS INFORMATION; ANY OUTPUT OR RELIANCE ON OUTPUT; CHARGES INCURRED WITH ANY AI PROVIDER; ACTS OR OMISSIONS OF THIRD PARTY SERVICES; UNAUTHORIZED ACCESS OR DATA BREACH EXCEPT TO THE EXTENT CAUSED BY OUR FAILURE TO IMPLEMENT THE SAFEGUARDS DESCRIBED IN SECTION 5.4; UNAUTHORIZED ACCESS RESULTING FROM YOUR FAILURE TO SECURE CREDENTIALS OR KEYS; OR YOUR SUBMISSION OF PROHIBITED DATA.**

**(d) THE LIMITATIONS IN THIS SECTION APPLY EVEN IF ANY LIMITED REMEDY FAILS OF ITS ESSENTIAL PURPOSE. SOME JURISDICTIONS DO NOT ALLOW CERTAIN LIMITATIONS OF LIABILITY, SO SOME OF THE ABOVE MAY NOT APPLY TO YOU. NOTHING IN THESE TERMS LIMITS LIABILITY THAT CANNOT BE LIMITED UNDER APPLICABLE LAW, SUCH AS LIABILITY FOR FRAUD, WILLFUL MISCONDUCT, OR GROSS NEGLIGENCE WHERE SUCH LIMITATION IS PROHIBITED.**

## 18. Indemnification

You will defend, indemnify, and hold harmless Talvex and its owner, affiliates, and personnel from and against any claims, damages, liabilities, costs, and expenses (including reasonable attorneys' fees) arising out of or related to: (a) Customer Content or Input; (b) your use of the Service, including use of Output and use of AI Providers through Customer Keys; (c) your violation of these Terms or applicable law, including submission of PHI or other prohibited data; (d) your monitoring of endpoints without authorization; or (e) disputes between you and your end users or clients. We will promptly notify you of any such claim and may participate in the defense with our own counsel at our expense.

## 19. Suspension and Termination

You may stop using the Service and close your account at any time. We may suspend or terminate your access, with or without notice, if you breach these Terms, if required by law, if your use poses a security risk or burden on the Service, or if we discontinue the Service. Upon termination, your right to use the Service ends. We may delete Customer Content after a reasonable period following termination; export your data before closing your account. Sections that by their nature should survive termination (including Sections 5, 7, 10, 16, 17, 18, 20, and 21) survive.

## 20. Dispute Resolution; Governing Law

These Terms are governed by the laws of the State of New York, without regard to conflict of laws principles. Any dispute arising out of or relating to these Terms or the Service will be resolved exclusively in the state or federal courts located in New York County, New York, and each party consents to personal jurisdiction and venue there. Either party may bring an individual claim in small claims court. **To the maximum extent permitted by law, each party waives any right to a jury trial and any right to participate in a class action or representative proceeding; all claims must be brought in a party's individual capacity.** Any claim must be filed within one year after the cause of action arises, or it is permanently barred, where such limitation is enforceable.

## 21. General

**Changes to the Terms.** We may update these Terms from time to time. Material changes will be notified through the Service or by email, and continued use after the effective date constitutes acceptance. **Entire agreement.** These Terms, together with the Privacy Policy and any executed order form or BAA, are the entire agreement and supersede prior agreements regarding the Service. **Severability.** If any provision is unenforceable, it will be modified to the minimum extent necessary and the remainder stays in effect. **No waiver.** Failure to enforce a provision is not a waiver. **Assignment.** You may not assign these Terms without our consent; we may assign them in connection with a merger, acquisition, or sale of assets. **Force majeure.** We are not liable for delays or failures caused by events beyond our reasonable control, including outages of third party infrastructure, internet disturbances, and acts of government. **Export and sanctions.** You represent you are not barred from using the Service under applicable export control or sanctions laws. **Notices.** Legal notices to us must be sent to islamelsayed02@gmail.com.

## Contact

Islam Elsayed, doing business as Talvex
islamelsayed02@gmail.com`,
}
