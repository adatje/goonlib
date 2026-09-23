/**
 * Schema migrations, applied in order and tracked with SQLite's `user_version`.
 *
 * SQL lives here as strings rather than as loose .sql files so it survives
 * bundling without any asset-loader configuration.
 */

export interface Migration {
  version: number
  name: string
  sql: string
}

export const migrations: Migration[] = [
  {
    version: 1,
    name: 'init',
    sql: /* sql */ `
      CREATE TABLE roots (
        id       INTEGER PRIMARY KEY AUTOINCREMENT,
        path     TEXT    NOT NULL UNIQUE,
        enabled  INTEGER NOT NULL DEFAULT 1,
        added_at INTEGER NOT NULL
      );

      CREATE TABLE media (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        root_id       INTEGER NOT NULL REFERENCES roots(id) ON DELETE CASCADE,
        rel_path      TEXT    NOT NULL,
        name          TEXT    NOT NULL,
        ext           TEXT    NOT NULL,
        kind          TEXT    NOT NULL CHECK (kind IN ('image','video')),
        size          INTEGER NOT NULL,
        mtime         INTEGER NOT NULL,

        width         INTEGER,
        height        INTEGER,
        duration_ms   INTEGER,
        vcodec        TEXT,
        acodec        TEXT,
        fps           REAL,
        playback_tier TEXT CHECK (playback_tier IN ('native','remux','transcode')),

        -- Exact-dupe key. Hex digest; see scan/hash.ts for the quick-hash strategy.
        content_hash  TEXT,
        -- Near-dupe key. 64-bit DCT perceptual hash stored as 16 hex chars, so we
        -- never round-trip it through a JS double. Compared with the hamming() UDF.
        phash         TEXT,

        probe_state   TEXT NOT NULL DEFAULT 'pending',
        thumb_state   TEXT NOT NULL DEFAULT 'pending',
        sprite_state  TEXT NOT NULL DEFAULT 'pending',
        hash_state    TEXT NOT NULL DEFAULT 'pending',

        added_at      INTEGER NOT NULL,
        seen_at       INTEGER NOT NULL,
        -- Files that vanish are flagged, never deleted, so metadata survives an
        -- unplugged drive and reattaches on the next scan.
        missing       INTEGER NOT NULL DEFAULT 0,

        UNIQUE (root_id, rel_path)
      );

      CREATE INDEX idx_media_kind         ON media(kind);
      CREATE INDEX idx_media_added_at     ON media(added_at);
      CREATE INDEX idx_media_content_hash ON media(content_hash) WHERE content_hash IS NOT NULL;
      CREATE INDEX idx_media_phash        ON media(phash)        WHERE phash IS NOT NULL;
      CREATE INDEX idx_media_missing      ON media(missing);
      CREATE INDEX idx_media_probe_state  ON media(probe_state)  WHERE probe_state  = 'pending';
      CREATE INDEX idx_media_thumb_state  ON media(thumb_state)  WHERE thumb_state  = 'pending';
      CREATE INDEX idx_media_sprite_state ON media(sprite_state) WHERE sprite_state = 'pending';
      CREATE INDEX idx_media_hash_state   ON media(hash_state)   WHERE hash_state   = 'pending';

      CREATE TABLE collections (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        name           TEXT    NOT NULL,
        cover_media_id INTEGER REFERENCES media(id) ON DELETE SET NULL,
        created_at     INTEGER NOT NULL
      );

      CREATE TABLE collection_items (
        collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
        media_id      INTEGER NOT NULL REFERENCES media(id)       ON DELETE CASCADE,
        position      REAL    NOT NULL,
        PRIMARY KEY (collection_id, media_id)
      );

      CREATE INDEX idx_collection_items_order ON collection_items(collection_id, position);

      -- Tags and ratings are deferred out of v1, but the schema ships now so that
      -- turning the UI on later is not a migration.
      CREATE TABLE tags (
        id   INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE COLLATE NOCASE
      );

      CREATE TABLE media_tags (
        media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
        tag_id   INTEGER NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
        PRIMARY KEY (media_id, tag_id)
      );

      CREATE INDEX idx_media_tags_tag ON media_tags(tag_id);

      CREATE TABLE settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      -- Full-text search over filenames and paths, kept in sync by triggers.
      CREATE VIRTUAL TABLE media_fts USING fts5(
        name, rel_path, content='media', content_rowid='id'
      );

      CREATE TRIGGER media_fts_ai AFTER INSERT ON media BEGIN
        INSERT INTO media_fts(rowid, name, rel_path)
        VALUES (new.id, new.name, new.rel_path);
      END;

      CREATE TRIGGER media_fts_ad AFTER DELETE ON media BEGIN
        INSERT INTO media_fts(media_fts, rowid, name, rel_path)
        VALUES ('delete', old.id, old.name, old.rel_path);
      END;

      CREATE TRIGGER media_fts_au AFTER UPDATE OF name, rel_path ON media BEGIN
        INSERT INTO media_fts(media_fts, rowid, name, rel_path)
        VALUES ('delete', old.id, old.name, old.rel_path);
        INSERT INTO media_fts(rowid, name, rel_path)
        VALUES (new.id, new.name, new.rel_path);
      END;
    `,
  },
  {
    version: 2,
    name: 'sprite_layout',
    sql: /* sql */ `
      -- Geometry of the hover-scrub sprite sheet. The renderer needs all four to
      -- map a cursor position onto the right cell, and they vary per item because
      -- frame count follows duration and cell height follows aspect ratio.
      ALTER TABLE media ADD COLUMN sprite_frames  INTEGER;
      ALTER TABLE media ADD COLUMN sprite_columns INTEGER;
      ALTER TABLE media ADD COLUMN sprite_cell_w  INTEGER;
      ALTER TABLE media ADD COLUMN sprite_cell_h  INTEGER;
    `,
  },
  {
    version: 3,
    name: 'sort_indexes',
    sql: /* sql */ `
      -- Sorting by name was the slowest paging query at scale (~125ms at 88k rows)
      -- because nothing indexed the collated name. The collation has to match the
      -- ORDER BY exactly or the index is ignored.
      CREATE INDEX idx_media_name_nocase ON media(name COLLATE NOCASE);

      -- Paging sorts always tie-break on id, so the index should carry it too.
      CREATE INDEX idx_media_size     ON media(size, id);
      CREATE INDEX idx_media_duration ON media(duration_ms, id);
    `,
  },
  {
    version: 4,
    name: 'ai_labels',
    sql: /* sql */ `
      -- A fifth scan stage, following the same pending/done/error convention as
      -- the rest. Existing rows default to pending, so enabling AI categorisation
      -- on a library that is already indexed simply gives the stage work to do.
      ALTER TABLE media ADD COLUMN classify_state TEXT NOT NULL DEFAULT 'pending';

      CREATE INDEX idx_media_classify_state
        ON media(classify_state) WHERE classify_state = 'pending';

      -- Labels reuse the tag tables shipped in v1 rather than adding a parallel
      -- one. These two columns are what keeps a model's guess distinguishable
      -- from the user's own filing — without them, clearing AI labels would have
      -- no way to avoid throwing away hand-applied tags too.
      ALTER TABLE media_tags ADD COLUMN source     TEXT NOT NULL DEFAULT 'manual';
      ALTER TABLE media_tags ADD COLUMN confidence REAL;

      CREATE INDEX idx_media_tags_source ON media_tags(source);
    `,
  },
  {
    version: 5,
    name: 'captions',
    sql: /* sql */ `
      -- A free-text description of the item, written by the classifier. Distinct
      -- from labels: labels are a closed vocabulary you browse by, this is prose
      -- you search. Null until a captioning pass has run.
      ALTER TABLE media ADD COLUMN caption TEXT;

      -- The FTS index has to be rebuilt rather than altered — fts5 has no ADD
      -- COLUMN, and an external-content table's column list must match what the
      -- triggers write. The index holds no original data (content='media'), so
      -- dropping it loses nothing that can't be regenerated from the media table.
      DROP TRIGGER media_fts_ai;
      DROP TRIGGER media_fts_ad;
      DROP TRIGGER media_fts_au;
      DROP TABLE media_fts;

      CREATE VIRTUAL TABLE media_fts USING fts5(
        name, rel_path, caption, content='media', content_rowid='id'
      );

      CREATE TRIGGER media_fts_ai AFTER INSERT ON media BEGIN
        INSERT INTO media_fts(rowid, name, rel_path, caption)
        VALUES (new.id, new.name, new.rel_path, new.caption);
      END;

      CREATE TRIGGER media_fts_ad AFTER DELETE ON media BEGIN
        INSERT INTO media_fts(media_fts, rowid, name, rel_path, caption)
        VALUES ('delete', old.id, old.name, old.rel_path, old.caption);
      END;

      -- Captions are written long after the row is created, so the update
      -- trigger has to watch that column too or a caption would never be
      -- searchable.
      CREATE TRIGGER media_fts_au AFTER UPDATE OF name, rel_path, caption ON media BEGIN
        INSERT INTO media_fts(media_fts, rowid, name, rel_path, caption)
        VALUES ('delete', old.id, old.name, old.rel_path, old.caption);
        INSERT INTO media_fts(rowid, name, rel_path, caption)
        VALUES (new.id, new.name, new.rel_path, new.caption);
      END;

      -- Repopulate from the media table, so existing rows stay searchable by
      -- name and path across the rebuild.
      INSERT INTO media_fts(media_fts) VALUES('rebuild');
    `,
  },
  {
    version: 6,
    name: 'favorites',
    sql: /* sql */ `
      -- When the item was favorited, or null. A timestamp rather than a flag so
      -- "recently favorited" is a sort away rather than a migration away. On the
      -- media row rather than in a table of its own: an item is favorited at
      -- most once, the grid needs it on every card, and a column rides along
      -- with the existing select for free where a join would not.
      --
      -- Keyed by media id like everything else the user files, so it survives a
      -- move or a rescan, and goes when the row does.
      ALTER TABLE media ADD COLUMN favorited_at INTEGER;

      CREATE INDEX idx_media_favorited ON media(favorited_at, id) WHERE favorited_at IS NOT NULL;
    `,
  },
  {
    version: 7,
    name: 'toy-patterns',
    sql: /* sql */ `
      -- Patterns drawn in the toy panel. The points are one JSON column rather
      -- than a table of their own: a pattern is only ever read and written
      -- whole, never queried by what is inside it.
      CREATE TABLE toy_patterns (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT    NOT NULL,
        duration_ms INTEGER NOT NULL,
        points      TEXT    NOT NULL,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
      );
    `,
  },
  {
    version: 8,
    name: 'media-views',
    sql: /* sql */ `
      -- How often each item has been opened in the viewer, and for how long in
      -- all. A table of its own rather than columns on media: it changes every
      -- time something is watched, and the grid has no use for it.
      CREATE TABLE media_views (
        media_id       INTEGER PRIMARY KEY REFERENCES media(id) ON DELETE CASCADE,
        view_count     INTEGER NOT NULL DEFAULT 0,
        watch_ms       INTEGER NOT NULL DEFAULT 0,
        last_viewed_at INTEGER
      );
    `,
  },
  {
    version: 9,
    name: 'collection-item-source',
    sql: /* sql */ `
      -- Who filed an item under a collection, the way tags already record it,
      -- so a collection the classifier filled can say so. Everything already
      -- here was filed by hand, which is what the default says.
      ALTER TABLE collection_items ADD COLUMN source TEXT NOT NULL DEFAULT 'user';
    `,
  },
]
