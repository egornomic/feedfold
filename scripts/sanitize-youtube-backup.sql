-- Remove Google-authorized data from the snapshot, never from the live database.
PRAGMA foreign_keys = ON;
PRAGMA secure_delete = ON;
BEGIN;
DELETE FROM feeds WHERE id IN (SELECT feed_id FROM youtube_feeds);
DELETE FROM youtube_connections;
DELETE FROM youtube_oauth_states;
DELETE FROM feed_sources
WHERE NOT EXISTS (SELECT 1 FROM feeds WHERE feeds.source_id = feed_sources.id)
  AND NOT EXISTS (
    SELECT 1 FROM articles JOIN feed_articles ON feed_articles.article_id = articles.id
    WHERE articles.source_id = feed_sources.id
  );
COMMIT;
VACUUM;
