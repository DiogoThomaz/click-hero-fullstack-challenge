#!/usr/bin/env bash
# FURY · Click Hero — Teste de Carga
# 1000 requisições (50% válidas, 50% inválidas) + consulta de jobs
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
TOTAL="${TOTAL:-1000}"
PARALLEL="${PARALLEL:-20}"
REPORT_FILE="${REPORT_FILE:-relatorio-carga.txt}"

# ── Estatísticas ──
req_total=0
req_202=0
req_400=0
req_404=0
req_other=0
job_ids=""
errors_400=""
start_epoch=0
end_epoch=0

# ── Cores ──
RST='\033[0m'
GRN='\033[32m'
RED='\033[31m'
YEL='\033[33m'
BLD='\033[1m'

info()  { echo -e "  ${BLD}$*${RST}"; }
ok()    { echo -e "  ${GRN}${*}${RST}"; }
warn()  { echo -e "  ${YEL}${*}${RST}"; }
err()   { echo -e "  ${RED}${*}${RST}" >&2; }

# ── Helpers ──

pick() {
  local arr=("$@")
  echo "${arr[RANDOM % ${#arr[@]}]}"
}

randint() {
  echo $((RANDOM % $1))
}

uuid() {
  echo "$(date +%s%N)-${RANDOM}-${RANDOM}"
}

make_valid_payload() {
  local id="ad-$(uuid)"
  local violation_type; violation_type=$(pick PROHIBITED_TERM BRAND_VIOLATION COMPLIANCE_FAIL)
  local severity; severity=$(pick LOW MEDIUM HIGH CRITICAL)
  local ts; ts=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")

  cat <<EOF
{
  "adId": "${id}",
  "tenantId": "tenant-${RANDOM}",
  "violationType": "${violation_type}",
  "severity": "${severity}",
  "detectedAt": "${ts}"
}
EOF
}

make_invalid_payload() {
  local kind=$((RANDOM % 6))

  case $kind in
    0) # adId vazio
      cat <<EOF
{
  "adId": "",
  "tenantId": "tenant-err",
  "violationType": "PROHIBITED_TERM",
  "severity": "LOW",
  "detectedAt": "$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")"
}
EOF
      ;;
    1) # tenantId ausente
      cat <<EOF
{
  "adId": "ad-err-$(uuid)",
  "violationType": "BRAND_VIOLATION",
  "severity": "MEDIUM",
  "detectedAt": "$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")"
}
EOF
      ;;
    2) # violationType inválido
      cat <<EOF
{
  "adId": "ad-err-$(uuid)",
  "tenantId": "tenant-err",
  "violationType": "NOT_A_REAL_TYPE",
  "severity": "HIGH",
  "detectedAt": "$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")"
}
EOF
      ;;
    3) # severity inválida
      cat <<EOF
{
  "adId": "ad-err-$(uuid)",
  "tenantId": "tenant-err",
  "violationType": "COMPLIANCE_FAIL",
  "severity": "INVALID_SEVERITY",
  "detectedAt": "$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")"
}
EOF
      ;;
    4) # detectedAt inválido
      cat <<EOF
{
  "adId": "ad-err-$(uuid)",
  "tenantId": "tenant-err",
  "violationType": "PROHIBITED_TERM",
  "severity": "CRITICAL",
  "detectedAt": "isso-nao-e-uma-data"
}
EOF
      ;;
    5) # body vazio
      echo "{}"
      ;;
  esac
}

collect_job_id() {
  local line="$1"
  # extrai "jobId":"..." da resposta
  local id; id=$(echo "$line" | sed -n 's/.*"jobId"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
  if [[ -n "$id" ]]; then
    job_ids="${job_ids}${id},"
  fi
}

collect_400_detail() {
  local line="$1"
  local detail; detail=$(echo "$line" | sed -n 's/.*"details"[[:space:]]*:[[:space:]]*{\([^}]*\)}.*/\1/p')
  if [[ -n "$detail" ]]; then
    errors_400="${errors_400}  [${detail}]"$'\n'
  fi
}

send_one() {
  local valid="$1"
  local payload

  if [[ "$valid" == "1" ]]; then
    payload=$(make_valid_payload)
  else
    payload=$(make_invalid_payload)
  fi

  local response
  response=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL}/webhook/violation" \
    -H "Content-Type: application/json" \
    -d "$payload" 2>/dev/null)

  local http_code
  http_code=$(echo "$response" | tail -1)
  local body
  body=$(echo "$response" | sed '$d')

  echo "$http_code|$body"
}

# ── Fase 1: Envio ──

echo ""
info "╔══════════════════════════════════════════════╗"
info "║   FURY · Click Hero — Teste de Carga        ║"
info "║   ${TOTAL} requisições (50% válidas / 50% inválidas)  ║"
info "╚══════════════════════════════════════════════╝"
echo ""

start_epoch=$(date +%s)

# ── Abordagem com diretório temporário ──
echo ""
info "  Enviando requisições..."
echo ""

TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

send_and_record() {
  local idx="$1"
  local valid="$2"
  local payload

  if [[ "$valid" == "1" ]]; then
    payload=$(make_valid_payload)
  else
    payload=$(make_invalid_payload)
  fi

  local response
  response=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL}/webhook/violation" \
    -H "Content-Type: application/json" \
    -d "$payload" 2>/dev/null)

  local http_code
  http_code=$(echo "$response" | tail -1)
  local body
  body=$(echo "$response" | sed '$d')

  # salva resultado
  echo "${http_code}|${body}" > "${TMP_DIR}/req_${idx}"
}

sent=0
bar_size=50

while [[ $sent -lt $TOTAL ]]; do
  batch=$((PARALLEL < (TOTAL - sent) ? PARALLEL : (TOTAL - sent)))

  for ((i = 0; i < batch; i++)); do
    local_valid=$((RANDOM % 2))
    send_and_record $((sent + i)) "$local_valid" &
  done

  wait

  sent=$((sent + batch))

  # barra de progresso
  pct=$((sent * 100 / TOTAL))
  filled=$((sent * bar_size / TOTAL))
  bar=""
  for ((j = 0; j < filled; j++)); do bar="${bar}#"; done
  for ((j = filled; j < bar_size; j++)); do bar="${bar}."; done
  echo -ne "\r  [${bar}] ${pct}% (${sent}/${TOTAL})"
done
echo ""

end_epoch=$(date +%s)
elapsed=$((end_epoch - start_epoch))

# ── Fase 2: Processar resultados ──

for f in "${TMP_DIR}"/req_*; do
  [[ -f "$f" ]] || continue
  IFS='|' read -r status body < "$f"
  req_total=$((req_total + 1))

  case "$status" in
    202) req_202=$((req_202 + 1)); collect_job_id "$body" ;;
    400) req_400=$((req_400 + 1)); collect_400_detail "$body" ;;
    404) req_404=$((req_404 + 1)) ;;
    *)   req_other=$((req_other + 1)) ;;
  esac
done

# ── Fase 3: Consultar alguns jobs ──

IFS=',' read -ra job_list <<< "$job_ids"
total_jobs=${#job_list[@]}
consulted=0
completed=0
failed=0
waiting=0
active=0
missing=0
unknown=0

# consulta até 50 jobs ou 10% do total
max_consult=$(( total_jobs / 10 ))
[[ $max_consult -gt 50 ]] && max_consult=50
[[ $max_consult -eq 0 ]] && max_consult=${#job_list[@]}

echo ""
info "  Consultando até ${max_consult} jobs..."

start_index=$((total_jobs - max_consult))
[[ $start_index -lt 0 ]] && start_index=0

for ((i = start_index; i < total_jobs; i++)); do
  jid="${job_list[$i]}"
  [[ -z "$jid" ]] && continue

  resp=$(curl -s "${BASE_URL}/jobs/${jid}" 2>/dev/null)
  consulted=$((consulted + 1))

  st=$(echo "$resp" | sed -n 's/.*"status"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
  case "$st" in
    completed) completed=$((completed + 1)) ;;
    failed)    failed=$((failed + 1)) ;;
    waiting)   waiting=$((waiting + 1)) ;;
    active)    active=$((active + 1)) ;;
    "")        missing=$((missing + 1)) ;;
    *)         unknown=$((unknown + 1)) ;;
  esac
done

# ── Fase 4: Relatório ──

{
  echo ""
  echo "═══════════════════════════════════════════════"
  echo "      FURY · Click Hero — Relatório de Carga"
  echo "═══════════════════════════════════════════════"
  echo ""
  echo "  Período:          ${elapsed}s"
  echo "  Média:            $((req_total / (elapsed == 0 ? 1 : elapsed))) req/s"
  echo ""
  echo "── Requisições ───────────────────────────────"
  echo ""
  echo "  Total:            ${req_total}"
  echo "  202 (aceito):     ${req_202}"
  echo "  400 (inválido):   ${req_400}"
  echo "  404 (não encont.) ${req_404}"
  echo "  Outros:           ${req_other}"
  echo ""
  echo "── Jobs ──────────────────────────────────────"
  echo ""
  echo "  Total enfileirados:  ${total_jobs}"
  echo "  Consultados:         ${consulted}"
  echo "  ├─ completed:        ${completed}"
  echo "  ├─ failed:           ${failed}"
  echo "  ├─ waiting:          ${waiting}"
  echo "  ├─ active:           ${active}"
  echo "  ├─ missing:          ${missing}"
  echo "  └─ unknown:          ${unknown}"
  echo ""
} > "$REPORT_FILE"

# também exibe na tela
cat "$REPORT_FILE"

# exibe amostra de erros 400
if [[ -n "$errors_400" ]]; then
  echo ""
  echo "── Amostra de erros 400 ──────────────────────"
  echo ""
  echo "$errors_400" | head -20
  echo ""
fi

# ── Resumo ──

echo ""
if [[ $req_other -eq 0 && $((req_202 + req_400)) -eq $TOTAL ]]; then
  ok "  Todos os ${TOTAL} requests retornaram 202 ou 400 como esperado."
else
  warn "  ${req_other} requests retornaram status inesperado."
fi

if [[ $failed -eq 0 && $consulted -gt 0 ]]; then
  ok "  Nenhum job falhou entre os consultados."
elif [[ $failed -gt 0 ]]; then
  err "  ${failed} job(s) falharam!"
  exit 1
fi

if [[ $req_other -ne 0 || $((req_202 + req_400)) -ne $TOTAL ]]; then
  exit 1
fi

echo ""
info "  Relatório salvo em: ${REPORT_FILE}"
echo ""
