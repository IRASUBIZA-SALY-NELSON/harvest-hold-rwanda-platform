-- Files of removed photos are deleted 30 days after removal; the row stays for the audit trail.
ALTER TABLE photos ADD COLUMN purged_at timestamptz;
