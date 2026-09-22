/**
 * IA local con Ollama instalado en el equipo (http://localhost:11434).
 *
 * Frente al modelo dentro del navegador tiene tres ventajas: los modelos se descargan una
 * sola vez en la PC (no en cada navegador ni en cada perfil), usan la tarjeta gráfica
 * dedicada con sus controladores, y pueden ser mucho más grandes (7B o más).
 *
 * Para que la app pueda hablarle desde su dirección de internet, Ollama tiene que permitir
 * ese origen con la variable OLLAMA_ORIGINS; si se usa la app desde localhost no hace falta.
 */

export const URL_OLLAMA = 'http://localhost:11434';

let ultimaRevision = { cuando: 0, estado: null };

const consultar = async (ruta, opciones = {}, milisegundos = 2500) => {
  const control = new AbortController();
  const reloj = setTimeout(() => control.abort(), milisegundos);
  try {
    return await fetch(`${URL_OLLAMA}${ruta}`, { ...opciones, signal: control.signal });
  } finally {
    clearTimeout(reloj);
  }
};

/**
 * ¿Hay un Ollama escuchando en este equipo? Devuelve también los modelos instalados.
 * El resultado se recuerda unos segundos para no consultar en cada pulsación.
 */
export const estadoOllama = async ({ forzar = false } = {}) => {
  if (!forzar && ultimaRevision.estado && Date.now() - ultimaRevision.cuando < 15000) return ultimaRevision.estado;
  let estado;
  try {
    const respuesta = await consultar('/api/tags');
    if (!respuesta.ok) {
      estado = { disponible: false, modelos: [], motivo: `Ollama respondió ${respuesta.status}` };
    } else {
      const datos = await respuesta.json();
      const modelos = (datos.models || []).map((m) => ({
        nombre: m.name,
        mb: Math.round((m.size || 0) / 1048576),
        familia: m.details?.family || '',
      }));
      estado = { disponible: true, modelos, motivo: null };
    }
  } catch (error) {
    // AbortError = no contesta nadie; TypeError desde una página https suele ser el navegador
    // bloqueando el acceso a los programas del equipo, no un problema de Ollama.
    const bloqueoDelNavegador = error.name !== 'AbortError'
      && typeof window !== 'undefined' && window.location.protocol === 'https:';
    estado = {
      disponible: false,
      modelos: [],
      motivo: error.name === 'AbortError' ? 'No respondió a tiempo' : 'No se pudo conectar',
      bloqueoDelNavegador,
    };
  }
  ultimaRevision = { cuando: Date.now(), estado };
  return estado;
};

export const olvidarEstadoOllama = () => { ultimaRevision = { cuando: 0, estado: null }; };

/** Elige el modelo instalado más adecuado: se prefieren los de instrucciones o código. */
export const modeloOllamaPorDefecto = (modelos = []) => {
  if (!modelos.length) return null;
  const preferido = modelos.find((m) => /instruct|coder|llama3|qwen|mistral|phi/i.test(m.nombre));
  return (preferido || modelos[0]).nombre;
};

// ------------------------------------------------------------------ modelos que ven imágenes

// Familias multimodales de Ollama. Se usa como respaldo: lo que manda es lo que declare
// /api/show, porque la lista de modelos con vista cambia a menudo.
const NOMBRE_CON_VISTA = /llava|bakllava|vl\b|-vl|vision|minicpm-v|moondream|gemma3|granite3\.\d-vision|mistral-small3/i;

/** Orden de preferencia para leer un diagrama: primero los que mejor leen texto dentro de la imagen. */
const PREFERENCIA_VISTA = [/qwen2\.?5vl|qwen2-vl/i, /minicpm-v/i, /gemma3/i, /llava/i, /llama3\.2-vision/i, /mistral-small3/i, /moondream/i];

const vistaDeclarada = new Map();

/**
 * ¿Este modelo instalado acepta imágenes? Ollama lo dice en /api/show ("capabilities"),
 * y en las versiones viejas se deduce del nombre y de la familia del proyector.
 */
export const modeloVeImagenes = async (nombre) => {
  if (!nombre) return false;
  if (vistaDeclarada.has(nombre)) return vistaDeclarada.get(nombre);
  let vista = NOMBRE_CON_VISTA.test(nombre);
  try {
    const respuesta = await consultar('/api/show', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: nombre }),
    }, 4000);
    if (respuesta.ok) {
      const datos = await respuesta.json();
      const capacidades = (datos.capabilities || []).map((c) => String(c).toLowerCase());
      const familias = (datos.details?.families || []).map((f) => String(f).toLowerCase());
      if (capacidades.length) vista = capacidades.includes('vision');
      else if (familias.some((f) => ['clip', 'mllama', 'qwen2vl', 'gemma3'].includes(f))) vista = true;
    }
  } catch {
    // Sin respuesta se queda con lo que diga el nombre
  }
  vistaDeclarada.set(nombre, vista);
  return vista;
};

/** Modelos instalados que aceptan imágenes, ya ordenados por lo bien que leen un diagrama. */
export const modelosConVista = async (modelos = []) => {
  const marcados = await Promise.all(modelos.map(async (m) => ({ ...m, vista: await modeloVeImagenes(m.nombre) })));
  const conVista = marcados.filter((m) => m.vista);
  const puesto = (nombre) => {
    const i = PREFERENCIA_VISTA.findIndex((patron) => patron.test(nombre));
    return i === -1 ? PREFERENCIA_VISTA.length : i;
  };
  return conVista.sort((a, b) => puesto(a.nombre) - puesto(b.nombre));
};

/** El mejor modelo instalado para leer una imagen, o null si no hay ninguno. */
export const modeloVistaPorDefecto = async (modelos = []) => {
  const conVista = await modelosConVista(modelos);
  return conVista.length ? conVista[0].nombre : null;
};

/**
 * Modelo con vista recomendado para este equipo. Los de 7B leen bastante mejor el texto
 * dentro de una foto, pero piden memoria; en equipos modestos va uno de 3B o 4B.
 */
export const modeloVistaSugerido = (capacidades) => {
  const memoriaGB = capacidades?.memoriaGB ?? 8;
  const dedicada = /nvidia|geforce|rtx|gtx|quadro|radeon rx|\barc\b|apple/i.test(capacidades?.adaptador || '');
  if (dedicada && memoriaGB >= 16) return 'qwen2.5vl:7b';
  if (memoriaGB >= 8) return 'gemma3:4b';
  return 'moondream';
};

/**
 * Genera texto con Ollama. Los mensajes son los mismos que usa el modelo del navegador.
 *
 * Un mensaje puede llevar `images: ['<base64 sin el prefijo data:>']`: los modelos con vista
 * leen la imagen y responden sobre ella. Leer una imagen tarda mucho más que responder texto,
 * así que la espera es más larga cuando alguna la trae.
 */
export const generarConOllama = async (mensajes, modelo, { temperatura = 0.2, maxTokens = 512 } = {}) => {
  const conImagen = mensajes.some((m) => Array.isArray(m.images) && m.images.length);
  const respuesta = await consultar('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: modelo,
      messages: mensajes,
      stream: false,
      options: { temperature: temperatura, num_predict: maxTokens },
    }),
  }, conImagen ? 420000 : 120000);
  if (!respuesta.ok) {
    const detalle = await respuesta.text().catch(() => '');
    throw new Error(`Ollama no pudo responder (${respuesta.status}). ${detalle.slice(0, 120)}`);
  }
  const datos = await respuesta.json();
  return datos.message?.content || '';
};

/**
 * Modelo recomendado para este equipo. Con gráfica dedicada y memoria de sobra vale la pena un
 * modelo de 7B; si no, uno de 3B o 1B, que responden rápido en equipos modestos.
 */
export const modeloSugeridoOllama = (capacidades) => {
  const memoriaGB = capacidades?.memoriaGB ?? 8;
  const dedicada = /nvidia|geforce|rtx|gtx|quadro|radeon rx|\barc\b|apple/i.test(capacidades?.adaptador || '');
  if (dedicada && memoriaGB >= 16) return 'qwen2.5-coder:7b';
  if (memoriaGB >= 8) return 'llama3.2:3b';
  return 'llama3.2:1b';
};

/**
 * Script que instala Ollama, autoriza esta página y descarga el modelo, todo de una pasada.
 * El navegador no puede instalar programas: entrega este archivo y el usuario lo ejecuta.
 */
export const guionInstalacion = ({ origen, modelo, modeloVista = null, windows = true }) => {
  // El modelo con vista es el que lee una foto del diagrama sin internet; se descarga aparte
  // porque pesa más y no todos lo necesitan.
  const pasoVistaWindows = modeloVista
    ? [`echo [6/6] Descargando el modelo con vista ${modeloVista} (para leer imagenes sin internet)...`,
      `"%LOCALAPPDATA%\\Programs\\Ollama\\ollama.exe" pull ${modeloVista}`]
    : [];
  const pasoVistaUnix = modeloVista
    ? [`echo "[4/4] Descargando el modelo con vista ${modeloVista}..."`, `ollama pull ${modeloVista}`]
    : [];
  if (windows) {
    return {
      nombre: 'instalar-ollama.bat',
      tipo: 'application/bat',
      contenido: [
        '@echo off',
        'chcp 65001 >nul',
        'title Instalar Ollama para el Diagramador UML',
        'echo ================================================',
        `echo  Ollama + modelo ${modelo}`,
        'echo ================================================',
        'echo.',
        'echo [1/5] Cerrando Ollama si estaba abierto...',
        'taskkill /IM "ollama app.exe" /F >nul 2>&1',
        'taskkill /IM ollama.exe /F >nul 2>&1',
        'echo [2/5] Instalando Ollama (acepta el permiso de Windows si lo pide)...',
        'where winget >nul 2>&1',
        'if %errorlevel%==0 (',
        '  winget install --id Ollama.Ollama -e --accept-source-agreements --accept-package-agreements',
        ') else (',
        '  powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -Uri https://ollama.com/download/OllamaSetup.exe -OutFile $env:TEMP\\OllamaSetup.exe; Start-Process -Wait -FilePath $env:TEMP\\OllamaSetup.exe"',
        ')',
        'echo [3/5] Permitiendo que la aplicacion use Ollama...',
        `setx OLLAMA_ORIGINS "${origen}" >nul`,
        `set "OLLAMA_ORIGINS=${origen}"`,
        'echo [4/5] Iniciando Ollama con el permiso aplicado...',
        // Windows no refresca el entorno de los programas ya abiertos: el servidor se arranca
        // desde aqui, que ya tiene la variable, en vez de depender del icono de la bandeja.
        'start "" /B "%LOCALAPPDATA%\\Programs\\Ollama\\ollama.exe" serve',
        'timeout /t 8 /nobreak >nul',
        `echo [5/5] Descargando el modelo ${modelo} (puede tardar varios minutos)...`,
        `"%LOCALAPPDATA%\\Programs\\Ollama\\ollama.exe" pull ${modelo}`,
        ...pasoVistaWindows,
        'echo.',
        'echo Listo. Vuelve al navegador y pulsa "Volver a comprobar".',
        'pause',
        ''
      ].join('\r\n'),
    };
  }
  return {
    nombre: 'instalar-ollama.sh',
    tipo: 'application/x-sh',
    contenido: [
      '#!/bin/sh',
      '# Instala Ollama, autoriza esta pagina y descarga el modelo recomendado.',
      'set -e',
      'if ! command -v ollama >/dev/null 2>&1; then',
      '  echo "[1/3] Instalando Ollama..."',
      '  curl -fsSL https://ollama.com/install.sh | sh',
      'fi',
      'echo "[2/3] Permitiendo que la aplicacion use Ollama..."',
      `export OLLAMA_ORIGINS="${origen}"`,
      'pkill ollama >/dev/null 2>&1 || true',
      '(ollama serve >/dev/null 2>&1 &)',
      'sleep 5',
      `echo "[3/3] Descargando el modelo ${modelo}..."`,
      `ollama pull ${modelo}`,
      ...pasoVistaUnix,
      'echo "Listo. Vuelve al navegador y pulsa Volver a comprobar."',
      `echo 'Para que quede permanente agrega: export OLLAMA_ORIGINS="${origen}"'`,
      ''
    ].join('\n'),
  };
};
