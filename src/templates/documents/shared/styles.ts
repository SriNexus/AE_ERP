import { DocumentTheme } from './theme';

export function getPrintStyles(theme: DocumentTheme) {
  return `
    @import url('https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;600;700;800&display=swap');
    
    :root {
      --primary: ${theme.primary};
      --secondary: ${theme.secondary};
      --text: ${theme.text};
      --border: ${theme.border};
      --bg: ${theme.background};
    }

    @page {
      size: A4;
      margin: 10mm;
    }

    body {
      font-family: 'Open Sans', sans-serif;
      font-size: 11px;
      color: #000;
      background: var(--bg);
      margin: 0;
      padding: 0;
      line-height: 1.4;
      -webkit-print-color-adjust: exact !important;
      color-adjust: exact !important;
    }

    .a4-container {
      width: 190mm; /* A4 width (210) - margins (2x10) */
      margin: auto;
      border: 1px solid var(--border);
      background: #fff;
    }

    .doc-header {
      text-align: center;
      background: var(--secondary);
      color: var(--primary);
      font-size: 16px;
      font-weight: 800;
      padding: 5px 0;
      border-bottom: 1px solid var(--border);
      text-transform: uppercase;
      letter-spacing: 1px;
    }

    table {
      width: 100%;
      border-collapse: collapse;
    }

    table, th, td {
      border: 1px solid var(--border);
    }

    th {
      background: var(--secondary);
      color: var(--text);
      font-size: 10px;
      font-weight: 700;
      padding: 6px 4px;
      text-align: left;
    }

    td {
      padding: 4px;
      vertical-align: top;
    }

    .text-center { text-align: center; }
    .text-right { text-align: right; }
    .text-left { text-align: left; }
    
    .font-bold { font-weight: 700; }
    .font-semibold { font-weight: 600; }
    
    .primary-text { color: var(--primary); }

    .no-border { border: none !important; }
    .border-bottom { border-bottom: 1px solid var(--border) !important; }
    .border-top { border-top: 1px solid var(--border) !important; }
    .border-right { border-right: 1px solid var(--border) !important; }

    /* Layout specific blocks */
    .company-block, .customer-block {
      width: 50%;
      padding: 10px;
      vertical-align: top;
    }
    
    .logo-img {
      max-height: 50px;
      max-width: 150px;
      object-fit: contain;
      margin-bottom: 5px;
    }

    .meta-table {
      width: 100%;
      margin: 0;
      border: none;
    }
    .meta-table td {
      border: none;
      padding: 2px 0;
    }

    .totals-box {
      font-size: 12px;
    }

    .amount-words {
      font-style: italic;
      font-weight: 600;
      background: var(--secondary);
      padding: 5px;
      border-bottom: 1px solid var(--border);
    }

    .footer-blocks {
      display: flex;
      border-top: 1px solid var(--border);
    }
    
    .bank-block {
      width: 50%;
      padding: 10px;
      border-right: 1px solid var(--border);
    }

    .qr-block {
      width: 25%;
      padding: 10px;
      text-align: center;
      border-right: 1px solid var(--border);
    }
    .qr-img {
      width: 70px;
      height: 70px;
      object-fit: contain;
    }

    .sign-block {
      width: 25%;
      padding: 10px;
      text-align: center;
      position: relative;
    }
    .sign-img {
      max-height: 45px;
      max-width: 120px;
      object-fit: contain;
      margin-bottom: 25px;
    }
    .sign-text {
      position: absolute;
      bottom: 10px;
      left: 0;
      right: 0;
      font-size: 10px;
      font-weight: 600;
    }

    .terms-block {
      padding: 10px;
      font-size: 9px;
      color: #333;
      border-top: 1px solid var(--border);
    }
  `;
}
