#!/usr/bin/env bash
# Atualiza a Cabine v2 na VPS: baixa a main, instala dependências e reinicia.
# É o único comando que a chave de deploy do GitHub pode rodar na VPS
# (ver "command=" em /root/.ssh/authorized_keys).
set -euo pipefail
APP_DIR="/opt/brain-cabine"
BRANCH="${CABINE_BRANCH:-main}"

# Trava de evento: com cockpit ou saída conectados, não reinicia no meio da
# transmissão. O deploy falha avisando; é só rodar de novo depois do evento.
CONEXOES="$(curl -fsS http://127.0.0.1:8790/saude 2>/dev/null | grep -o '"conexoes":[0-9]*' | cut -d: -f2 || true)"
if [[ "${CONEXOES:-0}" -gt 0 && "${FORCAR:-0}" != "1" ]]; then
  echo "EVENTO EM ANDAMENTO: $CONEXOES conexão(ões) ativa(s). Atualização adiada para não cortar a transmissão."
  exit 3
fi

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
