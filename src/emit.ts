// Publishes events inside the test process.
import { channel } from 'node:diagnostics_channel'
import type { UbqEvent } from './events.ts'

export const CHANNEL = 'ubq.event'
const ch = channel(CHANNEL)

export const emit = (event: UbqEvent): void => ch.publish(event)
