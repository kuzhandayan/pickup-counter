export interface Product {
  id: number;
  name: string;
  pricePaise: number;
  availableUnits: number;
}

export type OrderStatus = 'pending' | 'paid' | 'expired' | 'needs_review' | 'picked_up';

export interface Order {
  id: string;
  status: OrderStatus;
  totalPaise: number;
  expiresInSeconds: number;
  reviewReason: string | null;
  items: { productId: number; name: string; quantity: number; unitPricePaise: number }[];
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(res.status, body?.error?.code ?? 'unknown', body?.error?.message ?? `Request failed (${res.status})`);
  }
  return body as T;
}

export const api = {
  products: () => request<Product[]>('/products'),
  createOrder: (items: { productId: number; quantity: number }[]) =>
    request<Order>('/orders', { method: 'POST', body: JSON.stringify({ items }) }),
  order: (id: string) => request<Order>(`/orders/${id}`),
};

export function formatRupees(paise: number): string {
  const rupees = Math.floor(paise / 100);
  const rest = String(paise % 100).padStart(2, '0');
  return `₹${rupees}.${rest}`;
}
