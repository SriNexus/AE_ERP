/**
 * demoCompany — Permanent Demo Company configuration
 *
 * This configuration is used EXCLUSIVELY when a Demo user is logged in.
 * It provides a standalone company identity so the Demo user never sees
 * production branding, production companies, or multi-company features.
 *
 * Rules:
 *   - Available ONLY in Demo Mode (isOfficialDemoCompany === true)
 *   - NEVER visible to Production users
 *   - Not editable permanently (changes reset on logout)
 *   - Logo assets are placeholders at src/assets/login/demo-logo-*
 *     (replace with real assets later)
 */

import demoLogoIcon from '../assets/login/demo-logo-icon.png?url';
import demoLogoFullLight from '../assets/login/demo-logo-light.png?url';
import demoLogoFullDark from '../assets/login/demo-logo-dark.png?url';

import { DEMO_COMPANY_ID } from './demo';
import type { CompanyConfig } from './company';

/**
 * The permanent Demo Company configuration.
 * This is a complete CompanyConfig that mimics a real company setup
 * but is only applied when the user has a Demo identity.
 */
export const DEMO_COMPANY: CompanyConfig = {
  id: DEMO_COMPANY_ID,
  name: 'Neozy Demo',
  shortName: 'Demo',
  companyCode: 'DEMO',
  tagline: 'Solar EPC Management Demo',
  address: 'Demo Address',
  city: 'Demo City',
  state: 'Demo State',
  pincode: '000000',
  country: 'India',
  phone: '+91-0000000000',
  email: 'demo@neozy.in',
  website: 'www.neozy.com',
  gst: 'DEMO-GSTIN-000',
  pan: 'DEMOPAN000',
  cin: 'U99999MH2020PTC000000',
  bankName: 'Demo Bank',
  bankAccount: '00000000000000',
  bankIfsc: 'DEMO0000000',
  bankBranch: 'Demo Branch',
  currency: 'INR',
  currencySymbol: '₹',
  timezone: 'Asia/Kolkata',
  fiscalYearStart: '04-01',
  invoicePrefix: 'INV',
  orderPrefix: 'ORD',
  quotationPrefix: 'QT',
  dispatchPrefix: 'DSP',
  primaryColor: '#4f46e5',
  accentColor: '#10b981',
  status: 'Active',
  // Phase 1: Demo showcases the full ERP, so both workflows are reachable —
  // a demo-mode business-mode switcher can be introduced later if a
  // dedicated single-mode demo scenario is ever wanted (not required now).
  businessMode: 'Both',
};

/**
 * Demo logo URLs that are used on the Login page and in the app shell.
 * These are independent of the Companies module — they never query Firestore.
 *
 * - iconLogo: compact square/circle icon (collapsed sidebar, mobile)
 * - logoLight: full horizontal logo for Light Theme
 * - logoDark: full horizontal logo for Dark Theme
 *
 * Replace the placeholder PNG files at src/assets/login/ with your real assets.
 *
 * Logo files expected:
 *   src/assets/login/demo-logo-icon.png  — compact icon version
 *   src/assets/login/demo-logo-light.png — full logo for Light Theme
 *   src/assets/login/demo-logo-dark.png  — full logo for Dark Theme
 */
export const DEMO_LOGO_URLS = {
  iconLogo: demoLogoIcon,
  logoLight: demoLogoFullLight,
  logoDark: demoLogoFullDark,
} as const;

/**
 * Check if a company ID is the Demo company ID.
 * This is identical to isOfficialDemoCompany from demo.ts but re-exported here
 * for convenience when working with the Demo Company configuration.
 */
export { isOfficialDemoCompany } from './demo';
