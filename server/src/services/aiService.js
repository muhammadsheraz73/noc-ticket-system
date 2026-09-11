import Anthropic from '@anthropic-ai/sdk';
import env from '../config/env.js';
import logger from '../utils/logger.js';
import { TICKET_PRIORITIES } from '../utils/constants.js';

/**
 * AI assistant for NOC staff.
 *
 * Two providers are supported and produce an identical analysis object:
 *  - `openrouter` (default when OPENROUTER_API_KEY is set) — OpenAI-compatible
 *    chat-completions endpoint, used here with a free NVIDIA Nemotron model.
 *  - `anthropic`  — the Anthropic Messages API.
 *
 * Hard rules from the specification:
 *  - The API key lives ONLY on the server. It is never sent to the browser.
 *  - AI must never block ticket creation. Every failure path returns a status
 *    object instead of throwing, so the caller can persist the ticket anyway
 *    and offer a retry.
 */

const TOOL_NAME = 'record_ticket_analysis';

const TOOL_DESCRIPTION =
  'Record the structured analysis of a NOC network ticket so it can be stored alongside the ticket.';

/** Plain JSON Schema, shared by both providers (they only differ in the wrapper). */
const ANALYSIS_SCHEMA = {
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
};

const SYSTEM_PROMPT = `You are an assistant to a Network Operations Center (NOC) team for a fibre/PON ISP.
You help operators triage customer network faults.

Rules:
- You assist; you never make the operational decision. The operator can override every suggestion.
- Base the analysis strictly on the ticket data you are given. Do not invent device names, VLANs, or ports.
- The "customerResponse" text is customer-facing: keep it polite and free of internal network details
  (no VLAN, no port names, no device names, no addresses).
- Always call the ${TOOL_NAME} tool exactly once with your analysis.`;

let anthropicClient = null;

function getAnthropicClient() {
  if (!anthropicClient) {
    anthropicClient = new Anthropic({
      apiKey: env.ai.apiKey,
      maxRetries: 1,
      timeout: env.ai.timeoutMs,
    });
  }
  return anthropicClient;
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
      reason: `${env.ai.keyName} is not configured on the server`,
    };
  }
  return { available: true, status: 'ready', model: env.ai.model, provider: env.ai.provider };
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

  const prompt = buildPrompt(input);

  try {
    const { parsed, model, refusal } =
      env.ai.provider === 'openrouter'
        ? await callOpenRouter(prompt)
        : await callAnthropic(prompt);

    if (refusal) return failed(`AI declined the request (${refusal})`);
    if (!parsed) return failed('AI response did not contain a usable analysis');

    return normalizeAnalysis(parsed, model);
  } catch (error) {
    logger.warn(`AI analysis failed: ${describeError(error)}`);
    return failed(describeError(error));
  }
}

/* -------------------------------------------------------------------------- */
/* OpenRouter (OpenAI-compatible)                                             */
/* -------------------------------------------------------------------------- */

async function callOpenRouter(prompt) {
  const headers = {
    Authorization: `Bearer ${env.ai.apiKey}`,
    'Content-Type': 'application/json',
  };
  // Optional attribution headers — OpenRouter uses them for its activity page.
  if (env.ai.appUrl) headers['HTTP-Referer'] = env.ai.appUrl;
  if (env.ai.appName) headers['X-Title'] = env.ai.appName;

  const response = await fetch(`${env.ai.openrouterBaseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    signal: AbortSignal.timeout(env.ai.timeoutMs),
    body: JSON.stringify({
      model: env.ai.model,
      max_tokens: 8000,
      // A triage classification is a simple task - low effort keeps it fast.
      reasoning: { effort: 'low' },
      tools: [
        {
          type: 'function',
          function: {
            name: TOOL_NAME,
            description: TOOL_DESCRIPTION,
            parameters: ANALYSIS_SCHEMA,
          },
        },
      ],
      // `auto` + an explicit instruction works on every current model; forced
      // tool_choice is rejected by some of them.
      tool_choice: 'auto',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
    }),
  });

  const body = await response.json().catch(() => null);

  if (!response.ok || body?.error) {
    throw new OpenRouterError(
      body?.error?.message || `HTTP ${response.status}`,
      body?.error?.code ?? response.status,
    );
  }

  const message = body?.choices?.[0]?.message;
  if (!message) throw new OpenRouterError('AI returned an empty response', response.status);
  if (message.refusal) return { refusal: String(message.refusal).slice(0, 200) };

  const toolCall = message.tool_calls?.find((call) => call.function?.name === TOOL_NAME);
  const parsed = toolCall
    ? safeJsonParse(toolCall.function.arguments)
    : extractJsonFromText(message.content);

  return { parsed, model: body.model || env.ai.model };
}

class OpenRouterError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'OpenRouterError';
    this.code = code;
  }
}

/* -------------------------------------------------------------------------- */
/* Anthropic                                                                  */
/* -------------------------------------------------------------------------- */

async function callAnthropic(prompt) {
  const anthropic = getAnthropicClient();
  const request = {
    model: env.ai.model,
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    // A triage classification is a simple task - low effort keeps it fast and cheap.
    output_config: { effort: 'low' },
    tools: [
      {
        name: TOOL_NAME,
        description: TOOL_DESCRIPTION,
        strict: true,
        input_schema: ANALYSIS_SCHEMA,
      },
    ],
    tool_choice: { type: 'auto' },
    messages: [{ role: 'user', content: prompt }],
  };

  const response = await createWithFallback(anthropic, request);

  if (response.stop_reason === 'refusal') {
    return { refusal: response.stop_details?.category ?? 'unknown' };
  }

  const toolUse = response.content.find(
    (block) => block.type === 'tool_use' && block.name === TOOL_NAME,
  );
  const parsed = toolUse
    ? toolUse.input
    : extractJsonFromText(
        response.content
          .filter((block) => block.type === 'text')
          .map((block) => block.text)
          .join('\n'),
      );

  return { parsed, model: response.model || env.ai.model };
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

/* -------------------------------------------------------------------------- */
/* Shared helpers                                                             */
/* -------------------------------------------------------------------------- */

function normalizeAnalysis(parsed, model) {
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
    model: model || env.ai.model,
    error: '',
    analyzedAt: new Date(),
  };
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Last-resort recovery when a model answers in prose instead of calling the tool. */
function extractJsonFromText(text) {
  const match = String(text || '').match(/\{[\s\S]*\}/);
  return match ? safeJsonParse(match[0]) : null;
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
  if (error instanceof OpenRouterError) {
    if (error.code === 401) return `Invalid ${env.ai.keyName}`;
    if (error.code === 402) return 'OpenRouter credits exhausted for this model';
    if (error.code === 429) return 'AI rate limit reached, please retry';
    if (error.code === 502 || error.code === 503) {
      return 'No AI provider available for this model right now, please retry';
    }
    return `AI service error: ${error.message}`;
  }
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return 'AI request timed out';
  if (error instanceof Anthropic.AuthenticationError) return `Invalid ${env.ai.keyName}`;
  if (error instanceof Anthropic.RateLimitError) return 'AI rate limit reached, please retry';
  if (error instanceof Anthropic.APIConnectionTimeoutError) return 'AI request timed out';
  if (error instanceof Anthropic.APIConnectionError) return 'Could not reach the AI service';
  if (error instanceof Anthropic.APIError) return `AI service error ${error.status}: ${error.message}`;
  return error?.message || 'Unknown AI error';
}

export default analyzeTicket;
