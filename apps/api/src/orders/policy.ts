/**
 * Pending-order reservation policy (Sprint 7, Task 7).
 *
 * A `pending` order holds a stock reservation (inventory.quantity_reserved)
 * indefinitely - there is no automatic expiry in this codebase. The only
 * ways a reservation is released are:
 *   1. The customer cancels it themselves while it's still 'pending'
 *      (POST /api/v1/orders/:id/cancel).
 *   2. Staff cancel it, from 'pending', 'confirmed', or 'processing'
 *      (POST /api/v1/admin/orders/:id/cancel).
 * There is deliberately no third path (a cron job, a TTL, a queue) that
 * cancels an order on its own.
 *
 * Why manual-only is the right MVP choice here, not a shortcut:
 *   - Every payment method this sprint is "pay on collection"
 *     (cash_on_delivery/card_on_delivery) or unavailable (online). There is
 *     no "unpaid for N minutes, so release it" signal to act on yet,
 *     because payment and order status are intentionally decoupled
 *     (Task 4) and nothing here can yet observe real payment completion.
 *     Building an expiry policy before that signal exists would mean
 *     guessing at a timeout with no actual basis - exactly the kind of
 *     invented business rule this sprint is told not to do.
 *   - An auto-expiry that is wrong in either direction is costly: too
 *     short cancels real, slow guest checkouts (lost sales, confused
 *     support tickets); too long doesn't actually solve the problem it's
 *     meant to solve. Getting this right needs a real operational
 *     decision (how long is "too long" for this business?) that hasn't
 *     been made.
 *
 * The trade-off being accepted: a pending order can hold stock
 * indefinitely if nobody - customer or staff - ever cancels or
 * progresses it. That is a real operational cost (a few abandoned guest
 * checkouts can lock up inventory other shoppers could have bought) but
 * it is a *visible, auditable* cost: every pending order is listable via
 * GET /api/v1/admin/orders?status=pending, so staff can review and cancel
 * stale ones by hand at any time. That manual review is the whole policy
 * for now.
 *
 * If/when automated expiry is added later, it must (per Task 7):
 *   - Only ever touch orders still in 'pending' - never 'confirmed' or
 *     beyond (those are protected states; by the time staff have
 *     confirmed an order, it is no longer a candidate for silent expiry).
 *   - Release inventory inside the same transaction as the status change,
 *     through releaseOrderInventory, using the exact conditional-UPDATE
 *     pattern src/db/queries/admin-orders.ts already uses - so an expiry
 *     sweep can never double-release a reservation a customer or staff
 *     member already cancelled moments earlier.
 *   - Be its own explicit, testable code path (e.g. a scheduled script
 *     analogous to src/media/cleanup.ts), not a side effect bolted onto
 *     an unrelated request.
 */
export const PENDING_ORDER_POLICY = 'manual_cancellation_only' as const
