import Stripe from "stripe";

const PLATFORM_FEE_RATE = 0.12; // 12% комиссия платформы
const hasStripeKey = !!process.env.STRIPE_SECRET_KEY;

const stripe = hasStripeKey
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

export const isMockMode = !hasStripeKey;

/**
 * Создаёт PaymentIntent с manual capture (деньги блокируются, не списываются).
 * В mock-режиме (нет STRIPE_SECRET_KEY) возвращает фейковый intent для разработки.
 */
export async function createHold({ amountCents, currency = "eur", description }) {
  if (isMockMode) {
    return {
      id: "pi_mock_" + Math.random().toString(36).slice(2, 12),
      status: "requires_capture",
      amount: amountCents,
      currency,
      mock: true,
    };
  }

  const intent = await stripe.paymentIntents.create({
    amount: amountCents,
    currency,
    capture_method: "manual",
    description,
    automatic_payment_methods: { enabled: true },
  });
  return intent;
}

export async function capturePaymentIntent(paymentIntentId) {
  if (isMockMode || paymentIntentId.startsWith("pi_mock_")) {
    return { id: paymentIntentId, status: "succeeded", mock: true };
  }
  return stripe.paymentIntents.capture(paymentIntentId);
}

export async function refundPaymentIntent(paymentIntentId) {
  if (isMockMode || paymentIntentId.startsWith("pi_mock_")) {
    return { id: paymentIntentId, status: "refunded", mock: true };
  }
  return stripe.refunds.create({ payment_intent: paymentIntentId });
}

export function calculateSplit(amountCents) {
  const platformFee = Math.round(amountCents * PLATFORM_FEE_RATE);
  const driverPayout = amountCents - platformFee;
  return { platformFee, driverPayout };
}

export { stripe };
