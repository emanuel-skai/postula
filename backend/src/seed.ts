// Datos ficticios del Design Sprint (Fase 4/6): Ana Solano (ficticia), analista de datos.
// Ningún nombre de empleador real.

export const SEED_PROFILES = [
  {
    name: "Analista de datos",
    cv: [
      "Construí tableros en Power BI para el seguimiento de ventas regionales",
      "Escribí consultas SQL complejas sobre PostgreSQL para reportes mensuales",
      "Automaticé la limpieza de datos con Python y pandas, ahorrando 10 horas por semana",
      "Presenté hallazgos de negocio a gerencia con visualizaciones claras",
      "Diseñé indicadores de rendimiento (KPI) junto al área comercial",
      "Validé la calidad de datos de tres fuentes distintas antes de cada cierre",
    ].join("\n"),
  },
  {
    name: "Ingeniera de datos",
    cv: [
      "Diseñé pipelines ETL en Airflow que procesan dos millones de registros diarios",
      "Modelé un data warehouse en Snowflake con esquema estrella",
      "Desplegué procesos de datos en AWS con S3, Glue y Lambda",
      "Escribí pruebas automáticas para transformaciones de datos con dbt",
      "Optimicé consultas SQL que redujeron el tiempo de carga en un 40 %",
      "Documenté el linaje de datos para el equipo de auditoría",
    ].join("\n"),
  },
  {
    name: "Coordinadora de proyectos",
    cv: [
      "Coordiné un equipo de cinco personas con metodología Scrum",
      "Gestioné el presupuesto y el cronograma de tres proyectos simultáneos",
      "Facilité reuniones con clientes para levantar requerimientos de negocio",
      "Elaboré informes de avance semanales para la dirección",
      "Negocié prioridades entre áreas de ventas y tecnología",
    ].join("\n"),
  },
];

export const SEED_VACANCIES = [
  {
    company: "Empresa Actual",
    title: "Analista de Datos Senior",
    channel: "Portal de empleo (simulado)",
    requirements: [
      "Experiencia creando tableros en Power BI o Tableau",
      "Dominio de SQL para consultas y reportes",
      "Comunicación de resultados a la gerencia",
      "Conocimiento de Python para análisis de datos",
    ].join("\n"),
  },
  {
    company: "Empresa Destino",
    title: "Analista de Datos",
    channel: "Correo de reclutamiento (simulado)",
    requirements: [
      "Experiencia construyendo dashboards e indicadores de negocio",
      "Manejo avanzado de SQL en bases de datos relacionales",
      "Automatización de procesos de limpieza de datos con Python",
      "Capacidad para presentar hallazgos a personas no técnicas",
      "Experiencia con pipelines ETL y orquestadores como Airflow",
      "Inglés avanzado para reuniones con equipos internacionales",
    ].join("\n"),
  },
  {
    company: "Empresa Actual Servicios S.A.",
    title: "Ingeniera/o de Datos",
    channel: "Portal de empleo (simulado)",
    requirements: [
      "Diseño de pipelines de datos en la nube",
      "Modelado de data warehouse dimensional",
      "Experiencia con servicios de AWS para datos",
    ].join("\n"),
  },
  {
    company: "Nova Logística S.R.L.",
    title: "Coordinador/a de Proyectos de Datos",
    channel: "Sitio de la empresa (simulado)",
    requirements: [
      "Gestión de proyectos con metodologías ágiles como Scrum",
      "Control de presupuesto y cronograma de proyectos",
      "Levantamiento de requerimientos con clientes internos",
      "Conocimientos básicos de SQL para validar entregables",
    ].join("\n"),
  },
];

export const GENERIC_SAMPLE = "Me interesa cualquier puesto disponible en su empresa.";
