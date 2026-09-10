import Anthropic from '@anthropic-ai/sdk';
import env from '../config/env.js';
import logger from '../utils/logger.js';
import { TICKET_PRIORITIES } from '../utils/constants.js';

/**
 * AI assistant for NOC staff.
 *
 * Hard rules from the specification:
 *  - The API key lives ONLY on the server. It is never sent to the browser.
 *  - AI must never block ticket creation. Every failure path returns a status
 *    object instead of throwing, so the caller can persist the ticket anyway
 *    and offer a retry.
 */

const TOOL_NAME = 'record_ticket_analysis';

const ANALYSIS_TOOL = {
  name: TOOL_NAME,
  description:
    'Record the structured analysis of a NOC network ticket so it can be stored alongside the ticket.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['category', 'suggestedPriority', 'summary', 'troubleshootingSteps', 'customerResponse'],
    properties: {
      category: {
        type: 'string',
        description:
          'The most likely issue category, e.g. Fiber Cut, LOS, Internet Connectivity, Power, Configuration, Other.',
      },
      suggestedPriority: {
        type: 'string',
        enum: TICKET_PRIORITIES,
        description: 'Recommended priority for the NOC operator to consider.',
      },
      summary: {
        type: 'string',
        description: 'One-line technical summary of the fault, max 140 characters.',
      },
      troubleshootingSteps: {
        type: 'array',
        description: '3 to 6 concrete steps for the field engineer, most important first.',
        items: { type: 'string' },
      },
      customerResponse: {
        type: 'string',
        description:
          'A short, professional update that can be sent to the customer. No internal network details.',
      },
    },
  },
};

const SYSTEM_PROMPT = `You are an assistant to a Network Operations Center (NOC) team for a fibre/PON ISP.
You help operators triage customer network faults.

Rules:
- You assist; you never make the operational decision. The operator can override every suggestion.
- Base the analysis strictly on the ticket data you are given. Do not invent device names, VLANs, or ports.
- The "customerResponse" text is customer-facing: keep it polite and free of internal network details
  (no VLAN, no port names, no device names, no addresses).
- Always call the ${TOOL_NAME} tool exactly once with your analysis.`;

let client = null;

function getClient() {
  if (!env.ai.apiKey) return null;
  if (!client) {
    client = new Anthropic({
      apiKey: env.ai.apiKey,
      maxRetries: 1,
      timeout: env.ai.timeoutMs,
    });
  }
  return client;
}

/** Is AI configured and switched on? */
export function isAiAvailable() {
  return Boolean(env.ai.enabled && env.ai.apiKey);
}

export function aiStatusInfo() {
  if (!env.ai.enabled) {
    return { available: false, status: 'disabled', reason: 'AI is disabled (AI_ENABLED=false)' };
  }
  if (!env.ai.apiKey) {
    return {
      available: false,
      status: 'unavailable',
      reason: 'ANTHROPIC_API_KEY is not configured on the server',
    };
  }
  return { available: true, status: 'ready', model: env.ai.model };
}

function buildPrompt({ issueType, remarks, priority, customer, ettrMinutes }) {
  return [
    'Analyse this NOC ticket.',
    '',
    `Issue type selected by operator: ${issueType || 'not set'}`,
    `Priority selected by operator: ${priority || 'not set'}`,
    `Target resolution window (ETTR): ${ettrMinutes || 60} minutes`,
    `Operator remarks: ${remarks || '(none provided)'}`,
    '',
    'Customer / link context:',
    `- Customer reference: ${customer?.customerReferenceNumber ?? 'unknown'}`,
    `- Connection type: ${customer?.type ?? 'unknown'}`,
    `- Connected from (POP): ${customer?.connectedFrom ?? 'unknown'}`,
    `- Source port: ${customer?.sourcePort || 'not recorded'}`,
    `- Destination port: ${customer?.destinationPort || 'not recorded'}`,
    `- VLAN: ${customer?.vlan || 'not recorded'}`,
  ].join('\n');
}

/**
 * Analyse a ticket. Never throws.
 *
 * @returns {Promise<object>} an object shaped like the Ticket `ai` sub-document.
 */
export async function analyzeTicket(input) {
  const info = aiStatusInfo();
  if (!info.available) {
    return {
      status: info.status,
      error: info.reason,
      analyzedAt: new Date(),
      troubleshootingSteps: [],
    };
  }

  const anthropic = getClient();
  const request = {
    model: env.ai.model,
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    // A triage classification is a simple task - low effort keeps it fast and cheap.
    output_config: { effort: 'low' },
    tools: [ANALYSIS_TOOL],
    // `auto` + an explicit instruction works on every current model; forced
    // tool_choice is rejected by some of them.
    tool_choice: { type: 'auto' },
    messages: [{ role: 'user', content: buildPrompt(input) }],
  };

  try {
    const response = await createWithFallback(anthropic, request);

    if (response.stop_reason === 'refusal') {
      return failed(`AI declined the request (${response.stop_details?.category ?? 'unknown'})`);
    }

    const toolUse = response.content.find(
      (block) => block.type === 'tool_use' && block.name === TOOL_NAME,
    );

    const parsed = toolUse ? toolUse.input : extractJsonFromText(response.content);
    if (!parsed) return failed('AI response did not contain a usable analysis');

    return {
      status: 'completed',
      category: String(parsed.category || '').slice(0, 120),
      suggestedPriority: TICKET_PRIORITIES.includes(parsed.suggestedPriority)
        ? parsed.suggestedPriority
        : '',
      summary: String(parsed.summary || '').slice(0, 400),
      troubleshootingSteps: Array.isArray(parsed.troubleshootingSteps)
        ? parsed.troubleshootingSteps.slice(0, 8).map((s) => String(s).slice(0, 400))
        : [],
      customerResponse: String(parsed.customerResponse || '').slice(0, 1500),
      model: response.model || env.ai.model,
      error: '',
      analyzedAt: new Date(),
    };
  } catch (error) {
    logger.warn(`AI analysis failed: ${describeError(error)}`);
    return failed(describeError(error));
  }
}

/**
 * Send the request with server-side refusal fallbacks enabled, and transparently
 * retry without them if the account has not been granted that beta.
 */
async function createWithFallback(anthropic, request) {
  try {
    return await anthropic.beta.messages.create({
      ...request,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    });
  } catch (error) {
    if (error instanceof Anthropic.BadRequestError) {
      logger.debug('Server-side fallbacks unavailable, retrying without them.');
      return anthropic.messages.create(request);
    }
    throw error;
  }
}

function extractJsonFromText(content) {
  const text = content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

function failed(message) {
  return {
    status: 'failed',
    error: message,
    troubleshootingSteps: [],
    analyzedAt: new Date(),
  };
}

function describeError(error) {
  if (error instanceof Anthropic.AuthenticationError) return 'Invalid ANTHROPIC_API_KEY';
  if (error instanceof Anthropic.RateLimitError) return 'AI rate limit reached, please retry';
  if (error instanceof Anthropic.APIConnectionTimeoutError) return 'AI request timed out';
  if (error instanceof Anthropic.APIConnectionError) return 'Could not reach the AI service';
  if (error instanceof Anthropic.APIError) return `AI service error ${error.status}: ${error.message}`;
  return error?.message || 'Unknown AI error';
}

export default analyzeTicket;
