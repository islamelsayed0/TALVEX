import { documentBlocks } from '@/lib/legal/documents'

import { TERMS } from '../_content/terms'
import { DocumentPage } from '../ui'

export const metadata = {
  title: `${TERMS.title} — Talvext`,
  description: TERMS.description,
}

export default function TermsPage() {
  return (
    <DocumentPage
      title={TERMS.title}
      effective={TERMS.effective}
      blocks={documentBlocks(TERMS)}
    />
  )
}
