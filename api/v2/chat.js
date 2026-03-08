import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';

const client = new Anthropic();
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const SYSTEM_PROMPT = `You are Ryvite's event planning assistant. Your job is to help users create event invitations through natural conversation.

## YOUR GOAL
Extract all the information needed to create an event from casual conversation. Be warm, friendly, and concise. Ask follow-up questions for any missing REQUIRED fields.

## REQUIRED FIELDS (must have before proceeding)
- title: The event name/title
- eventType: One of: birthday, wedding, babyShower, graduation, dinnerParty, holiday, corporate, other
- startDate: Date and time (ISO 8601 format)
- locationName: Where the event is being held

## OPTIONAL FIELDS (ask about naturally, don't block on these)
- description: Additional event details
- endDate: End date/time
- locationAddress: Full address
- dressCode: What to wear
- prompt: Creative direction / vibe description for the AI invite designer

## RESPONSE FORMAT
Always respond with a JSON object:
{
  "message": "Your conversational response to the user",
  "extracted": {
    // Any fields you've extracted so far, using the field names above
    // Include ALL fields extracted from the entire conversation, not just the latest message
    // For startDate/endDate, convert to ISO 8601 format (e.g., "2026-04-15T18:00:00")
  },
  "ready": false,
  "missingRequired": ["list", "of", "missing", "required", "field", "names"]
}

Set "ready": true ONLY when all 4 required fields have been provided. When ready, your message should confirm the details and ask if they'd like to proceed.

## CONVERSATION STYLE
- Be concise — 1-3 sentences max per response
- If the user gives you most info in one message, don't ask redundant questions
- Infer eventType from context (e.g., "my son's 5th birthday" → birthday)
- For dates, if the user says something like "next Saturday at 3pm" or "March 15th", convert it relative to today's date
- If the user describes a vibe/style, capture that in the "prompt" field
- Today's date is: ${new Date().toISOString().split('T')[0]}

## EXAMPLES
User: "I want to throw a birthday party for my friend Mike, he loves Formula 1"
→ Extract: eventType=birthday, prompt="Formula 1 themed birthday party"
→ Ask: What would you like to name the event, and when/where is it?

User: "Mike's 30th Birthday Bash at The Garage on April 12th at 7pm"
→ Extract: title="Mike's 30th Birthday Bash", eventType=birthday, locationName="The Garage", startDate="2026-04-12T19:00:00"
→ Ready! Confirm details.`;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authHeader.slice(7);
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return res.status(401).json({ error: 'Invalid session' });
  }

  const { messages } = req.body;
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Messages array is required' });
  }

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: messages.map(m => ({
        role: m.role,
        content: m.content
      }))
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';

    // Parse JSON from response
    let parsed;
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { message: text, extracted: {}, ready: false, missingRequired: [] };
    } catch {
      parsed = { message: text, extracted: {}, ready: false, missingRequired: [] };
    }

    return res.status(200).json({
      success: true,
      ...parsed
    });
  } catch (err) {
    console.error('Chat error:', err);
    return res.status(500).json({ error: 'Failed to process message' });
  }
}
