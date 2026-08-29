<#
.SYNOPSIS
  Deja Krealo Shift corriendo en el navegador de esta maquina Windows.

.DESCRIPTION
  Un solo comando: comprueba Node, instala dependencias, crea el .env si falta y
  arranca la previsualizacion web.

  POR QUE ESTE SCRIPT EXISTE
  Sin .env la app NO muestra el kiosco: muestra una pantalla que dice que falta
  configuracion, porque `src/lib/env.ts` valida las variables al arrancar y la app
  prefiere explicar el problema antes que reventar. Eso confunde: parece que la app
  esta rota cuando lo unico que falta es un archivo. El script lo crea con valores de
  relleno para que puedas VER la app hoy, y te dice claro que con esos valores el
  panel administrativo no carga.

.PARAMETER Real
  Usa los valores reales de Supabase que ya tengas en .env en vez de los de relleno.
  Si .env ya existe, el script nunca lo sobreescribe: este parametro solo evita que
  se cree uno de relleno cuando no hay ninguno.

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
  # Nunca se sobreescribe un .env existente: puede tener credenciales de verdad.
  $contenido = Get-Content '.env' -Raw
  $hayEnvReal = $contenido -notmatch 'ejemplo\.supabase\.co'
  if ($hayEnvReal) {
    Escribir ".env con credenciales propias — bien" 'Green'
  } else {
    Escribir ".env con valores de relleno" 'Yellow'
  }
} elseif ($Real) {
  Escribir "`nNo hay .env y pediste -Real." 'Red'
  Escribir "  Copia .env.example a .env y pon la URL y la anon key de tu proyecto"
  Escribir "  de Supabase. Las dos son publicas; la service_role NO va en este archivo."
  exit 1
} else {
  Escribir "`nNo hay .env. Creando uno de relleno para poder ver la app..." 'Yellow'
  @'
# Generado por scripts/windows-empezar.ps1
#
# VALORES DE RELLENO. Sirven para que la app arranque y se pueda recorrer el kiosco.
# NO apuntan a ningun servidor, asi que:
#   - el PIN no valida,
#   - el panel administrativo se queda en "Preparando tu sesion".
#
# Para que funcione de verdad, reemplaza las dos primeras por las de tu proyecto de
# Supabase (Project Settings > API). Las dos son publicas.
EXPO_PUBLIC_APP_ENV=development
EXPO_PUBLIC_SUPABASE_URL=https://ejemplo.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=clave-de-relleno-solo-para-ver-la-interfaz
EXPO_PUBLIC_SUPPORT_EMAIL=soporte@krealomedia.com
EXPO_PUBLIC_PRIVACY_URL=https://krealomedia.com/privacidad
'@ | Set-Content '.env' -Encoding UTF8
  Escribir ".env creado" 'Green'
}

# --- 4. Arrancar -------------------------------------------------------------
Escribir "`n----------------------------------------------------------------"
if ($hayEnvReal) {
  Escribir "Arrancando con TUS credenciales: deberia cargar todo, panel incluido." 'Green'
} else {
  Escribir "Arrancando SIN servidor. Lo que si podras hacer:" 'Yellow'
  Escribir "  - recorrer el kiosco: reloj, teclado, ayuda, activacion"
  Escribir "  - cambiar de idioma y ver que todo se traduce"
  Escribir "  - redimensionar la ventana y ver el diseno de iPad y de telefono"
  Escribir "  Lo que NO: validar un PIN ni entrar al panel. Eso necesita Supabase."
}
Escribir "`nSe abrira en el navegador. Para parar: Ctrl+C en esta ventana."
Escribir "Si no se abre solo, entra a la URL que salga abajo (normalmente"
Escribir "http://localhost:8081) y añade /kiosk al final para ver el reloj."
Escribir "----------------------------------------------------------------`n"

& npx expo start --web
