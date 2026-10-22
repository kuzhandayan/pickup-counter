import { Router } from 'express';
import { pool } from '../../db.js';

export const productsRouter = Router();

productsRouter.get('/products', async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT p.id, p.name, p.price_paise AS "pricePaise", p.stock,
            p.stock - COALESCE(r.units, 0) AS "availableUnits"
       FROM products p
       LEFT JOIN reserved_units r ON r.product_id = p.id
      ORDER BY p.id`,
  );
  res.json(rows);
});
