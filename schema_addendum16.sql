-- Da eseguire IN AGGIUNTA agli schema_addendum* già eseguiti.
--
-- Storico fatture: salva anche il numero di fattura, così dalla pagina
-- Storico si possono selezionare fatture già emesse e rifare l'Excel per
-- Psicogest con lo stesso numero.
--
-- Senza questa modifica tutto funziona comunque: le nuove fatture si
-- registrano senza numero e, rigenerando, il numero va digitato a mano.

alter table invoice_history add column if not exists numero int;
