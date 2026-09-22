const { DEFAULT_CONTENT, DEFAULT_HELP_CARDS } = require("../default-content");

function createPostgresSiteRepository(db) {
  async function ensureSection(sectionKey, payload) {
    const rows = await db`
      SELECT section_key
      FROM content_sections
      WHERE section_key = ${sectionKey}
      LIMIT 1
    `;

    if (rows[0]) {
      return;
    }

    const now = new Date().toISOString();
    await db`
      INSERT INTO content_sections (
        section_key,
        payload_json,
        created_at,
        updated_at
      ) VALUES (
        ${sectionKey},
        ${db.json(payload)},
        ${now},
        ${now}
      )
      ON CONFLICT (section_key) DO NOTHING
    `;
  }

  return {
    async seedDefaults() {
      await ensureSection("home", DEFAULT_CONTENT.home);
      await ensureSection("about", DEFAULT_CONTENT.about);
      await ensureSection("aboutPanel", DEFAULT_CONTENT.aboutPanel);
      await ensureSection("help", DEFAULT_CONTENT.help);
      await ensureSection("work", DEFAULT_CONTENT.work);
      await ensureSection("attendance", DEFAULT_CONTENT.attendance);
      await ensureSection("closing", DEFAULT_CONTENT.closing);
      await ensureSection("contact", DEFAULT_CONTENT.contact);
      await ensureSection("seo", DEFAULT_CONTENT.seo);
      await ensureSection("footer", DEFAULT_CONTENT.footer);

      const totals = await db`SELECT COUNT(*)::int AS total FROM help_cards`;
      if ((totals[0]?.total || 0) > 0) {
        return;
      }

      await this.replaceHelpCards(DEFAULT_HELP_CARDS);
    },
    async getSection(sectionKey) {
      const rows = await db`
        SELECT payload_json
        FROM content_sections
        WHERE section_key = ${sectionKey}
        LIMIT 1
      `;

      if (!rows[0]) {
        return null;
      }

      return typeof rows[0].payload_json === "string"
        ? JSON.parse(rows[0].payload_json)
        : rows[0].payload_json;
    },
    async setSection(sectionKey, payload) {
      const now = new Date().toISOString();
      await db`
        INSERT INTO content_sections (
          section_key,
          payload_json,
          created_at,
          updated_at
        ) VALUES (
          ${sectionKey},
          ${db.json(payload)},
          ${now},
          ${now}
        )
        ON CONFLICT (section_key) DO UPDATE SET
          payload_json = EXCLUDED.payload_json,
          updated_at = EXCLUDED.updated_at
      `;

      return this.getSection(sectionKey);
    },
    async listHelpCards() {
      const rows = await db`
        SELECT
          id,
          sort_order AS "sortOrder",
          title,
          description,
          asset_type AS "assetType",
          asset_value AS "assetValue"
        FROM help_cards
        ORDER BY sort_order ASC, id ASC
      `;
      return rows;
    },
    async replaceHelpCards(cards) {
      await db.begin(async (sql) => {
        await sql`DELETE FROM help_cards`;
        const now = new Date().toISOString();

        for (const card of cards) {
          await sql`
            INSERT INTO help_cards (
              sort_order,
              title,
              description,
              asset_type,
              asset_value,
              created_at,
              updated_at
            ) VALUES (
              ${card.sortOrder},
              ${card.title},
              ${card.description},
              ${card.assetType},
              ${card.assetValue},
              ${now},
              ${now}
            )
          `;
        }
      });

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
  createPostgresSiteRepository
};
