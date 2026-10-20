import type { Database } from './client'

export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0]
/** Either the plain db client (read-only use, e.g. checkout preview/shipping quote) or an open transaction (order creation/cancellation/fulfillment). */
export type DbOrTx = Database | Tx
