const { hashPassword, serializePasswordRecord } = require("../src/lib/password");

const password = process.argv[2];

if (!password) {
  console.error("Uso: npm run admin:hash -- \"sua-senha-aqui\"");
  process.exit(1);
}

const record = hashPassword(password);
console.log(serializePasswordRecord(record));
