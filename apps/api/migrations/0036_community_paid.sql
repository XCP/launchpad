-- XCP committed to mints by each community's members, and by everyone, so
-- the stats page can say what share of all XCP minted a community put in.
-- Raw satoshi as TEXT, like every other quantity here.
ALTER TABLE community_stats ADD COLUMN paid_xcp TEXT NOT NULL DEFAULT '0';
ALTER TABLE community_totals ADD COLUMN paid_xcp TEXT NOT NULL DEFAULT '0';
