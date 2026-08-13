UPDATE feature_flags SET enabled=1 WHERE flag_key='finance_payables';

INSERT OR REPLACE INTO user_roles(identity_hash,display_name,role,active,created_at,machine_name)
VALUES('afdc275dc6a26345ecf2c601d9bd98ce3abaf71f82f5bda9b4b80c339a29e924','Financeiro Teste','admin',1,CURRENT_TIMESTAMP,'');

DELETE FROM finance_payables_cache;
DELETE FROM finance_purchase_orders_cache;
DELETE FROM finance_account_balances;

INSERT INTO finance_payables_cache(cache_key,branch,title_number,title_type,installment,nature,supplier_code,supplier_store,supplier_name,supplier_tax_id,issue_date,accounting_date,due_date,actual_due_date,original_value,open_balance,settlement_date,first_seen_at,source_updated_at,payload_hash) VALUES
('01|A|100|1|NF','01','100','NF','1','MERCADORIA','F001','01','Fornecedor Visível','12345678000190','2026-08-10','2026-08-10','2026-08-16','2026-08-16',1000,1000,'',datetime('now','-2 hours'),datetime('now'),'a'),
('01|A|101|1|NF','01','101','NF','1','MERCADORIA','F002','01','Fornecedor Excluído','07155032000105','2026-08-10','2026-08-10','2026-08-15','2026-08-15',2000,2000,'',datetime('now','-2 hours'),datetime('now'),'b'),
('01|A|102|1|NF','01','102','NF','1','MERCADORIA','F003','01','Fornecedor Baixado','98765432000199','2026-08-01','2026-08-01','2026-08-08','2026-08-08',500,0,'2026-08-09',datetime('now','-10 days'),datetime('now'),'c'),
('01|A|103|1|NF','01','103','NF','1','SERVICO','F004','01','Fornecedor Vencido','11222333000144','2026-08-01','2026-08-01','2026-08-10','2026-08-10',750,750,'',datetime('now','-10 days'),datetime('now'),'d');

INSERT INTO finance_purchase_orders_cache(cache_key,branch,order_number,item_number,issue_date,supplier_code,supplier_store,supplier_name,supplier_tax_id,payment_condition,currency,product_code,product_description,ordered_quantity,received_quantity,open_quantity,unit_value,total_value,open_value,first_seen_at,source_updated_at,payload_hash) VALUES
('01|PC100|01','01','PC100','01','2026-08-05','F001','01','Fornecedor Visível','12345678000190','30','1','P001','Produto teste',10,4,6,100,1000,600,datetime('now'),datetime('now'),'p1'),
('01|PC101|01','01','PC101','01','2026-08-05','F002','01','Fornecedor Excluído','07155032000105','30','1','P002','Produto excluído',10,2,8,100,1000,800,datetime('now'),datetime('now'),'p2');

INSERT INTO finance_account_balances(balance_date,account_key,account_name,balance_value,recorded_at,recorded_by_hash,recorded_by_name)
VALUES('2026-08-13','principal','Conta Principal',3000,datetime('now'),'afdc275dc6a26345ecf2c601d9bd98ce3abaf71f82f5bda9b4b80c339a29e924','Financeiro Teste');

INSERT INTO finance_sync_runs(source,status,payables_received,purchases_received,duration_ms,started_at,finished_at)
VALUES('fixture','success',4,2,1,datetime('now'),datetime('now'));
