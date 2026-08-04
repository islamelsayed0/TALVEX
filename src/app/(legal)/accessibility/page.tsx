import { documentBlocks } from '@/lib/legal/documents'

import { ACCESSIBILITY } from '../_content/accessibility'
import { DocumentPage } from '../ui'

export const metadata = {
  title: `${ACCESSIBILITY.title} — Talvext`,
  description: ACCESSIBILITY.description,
}

export default function AccessibilityPage() {
  return (
    <DocumentPage
      title={ACCESSIBILITY.title}
      effective={ACCESSIBILITY.effective}
      blocks={documentBlocks(ACCESSIBILITY)}
    />
  )
}
