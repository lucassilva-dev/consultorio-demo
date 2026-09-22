const { hashPassword } = require("../lib/password");

function createSqliteAdminRepository(db) {
  const findByEmailStmt = db.prepare("SELECT * FROM admin_users WHERE email = ? LIMIT 1");
  const findByIdStmt = db.prepare("SELECT * FROM admin_users WHERE id = ? LIMIT 1");
  const insertStmt = db.prepare(`
    INSERT INTO admin_users (
      email,
      password_hash,
      password_salt,
      password_iterations,
      role,
      created_at,
      updated_at
    ) VALUES (
      @email,
      @password_hash,
      @password_salt,
      @password_iterations,
      'admin',
      @created_at,
      @updated_at
    )
  `);
  const updateCredentialsStmt = db.prepare(`
    UPDATE admin_users
    SET
      password_hash = @password_hash,
      password_salt = @password_salt,
      password_iterations = @password_iterations,
      updated_at = @updated_at
    WHERE email = @email
  `);

  const incrementSessionEpochStmt = db.prepare(`
    UPDATE admin_users
    SET session_epoch = session_epoch + 1, updated_at = @updated_at
    WHERE id = @id
  `);

  return {
    async incrementSessionEpoch(id) {
      incrementSessionEpochStmt.run({ id: Number(id), updated_at: new Date().toISOString() });
      return this.findById(Number(id));
    },
    async findByEmail(email) {
      return findByEmailStmt.get(String(email || "").trim().toLowerCase()) || null;
    },
    async findById(id) {
      return findByIdStmt.get(id) || null;
    },
    async createAdminUser(email, password) {
      const normalizedEmail = String(email).trim().toLowerCase();
      const now = new Date().toISOString();
      const passwordRecord = hashPassword(password);
      const result = insertStmt.run({
        email: normalizedEmail,
        password_hash: passwordRecord.hash,
        password_salt: passwordRecord.salt,
        password_iterations: passwordRecord.iterations,
        created_at: now,
        updated_at: now
      });
      return this.findById(result.lastInsertRowid);
    },
    async createAdminUserFromRecord(email, passwordRecord) {
      const normalizedEmail = String(email).trim().toLowerCase();
      const now = new Date().toISOString();
      const result = insertStmt.run({
        email: normalizedEmail,
        password_hash: passwordRecord.password_hash,
        password_salt: passwordRecord.password_salt,
        password_iterations: passwordRecord.password_iterations,
        created_at: now,
        updated_at: now
      });
      return this.findById(result.lastInsertRowid);
    },
    async syncAdminPasswordRecord(email, passwordRecord) {
      const normalizedEmail = String(email).trim().toLowerCase();
      updateCredentialsStmt.run({
        email: normalizedEmail,
        password_hash: passwordRecord.password_hash,
        password_salt: passwordRecord.password_salt,
        password_iterations: passwordRecord.password_iterations,
        updated_at: new Date().toISOString()
      });
      return this.findByEmail(normalizedEmail);
    }
  };
}

module.exports = {
  createSqliteAdminRepository
};
