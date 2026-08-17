/**
 * Converts numbers to Indian Currency Words (Rupees & Paise)
 */
export function numberToWords(amount: number): string {
  const a = ['', 'One ', 'Two ', 'Three ', 'Four ', 'Five ', 'Six ', 'Seven ', 'Eight ', 'Nine ', 'Ten ', 'Eleven ', 'Twelve ', 'Thirteen ', 'Fourteen ', 'Fifteen ', 'Sixteen ', 'Seventeen ', 'Eighteen ', 'Nineteen '];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  function toWords(num: number): string {
    if ((num = Math.floor(num)) === 0) return 'Zero';
    let str = '';
    const n = ('000000000' + num).slice(-9).match(/^(\d{2})(\d{2})(\d{2})(\d{1})(\d{2})$/);
    if (!n) return '';
    
    str += (Number(n[1]) !== 0) ? (a[Number(n[1])] || b[n[1][0] as any] + ' ' + a[n[1][1] as any]) + 'Crore ' : '';
    str += (Number(n[2]) !== 0) ? (a[Number(n[2])] || b[n[2][0] as any] + ' ' + a[n[2][1] as any]) + 'Lakh ' : '';
    str += (Number(n[3]) !== 0) ? (a[Number(n[3])] || b[n[3][0] as any] + ' ' + a[n[3][1] as any]) + 'Thousand ' : '';
    str += (Number(n[4]) !== 0) ? (a[Number(n[4])] || b[n[4][0] as any] + ' ' + a[n[4][1] as any]) + 'Hundred ' : '';
    str += (Number(n[5]) !== 0) ? ((str !== '') ? 'and ' : '') + (a[Number(n[5])] || b[n[5][0] as any] + ' ' + a[n[5][1] as any]) : '';
    return str.trim();
  }

  const rupees = Math.floor(amount);
  const paise = Math.round((amount - rupees) * 100);
  
  let result = 'Rupees ' + toWords(rupees);
  if (paise > 0) {
    result += ' and ' + toWords(paise) + ' Paise';
  }
  return result + ' Only';
}

export function b64ToSrc(base64?: string): string {
  if (!base64) return '';
  // If it already has the data uri prefix, return as is
  if (base64.startsWith('data:image')) return base64;
  // Fallback assuming it's a raw base64 string
  return `data:image/png;base64,${base64}`;
}
