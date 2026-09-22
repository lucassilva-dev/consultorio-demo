const { hashPassword } = require("../lib/password");

function createPostgresAdminRepository(db) {
  return {
    async incrementSessionEpoch(id) {
      await db`
        UPDATE admin_users
        SET session_epoch = session_epoch + 1, updated_at = ${new Date().toISOString()}
        WHERE id = ${Number(id)}
      `;
      return this.findById(Number(id));
    },
    async findByEmail(email) {
      const normalizedEmail = String(email || "").trim().toLowerCase();
      const rows = await db`
        SELECT *
        FROM admin_users
        WHERE email = ${normalizedEmail}
        LIMIT 1
      `;
      return rows[0] || null;
    },
    async findById(id) {
      const rows = await db`
        SELECT *
        FROM admin_users
        WHERE id = ${id}
        LIMIT 1
      `;
      return rows[0] || null;
    },
    async createAdminUser(email, password) {
      const normalizedEmail = String(email).trim().toLowerCase();
      const passwordRecord = hashPassword(password);
      return this.createAdminUserFromRecord(normalizedEmail, {
        password_hash: passwordRecord.hash,
        password_salt: passwordRecord.salt,
        password_iterations: passwordRecord.iterations
      });
    },
    async createAdminUserFromRecord(email, passwordRecord) {
      const normalizedEmail = String(email).trim().toLowerCase();
      const now = new Date().toISOString();
      const rows = await db`
        INSERT INTO admin_users (
          email,
          password_hash,
          password_salt,
          password_iterations,
          role,
          created_at,
          updated_at
        ) VALUES (
          ${normalizedEmail},
          ${passwordRecord.password_hash},
          ${passwordRecord.password_salt},
          ${passwordRecord.password_iterations},
          'admin',
          ${now},
          ${now}
        )
        RETURNING *
      `;
      return rows[0] || null;
    },
    async syncAdminPasswordRecord(email, passwordRecord) {
      const normalizedEmail = String(email).trim().toLowerCase();
      const rows = await db`
        UPDATE admin_users
        SET
          password_hash = ${passwordRecord.password_hash},
          password_salt = ${passwordRecord.password_salt},
          password_iterations = ${passwordRecord.password_iterations},
          updated_at = ${new Date().toISOString()}
        WHERE email = ${normalizedEmail}
        RETURNING *
      `;
      return rows[0] || null;
    }
  };
}

module.exports = {
  createPostgresAdminRepository
};
