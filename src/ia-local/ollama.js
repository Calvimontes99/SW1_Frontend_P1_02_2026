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
    // AbortError = no contesta nadie; TypeError = el navegador bloqueó la petición
    estado = {
      disponible: false,
      modelos: [],
      motivo: error.name === 'AbortError' ? 'No respondió a tiempo' : 'No se pudo conectar',
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

/** Genera texto con Ollama. Los mensajes son los mismos que usa el modelo del navegador. */
export const generarConOllama = async (mensajes, modelo, { temperatura = 0.2, maxTokens = 512 } = {}) => {
  const respuesta = await consultar('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: modelo,
      messages: mensajes,
      stream: false,
      options: { temperature: temperatura, num_predict: maxTokens },
    }),
  }, 120000);
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
export const guionInstalacion = ({ origen, modelo, windows = true }) => {
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
        'echo [4/5] Iniciando Ollama...',
        'start "" "%LOCALAPPDATA%\\Programs\\Ollama\\ollama app.exe"',
        'timeout /t 8 /nobreak >nul',
        `echo [5/5] Descargando el modelo ${modelo} (puede tardar varios minutos)...`,
        `"%LOCALAPPDATA%\\Programs\\Ollama\\ollama.exe" pull ${modelo}`,
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
      'echo "Listo. Vuelve al navegador y pulsa Volver a comprobar."',
      `echo 'Para que quede permanente agrega: export OLLAMA_ORIGINS="${origen}"'`,
      ''
    ].join('\n'),
  };
};
