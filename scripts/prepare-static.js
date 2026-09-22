const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const publicDir = path.join(rootDir, "public");

function copyFileToPublic(relativePath) {
  const sourcePath = path.join(rootDir, relativePath);
  const targetPath = path.join(publicDir, relativePath);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
}

// Remove um diretório que versões anteriores do build publicavam, para que a
// pasta não fique para trás em quem já tem o public/ montado.
function removeFromPublic(relativePath) {
  fs.rmSync(path.join(publicDir, relativePath), { recursive: true, force: true });
}

function copyDirectoryToPublic(relativePath) {
  const sourcePath = path.join(rootDir, relativePath);
  const targetPath = path.join(publicDir, relativePath);
  fs.rmSync(targetPath, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.cpSync(sourcePath, targetPath, { recursive: true });
}

copyFileToPublic("colors_and_type.css");
copyDirectoryToPublic("assets");

// landing/ e ui_kits/ são protótipos React de referência para o design, não
// páginas servidas. Copiá-los para public/ publicava /landing/index.html e
// /ui_kits/landing/index.html, que carregam scripts de unpkg — bloqueados
// pela CSP — e portanto renderizavam em branco no domínio do consultório.
removeFromPublic("landing");
removeFromPublic("ui_kits");
