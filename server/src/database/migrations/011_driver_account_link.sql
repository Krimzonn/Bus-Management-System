-- Slice 7: optional link from a driver record to the login account that driver
-- uses, so a signed-in driver can see and operate only their own trips.
-- No foreign key into Identity & Access tables (module boundary). The API layer
-- verifies the account through Identity & Access before a link is saved.
ALTER TABLE drivers_drivers
    ADD COLUMN account_user_id BIGINT,
    ADD CONSTRAINT drivers_drivers_account_check CHECK (account_user_id > 0);

-- One account belongs to at most one driver record.
CREATE UNIQUE INDEX drivers_drivers_account_key
    ON drivers_drivers (account_user_id)
    WHERE account_user_id IS NOT NULL;
