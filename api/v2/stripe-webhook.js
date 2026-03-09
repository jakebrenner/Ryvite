import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export const config = {
  api: { bodyParser: false }
};

async function getRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  let event;

  try {
    const rawBody = await getRawBody(req);
    const sig = req.headers['stripe-signature'];

    if (process.env.STRIPE_WEBHOOK_SECRET && sig) {
      event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } else {
      // Fallback for development (no webhook signature verification)
      event = JSON.parse(rawBody.toString());
    }
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).json({ error: 'Webhook signature verification failed' });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutComplete(event.data.object);
        break;

      case 'payment_intent.succeeded':
        // Handled via checkout.session.completed
        break;

      case 'charge.refunded':
        await handleRefund(event.data.object);
        break;

      default:
        // Unhandled event type
        break;
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('Webhook handler error:', err);
    return res.status(500).json({ error: 'Webhook handler error' });
  }
}

async function handleCheckoutComplete(session) {
  const metadata = session.metadata || {};
  const userId = metadata.supabase_user_id;
  const planId = metadata.plan_id;
  const couponId = metadata.coupon_id || null;
  const couponCode = metadata.coupon_code || null;
  const originalAmountCents = parseInt(metadata.original_amount_cents) || 0;
  const discountCents = parseInt(metadata.discount_cents) || 0;

  if (!userId || !planId) {
    console.error('Missing userId or planId in checkout metadata');
    return;
  }

  // Create subscription record
  const { data: subscription, error: subError } = await supabaseAdmin
    .from('subscriptions')
    .insert({
      user_id: userId,
      plan_id: planId,
      status: 'active',
      stripe_customer_id: session.customer,
      stripe_checkout_session_id: session.id,
      coupon_id: couponId || null,
      amount_paid_cents: session.amount_total || (originalAmountCents - discountCents),
      discount_cents: discountCents,
      events_used: 0,
      generations_used: 0,
      current_period_start: new Date().toISOString()
    })
    .select()
    .single();

  if (subError) {
    console.error('Failed to create subscription:', subError);
    return;
  }

  // Record billing history
  await supabaseAdmin
    .from('billing_history')
    .insert({
      user_id: userId,
      subscription_id: subscription.id,
      stripe_payment_intent_id: session.payment_intent,
      amount_cents: session.amount_total || (originalAmountCents - discountCents),
      currency: session.currency || 'usd',
      status: 'succeeded',
      description: `Plan purchase: ${metadata.plan_name || 'Single Event'}`,
      receipt_url: null // Will be updated if we get the charge
    });

  // Record coupon redemption
  if (couponId) {
    await supabaseAdmin
      .from('coupon_redemptions')
      .insert({
        coupon_id: couponId,
        user_id: userId,
        subscription_id: subscription.id
      });

    // Increment coupon times_used
    await supabaseAdmin.rpc('increment_coupon_usage', { coupon_uuid: couponId })
      .then(() => {})
      .catch(async () => {
        // Fallback if RPC doesn't exist: direct update
        const { data: c } = await supabaseAdmin
          .from('coupons')
          .select('times_used')
          .eq('id', couponId)
          .single();
        if (c) {
          await supabaseAdmin
            .from('coupons')
            .update({ times_used: (c.times_used || 0) + 1 })
            .eq('id', couponId);
        }
      });
  }

  // Update user's stripe_customer_id if not set
  await supabaseAdmin
    .from('profiles')
    .update({ stripe_customer_id: session.customer, tier: 'pro' })
    .eq('id', userId);

  // Try to get receipt URL from the payment intent
  if (session.payment_intent) {
    try {
      const paymentIntent = await stripe.paymentIntents.retrieve(session.payment_intent);
      if (paymentIntent.latest_charge) {
        const charge = await stripe.charges.retrieve(paymentIntent.latest_charge);
        if (charge.receipt_url) {
          await supabaseAdmin
            .from('billing_history')
            .update({ receipt_url: charge.receipt_url })
            .eq('stripe_payment_intent_id', session.payment_intent);
        }
      }
    } catch (e) {
      // Non-critical, receipt URL is nice-to-have
    }
  }
}

async function handleRefund(charge) {
  if (!charge.payment_intent) return;

  await supabaseAdmin
    .from('billing_history')
    .update({ status: 'refunded' })
    .eq('stripe_payment_intent_id', charge.payment_intent);
}
