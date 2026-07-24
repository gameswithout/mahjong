CREATE FUNCTION validate_jade_journal_balance()
RETURNS TRIGGER AS $$
DECLARE
    computed_debits BIGINT;
    computed_credits BIGINT;
BEGIN
    SELECT
        COALESCE(SUM(-amount) FILTER (WHERE amount < 0), 0),
        COALESCE(SUM(amount) FILTER (WHERE amount > 0), 0)
    INTO computed_debits, computed_credits
    FROM jade_postings
    WHERE journal_id = NEW.journal_id;

    IF computed_debits <> NEW.total_debits OR
       computed_credits <> NEW.total_credits THEN
        RAISE EXCEPTION
            'unbalanced Jade journal %: postings %/% expected %/%',
            NEW.journal_id,
            computed_debits,
            computed_credits,
            NEW.total_debits,
            NEW.total_credits;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER jade_journals_postings_balance
AFTER INSERT ON jade_journals
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_jade_journal_balance();

CREATE FUNCTION prevent_jade_ledger_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Jade ledger rows are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER jade_journals_immutable
BEFORE UPDATE OR DELETE ON jade_journals
FOR EACH ROW EXECUTE FUNCTION prevent_jade_ledger_mutation();

CREATE TRIGGER jade_postings_immutable
BEFORE UPDATE OR DELETE ON jade_postings
FOR EACH ROW EXECUTE FUNCTION prevent_jade_ledger_mutation();
