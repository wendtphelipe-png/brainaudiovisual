#!/usr/bin/env bash
# Atualiza a Cabine v2 na VPS: baixa a main, instala dependências e reinicia.
# É o único comando que a chave de deploy do GitHub pode rodar na VPS
# (ver "command=" em /root/.ssh/authorized_keys).
set -euo pipefail
APP_DIR="/opt/brain-cabine"
BRANCH="${CABINE_BRANCH:-main}"

git -C "$APP_DIR" fetch -q origin "$BRANCH"
git -C "$APP_DIR" reset -q --hard "origin/$BRANCH"
(cd "$APP_DIR/cabine" && npm ci --omit=dev --silent)
systemctl restart brain-cabine

# Confere se voltou de pé
for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS http://127.0.0.1:8790/saude >/dev/null 2>&1; then
    echo "Cabine atualizada: $(git -C "$APP_DIR" log --oneline -1)"
    exit 0
  fi
  sleep 1
done
echo "ERRO: a cabine não respondeu depois de atualizar"
journalctl -u brain-cabine -n 30 --no-pager
exit 1
