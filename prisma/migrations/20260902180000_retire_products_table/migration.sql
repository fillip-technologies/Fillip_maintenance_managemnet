-- Retire the standalone Products/Inventory tables. The tracked unit is now the
-- Device (see 20260902160000_unify_product_unit); the 1 legacy product row was
-- migrated into device units before this drop. Dropping is safe/near-empty.

DROP TABLE IF EXISTS "product_audit";
DROP TABLE IF EXISTS "products";
