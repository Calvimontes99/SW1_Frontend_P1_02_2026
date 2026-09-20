/**
 * Exportación a XMI con dos formatos seleccionables:
 *
 *   - XMI 2.1 de Enterprise Architect: el modelo Y el diagrama. Al importarlo
 *     en EA se abre el lienzo ya armado (clases en su posición, relaciones con
 *     sus cardinalidades, tipos de datos y firmas de métodos).
 *   - XMI 2.5.1 / UML 2.5: estándar OMG, solo el modelo. Para Papyrus,
 *     MagicDraw, StarUML y el importador propio.
 *
 * Por qué la variante de EA calca su formato al detalle
 * -----------------------------------------------------
 * EA solo procesa su extensión propietaria (donde vive el lienzo) cuando
 * reconoce el archivo como exportado por EA. Si no, usa su importador genérico
 * de UML, y así quedó registrado en la base del proyecto .EAP al importar la
 * versión anterior de este exportador: GUIDs regenerados (ignoró los EAID_),
 * atributos sin tipo (no resolvió "EAJava_String"), el parámetro de retorno
 * convertido en un parámetro más llamado "DuplicateParam_1" (los métodos se
 * veían como "actualizarStock(,)") y ningún diagrama. Por eso esta variante
 * reproduce la estructura que escribe EA 13.5 al exportar un paquete.
 */

import { parseAtributo, parseMetodo, SIMBOLO_POR_VISIBILIDAD } from './umlParser.js';

const escapar = (texto) =>
  String(texto ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

/**
 * Hash estable: exportar dos veces el mismo diagrama produce los mismos
 * identificadores, así que reimportar en EA actualiza el paquete en lugar de
 * duplicarlo.
 */
const hashHex = (texto, longitud) => {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  const t = String(texto ?? '');
  for (let i = 0; i < t.length; i++) {
    h1 = ((h1 ^ t.charCodeAt(i)) * 0x01000193) >>> 0;
    h2 = ((h2 + t.charCodeAt(i) * (i + 7)) * 0x85ebca6b) >>> 0;
  }
  let out = '';
  let a = h1;
  let b = h2;
  while (out.length < longitud) {
    a = (a * 0x27220a95 + 0x165667b1) >>> 0;
    b = (b ^ (a >>> 13)) >>> 0;
    // >>> 0 es imprescindible: sin el, el XOR da un entero CON SIGNO y el
    // GUID sale con guiones ('-2D60DF5'), que EA no acepta como identificador.
    out += ((a ^ b) >>> 0).toString(16).padStart(8, '0').toUpperCase();
  }
  return out.slice(0, longitud);
};

/** GUID con el formato de EA: XXXXXXXX_XXXX_XXXX_XXXX_XXXXXXXXXXXX */
const guidEA = (valor) => {
  const h = hashHex(valor, 32);
  return `${h.slice(0, 8)}_${h.slice(8, 12)}_${h.slice(12, 16)}_${h.slice(16, 20)}_${h.slice(20, 32)}`;
};

const idXmi = (valor) => `EAID_${guidEA(valor)}`;
const idPaquete = (valor) => `EAPK_${guidEA(valor)}`;

/**
 * EA deriva algunos ids del GUID de su dueño reemplazando el principio del
 * primer bloque: extremos de asociación ("EAID_dst…" / "EAID_src…"), retorno
 * de una operación ("EAID_RT000000_…") y valores literales ("EAID_LI000001_…").
 */
const conPrefijo = (prefijo, id) => `EAID_${prefijo}${id.slice(5 + prefijo.length)}`;

/** "EAID_A_B_C_D_E" -> "{A-B-C-D-E}", el formato de ea_guid. */
const guidLlaves = (id) => `{${id.replace(/^EA(ID|PK)_/, '').replace(/_/g, '-')}}`;

const AUTOR = 'Diagramador UML';

const fechaEA = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

/**
 * Convierte una cardinalidad de la interfaz ("1", "0..1", "*", "1..*")
 * en el par lower/upper que usa UML. Sin etiqueta no hay multiplicidad.
 */
const multiplicidad = (etiqueta) => {
  const t = String(etiqueta ?? '').trim();
  if (!t) return null;
  if (t === '*' || t === '0..*') return { lower: '0', upper: '*' };
  if (t === '1..*') return { lower: '1', upper: '*' };
  if (t === '0..1') return { lower: '0', upper: '1' };
  const m = t.match(/^(\d+)\.\.(\d+|\*)$/);
  if (m) return { lower: m[1], upper: m[2] };
  if (/^\d+$/.test(t)) return { lower: t, upper: t };
  return { lower: '1', upper: '1' };
};

const textoMultiplicidad = (m) => (m.lower === m.upper ? m.lower : `${m.lower}..${m.upper}`);

const tipoRelacion = (edge) => {
  const t = String(edge.data?.type || 'Association').toLowerCase();
  if (t === 'generalization' || t === 'inheritance') return 'generalization';
  if (t === 'implementation' || t === 'realization' || t === 'realisation') return 'realization';
  if (t === 'dependency') return 'dependency';
  if (t === 'composition') return 'composition';
  if (t === 'aggregation') return 'aggregation';
  return 'association';
};

const ES_ASOCIACION = new Set(['association', 'aggregation', 'composition']);

/**
 * En UML el tipo de agregación se declara en la propiedad tipada por la PARTE
 * y el rombo se dibuja en el extremo opuesto. El editor pinta el rombo en el
 * destino de la arista, así que la parte es el origen.
 */
const agregacionDe = (r) =>
  r.tipo === 'composition' ? 'composite' : r.tipo === 'aggregation' ? 'shared' : 'none';

const esNodoUML = (n) =>
  n && n.type === 'classNode' && !n.data?.isConnectionPoint && !n.data?.isNote && n.data?.className;

const esRelacionUML = (e) =>
  e && !e.data?.isAssociationConnection && !e.data?.isNoteConnection;

export const VERSIONES_XMI = [
  {
    valor: '2.1',
    etiqueta: 'XMI 2.1 — Enterprise Architect',
    detalle: 'Abre en EA con el diagrama ya armado: clases en su posición, relaciones, cardinalidades y tipos.',
  },
  {
    valor: '2.5.1',
    etiqueta: 'XMI 2.5.1 — estándar UML 2.5',
    detalle: 'Formato OMG para Papyrus, MagicDraw o StarUML. Lleva el modelo, no el lienzo.',
  },
];

/** Normaliza nodos y aristas del editor en clases y relaciones con sus ids. */
const prepararModelo = (nodes, edges, nombreModelo) => {
  const titulo = String(nombreModelo || 'ModeloUML').trim() || 'ModeloUML';
  const nodosClase = (nodes || []).filter(esNodoUML);
  const idsValidos = new Set(nodosClase.map((n) => n.id));

  const clases = nodosClase.map((nodo) => {
    const estereotipo = nodo.data?.stereotype || null;
    const esEnum = estereotipo === 'enumeration';
    const crudos = nodo.data?.attributes || [];

    const literales = esEnum
      ? crudos
          .map((l) => (typeof l === 'string' ? l.trim() : String(l?.name ?? '').trim()))
          .filter(Boolean)
          .map((nombre, i) => ({ nombre, id: idXmi(`${nodo.id}::lit::${i}`) }))
      : [];

    const atributos = esEnum
      ? []
      : crudos.map((a, i) => ({ ...parseAtributo(a), id: idXmi(`${nodo.id}::attr::${i}`) }));

    const operaciones = (nodo.data?.methods || []).map((m, i) => {
      const op = parseMetodo(m);
      const opId = idXmi(`${nodo.id}::op::${i}`);
      return {
        ...op,
        id: opId,
        idRetorno: conPrefijo('RT000000', opId),
        tipoRetorno: String(op.tipoRetorno || 'void'),
        parametros: (op.parametros || []).map((p, j) => ({
          nombre: String(p?.nombre ?? p?.name ?? 'param'),
          tipo: String(p?.tipo ?? p?.type ?? 'String'),
          id: idXmi(`${nodo.id}::op::${i}::p::${j}`),
        })),
      };
    });

    return {
      nodo,
      id: idXmi(nodo.id),
      nombre: String(nodo.data.className),
      estereotipo,
      esEnum,
      literales,
      atributos,
      operaciones,
    };
  });

  const relaciones = (edges || [])
    .filter(esRelacionUML)
    .filter((e) => idsValidos.has(e.source) && idsValidos.has(e.target))
    .map((edge) => {
      const tipo = tipoRelacion(edge);
      const asociacion = ES_ASOCIACION.has(tipo);
      return {
        edge,
        id: idXmi(edge.id),
        tipo,
        origen: idXmi(edge.source),
        destino: idXmi(edge.target),
        nombre: String(edge.data?.label ?? '').trim(),
        rolOrigen: asociacion ? String(edge.data?.sourceRole ?? '').trim() : '',
        rolDestino: asociacion ? String(edge.data?.targetRole ?? '').trim() : '',
        multOrigen: asociacion ? multiplicidad(edge.data?.startLabel) : null,
        multDestino: asociacion ? multiplicidad(edge.data?.endLabel) : null,
      };
    });

  return { titulo, clases, relaciones };
};

const TIPOS_UML_ESTANDAR = new Set(['String', 'Integer', 'Boolean', 'Real', 'UnlimitedNatural']);
const HREF_PRIMITIVOS_UML = 'http://www.omg.org/spec/UML/20131001/PrimitiveTypes.xmi#';

/**
 * Resuelve el nombre de un tipo a un id: el de la clase si el tipo es una
 * clase del diagrama, o un tipo primitivo que se declara al final del archivo.
 */
const crearRegistroTipos = (clases, prefijo) => {
  const clasePorNombre = new Map(clases.map((c) => [c.nombre, c.id]));
  const primitivos = new Map(); // id -> nombre
  const referencia = (nombre) => {
    const n = String(nombre ?? '').trim() || 'String';
    if (clasePorNombre.has(n)) return clasePorNombre.get(n);
    const id = `${prefijo}${n.replace(/[^A-Za-z0-9_]/g, '_')}`;
    if (!primitivos.has(id)) primitivos.set(id, n);
    return id;
  };
  return { referencia, primitivos };
};

const crearEscritor = () => {
  const lineas = [];
  const w = (nivel, texto) => lineas.push('\t'.repeat(nivel) + texto);
  return { lineas, w };
};

const tipoXmiDe = (c) =>
  c.estereotipo === 'interface' ? 'uml:Interface' : c.esEnum ? 'uml:Enumeration' : 'uml:Class';

// ---------------------------------------------------------------------------
// Geometría del lienzo
// ---------------------------------------------------------------------------

/** Tamaño de la caja tal como la dibuja EA (fuente de ~6 px por carácter). */
const medirCaja = (c) => {
  const sim = (v, porDefecto) => SIMBOLO_POR_VISIBILIDAD[v] || porDefecto;
  const lineas = [
    c.nombre,
    ...c.literales.map((l) => l.nombre),
    ...c.atributos.map((a) => `${sim(a.visibilidad, '-')} ${a.nombre}: ${a.tipo}`),
    ...c.operaciones.map(
      (o) =>
        `${sim(o.visibilidad, '+')} ${o.nombre}(${o.parametros.map((p) => `${p.nombre}: ${p.tipo}`).join(', ')}): ${o.tipoRetorno}`
    ),
  ];
  const masLarga = Math.max(...lineas.map((l) => l.length));
  const filas = c.literales.length + c.atributos.length + c.operaciones.length;
  const conEstereotipo = c.estereotipo === 'interface' || c.esEnum;
  return {
    ancho: Math.min(420, Math.max(110, Math.round(28 + masLarga * 6.2))),
    alto: Math.max(70, 44 + filas * 14 + (conEstereotipo ? 14 : 0)),
  };
};

/**
 * Usa las coordenadas del lienzo del editor, trasladadas para empezar en
 * (40, 40). Si con el tamaño de EA dos cajas se pisan, separa todo
 * proporcionalmente hasta que dejen de solaparse.
 */
const calcularGeometria = (clases) => {
  if (!clases.length) return [];
  const base = clases.map((c, i) => ({
    x: Number.isFinite(c.nodo.position?.x) ? c.nodo.position.x : (i % 3) * 320,
    y: Number.isFinite(c.nodo.position?.y) ? c.nodo.position.y : Math.floor(i / 3) * 260,
    ...medirCaja(c),
  }));
  const minX = Math.min(...base.map((b) => b.x));
  const minY = Math.min(...base.map((b) => b.y));
  const margen = 20;
  const seSolapan = (cajas) =>
    cajas.some((a, i) =>
      cajas.some(
        (b, j) =>
          j > i &&
          a.left < b.right + margen && b.left < a.right + margen &&
          a.top < b.bottom + margen && b.top < a.bottom + margen
      )
    );

  let escala = 1;
  let cajas;
  do {
    cajas = base.map((b) => {
      const left = Math.round(40 + (b.x - minX) * escala);
      const top = Math.round(40 + (b.y - minY) * escala);
      return { left, top, right: left + b.ancho, bottom: top + b.alto };
    });
    escala += 0.1;
  } while (seSolapan(cajas) && escala < 4);
  return cajas;
};

/** Lado de la caja de origen por el que sale la línea (1 arriba, 2 derecha, 3 abajo, 4 izquierda). */
const ladoSalida = (a, b) => {
  const dx = (b.left + b.right) / 2 - (a.left + a.right) / 2;
  const dy = (b.top + b.bottom) / 2 - (a.top + a.bottom) / 2;
  if (Math.abs(dy) >= Math.abs(dx)) return dy < 0 ? 1 : 3;
  return dx > 0 ? 2 : 4;
};

/** Posición de una etiqueta de conector en el formato de EA ('' = sin etiqueta). */
const etiquetaLienzo = (texto) =>
  texto
    ? `CX=${Math.max(16, String(texto).length * 5)}:CY=13:OX=0:OY=0:HDN=0:BLD=0:ITA=0:UND=0:CLR=-1:ALN=1:DIR=0:ROT=0`
    : '';

const SCOPE_EA = { public: 'Public', private: 'Private', protected: 'Protected', package: 'Package' };

const PROPIEDAD_EA =
  'isStatic="false" isReadOnly="false" isDerived="false" isOrdered="false" isUnique="true" isDerivedUnion="false"';

const ESTILO_DIAGRAMA_2 =
  'ExcludeRTF=0;DocAll=0;HideQuals=0;AttPkg=1;ShowTests=0;ShowMaint=0;SuppressFOC=1;MatrixActive=0;' +
  'SwimlanesActive=1;KanbanActive=0;MatrixLineWidth=1;MatrixLineClr=0;MatrixLocked=0;TConnectorNotation=UML 2.1;' +
  'TExplicitNavigability=0;AdvancedElementProps=1;AdvancedFeatureProps=1;AdvancedConnectorProps=1;' +
  'm_bElementClassifier=1;ProfileData=;MDGDgm=;STBLDgm=;ShowNotes=0;VisibleAttributeDetail=0;ShowOpRetType=1;' +
  'SuppressBrackets=0;SuppConnectorLabels=0;PrintPageHeadFoot=0;ShowAsList=0;SuppressedCompartments=;Theme=:119;';

const ESTILO_OBJETO_LIENZO =
  'NSL=0;BCol=-1;BFol=-1;LCol=-1;LWth=-1;fontsz=0;bold=0;black=0;italic=0;ul=0;charset=0;pitch=0;';

// ---------------------------------------------------------------------------
// XMI 2.1 de Enterprise Architect
// ---------------------------------------------------------------------------

function construirXmiEA({ titulo, clases, relaciones }) {
  const { lineas, w } = crearEscritor();
  const t = escapar(titulo);
  const paquete = idPaquete(titulo);
  const diagrama = idXmi(`diagrama::${titulo}`);
  const fecha = fechaEA();
  const tipos = crearRegistroTipos(clases, 'EAJava_');
  const clasePorId = new Map(clases.map((c) => [c.id, c]));
  const localId = new Map(clases.map((c, i) => [c.id, i + 2])); // 1 es el paquete
  const geometria = calcularGeometria(clases);
  const cajaPorId = new Map(clases.map((c, i) => [c.id, geometria[i]]));
  const duid = (idClase) => hashHex(clasePorId.get(idClase).nodo.id, 8);

  w(0, '<?xml version="1.0" encoding="UTF-8"?>');
  w(0, '<xmi:XMI xmi:version="2.1" xmlns:uml="http://schema.omg.org/spec/UML/2.1" xmlns:xmi="http://schema.omg.org/spec/XMI/2.1">');
  // EA mira este exportador para decidir si procesa su extensión (el lienzo).
  w(1, '<xmi:Documentation exporter="Enterprise Architect" exporterVersion="6.5"/>');
  w(1, '<uml:Model xmi:type="uml:Model" name="EA_Model" visibility="public">');
  w(2, `<packagedElement xmi:type="uml:Package" xmi:id="${paquete}" name="${t}" visibility="public">`);

  // ---------- Clasificadores ----------
  clases.forEach((c) => {
    w(3,
      `<packagedElement xmi:type="${tipoXmiDe(c)}" xmi:id="${c.id}" name="${escapar(c.nombre)}" visibility="public"` +
      `${c.estereotipo === 'abstract' ? ' isAbstract="true"' : ''}>`
    );
    c.literales.forEach((l) => {
      w(4, `<ownedLiteral xmi:type="uml:EnumerationLiteral" xmi:id="${l.id}" name="${escapar(l.nombre)}" visibility="public"/>`);
    });
    c.atributos.forEach((a) => {
      w(4, `<ownedAttribute xmi:type="uml:Property" xmi:id="${a.id}" name="${escapar(a.nombre)}" visibility="${a.visibilidad}" ${PROPIEDAD_EA}>`);
      if (a.valorPorDefecto) {
        w(5, `<defaultValue xmi:type="uml:LiteralString" xmi:id="${conPrefijo('LI000003', a.id)}" value="${escapar(a.valorPorDefecto)}"/>`);
      }
      w(5, `<type xmi:idref="${tipos.referencia(a.tipo)}"/>`);
      w(4, '</ownedAttribute>');
    });
    c.operaciones.forEach((o) => {
      w(4, `<ownedOperation xmi:id="${o.id}" name="${escapar(o.nombre)}" visibility="${o.visibilidad}" concurrency="sequential">`);
      o.parametros.forEach((p) => {
        w(5,
          `<ownedParameter xmi:id="${p.id}" name="${escapar(p.nombre)}" direction="in" isStream="false"` +
          ` isException="false" isOrdered="false" isUnique="true" type="${tipos.referencia(p.tipo)}"/>`
        );
      });
      // El retorno se llama "return": con otro nombre EA lo toma como un parámetro más
      w(5, `<ownedParameter xmi:id="${o.idRetorno}" name="return" direction="return" type="${tipos.referencia(o.tipoRetorno)}"/>`);
      w(4, '</ownedOperation>');
    });
    relaciones
      .filter((r) => r.tipo === 'generalization' && r.origen === c.id)
      .forEach((r) => {
        w(4, `<generalization xmi:type="uml:Generalization" xmi:id="${r.id}" general="${r.destino}"/>`);
      });
    w(3, '</packagedElement>');
  });

  // ---------- Relaciones ----------
  const extremoUML = (idExtremo, r, tipoId, mult, rol, agregacion) => {
    w(4,
      `<ownedEnd xmi:type="uml:Property" xmi:id="${idExtremo}"${rol ? ` name="${escapar(rol)}"` : ''} visibility="public"` +
      ` association="${r.id}" ${PROPIEDAD_EA} aggregation="${agregacion}">`
    );
    if (mult) {
      w(5, `<lowerValue xmi:type="uml:LiteralInteger" xmi:id="${conPrefijo('LI000001', idXmi(`${idExtremo}::lower`))}" value="${mult.lower}"/>`);
      w(5, `<upperValue xmi:type="uml:LiteralUnlimitedNatural" xmi:id="${conPrefijo('LI000002', idXmi(`${idExtremo}::upper`))}" value="${mult.upper}"/>`);
    }
    w(5, `<type xmi:idref="${tipoId}"/>`);
    w(4, '</ownedEnd>');
  };

  relaciones.forEach((r) => {
    const nombre = r.nombre ? ` name="${escapar(r.nombre)}"` : '';
    if (ES_ASOCIACION.has(r.tipo)) {
      const dst = conPrefijo('dst', r.id);
      const src = conPrefijo('src', r.id);
      w(3, `<packagedElement xmi:type="uml:Association" xmi:id="${r.id}"${nombre} visibility="public">`);
      w(4, `<memberEnd xmi:idref="${dst}"/>`);
      w(4, `<memberEnd xmi:idref="${src}"/>`);
      extremoUML(dst, r, r.destino, r.multDestino, r.rolDestino, 'none');
      extremoUML(src, r, r.origen, r.multOrigen, r.rolOrigen, agregacionDe(r));
      w(3, '</packagedElement>');
    } else if (r.tipo === 'dependency' || r.tipo === 'realization') {
      const tipo = r.tipo === 'dependency' ? 'uml:Dependency' : 'uml:Realization';
      w(3, `<packagedElement xmi:type="${tipo}" xmi:id="${r.id}"${nombre} visibility="public" supplier="${r.destino}" client="${r.origen}"/>`);
    }
  });

  w(2, '</packagedElement>');
  w(1, '</uml:Model>');

  // ---------- Extensión de Enterprise Architect ----------
  w(1, '<xmi:Extension extender="Enterprise Architect" extenderID="6.5">');
  w(2, '<elements>');

  w(3, `<element xmi:idref="${paquete}" xmi:type="uml:Package" name="${t}" scope="public">`);
  w(4, `<model package2="${paquete.replace('EAPK_', 'EAID_')}" package="${idPaquete(`padre::${titulo}`)}" tpos="0" ea_localid="1" ea_eleType="package"/>`);
  w(4, '<properties isSpecification="false" sType="Package" nType="0" scope="public"/>');
  w(4, `<project author="${AUTOR}" version="1.0" phase="1.0" created="${fecha}" modified="${fecha}" complexity="1" status="Proposed"/>`);
  w(4, '<code gentype="Java"/>');
  w(4, '<style appearance="BackColor=-1;BorderColor=-1;BorderWidth=-1;FontColor=-1;VSwimLanes=1;HSwimLanes=1;BorderStyle=0;"/>');
  w(4, '<tags/>');
  w(4, '<xrefs/>');
  w(4, '<extendedProperties tagged="0" package_name="Model"/>');
  w(4, '<packageproperties version="1.0" tpos="0"/>');
  w(4, '<paths/>');
  w(4, `<times created="${fecha}" modified="${fecha}"/>`);
  w(4, '<flags iscontrolled="FALSE" isprotected="FALSE" usedtd="FALSE" logxml="FALSE"/>');
  w(3, '</element>');

  let localCaracteristica = 1;
  clases.forEach((c) => {
    const sType = tipoXmiDe(c).replace('uml:', '');
    w(3, `<element xmi:idref="${c.id}" xmi:type="${tipoXmiDe(c)}" name="${escapar(c.nombre)}" scope="public">`);
    w(4, `<model package="${paquete}" tpos="0" ea_localid="${localId.get(c.id)}" ea_eleType="element"/>`);
    w(4,
      `<properties isSpecification="false" sType="${sType}" nType="0" scope="public" isRoot="false" isLeaf="false"` +
      ` isAbstract="${c.estereotipo === 'abstract'}" isActive="false"/>`
    );
    w(4, `<project author="${AUTOR}" version="1.0" phase="1.0" created="${fecha}" modified="${fecha}" complexity="1" status="Proposed"/>`);
    w(4, '<code gentype="Java"/>');
    w(4, '<style appearance="BackColor=-1;BorderColor=-1;BorderWidth=-1;FontColor=-1;VSwimLanes=1;HSwimLanes=1;BorderStyle=0;"/>');
    w(4, '<tags/>');
    w(4, '<xrefs/>');
    w(4, `<extendedProperties tagged="0" package_name="${t}"/>`);

    const caracteristicas = [
      ...c.literales.map((l) => ({ id: l.id, nombre: l.nombre, scope: 'Public', tipo: '', inicial: null, enumerado: true })),
      ...c.atributos.map((a) => ({
        id: a.id,
        nombre: a.nombre,
        scope: SCOPE_EA[a.visibilidad] || 'Private',
        tipo: a.tipo,
        inicial: a.valorPorDefecto,
        enumerado: false,
      })),
    ];
    if (caracteristicas.length) {
      w(4, '<attributes>');
      caracteristicas.forEach((a, pos) => {
        w(5, `<attribute xmi:idref="${a.id}" name="${escapar(a.nombre)}" scope="${a.scope}">`);
        w(6, a.inicial ? `<initial body="${escapar(a.inicial)}"/>` : '<initial/>');
        w(6, '<documentation/>');
        w(6, `<model ea_localid="${localCaracteristica++}" ea_guid="${guidLlaves(a.id)}"/>`);
        w(6, `<properties type="${escapar(a.tipo)}" derived="0" collection="false" duplicates="0" changeability="changeable"/>`);
        w(6, '<coords ordered="0" scale="0"/>');
        w(6, `<containment containment="Not Specified" position="${pos}"/>`);
        w(6, a.enumerado ? '<stereotype stereotype="enum"/>' : '<stereotype/>');
        w(6, '<bounds lower="1" upper="1"/>');
        w(6, '<options/>');
        w(6, '<style/>');
        w(6, '<styleex value="volatile=0;"/>');
        w(6, '<tags/>');
        w(6, '<xrefs/>');
        w(5, '</attribute>');
      });
      w(4, '</attributes>');
    }

    if (c.operaciones.length) {
      w(4, '<operations>');
      c.operaciones.forEach((o, pos) => {
        w(5, `<operation xmi:idref="${o.id}" name="${escapar(o.nombre)}" scope="${SCOPE_EA[o.visibilidad] || 'Public'}">`);
        w(6, `<properties position="${pos}"/>`);
        w(6, '<stereotype/>');
        w(6, `<model ea_guid="${guidLlaves(o.id)}" ea_localid="${localCaracteristica++}"/>`);
        w(6,
          `<type type="${escapar(o.tipoRetorno)}" const="false" static="false" isAbstract="false" synchronised="0"` +
          ' concurrency="Sequential" pure="0" isQuery="false"/>'
        );
        w(6, '<behaviour/>');
        w(6, '<code/>');
        w(6, '<style/>');
        w(6, '<styleex/>');
        w(6, '<documentation/>');
        w(6, '<tags/>');
        w(6, '<parameters>');
        o.parametros.forEach((p, i) => {
          w(7, `<parameter xmi:idref="${p.id}" visibility="public">`);
          w(8, `<properties pos="${i}" type="${escapar(p.tipo)}" const="false" ea_guid="${guidLlaves(p.id)}"/>`);
          w(8, '<style/>');
          w(8, '<styleex/>');
          w(8, '<documentation/>');
          w(8, '<tags/>');
          w(8, '<xrefs/>');
          w(7, '</parameter>');
        });
        w(6, '</parameters>');
        w(6, '<xrefs/>');
        w(5, '</operation>');
      });
      w(4, '</operations>');
    }
    w(3, '</element>');
  });
  w(2, '</elements>');

  // ---------- Conectores ----------
  const EA_TYPE = {
    association: 'Association',
    aggregation: 'Association',
    composition: 'Association',
    generalization: 'Generalization',
    realization: 'Realisation',
    dependency: 'Dependency',
  };

  const extremoConector = (lado, idClase, mult, rol, agregacion, navegable) => {
    const c = clasePorId.get(idClase);
    const nav = navegable === null ? 'Unspecified' : navegable ? 'Navigable' : 'Non-Navigable';
    w(3, `<${lado} xmi:idref="${idClase}">`);
    w(4, `<model ea_localid="${localId.get(idClase)}" type="${tipoXmiDe(c).replace('uml:', '')}" name="${escapar(c.nombre)}"/>`);
    w(4, `<role${rol ? ` name="${escapar(rol)}"` : ''} visibility="Public" targetScope="instance"/>`);
    w(4, `<type${mult ? ` multiplicity="${textoMultiplicidad(mult)}"` : ''} aggregation="${agregacion}" containment="Unspecified"/>`);
    w(4, '<constraints/>');
    w(4, `<modifiers isOrdered="false" changeable="none" isNavigable="${navegable === true}"/>`);
    w(4, `<style value="Union=0;Derived=0;AllowDuplicates=0;Owned=0;Navigable=${nav};"/>`);
    w(4, '<documentation/>');
    w(4, '<xrefs/>');
    w(4, '<tags/>');
    w(3, `</${lado}>`);
  };

  w(2, '<connectors>');
  relaciones.forEach((r, k) => {
    const asociacion = ES_ASOCIACION.has(r.tipo);
    w(3, `<connector xmi:idref="${r.id}">`);
    // Asociaciones sin dirección; el resto va del origen al destino
    extremoConector('source', r.origen, r.multOrigen, r.rolOrigen, 'none', asociacion ? null : false);
    extremoConector('target', r.destino, r.multDestino, r.rolDestino, agregacionDe(r), asociacion ? null : true);
    w(3, `<model ea_localid="${k + 1}"/>`);
    w(3, `<properties ea_type="${EA_TYPE[r.tipo]}" direction="${asociacion ? 'Unspecified' : 'Source -&gt; Destination'}"/>`);
    w(3, '<modifiers isRoot="false" isLeaf="false"/>');
    w(3, '<parameterSubstitutions/>');
    w(3, '<documentation/>');
    w(3, '<appearance linemode="3" linecolor="-1" linewidth="0" seqno="0" headStyle="0" lineStyle="0"/>');
    const etiquetas = [
      r.multOrigen && `lb="${textoMultiplicidad(r.multOrigen)}"`,
      r.rolOrigen && `lt="${escapar(r.rolOrigen)}"`,
      r.nombre && `mt="${escapar(r.nombre)}"`,
      r.rolDestino && `rt="${escapar(r.rolDestino)}"`,
      r.multDestino && `rb="${textoMultiplicidad(r.multDestino)}"`,
    ].filter(Boolean);
    w(3, etiquetas.length ? `<labels ${etiquetas.join(' ')}/>` : '<labels/>');
    w(3, '<extendedProperties virtualInheritance="0"/>');
    w(3, '<style/>');
    w(3, '<xrefs/>');
    w(3, '<tags/>');
    w(3, '</connector>');
  });
  w(2, '</connectors>');

  // ---------- Tipos primitivos referenciados como EAJava_* ----------
  w(2, '<primitivetypes>');
  w(3, '<packagedElement xmi:type="uml:Package" xmi:id="EAPrimitiveTypesPackage" name="EA_PrimitiveTypes_Package" visibility="public">');
  w(4, '<packagedElement xmi:type="uml:Package" xmi:id="EAJavaTypesPackage" name="EA_Java_Types_Package" visibility="public">');
  tipos.primitivos.forEach((nombre, id) => {
    w(5, `<packagedElement xmi:type="uml:PrimitiveType" xmi:id="${id}" name="${escapar(nombre)}" visibility="public"/>`);
  });
  w(4, '</packagedElement>');
  w(3, '</packagedElement>');
  w(2, '</primitivetypes>');
  w(2, '<profiles/>');

  // ---------- Diagrama: el lienzo con cada clase en su posición ----------
  const maxRight = Math.max(827, ...geometria.map((g) => g.right + 40));
  const maxBottom = Math.max(1169, ...geometria.map((g) => g.bottom + 40));
  const estilo1 =
    'ShowPrivate=1;ShowProtected=1;ShowPublic=1;HideRelationships=0;Locked=0;Border=1;HighlightForeign=1;' +
    'PackageContents=1;SequenceNotes=0;ScalePrintImage=0;' +
    `PPgs.cx=${Math.ceil(maxRight / 827)};PPgs.cy=${Math.ceil(maxBottom / 1169)};DocSize.cx=827;DocSize.cy=1169;` +
    'ShowDetails=0;Orientation=P;Zoom=100;ShowTags=0;OpParams=3;VisibleAttributeDetail=0;ShowOpRetType=1;' +
    'ShowIcons=1;CollabNums=0;HideProps=0;ShowReqs=0;ShowCons=0;PaperSize=9;HideParents=0;UseAlias=0;' +
    'HideAtts=0;HideOps=0;HideStereo=0;HideElemStereo=0;ShowTests=0;ShowMaint=0;ConnectorNotation=UML 2.1;' +
    'ExplicitNavigability=0;ShowShape=1;AdvancedElementProps=1;AdvancedFeatureProps=1;AdvancedConnectorProps=1;' +
    'm_bElementClassifier=1;ShowNotes=0;SuppressBrackets=0;SuppConnectorLabels=0;PrintPageHeadFoot=0;ShowAsList=0;';

  w(2, '<diagrams>');
  w(3, `<diagram xmi:id="${diagrama}">`);
  w(4, `<model package="${paquete}" localID="1" owner="${paquete}"/>`);
  w(4, `<properties name="${t}" type="Logical"/>`);
  w(4, `<project author="${AUTOR}" version="1.0" created="${fecha}" modified="${fecha}"/>`);
  w(4, `<style1 value="${estilo1}"/>`);
  w(4, `<style2 value="${ESTILO_DIAGRAMA_2}"/>`);
  w(4,
    '<swimlanes value="locked=false;orientation=0;width=0;inbar=false;names=false;color=-1;bold=false;fcol=0;' +
    'tcol=-1;ofCol=-1;ufCol=-1;hl=1;ufh=0;hh=0;cls=0;bw=0;hli=0;bro=0;SwimlaneFont=lfh:-10,lfw:0,lfi:0,lfu:0,' +
    'lfs:0,lfface:Calibri,lfe:0,lfo:0,lfchar:1,lfop:0,lfcp:0,lfq:0,lfpf=0,lfWidth=0;"/>'
  );
  w(4, '<matrixitems value="locked=false;matrixactive=false;swimlanesactive=true;kanbanactive=false;width=1;clrLine=0;"/>');
  w(4, '<extendedProperties/>');
  w(4, '<xrefs/>');
  w(4, '<elements>');
  clases.forEach((c, i) => {
    const g = geometria[i];
    w(5,
      `<element geometry="Left=${g.left};Top=${g.top};Right=${g.right};Bottom=${g.bottom};" subject="${c.id}"` +
      ` seqno="${i + 1}" style="DUID=${duid(c.id)};${ESTILO_OBJETO_LIENZO}"/>`
    );
  });
  relaciones.forEach((r) => {
    const lado = ladoSalida(cajaPorId.get(r.origen), cajaPorId.get(r.destino));
    const geometriaLinea =
      `SX=0;SY=0;EX=0;EY=0;EDGE=${lado};` +
      `$LLB=${etiquetaLienzo(r.multOrigen && textoMultiplicidad(r.multOrigen))};` +
      `LLT=${etiquetaLienzo(r.rolOrigen)};` +
      `LMT=${etiquetaLienzo(r.nombre)};LMB=;` +
      `LRT=${etiquetaLienzo(r.rolDestino)};` +
      `LRB=${etiquetaLienzo(r.multDestino && textoMultiplicidad(r.multDestino))};` +
      'IRHS=;ILHS=;';
    // EOID/SOID son los DUID de las cajas destino/origen dentro de este lienzo
    w(5,
      `<element geometry="${escapar(geometriaLinea)}" subject="${r.id}"` +
      ` style="Mode=3;EOID=${duid(r.destino)};SOID=${duid(r.origen)};Color=-1;LWidth=0;"/>`
    );
  });
  w(4, '</elements>');
  w(3, '</diagram>');
  w(2, '</diagrams>');
  w(1, '</xmi:Extension>');
  w(0, '</xmi:XMI>');

  return lineas.join('\n');
}

// ---------------------------------------------------------------------------
// XMI 2.5.1 / UML 2.5 estándar
// ---------------------------------------------------------------------------

function construirXmi251({ titulo, clases, relaciones }) {
  const { lineas, w } = crearEscritor();
  const tipos = crearRegistroTipos(clases, 'tipo_');

  const tipoHijo = (nivel, nombre) => {
    const n = String(nombre ?? '').trim() || 'String';
    if (TIPOS_UML_ESTANDAR.has(n)) w(nivel, `<type href="${HREF_PRIMITIVOS_UML}${n}"/>`);
    else w(nivel, `<type xmi:idref="${tipos.referencia(n)}"/>`);
  };

  w(0, '<?xml version="1.0" encoding="UTF-8"?>');
  w(0, '<xmi:XMI xmi:version="2.5.1" xmlns:xmi="http://www.omg.org/spec/XMI/20131001" xmlns:uml="http://www.omg.org/spec/UML/20131001">');
  w(1, '<xmi:Documentation exporter="Diagramador UML Colaborativo" exporterVersion="2.5"/>');
  w(1, `<uml:Model xmi:type="uml:Model" xmi:id="${idPaquete(titulo)}" name="${escapar(titulo)}">`);

  clases.forEach((c) => {
    w(2,
      `<packagedElement xmi:type="${tipoXmiDe(c)}" xmi:id="${c.id}" name="${escapar(c.nombre)}"` +
      `${c.estereotipo === 'abstract' ? ' isAbstract="true"' : ''}>`
    );
    c.literales.forEach((l) => {
      w(3, `<ownedLiteral xmi:type="uml:EnumerationLiteral" xmi:id="${l.id}" name="${escapar(l.nombre)}"/>`);
    });
    c.atributos.forEach((a) => {
      w(3, `<ownedAttribute xmi:type="uml:Property" xmi:id="${a.id}" name="${escapar(a.nombre)}" visibility="${a.visibilidad}">`);
      tipoHijo(4, a.tipo);
      if (a.valorPorDefecto) {
        w(4, `<defaultValue xmi:type="uml:LiteralString" xmi:id="${conPrefijo('LI000003', a.id)}" value="${escapar(a.valorPorDefecto)}"/>`);
      }
      w(3, '</ownedAttribute>');
    });
    c.operaciones.forEach((o) => {
      w(3, `<ownedOperation xmi:type="uml:Operation" xmi:id="${o.id}" name="${escapar(o.nombre)}" visibility="${o.visibilidad}">`);
      o.parametros.forEach((p) => {
        w(4, `<ownedParameter xmi:type="uml:Parameter" xmi:id="${p.id}" name="${escapar(p.nombre)}" direction="in">`);
        tipoHijo(5, p.tipo);
        w(4, '</ownedParameter>');
      });
      // En UML una operación void simplemente no tiene parámetro de retorno
      if (o.tipoRetorno !== 'void') {
        w(4, `<ownedParameter xmi:type="uml:Parameter" xmi:id="${o.idRetorno}" name="return" direction="return">`);
        tipoHijo(5, o.tipoRetorno);
        w(4, '</ownedParameter>');
      }
      w(3, '</ownedOperation>');
    });
    relaciones
      .filter((r) => r.tipo === 'generalization' && r.origen === c.id)
      .forEach((r) => {
        w(3, `<generalization xmi:type="uml:Generalization" xmi:id="${r.id}" general="${r.destino}"/>`);
      });
    w(2, '</packagedElement>');
  });

  relaciones.forEach((r) => {
    const nombre = r.nombre ? ` name="${escapar(r.nombre)}"` : '';
    if (ES_ASOCIACION.has(r.tipo)) {
      const src = conPrefijo('src', r.id);
      const dst = conPrefijo('dst', r.id);
      w(2, `<packagedElement xmi:type="uml:Association" xmi:id="${r.id}"${nombre}>`);
      w(3, `<memberEnd xmi:idref="${src}"/>`);
      w(3, `<memberEnd xmi:idref="${dst}"/>`);
      [
        [src, r.origen, r.multOrigen, r.rolOrigen, agregacionDe(r)],
        [dst, r.destino, r.multDestino, r.rolDestino, 'none'],
      ].forEach(([idExtremo, tipoId, mult, rol, agregacion]) => {
        w(3,
          `<ownedEnd xmi:type="uml:Property" xmi:id="${idExtremo}"${rol ? ` name="${escapar(rol)}"` : ''}` +
          ` type="${tipoId}" association="${r.id}"${agregacion !== 'none' ? ` aggregation="${agregacion}"` : ''}>`
        );
        if (mult) {
          w(4, `<lowerValue xmi:type="uml:LiteralInteger" value="${mult.lower}"/>`);
          w(4, `<upperValue xmi:type="uml:LiteralUnlimitedNatural" value="${mult.upper}"/>`);
        }
        w(3, '</ownedEnd>');
      });
      w(2, '</packagedElement>');
    } else if (r.tipo === 'dependency' || r.tipo === 'realization') {
      const tipo = r.tipo === 'dependency' ? 'uml:Dependency' : 'uml:Realization';
      w(2, `<packagedElement xmi:type="${tipo}" xmi:id="${r.id}"${nombre} client="${r.origen}" supplier="${r.destino}"/>`);
    }
  });

  tipos.primitivos.forEach((nombre, id) => {
    w(2, `<packagedElement xmi:type="uml:PrimitiveType" xmi:id="${id}" name="${escapar(nombre)}"/>`);
  });

  w(1, '</uml:Model>');
  w(0, '</xmi:XMI>');
  return lineas.join('\n');
}

/**
 * @param {Array} nodes
 * @param {Array} edges
 * @param {string} version  '2.1' (Enterprise Architect, con lienzo) o '2.5.1'
 * @param {string} nombreModelo  nombre del paquete/modelo (título del tablero)
 */
export function buildExportXML(nodes = [], edges = [], version = '2.5.1', nombreModelo = 'ModeloUML') {
  const modelo = prepararModelo(nodes, edges, nombreModelo);
  return String(version) === '2.1' ? construirXmiEA(modelo) : construirXmi251(modelo);
}

export default buildExportXML;
