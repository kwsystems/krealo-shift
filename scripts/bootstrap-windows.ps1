# Krealo Shift — arranque completo en Windows, de cero, con un solo comando.
#
# Uso (una sola linea en PowerShell):
#   irm https://raw.githubusercontent.com/kwsystems/krealo-shift/claude/proxima-tarea-uwy0ab/scripts/bootstrap-windows.ps1 | iex
#
# POR QUE EXISTE
# Los pasos manuales son cinco y dos de ellos fallan de forma confusa:
#   - si se pegan varias lineas de golpe, PowerShell las une y sale
#     "cd krealo-shiftnpm install", que no dice en ningun sitio que el problema fue
#     el pegado;
#   - al clonar se queda en `main`, donde la app casi no existe, y olvidarse del
#     checkout produce una app vacia sin ningun mensaje de error.
# Con un solo comando ninguno de los dos puede pasar.
#
# NO usa `param()` ni `$MyInvocation`: cuando el script llega por `irm | iex` no hay
# archivo en disco ni linea de comandos, asi que todo tiene que ser autonomo.

# NO se pone $ErrorActionPreference = 'Stop' a proposito.
#
# `git clone` escribe su progreso en stderr —"Cloning into...", los porcentajes— y
# `npm install` escribe avisos ahi tambien. En PowerShell 7 con 'Stop', la salida por
# stderr de un programa nativo puede abortar el script: se cortaria en medio de un
# clon que iba bien, con un mensaje que no explica nada. En su lugar se comprueba
# $LASTEXITCODE, que es el codigo de salida de verdad.

$rama = 'claude/proxima-tarea-uwy0ab'
$destino = Join-Path $env:USERPROFILE 'krealo-shift'
$url = 'https://github.com/kwsystems/krealo-shift.git'

function Paso($n, $texto) {
  Write-Host ""
  Write-Host "[$n] $texto" -ForegroundColor Cyan
}

function Fallo($texto, $ayuda) {
  Write-Host ""
  Write-Host "NO SE PUDO: $texto" -ForegroundColor Red
  Write-Host "  $ayuda" -ForegroundColor Yellow
  Write-Host ""
}

Write-Host ""
Write-Host "Krealo Shift" -ForegroundColor Magenta
Write-Host "Va a quedar en: $destino"

# --- Requisitos ---------------------------------------------------------------
Paso 1 "Comprobando Git y Node"

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Fallo "Git no esta instalado." "Instalalo desde https://git-scm.com/download/win, cierra esta ventana, abre otra y repite el comando."
  return
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Fallo "Node.js no esta instalado." "Instalalo desde https://nodejs.org (boton LTS), cierra esta ventana, abre otra y repite el comando."
  return
}

$v = (node --version).TrimStart('v').Split('.')[0]
if ([int]$v -lt 20) {
  Fallo "Node $v es demasiado antiguo; hace falta 20 o superior." "Actualizalo desde https://nodejs.org (boton LTS)."
  return
}
Write-Host "    Git y Node listos (Node $v)" -ForegroundColor Green

# --- Descargar ----------------------------------------------------------------
if (Test-Path (Join-Path $destino '.git')) {
  Paso 2 "El proyecto ya estaba descargado. Traigo los cambios"
  Set-Location $destino
  git fetch origin $rama
  git checkout $rama
  git pull origin $rama
} else {
  Paso 2 "Descargando el proyecto"
  Set-Location $env:USERPROFILE
  git clone $url 'krealo-shift'
  if ($LASTEXITCODE -ne 0) {
    Fallo "No se pudo descargar el proyecto." "Revisa la conexion y vuelve a correr el mismo comando."
    return
  }
  Set-Location $destino
  # Al clonar se queda en `main`, que no tiene la app. Este checkout es el paso que
  # mas facil es olvidar a mano y el que falla sin decir nada.
  git checkout $rama
  if ($LASTEXITCODE -ne 0) {
    Fallo "No se pudo cambiar a la rama $rama." "Sin esta rama la app no esta completa. Vuelve a correr el mismo comando."
    return
  }
}

Write-Host "    Rama activa: $(git branch --show-current)" -ForegroundColor Green

# --- Dependencias -------------------------------------------------------------
Paso 3 "Instalando dependencias (varios minutos la primera vez, con mucho texto)"
npm install
if ($LASTEXITCODE -ne 0) {
  Fallo "npm install fallo." "Suele ser la red. Vuelve a correr el mismo comando; retoma donde iba."
  return
}
Write-Host "    Dependencias listas" -ForegroundColor Green

# --- Configuracion ------------------------------------------------------------
Paso 4 "Configuracion"
if (Test-Path '.env') {
  Write-Host "    Ya habia un .env; no lo toco" -ForegroundColor Green
} else {
  Copy-Item '.env.example' '.env'
  Write-Host "    .env creado a partir de .env.example" -ForegroundColor Green
}

# --- Arrancar -----------------------------------------------------------------
Write-Host ""
Write-Host "----------------------------------------------------------------"
Write-Host "Cuando termine de compilar, abre en el navegador:" -ForegroundColor Cyan
Write-Host "    http://localhost:8081/kiosk" -ForegroundColor White
Write-Host ""
Write-Host "Sin credenciales de Supabase veras el kiosco completo: reloj, teclado,"
Write-Host "ayuda, cambio de idioma. El panel administrativo se queda en"
Write-Host "'Preparando tu sesion', y eso es correcto: necesita servidor."
Write-Host ""
Write-Host "Para parar: Ctrl+C aqui." -ForegroundColor Yellow
Write-Host "Para volver a arrancar otro dia: cd $destino  y luego  npx expo start --web"
Write-Host "----------------------------------------------------------------"
Write-Host ""

npx expo start --web
