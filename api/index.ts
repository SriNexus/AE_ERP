/**
 * API Root — Health check and documentation
 *
 * GET /api → Returns API info, available endpoints, and health status
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { isAdminConfigured } from './_lib/firebase';
import { verifyAuthToken } from './_lib/auth';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  // Health check (no auth required)
  const healthy = isAdminConfigured();

  // Try to authenticate for personalized response
  let authenticatedUser = null;
  try {
    authenticatedUser = await verifyAuthToken(req.headers.authorization);
  } catch {
    // Not authenticated — that's fine for the root endpoint
  }

  const endpoints = [
    { method: 'GET', path: '/api', description: 'API documentation and health check' },
    { method: 'GET', path: '/api/:entity', description: 'List resources (paginated, filterable)' },
    { method: 'POST', path: '/api/:entity', description: 'Create a resource' },
    { method: 'GET', path: '/api/:entity/:id', description: 'Get a resource by ID' },
    { method: 'PUT', path: '/api/:entity/:id', description: 'Update a resource by ID' },
    { method: 'GET', path: '/api/integrations', description: 'Read masked integration secret status' },
    { method: 'POST', path: '/api/integrations', description: 'Update, rotate, test, or disconnect secure integration secrets' },
    { method: 'PATCH', path: '/api/:entity/:id', description: 'Partial update a resource by ID' },
    { method: 'DELETE', path: '/api/:entity/:id', description: 'Soft-delete a resource by ID' },
  ];

  const supportedEntities = [
    'projects', 'leads', 'customers', 'quotations', 'orders', 'dispatch',
    'products', 'stock', 'users', 'vendors',
    'purchase_orders', 'goods_receipts', 'invoices', 'tax_invoices', 'payments',
    'employees', 'attendance', 'payroll', 'warehouses',
    'surveys', 'engineering_designs', 'installations',
    'qc_checks', 'commissioning_records', 'net_metering', 'subsidy',
    'handovers', 'amc_contracts', 'service_tickets', 'generation_readings',
    'roles', 'companies', 'notifications', 'channel_partners',
  ];

  return res.status(200).json({
    success: true,
    data: {
      name: 'Neozy REST API',
      version: '1.0.0',
      status: healthy ? 'healthy' : 'unhealthy',
      authenticated: !!authenticatedUser,
      user: authenticatedUser ? { uid: authenticatedUser.uid, erpUserId: authenticatedUser.erpUserId, email: authenticatedUser.email, role: authenticatedUser.role, companyId: authenticatedUser.companyId } : null,
      documentation: {
        base_url: '/api',
        auth: 'Bearer <Firebase ID token> in Authorization header',
        auth_alt: 'X-API-Key <key> in request header for machine-to-machine access',
        pagination: '?page=1&perPage=20',
        filtering: '?search=term&status=active&sortBy=createdAt&sortOrder=desc',
        company_filter: '?companyId=<id> to scope to a specific company',
      },
      endpoints,
      supported_entities: supportedEntities,
    },
  });
}
