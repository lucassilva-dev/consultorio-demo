#!/usr/bin/env bash
set -euo pipefail

git init -b main
git add .
git commit -m "chore: versão demonstrativa com dados fictícios"

echo
echo "Repositório local criado sem histórico anterior."
echo "Agora crie um repo vazio no GitHub e rode:"
echo "  git remote add origin git@github.com:SEU-USUARIO/NOME-DO-REPO.git"
echo "  git push -u origin main"
