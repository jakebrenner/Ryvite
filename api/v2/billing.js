import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const PROD_URL = 'https://ryvite.com';

function getBaseUrl(req) {
  const origin = req.body?.origin || req.headers.origin;
  if (origin) return origin;
  return process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : PROD_URL;
}

async function getUser(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return null;
  return user;
}

async function getOrCreateStripeCustomer(user) {
  // Check if profile already has a stripe_customer_id
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('stripe_customer_id, display_name, phone')
    .eq('id', user.id)
    .single();

  if (profile?.stripe_customer_id) {
    return profile.stripe_customer_id;
  }

  // Create a new Stripe customer
  const customer = await stripe.customers.create({
    email: user.email,
    name: profile?.display_name || '',
    metadata: { supabase_user_id: user.id }
  });

  // Save to profile
  await supabaseAdmin
    .from('profiles')
    .update({ stripe_customer_id: customer.id })
    .eq('id', user.id);

  return customer.id;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action } = req.query;

  try {
    // ---- GET PLANS (public) ----
    if (action === 'plans') {
      const { data: plans, error } = await supabaseAdmin
        .from('plans')
        .select('*')
        .eq('is_active', true)
        .order('sort_order', { ascending: true });

      if (error) return res.status(400).json({ error: error.message });

      return res.status(200).json({
        success: true,
        plans: (plans || []).map(p => ({
          id: p.id,
          name: p.name,
          displayName: p.display_name,
          description: p.description,
          priceCents: p.price_cents,
          currency: p.currency,
          maxEvents: p.max_events,
          maxGenerations: p.max_generations,
          features: p.features || []
        }))
      });
    }

    // ---- VALIDATE COUPON (public, but needs plan context) ----
    if (action === 'validateCoupon') {
      const { code, planName } = req.query;
      if (!code) return res.status(400).json({ error: 'Coupon code required' });

      const user = await getUser(req);
      const result = await validateCoupon(code, planName, user?.id, user?.email);

      if (!result.valid) {
        return res.status(400).json({ success: false, error: result.error });
      }

      return res.status(200).json({
        success: true,
        coupon: {
          id: result.coupon.id,
          code: result.coupon.code,
          discountType: result.coupon.discount_type,
          discountValue: Number(result.coupon.discount_value),
          description: result.coupon.description
        },
        discount: result.discount
      });
    }

    // ---- AUTHENTICATED ENDPOINTS ----
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    // ---- CREATE CHECKOUT SESSION ----
    if (action === 'checkout') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });

      const { planId, couponCode } = req.body || {};
      if (!planId) return res.status(400).json({ error: 'planId required' });

      // Fetch plan
      const { data: plan } = await supabaseAdmin
        .from('plans')
        .select('*')
        .eq('id', planId)
        .eq('is_active', true)
        .single();

      if (!plan) return res.status(404).json({ error: 'Plan not found' });

      // Validate coupon if provided
      let discount = null;
      let coupon = null;
      if (couponCode) {
        const couponResult = await validateCoupon(couponCode, plan.name, user.id, user.email);
        if (!couponResult.valid) {
          return res.status(400).json({ error: couponResult.error });
        }
        coupon = couponResult.coupon;
        discount = couponResult.discount;
      }

      const customerId = await getOrCreateStripeCustomer(user);
      const baseUrl = getBaseUrl(req);

      // Calculate final price
      let finalAmountCents = plan.price_cents;
      let discountCents = 0;
      if (discount) {
        if (discount.type === 'percent') {
          discountCents = Math.round(plan.price_cents * discount.percent / 100);
        } else {
          discountCents = discount.amountCents;
        }
        finalAmountCents = Math.max(0, plan.price_cents - discountCents);
      }

      const sessionParams = {
        customer: customerId,
        payment_method_types: ['card'],
        line_items: [{
          price_data: {
            currency: plan.currency || 'usd',
            product_data: {
              name: plan.display_name,
              description: plan.description || `${plan.max_events} event, up to ${plan.max_generations} AI generations`
            },
            unit_amount: finalAmountCents
          },
          quantity: 1
        }],
        mode: 'payment',
        success_url: `${baseUrl}/v2/dashboard/?purchased=true&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/v2/pricing/`,
        metadata: {
          supabase_user_id: user.id,
          plan_id: plan.id,
          plan_name: plan.name,
          coupon_id: coupon?.id || '',
          coupon_code: couponCode || '',
          original_amount_cents: String(plan.price_cents),
          discount_cents: String(discountCents)
        }
      };

      const session = await stripe.checkout.sessions.create(sessionParams);

      return res.status(200).json({
        success: true,
        sessionId: session.id,
        url: session.url
      });
    }

    // ---- GET USER SUBSCRIPTION INFO ----
    if (action === 'subscription') {
      const { data: subscriptions } = await supabaseAdmin
        .from('subscriptions')
        .select(`
          *,
          plans:plan_id (name, display_name, price_cents, max_events, max_generations, features),
          coupons:coupon_id (code, discount_type, discount_value)
        `)
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      // Count actual events and generations used
      const { count: eventCount } = await supabaseAdmin
        .from('events')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .neq('status', 'archived');

      const { count: genCount } = await supabaseAdmin
        .from('generation_log')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('status', 'success');

      // Find active subscription
      const activeSub = (subscriptions || []).find(s => s.status === 'active');

      return res.status(200).json({
        success: true,
        subscription: activeSub ? {
          id: activeSub.id,
          status: activeSub.status,
          plan: activeSub.plans,
          coupon: activeSub.coupons,
          amountPaidCents: activeSub.amount_paid_cents,
          discountCents: activeSub.discount_cents,
          eventsUsed: activeSub.events_used,
          generationsUsed: activeSub.generations_used,
          createdAt: activeSub.created_at
        } : null,
        usage: {
          eventsUsed: eventCount || 0,
          generationsUsed: genCount || 0,
          maxEvents: activeSub?.plans?.max_events || 0,
          maxGenerations: activeSub?.plans?.max_generations || 0
        },
        allSubscriptions: (subscriptions || []).map(s => ({
          id: s.id,
          status: s.status,
          planName: s.plans?.display_name || 'Unknown',
          amountPaidCents: s.amount_paid_cents,
          createdAt: s.created_at
        }))
      });
    }

    // ---- BILLING HISTORY ----
    if (action === 'history') {
      const { data: history } = await supabaseAdmin
        .from('billing_history')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(50);

      return res.status(200).json({
        success: true,
        history: (history || []).map(h => ({
          id: h.id,
          amountCents: h.amount_cents,
          currency: h.currency,
          status: h.status,
          description: h.description,
          receiptUrl: h.receipt_url,
          createdAt: h.created_at
        }))
      });
    }

    // ---- CHECK PLAN LIMITS ----
    if (action === 'checkLimits') {
      const limitCheck = await checkUserLimits(user.id);
      return res.status(200).json({ success: true, ...limitCheck });
    }

    return res.status(400).json({ error: 'Unknown action' });

  } catch (err) {
    console.error('Billing API error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}

// ---- COUPON VALIDATION ENGINE ----
async function validateCoupon(code, planName, userId, userEmail) {
  const { data: coupon, error } = await supabaseAdmin
    .from('coupons')
    .select('*')
    .eq('code', code.toUpperCase().trim())
    .eq('is_active', true)
    .single();

  if (error || !coupon) {
    return { valid: false, error: 'Invalid coupon code' };
  }

  const now = new Date();

  // Check date validity
  if (coupon.valid_from && new Date(coupon.valid_from) > now) {
    return { valid: false, error: 'This coupon is not yet active' };
  }
  if (coupon.valid_until && new Date(coupon.valid_until) < now) {
    return { valid: false, error: 'This coupon has expired' };
  }

  // Check max global uses
  if (coupon.max_uses !== null && coupon.times_used >= coupon.max_uses) {
    return { valid: false, error: 'This coupon has reached its usage limit' };
  }

  // Check per-user usage
  if (userId && coupon.max_uses_per_user) {
    const { count } = await supabaseAdmin
      .from('coupon_redemptions')
      .select('id', { count: 'exact', head: true })
      .eq('coupon_id', coupon.id)
      .eq('user_id', userId);

    if (count >= coupon.max_uses_per_user) {
      return { valid: false, error: 'You have already used this coupon' };
    }
  }

  // Check allowed plans
  if (coupon.allowed_plans && coupon.allowed_plans.length > 0 && planName) {
    if (!coupon.allowed_plans.includes(planName)) {
      return { valid: false, error: 'This coupon does not apply to the selected plan' };
    }
  }

  // Check allowed emails
  if (coupon.allowed_emails && coupon.allowed_emails.length > 0) {
    if (!userEmail || !coupon.allowed_emails.map(e => e.toLowerCase()).includes(userEmail.toLowerCase())) {
      return { valid: false, error: 'This coupon is not available for your account' };
    }
  }

  // Calculate discount
  // For the plan price, we need it from context. We'll calculate based on the default plan.
  let discountInfo;
  if (coupon.discount_type === 'percent') {
    discountInfo = {
      type: 'percent',
      percent: Number(coupon.discount_value),
      // amountCents will be calculated against actual plan price at checkout
      amountCents: 0, // placeholder - calculated at checkout
      label: `${Number(coupon.discount_value)}% off`
    };
  } else {
    // Fixed discount (discount_value is in cents)
    discountInfo = {
      type: 'fixed',
      amountCents: Math.round(Number(coupon.discount_value)),
      label: `$${(Number(coupon.discount_value) / 100).toFixed(2)} off`
    };
  }

  return { valid: true, coupon, discount: discountInfo };
}

// ---- PLAN LIMIT CHECKING ----
export async function checkUserLimits(userId) {
  // Get active subscription
  const { data: activeSub } = await supabaseAdmin
    .from('subscriptions')
    .select('*, plans:plan_id (max_events, max_generations)')
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (!activeSub) {
    return {
      hasActivePlan: false,
      canCreateEvent: false,
      canGenerate: false,
      reason: 'No active plan. Purchase a plan to create events.'
    };
  }

  const maxEvents = activeSub.plans?.max_events || 0;
  const maxGenerations = activeSub.plans?.max_generations || 0;

  // Count events (non-archived)
  const { count: eventCount } = await supabaseAdmin
    .from('events')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .neq('status', 'archived');

  // Count generations
  const { count: genCount } = await supabaseAdmin
    .from('generation_log')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('status', 'success');

  const canCreateEvent = (eventCount || 0) < maxEvents;
  const canGenerate = (genCount || 0) < maxGenerations;

  return {
    hasActivePlan: true,
    canCreateEvent,
    canGenerate,
    eventsUsed: eventCount || 0,
    eventsMax: maxEvents,
    generationsUsed: genCount || 0,
    generationsMax: maxGenerations,
    reason: !canCreateEvent
      ? `You've used all ${maxEvents} event(s) in your plan.`
      : !canGenerate
      ? `You've used all ${maxGenerations} AI generations in your plan.`
      : null
  };
}
