/**
 * Smart Pricing & Prefill Engine
 * Scans historical orders to find the last price a specific customer paid for a specific product.
 */
export function getProductHistory(orders: any[], customerId: string, productId: string) {
  if (!customerId || !productId || !orders || orders.length === 0) return null;

  // Sort orders descending by date to find the most recent
  const sortedOrders = [...orders].sort((a, b) => 
    new Date(b.date || b.createdAt).getTime() - new Date(a.date || a.createdAt).getTime()
  );
  
  for (const order of sortedOrders) {
    if (order.customerId !== customerId) continue;
    
    // Search inside the order items
    const item = (order.items || []).find((i: any) => i.productId === productId);
    if (item) {
      return { 
        price: Number(item.price), 
        date: order.date || order.createdAt, 
        orderId: order.id,
        tax: Number(item.tax) || 0
      };
    }
  }
  
  return null;
}
