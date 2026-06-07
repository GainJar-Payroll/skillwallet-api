import { AbiEvent, parseAbiItem } from 'viem'

export function parseTriggerEventAbi(signature: string): AbiEvent {
  const trimmed = signature.trim()
  const candidates: string[] = []

  if (/^event\b/i.test(trimmed)) {
    candidates.push(trimmed)
  } else {
    candidates.push(`event ${trimmed}`)
    candidates.push(trimmed)
  }

  for (const candidate of candidates) {
    try {
      const item = parseAbiItem(candidate)
      if (item.type === 'event') {
        return item
      }
    } catch {}
  }

  throw new Error(`Unable to parse event signature into AbiEvent: ${signature}`)
}
