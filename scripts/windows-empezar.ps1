<#
.SYNOPSIS
  Deja Krealo Shift corriendo en el navegador de esta maquina Windows.

.DESCRIPTION
  Un solo comando: comprueba Node, instala dependencias y arranca la web.

  QUE ARRANCA, Y POR QUE
  Si hay un .env con credenciales de verdad, arranca contra tu Firebase. Si no, usa
  el MODO DEMOSTRACION, que trae datos incorporados: se entra sin cuenta y se recorre
  la app entera.

  Antes este script creaba un .env de relleno y avisaba de que el panel administrativo
  no iba a cargar, porque sin servidor no habia contra que autenticarse: se veia la
  pantalla de acceso y nada mas. Con el modo demostracion eso ya no hace falta, asi
  que el script no toca tu .env nunca.

.PARAMETER Real
  Exige credenciales reales: si no hay .env con valores propios, falla en vez de caer
  al modo demostracion. Util para comprobar que el .env esta bien puesto.

.EXAMPLE
  .\scripts\windows-empezar.ps1
#>

[CmdletBinding()]
param(
  [switch]$Real
)

$ErrorActionPreference = 'Stop'

function Escribir($texto, $color = 'White') {
  Write-Host $texto -ForegroundColor $color
}

$raiz = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $raiz
Escribir "Krealo Shift — arranque en Windows" 'Cyan'
Escribir "Carpeta: $raiz`n"

# --- 1. Node -----------------------------------------------------------------
try {
  $nodeVersion = (& node --version) 2>$null
} catch {
  $nodeVersion = $null
}

if (-not $nodeVersion) {
  Escribir "FALTA Node.js." 'Red'
  Escribir "  Instalalo desde https://nodejs.org (elige la version LTS) y vuelve a"
  Escribir "  correr este script. No hace falta nada mas."
  exit 1
}

# `v20.11.0` -> 20
$mayor = [int]($nodeVersion.TrimStart('v').Split('.')[0])
if ($mayor -lt 20) {
  Escribir "Node $nodeVersion es demasiado antiguo. Hace falta 20 LTS o superior." 'Red'
  Escribir "  Expo SDK 57 no funciona por debajo de 20."
  exit 1
}
Escribir "Node $nodeVersion — bien" 'Green'

# --- 2. Dependencias ---------------------------------------------------------
if (-not (Test-Path 'node_modules')) {
  Escribir "`nInstalando dependencias (tarda unos minutos la primera vez)..." 'Yellow'
  & npm install
  if ($LASTEXITCODE -ne 0) {
    Escribir "npm install fallo. Suele ser red o permisos." 'Red'
    exit 1
  }
} else {
  Escribir "Dependencias ya instaladas — bien" 'Green'
}

# --- 3. Configuracion --------------------------------------------------------
$hayEnvReal = $false

if (Test-Path '.env') {
  # El .env NUNCA se toca: puede tener credenciales de verdad.
  $contenido = Get-Content '.env' -Raw
  $hayEnvReal = ($contenido -notmatch 'EXPO_PUBLIC_FIREBASE_PROJECT_ID=ejemplo') -and
                ($contenido -match 'EXPO_PUBLIC_FIREBASE_PROJECT_ID=\S')
  if ($hayEnvReal) {
    Escribir ".env con credenciales propias — bien" 'Green'
  } else {
    Escribir ".env sin credenciales utiles: se usara el modo demostracion" 'Yellow'
  }
}

if ($Real -and -not $hayEnvReal) {
  Escribir "`nPediste -Real y no hay credenciales en .env." 'Red'
  Escribir "  Copia .env.example a .env y pon la URL y la anon key de tu proyecto"
  Escribir "  de Firebase. Son publicas por diseno; la clave de servicio NO va ahi."
  exit 1
}


# --- 4. Arrancar -------------------------------------------------------------
Escribir "`n----------------------------------------------------------------"
if ($hayEnvReal) {
  Escribir "Arrancando con TU proyecto de Firebase: datos de verdad." 'Green'
} else {
  Escribir "Arrancando en MODO DEMOSTRACION. Entras solo, sin cuenta ni claves." 'Yellow'
  Escribir "  - el panel completo: inicio, equipo, horario, horas y solicitudes"
  Escribir "  - el kiosco: reloj, teclado de PIN, ayuda y activacion"
  Escribir "  - los dos idiomas y el diseno de escritorio, iPad y telefono"
  Escribir "  Los datos son inventados y se pierden al recargar. Lo dice en pantalla."
}
Escribir "`nSe abrira en el navegador. Para parar: Ctrl+C en esta ventana."
Escribir "Si no se abre solo, entra a la URL que salga abajo (normalmente"
Escribir "http://localhost:8081) y añade /kiosk al final para ver el reloj."
Escribir "----------------------------------------------------------------`n"

if ($hayEnvReal) {
  & npm run web
} else {
  & npm run web:demo
}
