/**
 * Qué IA local puede usar este equipo y con qué modelo.
 *
 * La herramienta está desplegada en un servidor y no sabemos qué PC tendrá el
 * usuario. Sin internet el navegador no llega al servidor, así que la IA offline
 * corre en el propio navegador. Según el hardware se elige un nivel:
 *
 *   gpu    WebGPU con shader-f16: modelo de lenguaje y Whisper en la tarjeta gráfica
 *   cpu    sin WebGPU pero con memoria suficiente: intérprete de órdenes + Whisper (WASM)
 *   basico equipos modestos: solo el intérprete de órdenes + Whisper pequeño
 *
 * Dentro de cada nivel hay varios modelos: el equipo recibe uno recomendado según su
 * gráfica y su memoria, y el usuario puede cambiarlo (más pequeño si va justo de
 * memoria, más grande si su gráfica lo admite). Los modelos se descargan una vez (con
 * internet) y quedan en la caché del navegador.
 */

// ONNX Runtime Web 1.26 falla al crear sesiones de modelos cuantizados con la
// optimización completa del grafo (TransposeDQWeightsForMatMulNBits): "basic" lo evita.
const SESION = { graphOptimizationLevel: 'basic' };

/**
 * Modelos de lenguaje (entienden pedidos libres). Todos necesitan WebGPU: probado en
 * procesador, cualquiera de estos tarda más de un minuto por respuesta.
 * Los tamaños son los archivos q4f16 que se descargan de Hugging Face.
 */
export const CATALOGO_TEXTO = [
  {
    clave: 'qwen-0.5b',
    nombre: 'Qwen 2.5 · 0.5B',
    id: 'onnx-community/Qwen2.5-0.5B-Instruct',
    device: 'webgpu',
    dtype: 'q4f16',
    mb: 461,
    memoriaMinimaGB: 2,
    detalle: 'Último recurso para equipos modestos: con pedidos libres suele no entender y responder cualquier cosa.',
  },
  {
    clave: 'llama-1b',
    nombre: 'Llama 3.2 · 1B',
    id: 'onnx-community/Llama-3.2-1B-Instruct-ONNX',
    device: 'webgpu',
    dtype: 'q4f16',
    mb: 1039,
    memoriaMinimaGB: 4,
    detalle: 'Ligero: anda bien en gráficas integradas. Con pedidos largos se equivoca más que el de 3B.',
  },
  {
    clave: 'llama-3b',
    nombre: 'Llama 3.2 · 3B',
    id: 'onnx-community/Llama-3.2-3B-Instruct-ONNX',
    device: 'webgpu',
    dtype: 'q4f16',
    mb: 2296,
    memoriaMinimaGB: 8,
    detalle: 'El más preciso con pedidos libres. Pensado para gráficas dedicadas; en una integrada va lento.',
  },
];

/**
 * Modelos de voz (Whisper). El mismo modelo se descarga en dos formatos según dónde corra:
 * en la gráfica va en fp32 (el fp16 devuelve basura) y en el procesador en q8.
 */
export const CATALOGO_VOZ = [
  {
    clave: 'whisper-tiny',
    nombre: 'Whisper tiny',
    id: 'onnx-community/whisper-tiny',
    mbGpu: 144,
    mbCpu: 39,
    detalle: 'El más liviano. Confunde palabras parecidas ("de simal" por "decimal").',
  },
  {
    clave: 'whisper-base',
    nombre: 'Whisper base',
    id: 'onnx-community/whisper-base',
    mbGpu: 278,
    mbCpu: 73,
    detalle: 'El equilibrado: transcribe bien el español técnico y pesa poco.',
  },
  {
    clave: 'whisper-small',
    nombre: 'Whisper small',
    id: 'onnx-community/whisper-small',
    mbGpu: 923,
    mbCpu: 238,
    detalle: 'El más exacto con audios difíciles o con ruido. Tarda más en cargar.',
  },
];

export const NOMBRE_NIVEL = {
  gpu: 'Tarjeta gráfica (WebGPU)',
  cpu: 'Procesador',
  basico: 'Básico (intérprete de órdenes)',
};

/** Configuración lista para el motor a partir de una opción del catálogo de voz. */
export const configuracionDeVoz = (opcion, nivel) => {
  if (!opcion) return null;
  return nivel === 'gpu'
    ? { id: opcion.id, device: 'webgpu', dtype: { encoder_model: 'fp32', decoder_model_merged: 'fp32' }, sesion: SESION, mb: opcion.mbGpu }
    : { id: opcion.id, device: 'wasm', dtype: 'q8', sesion: SESION, mb: opcion.mbCpu };
};

/** Configuración lista para el motor a partir de una opción del catálogo de texto. */
export const configuracionDeTexto = (opcion) => (opcion
  ? { id: opcion.id, device: opcion.device, dtype: opcion.dtype, mb: opcion.mb }
  : null);

const PREFERENCIAS = 'ia.preferencias';

const leer = () => {
  try { return JSON.parse(localStorage.getItem(PREFERENCIAS)) || {}; } catch { return {}; }
};

/**
 * { siempreLocal, nivel?: 'gpu'|'cpu'|'basico', modeloTexto?, modeloVoz?,
 *   motorTexto?: 'auto'|'ollama'|'navegador', modeloOllama? }
 * motorTexto 'auto': si hay un Ollama con modelos en el equipo, se usa ese; si no, el del navegador.
 */
export const preferenciasIA = () => ({ siempreLocal: false, ...leer() });

export const guardarPreferenciasIA = (cambios) => {
  const nuevas = { ...preferenciasIA(), ...cambios };
  try { localStorage.setItem(PREFERENCIAS, JSON.stringify(nuevas)); } catch { /* sin almacenamiento */ }
  return nuevas;
};

let capacidadesEnCache = null;

/** Detecta WebGPU, memoria, núcleos y espacio libre; elige el nivel recomendado. */
export const detectarCapacidades = async () => {
  if (capacidadesEnCache) return capacidadesEnCache;
  const memoriaGB = navigator.deviceMemory ?? null; // Chrome/Edge; tope de 8
  const nucleos = navigator.hardwareConcurrency ?? null;
  let webgpu = false;
  let f16 = false;
  let adaptador = '';
  let memoriaGraficaMB = null;
  try {
    if (navigator.gpu) {
      const a = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (a) {
        webgpu = true;
        f16 = a.features.has('shader-f16');
        adaptador = [a.info?.vendor, a.info?.architecture, a.info?.description].filter(Boolean).join(' ');
        // No hay forma de leer la VRAM; el tamaño máximo de buffer es la mejor pista
        if (a.limits?.maxBufferSize) memoriaGraficaMB = Math.round(a.limits.maxBufferSize / 1048576);
      }
    }
  } catch { /* WebGPU no disponible */ }
  let libreMB = null;
  try {
    const e = await navigator.storage?.estimate?.();
    if (e?.quota) libreMB = Math.round((e.quota - (e.usage || 0)) / 1048576);
  } catch { /* sin estimación */ }

  // El nivel depende solo del hardware: el espacio libre baja justamente cuando los
  // modelos ya están descargados (y si falta al descargar, prepararModelo lo informa)
  let recomendado = 'basico';
  if (webgpu && f16 && (memoriaGB === null || memoriaGB >= 4)) recomendado = 'gpu';
  else if ((memoriaGB === null || memoriaGB >= 4) && (nucleos === null || nucleos >= 4)) recomendado = 'cpu';

  capacidadesEnCache = { recomendado, webgpu, f16, memoriaGB, nucleos, libreMB, adaptador, memoriaGraficaMB };
  return capacidadesEnCache;
};

/** Nivel en uso: el que eligió el usuario o el recomendado para su equipo. */
export const nivelActual = async () => {
  const { nivel } = preferenciasIA();
  if (nivel && NOMBRE_NIVEL[nivel]) return nivel;
  return (await detectarCapacidades()).recomendado;
};

// Gráficas dedicadas: mueven el modelo grande con soltura. Las integradas (Intel Iris/UHD/gen-N,
// AMD Radeon Graphics/Vega) comparten memoria con el sistema y van mucho más lentas con 3B.
const GRAFICA_DEDICADA = /nvidia|geforce|rtx|gtx|quadro|radeon rx|\barc\b|apple/i;

/**
 * Modelo de lenguaje recomendado para este equipo. Se mira el tipo de gráfica y la memoria del
 * sistema; el "bloque máximo" de WebGPU no sirve para deducir la memoria de la gráfica, porque
 * el navegador lo limita por igual en casi todos los equipos.
 */
export const textoRecomendado = (capacidades, nivel) => {
  if (nivel !== 'gpu') return null;
  const memoriaGB = capacidades?.memoriaGB ?? 8;
  const dedicada = GRAFICA_DEDICADA.test(capacidades?.adaptador || '');
  if (memoriaGB < 4) return 'qwen-0.5b';
  if (dedicada && memoriaGB >= 8) return 'llama-3b';
  return 'llama-1b';
};

/**
 * ¿El navegador está usando una gráfica integrada? Muchos equipos con gráfica dedicada la dejan
 * apagada para el navegador, y entonces la IA local va mucho más lenta de lo que podría.
 */
export const usaGraficaIntegrada = (capacidades) =>
  Boolean(capacidades?.webgpu && capacidades?.adaptador && !GRAFICA_DEDICADA.test(capacidades.adaptador));

/** Modelo de voz recomendado: el básico usa el más liviano. */
export const vozRecomendada = (capacidades, nivel) => (nivel === 'basico' ? 'whisper-tiny' : 'whisper-base');

const buscar = (catalogo, clave) => catalogo.find((o) => o.clave === clave) || null;

/** Opción de texto elegida (o la recomendada). null si el nivel no usa modelo de lenguaje. */
export const opcionTextoActual = async () => {
  const nivel = await nivelActual();
  if (nivel !== 'gpu') return null;
  const capacidades = await detectarCapacidades();
  const { modeloTexto } = preferenciasIA();
  return buscar(CATALOGO_TEXTO, modeloTexto) || buscar(CATALOGO_TEXTO, textoRecomendado(capacidades, nivel));
};

/** Opción de voz elegida (o la recomendada). */
export const opcionVozActual = async () => {
  const nivel = await nivelActual();
  const capacidades = await detectarCapacidades();
  const { modeloVoz } = preferenciasIA();
  return buscar(CATALOGO_VOZ, modeloVoz) || buscar(CATALOGO_VOZ, vozRecomendada(capacidades, nivel));
};

/** Configuración del modelo de lenguaje en uso, lista para el motor. */
export const modeloTextoActual = async () => configuracionDeTexto(await opcionTextoActual());

/** Configuración del modelo de voz en uso, lista para el motor. */
export const modeloVozActual = async () => configuracionDeVoz(await opcionVozActual(), await nivelActual());
