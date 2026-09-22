const { DEFAULT_CONTENT, DEFAULT_HELP_CARDS } = require("../default-content");

function createSqliteSiteRepository(db) {
  const getSectionStmt = db.prepare(
    "SELECT payload_json FROM content_sections WHERE section_key = ? LIMIT 1"
  );
  const upsertSectionStmt = db.prepare(`
    INSERT INTO content_sections (
      section_key,
      payload_json,
      created_at,
      updated_at
    ) VALUES (
      @section_key,
      @payload_json,
      @created_at,
      @updated_at
    )
    ON CONFLICT(section_key) DO UPDATE SET
      payload_json = excluded.payload_json,
      updated_at = excluded.updated_at
  `);
  const hasAnyHelpCardsStmt = db.prepare("SELECT COUNT(*) AS total FROM help_cards");
  const listHelpCardsStmt = db.prepare(`
    SELECT
      id,
      sort_order AS sortOrder,
      title,
      description,
      asset_type AS assetType,
      asset_value AS assetValue
    FROM help_cards
    ORDER BY sort_order ASC, id ASC
  `);
  const clearHelpCardsStmt = db.prepare("DELETE FROM help_cards");
  const insertHelpCardStmt = db.prepare(`
    INSERT INTO help_cards (
      sort_order,
      title,
      description,
      asset_type,
      asset_value,
      created_at,
      updated_at
    ) VALUES (
      @sort_order,
      @title,
      @description,
      @asset_type,
      @asset_value,
      @created_at,
      @updated_at
    )
  `);

  const replaceHelpCardsTransaction = db.transaction((cards) => {
    clearHelpCardsStmt.run();
    const now = new Date().toISOString();
    for (const card of cards) {
      insertHelpCardStmt.run({
        sort_order: card.sortOrder,
        title: card.title,
        description: card.description,
        asset_type: card.assetType,
        asset_value: card.assetValue,
        created_at: now,
        updated_at: now
      });
    }
  });

  function ensureSection(sectionKey, payload) {
    const row = getSectionStmt.get(sectionKey);
    if (row) {
      return;
    }

    const now = new Date().toISOString();
    upsertSectionStmt.run({
      section_key: sectionKey,
      payload_json: JSON.stringify(payload),
      created_at: now,
      updated_at: now
    });
  }

  return {
    async seedDefaults() {
      ensureSection("home", DEFAULT_CONTENT.home);
      ensureSection("about", DEFAULT_CONTENT.about);
      ensureSection("aboutPanel", DEFAULT_CONTENT.aboutPanel);
      ensureSection("help", DEFAULT_CONTENT.help);
      ensureSection("work", DEFAULT_CONTENT.work);
      ensureSection("attendance", DEFAULT_CONTENT.attendance);
      ensureSection("closing", DEFAULT_CONTENT.closing);
      ensureSection("contact", DEFAULT_CONTENT.contact);
      ensureSection("seo", DEFAULT_CONTENT.seo);
      ensureSection("footer", DEFAULT_CONTENT.footer);

      const hasCards = hasAnyHelpCardsStmt.get().total > 0;
      if (!hasCards) {
        replaceHelpCardsTransaction(DEFAULT_HELP_CARDS);
      }
    },
    async getSection(sectionKey) {
      const row = getSectionStmt.get(sectionKey);
      return row ? JSON.parse(row.payload_json) : null;
    },
    async setSection(sectionKey, payload) {
      const now = new Date().toISOString();
      upsertSectionStmt.run({
        section_key: sectionKey,
        payload_json: JSON.stringify(payload),
        created_at: now,
        updated_at: now
      });
      return this.getSection(sectionKey);
    },
    async listHelpCards() {
      return listHelpCardsStmt.all();
    },
    async replaceHelpCards(cards) {
      replaceHelpCardsTransaction(cards);
      return this.listHelpCards();
    },
    async getContentBundle() {
      return {
        home: await this.getSection("home"),
        about: await this.getSection("about"),
        aboutPanel: await this.getSection("aboutPanel"),
        help: {
          ...((await this.getSection("help")) || DEFAULT_CONTENT.help),
          cards: await this.listHelpCards()
        },
        work: await this.getSection("work"),
        attendance: await this.getSection("attendance"),
        closing: await this.getSection("closing"),
        contact: await this.getSection("contact"),
        seo: await this.getSection("seo"),
        footer: await this.getSection("footer")
      };
    }
  };
}

module.exports = {
  createSqliteSiteRepository
};
