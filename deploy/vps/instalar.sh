#!/usr/bin/env bash
# Instala ou atualiza a Cabine v2 numa VPS Ubuntu/Debian.
#
#   sudo bash instalar.sh cabine.brainaudiovisual.com.br
#
# O que faz (pode rodar de novo sem medo, só atualiza):
#   - instala Node.js 22, git e o Caddy (servidor web com HTTPS automático)
#   - baixa/atualiza o código em /opt/brain-cabine (repositório público)
#   - cria o serviço "brain-cabine", que liga com a VPS e reinicia se cair
#   - gera o código de acesso da equipe (só na primeira vez) em /etc/brain-cabine.env
#   - publica o domínio com HTTPS via Caddy
set -euo pipefail

DOMAIN="${1:-}"
REPO="https://github.com/wendtphelipe-png/brainaudiovisual.git"
BRANCH="${CABINE_BRANCH:-main}"
APP_DIR="/opt/brain-cabine"
DATA_DIR="/var/lib/brain-cabine"
ENV_FILE="/etc/brain-cabine.env"
PORT=8790

if [[ -z "$DOMAIN" ]]; then echo "Uso: sudo bash instalar.sh cabine.seudominio.com.br"; exit 1; fi
if [[ $EUID -ne 0 ]]; then echo "Rode com sudo (como root)."; exit 1; fi

echo "==> Pacotes básicos"
apt-get update -qq
apt-get install -y -qq curl git ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https >/dev/null

echo "==> Node.js 22"
if ! command -v node >/dev/null || [[ "$(node -v | cut -d. -f1 | tr -d v)" -lt 20 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
node -v

echo "==> Usuário do serviço"
id -u cabine >/dev/null 2>&1 || useradd --system --home "$DATA_DIR" --shell /usr/sbin/nologin cabine
mkdir -p "$DATA_DIR"
chown -R cabine:cabine "$DATA_DIR"

echo "==> Código ($BRANCH)"
if [[ -d "$APP_DIR/.git" ]]; then
  git -C "$APP_DIR" fetch -q origin "$BRANCH"
  git -C "$APP_DIR" checkout -q "$BRANCH"
  git -C "$APP_DIR" reset -q --hard "origin/$BRANCH"
else
  git clone -q --branch "$BRANCH" "$REPO" "$APP_DIR"
fi
(cd "$APP_DIR/cabine" && npm ci --omit=dev --silent)
git -C "$APP_DIR" log --oneline -1

echo "==> Configuração"
if [[ ! -f "$ENV_FILE" ]]; then
  # 10 caracteres fáceis de ditar (sem 0/O, 1/l/I)
  KEY="$(node -e "const a='ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';let s='';for(const b of require('crypto').randomBytes(10))s+=a[b%a.length];console.log(s)")"
  cat > "$ENV_FILE" <<EOF
CABINE_PORT=$PORT
CABINE_HOST=127.0.0.1
CABINE_PUBLIC_URL=https://$DOMAIN
CABINE_DATA=$DATA_DIR
CABINE_CREATE_KEY=$KEY
EOF
  chmod 640 "$ENV_FILE"
  chgrp cabine "$ENV_FILE"
  NEW_KEY=1
else
  sed -i "s#^CABINE_PUBLIC_URL=.*#CABINE_PUBLIC_URL=https://$DOMAIN#" "$ENV_FILE"
  NEW_KEY=0
fi

echo "==> Serviço"
cat > /etc/systemd/system/brain-cabine.service <<EOF
[Unit]
Description=Brain Audiovisual - Cabine v2
After=network-online.target
Wants=network-online.target

[Service]
User=cabine
EnvironmentFile=$ENV_FILE
WorkingDirectory=$APP_DIR/cabine
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=2
NoNewPrivileges=true
ProtectSystem=full
ReadWritePaths=$DATA_DIR

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now brain-cabine >/dev/null
systemctl restart brain-cabine

echo "==> HTTPS (Caddy)"
if ! command -v caddy >/dev/null; then
  if ss -ltn '( sport = :80 or sport = :443 )' | grep -q LISTEN; then
    echo "AVISO: as portas 80/443 já estão em uso por outro programa (ex.: nginx)."
    echo "O serviço da cabine está rodando em 127.0.0.1:$PORT; configure o proxy desse programa para ele."
    exit 2
  fi
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq && apt-get install -y -qq caddy >/dev/null
fi
mkdir -p /etc/caddy/sites
grep -q 'import /etc/caddy/sites/\*' /etc/caddy/Caddyfile 2>/dev/null || {
  # Mantém o que já existir no Caddyfile e passa a ler os sites desta pasta
  [[ -f /etc/caddy/Caddyfile ]] && grep -q ':80 {' /etc/caddy/Caddyfile && grep -q 'root \* /usr/share/caddy' /etc/caddy/Caddyfile && : > /etc/caddy/Caddyfile
  echo 'import /etc/caddy/sites/*.caddy' >> /etc/caddy/Caddyfile
}
cat > /etc/caddy/sites/brain-cabine.caddy <<EOF
$DOMAIN {
  encode gzip
  reverse_proxy 127.0.0.1:$PORT
}
EOF
caddy validate --config /etc/caddy/Caddyfile >/dev/null
systemctl reload caddy || systemctl restart caddy

echo ""
echo "Pronto: https://$DOMAIN"
sleep 2
curl -fsS "http://127.0.0.1:$PORT/saude" && echo ""
if [[ $NEW_KEY == 1 ]]; then
  echo ""
  echo "CÓDIGO DE ACESSO DA EQUIPE (para criar cabines): $(grep CABINE_CREATE_KEY "$ENV_FILE" | cut -d= -f2)"
  echo "Para trocar depois: edite $ENV_FILE e rode: systemctl restart brain-cabine"
fi
