import { documentBlocks } from '@/lib/legal/documents'

import { PRIVACY } from '../_content/privacy'
import { DocumentPage } from '../ui'

export const metadata = {
  title: `${PRIVACY.title} — Talvext`,
  description: PRIVACY.description,
}

export default function PrivacyPage() {
  return (
    <DocumentPage
      title={PRIVACY.title}
      effective={PRIVACY.effective}
      blocks={documentBlocks(PRIVACY)}
    />
  )
}
