import { pool } from './db.js';

const seedProducts = [
  { name: 'Masala Chips', pricePaise: 2000, stock: 10 },
  { name: 'Chocolate Bar', pricePaise: 4500, stock: 8 },
  { name: 'Cold Coffee', pricePaise: 6000, stock: 5 },
  { name: 'Peanut Chikki', pricePaise: 1500, stock: 12 },
  { name: 'Mango Juice', pricePaise: 3500, stock: 2 },
];

// Seeds the catalog only when it is empty, so restarts keep existing data.
export async function seedIfEmpty(): Promise<void> {
  const { rows } = await pool.query<{ count: number }>('SELECT COUNT(*) AS count FROM products');
  if (rows[0].count > 0) return;
  for (const p of seedProducts) {
    await pool.query('INSERT INTO products (name, price_paise, stock) VALUES ($1, $2, $3)', [
      p.name,
      p.pricePaise,
      p.stock,
    ]);
  }
  console.log(`seeded ${seedProducts.length} products`);
}
