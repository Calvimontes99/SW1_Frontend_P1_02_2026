/**
 * Guiones del tutorial y checklist de aprendizaje.
 *
 * Los selectores apuntan a atributos `data-tour` colocados en la interfaz, para
 * que un cambio de estilos no rompa el tour.
 */

export const TOUR_TABLEROS = [
  {
    titulo: '¡Bienvenido al Diagramador UML!',
    texto:
      'Esta herramienta sirve para diseñar la base de datos de cualquier sistema de gestión (ventas, compras, contabilidad...) en equipo y en tiempo real. En un minuto te enseño lo esencial.',
  },
  {
    selector: '[data-tour="nuevo-tablero"]',
    titulo: 'Crea un tablero',
    texto:
      'Cada tablero es un diagrama de clases. Se guarda solo y varias personas pueden editarlo a la vez.',
  },
  {
    selector: '[data-tour="importar-xml"]',
    titulo: 'O importa uno existente',
    texto:
      'Si ya tienes un diagrama en Enterprise Architect, impórtalo: sirve el proyecto .EAP tal como lo guarda EA o un archivo XMI. Llegan las clases, atributos, relaciones y la posición de cada clase en el lienzo.',
  },
  {
    selector: '[data-tour="invitar"]',
    titulo: 'Invita a tu equipo',
    texto:
      'Con "Invitar" añades compañeros por correo electrónico, o compartes el código QR. Todos verán los cambios al instante.',
  },
  {
    selector: '[data-tour="ver-tablero"]',
    titulo: 'Abre el tablero',
    texto:
      'Pulsa "Ver" para entrar al editor. Allí te espera la segunda parte del tutorial, con el diagrama y la generación de código.',
  },
];

export const TOUR_EDITOR = [
  {
    selector: '[data-tour="nueva-clase"]',
    titulo: 'Añade clases',
    texto:
      'Cada clase será una tabla de tu base de datos. Haz clic en una clase del lienzo para editar su nombre, atributos y métodos en el panel lateral.',
  },
  {
    selector: '[data-tour="panel-lateral"]',
    titulo: 'Notación UML 2.5',
    texto:
      'En el panel puedes marcar la clase como abstracta, interfaz o enumeración, y escribir atributos con visibilidad: "+ nombre: String" (público), "- saldo: double" (privado), "# ci: String" (protegido).',
  },
  {
    selector: '[data-tour="lienzo"]',
    titulo: 'Crea relaciones',
    texto:
      'Arrastra desde un punto de conexión de una clase hasta otra para crear una relación. Luego selecciónala para elegir su tipo (asociación, herencia, composición...) y sus cardinalidades: 1, *, 0..1, 1..*.',
  },
  {
    selector: '[data-tour="verificar"]',
    titulo: 'Revisa el diseño con IA',
    texto:
      'Analiza tu diagrama y te señala clases sueltas, referencias rotas y mejoras de diseño, con una puntuación.',
  },
  {
    selector: '[data-tour="sql"]',
    titulo: 'Obtén el modelo relacional',
    texto:
      'Convierte tu diagrama de clases en el script SQL de PostgreSQL: tablas, claves foráneas y tablas intermedias para las relaciones muchos a muchos.',
  },
  {
    selector: '[data-tour="springboot"]',
    titulo: 'Genera el backend completo',
    texto:
      'Descarga un proyecto Spring Boot por capas (entidades, repositorios, servicios y controladores). Trae el Maven Wrapper: solo necesitas Java para ejecutarlo con "./mvnw spring-boot:run".',
  },
  {
    selector: '[data-tour="postman"]',
    titulo: 'Pruébalo con Postman',
    texto:
      'Genera la colección con todos los endpoints del backend generado (apunta al puerto 8080) para probar el CRUD sin escribir nada.',
  },
  {
    selector: '[data-tour="flutter"]',
    titulo: 'Y la app móvil',
    texto:
      'Exporta una aplicación Flutter con sus modelos, servicios y pantallas, ya conectada a la API que acabas de generar.',
  },
  {
    selector: '[data-tour="xmi"]',
    titulo: 'Comparte con otras herramientas',
    texto:
      'Exporta el diagrama en XMI 2.5 para abrirlo en Enterprise Architect u otra herramienta CASE, y para volver a importarlo aquí.',
  },
];

/** Tareas que se marcan solas conforme el usuario las va haciendo. */
export const TAREAS = [
  { id: 'tablero', texto: 'Crear tu primer tablero' },
  { id: 'clase', texto: 'Añadir una clase al diagrama' },
  { id: 'relacion', texto: 'Crear una relación entre dos clases' },
  { id: 'guardar', texto: 'Guardar el diagrama' },
  { id: 'exportar', texto: 'Generar el backend o el modelo SQL' },
];

const CLAVE = 'tutorial:progreso';

export const leerProgreso = () => {
  try {
    return JSON.parse(localStorage.getItem(CLAVE) || '{}');
  } catch (e) {
    return {};
  }
};

/** Marca una tarea como completada. Devuelve true si es la primera vez. */
export const marcarTarea = (id) => {
  try {
    const p = leerProgreso();
    if (p[id]) return false;
    p[id] = true;
    localStorage.setItem(CLAVE, JSON.stringify(p));
    window.dispatchEvent(new CustomEvent('tutorial:progreso'));
    return true;
  } catch (e) {
    return false;
  }
};

export const tourVisto = (nombre) => {
  try {
    return localStorage.getItem(`tutorial:visto:${nombre}`) === '1';
  } catch (e) {
    return true; // si no podemos saberlo, no molestamos con el tour
  }
};

export const marcarTourVisto = (nombre) => {
  try {
    localStorage.setItem(`tutorial:visto:${nombre}`, '1');
  } catch (e) {
    /* sin almacenamiento: el tour se podrá relanzar con el botón "?" */
  }
};
