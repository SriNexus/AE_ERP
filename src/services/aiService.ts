/**
 * aiService.ts — AI Provider Abstraction Layer (Phase 9D)
 *
 * Supports three modes:
 *   1. MOCK — Built-in demo mode (no API keys required)
 *   2. OPENAI — OpenAI API via VITE_OPENAI_API_KEY
 *   3. GEMINI — Google Gemini API via VITE_GEMINI_API_KEY
 *
 * Architecture:
 *   - AI only provides recommendations, insights, summaries, predictions.
 *   - AI can NEVER write directly to Firestore.
 *   - All results are advisory — user action is required.
 */

export type AiProviderType = 'MOCK' | 'OPENAI' | 'GEMINI' | 'DISABLED';

export interface AiServiceConfig {
  provider: AiProviderType;
  openAiKey?: string;
  geminiKey?: string;
  model?: string;
}

// ── Configuration ─────────────────────────────────────────

let config: AiServiceConfig = (() => {
  const openAiKey = (import.meta.env as Record<string, string | undefined>).VITE_OPENAI_API_KEY?.trim();
  const geminiKey = (import.meta.env as Record<string, string | undefined>).VITE_GEMINI_API_KEY?.trim();

  if (openAiKey) return { provider: 'OPENAI', openAiKey };
  if (geminiKey) return { provider: 'GEMINI', geminiKey };
  return { provider: 'MOCK' };
})();

export function getAiConfig(): AiServiceConfig {
  return { ...config };
}

export function configureAi(): AiServiceConfig {
  const openAiKey = (import.meta.env as Record<string, string | undefined>).VITE_OPENAI_API_KEY?.trim();
  const geminiKey = (import.meta.env as Record<string, string | undefined>).VITE_GEMINI_API_KEY?.trim();

  if (openAiKey) {
    config = { provider: 'OPENAI', openAiKey };
  } else if (geminiKey) {
    config = { provider: 'GEMINI', geminiKey };
  } else {
    config = { provider: 'MOCK' };
  }

  return getAiConfig();
}

export function isAiAvailable(): boolean {
  return config.provider !== 'DISABLED';
}

export function isAiMockMode(): boolean {
  return config.provider === 'MOCK';
}

// ── AI Request/Response Types ─────────────────────────────

export interface AiRequest {
  prompt: string;
  context?: Record<string, unknown>;
  systemPrompt?: string;
}

export interface AiResponse {
  content: string;
  provider: AiProviderType;
  generatedAt: string;
}

// ── Mock Responses (Demo Mode) ────────────────────────────

const MOCK_RESPONSES: Record<string, string> = {
  'overdue_invoices': 'Based on the financial data, there are **5 overdue invoices** totaling approximately ₹12,45,000:\n\n1. **INV-2026-0042** — ₹3,50,000 (45 days overdue)\n2. **INV-2026-0051** — ₹2,80,000 (32 days overdue)\n3. **INV-2026-0060** — ₹2,15,000 (28 days overdue)\n4. **INV-2026-0067** — ₹2,50,000 (18 days overdue)\n5. **INV-2026-0072** — ₹1,50,000 (12 days overdue)\n\n**Recommendation:** Send payment reminders for invoices overdue >30 days and escalate the top 2 for management follow-up.',
  'delayed_projects': 'I identified **3 projects** that are potentially delayed:\n\n1. **PRJ-2026-0124** — Stuck in QC for 8 days (avg: 3 days)\n2. **PRJ-2026-0131** — Engineering design pending for 6 days\n3. **PRJ-2026-0098** — Installation delayed — materials not dispatched\n\n**Recommendation:** Review QC resource allocation and expedite dispatch for PRJ-2026-0098.',
  'leads_followup': 'There are **12 leads** requiring follow-up today:\n\n🔴 **Hot leads needing immediate attention:**\n- **Rajesh Sharma** — 95 score — Last contact: 5 days ago\n- **Priya Patel** — 88 score — Quotation sent, no response in 3 days\n\n🟡 **Warm leads due today:**\n- **Amit Singh** — 65 score — Follow-up scheduled\n- **Sunita Verma** — 62 score — Site survey pending\n\n**Recommendation:** Prioritize hot leads and call Rajesh Sharma today.',
  'low_stock': 'I detected **6 products** at stockout risk:\n\n🔴 **Critical:**\n- **Solar Panel 545W** — Current: 12 units (15-day supply)\n- **Inverter 5kW** — Current: 8 units (10-day supply)\n\n🟡 **Warning:**\n- **MC4 Connectors** — Current: 200 units\n- **DC Cable 4mm²** — Current: 500 meters\n\n**Recommendation:** Place PO for solar panels and inverters this week.',
  'partner_tier': 'Based on performance data, **2 partners** are approaching tier upgrades:\n\n1. **GreenEnergy Solutions** — Current: Silver → Gold (92% target achieved)\n   - Revenue: ₹85L (Target: ₹92L)\n   - Installations: 18 (Target: 20)\n   \n2. **SunBright Installers** — Current: Bronze → Silver (78% target achieved)\n   - Revenue: ₹42L (Target: ₹55L)\n   - Installations: 9 (Target: 12)\n\n**Recommendation:** Encourage GreenEnergy to close 2 more installations this quarter.',
  'top_performers': '**Top Performing Employees (This Month):**\n\n🥇 **Vikram Joshi** — 12 installations completed\n🥇 **Anita Desai** — 8 leads converted (45% conversion rate)\n🥇 **Rahul Mehra** — Highest revenue: ₹18,50,000\n\n**Top Channel Partners:**\n1. **EcoPower Systems** — 25 installations\n2. **GreenEnergy Solutions** — 18 installations\n3. **SolarTech India** — 15 installations',
  'risky_projects': '**High-risk projects identified:**\n\n🚨 **PRJ-2026-0124** — QC failed twice\n- Stage: QC (Day 8 of expected 3)\n- Risk: Timeline overrun 167%\n\n⚠️ **PRJ-2026-0131** — Engineering not started\n- Stage: Survey Complete (Day 5)\n- Risk: No engineer assigned\n\n⚠️ **PRJ-2026-0098** — Installation materials missing\n- Stage: Dispatch Pending\n- Risk: Customer complaint received',
  'cashflow': '**Cash Flow Summary (Current Month):**\n\n💰 **Total Inflow:** ₹52,30,000\n  - Collections: ₹38,50,000\n  - Advance Payments: ₹13,80,000\n\n💸 **Total Outflow:** ₹41,20,000\n  - Vendor Payments: ₹28,50,000\n  - Operational Expenses: ₹12,70,000\n\n📊 **Net Cash Flow:** +₹11,10,000\n\n**Outstanding:** ₹18,75,000 (5 overdue invoices)',
  'fraud': '**Fraud Detection Analysis:**\n\n✅ No suspicious patterns detected in the last 30 days.\n\n⚠️ **Flagged for review:**\n- **Partner GreenEnergy Solutions** — 3 settlement withdrawals in 24 hours\n- **Lead from unknown source** — Duplicate phone number detected\n\n**Recommendation:** Review flagged items manually.',
  'monitoring': '**Plant Monitoring Status:**\n\n🟢 **Online:** 142 plants (94.7%)\n🔴 **Offline:** 8 plants (5.3%)\n\n⚠️ **Low Generation Alerts:**\n- **PRJ-2026-0012** — 2.4 kWh (expected: 8.5 kWh)\n- **PRJ-2026-0034** — 1.8 kWh (expected: 6.2 kWh)\n- **PRJ-2026-0056** — 3.1 kWh (expected: 10.0 kWh)\n\n**Recommendation:** Dispatch technician to PRJ-2026-0012 and PRJ-2026-0034.',
  'default': 'I analyzed the available data. Here are the key insights:\n\n📊 **Lead Pipeline:** 45 active leads (8 hot, 22 warm, 15 cold)\n📦 **Stock Status:** 6 products below reorder level\n🏗️ **Active Projects:** 23 projects across 8 stages\n💰 **Monthly Revenue:** ₹52.3L (↑12% vs last month)\n\nWhat specific area would you like me to analyze in more detail?',
};

function getMockResponse(prompt: string): string {
  const lower = prompt.toLowerCase();
  if (lower.includes('overdue') && lower.includes('invoice')) return MOCK_RESPONSES.overdue_invoices;
  if (lower.includes('delay') || lower.includes('late') || lower.includes('stuck')) return MOCK_RESPONSES.delayed_projects;
  if (lower.includes('follow') && lower.includes('lead')) return MOCK_RESPONSES.leads_followup;
  if (lower.includes('stock') || lower.includes('shortage') || lower.includes('inventory')) return MOCK_RESPONSES.low_stock;
  if ((lower.includes('partner') || lower.includes('tier')) && (lower.includes('upgrade') || lower.includes('promote'))) return MOCK_RESPONSES.partner_tier;
  if (lower.includes('top') && (lower.includes('perform') || lower.includes('seller'))) return MOCK_RESPONSES.top_performers;
  if (lower.includes('risk') || lower.includes('risky')) return MOCK_RESPONSES.risky_projects;
  if (lower.includes('cash') || lower.includes('cashflow')) return MOCK_RESPONSES.cashflow;
  if (lower.includes('fraud')) return MOCK_RESPONSES.fraud;
  if (lower.includes('monitor') || lower.includes('plant') || lower.includes('offline')) return MOCK_RESPONSES.monitoring;
  return MOCK_RESPONSES.default;
}

// ── OpenAI Integration ────────────────────────────────────

async function queryOpenAI(request: AiRequest): Promise<AiResponse> {
  const apiKey = config.openAiKey;
  if (!apiKey) throw new Error('OpenAI API key not configured');

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: config.model || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: request.systemPrompt || 'You are an AI assistant for Neozy ERP. Provide concise, data-driven insights about solar EPC business operations. Never write to databases. Only analyze and recommend.' },
        { role: 'user', content: request.prompt },
      ],
      max_tokens: 1024,
      temperature: 0.3,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI API error: ${response.status} — ${error}`);
  }

  const data = await response.json();
  return {
    content: data.choices?.[0]?.message?.content || 'No response generated.',
    provider: 'OPENAI',
    generatedAt: new Date().toISOString(),
  };
}

// ── Gemini Integration ────────────────────────────────────

async function queryGemini(request: AiRequest): Promise<AiResponse> {
  const apiKey = config.geminiKey;
  if (!apiKey) throw new Error('Gemini API key not configured');

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: `${request.systemPrompt || 'You are an AI assistant for Neozy ERP. Provide concise, data-driven insights about solar EPC business operations. Never write to databases. Only analyze and recommend.'}\n\n${request.prompt}`,
          }],
        }],
        generationConfig: {
          maxOutputTokens: 1024,
          temperature: 0.3,
        },
      }),
    },
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Gemini API error: ${response.status} — ${error}`);
  }

  const data = await response.json();
  return {
    content: data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response generated.',
    provider: 'GEMINI',
    generatedAt: new Date().toISOString(),
  };
}

// ── Public API ────────────────────────────────────────────

/**
 * Send a query to the configured AI provider.
 * In MOCK mode, returns a static response without any API call.
 * In production, requires VITE_OPENAI_API_KEY or VITE_GEMINI_API_KEY.
 */
export async function queryAi(request: AiRequest): Promise<AiResponse> {
  // Lazy initialization
  if (config.provider === 'DISABLED') {
    configureAi();
  }

  switch (config.provider) {
    case 'OPENAI':
      return queryOpenAI(request);
    case 'GEMINI':
      return queryGemini(request);
    case 'MOCK':
      return {
        content: getMockResponse(request.prompt),
        provider: 'MOCK',
        generatedAt: new Date().toISOString(),
      };
    case 'DISABLED':
    default:
      return {
        content: getMockResponse(request.prompt),
        provider: 'MOCK',
        generatedAt: new Date().toISOString(),
      };
  }
}

/**
 * Quick query shorthand for simple prompts.
 */
export async function askAi(prompt: string, systemPrompt?: string): Promise<string> {
  const response = await queryAi({ prompt, systemPrompt });
  return response.content;
}

export default {
  configureAi,
  queryAi,
  askAi,
  isAiAvailable,
  isAiMockMode,
  getAiConfig,
};
