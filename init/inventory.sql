CREATE TABLE inventory (product_id INT PRIMARY KEY, qty INT CHECK (qty >= 0));
INSERT INTO inventory VALUES (1, 5), (2, 0);
