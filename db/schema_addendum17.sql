-- Da eseguire IN AGGIUNTA agli schema_addendum* già eseguiti.
--
-- Nuova tipologia "supervisione" (richiesta di Maurizio 2026-09-22, accanto
-- ad "altro" per eventi/pazienti non fatturati — vedi patients.stato più
-- sotto): testo prestazione per il file di import Psicogest + tariffe
-- standard regolare/agevolata, stesso schema già usato per individuale/
-- coppia/consulenza.
--
-- Nota: patients.tipologia e patients.stato sono testo libero (nessun CHECK
-- constraint) — i nuovi valori "supervisione"/"altro" (tipologia) e
-- "non_fatturato" (stato) non richiedono alcuna modifica allo schema di
-- `patients`, solo a `settings` per i due campi nuovi sotto.
--
-- Senza questa modifica tutto funziona comunque tranne il salvataggio dei
-- due campi in Impostazioni (la scrittura fallirebbe silenziosamente,
-- colonna inesistente) e tariffaStandard("supervisione", ...) darebbe
-- sempre 0 (il costo_unitario andrebbe comunque impostato a mano).

alter table settings add column if not exists prestazione_supervisione text not null default 'supervisione';
alter table settings add column if not exists tariffa_supervisione_regolare numeric not null default 0;
alter table settings add column if not exists tariffa_supervisione_agevolata numeric not null default 0;
