# Postula — prototipo funcional

Asistente de postulación discreta para personas con empleo que buscan cambiar: lista de exclusión de empresas, comparación de varias versiones del CV con cada vacante mediante **embeddings semánticos**, revisión y aprobación explícita, y estados honestos (preparada → enviada → recepción confirmada solo con evidencia).

Prototipo del Proyecto Final del curso *Taller de Innovación en Software II* (Universidad CENFOTEC, 2026). Es una simulación académica: el envío de postulaciones es simulado y se deben usar datos ficticios.

- **Demo:** https://postula.potenci.ai (requiere iniciar sesión; botón «Cargar datos de ejemplo»)

## Arquitectura
| Capa | Tecnología |
|---|---|
| Frontend | Vite + React 19 + TypeScript, Thirdweb 5 para el inicio de sesión; publicado en AWS Amplify |
| Login | SIWE (Sign-In with Ethereum) contra el servicio de autenticación de potenci; la API hace de proxy y valida cada JWT. El identificador de la persona es su wallet (`sub`) |
| Backend | AWS Lambda (Node.js 22, ARM) con Function URL — `backend/src/handler.ts` |
| Datos | Amazon DynamoDB bajo demanda (`pk=USER#wallet`, `sk=PROFILE#/EXCL#/VAC#/APP#/EMB#`; catálogo en `pk=CATALOG`) |
| Embeddings | Cohere `embed-v4.0` (1536 dim.) vía API v2; la clave se lee de AWS Systems Manager en tiempo de ejecución y nunca llega al navegador. Vectores en caché por persona |

## Roles: candidato y reclutador (admin)

Dos vistas sobre el mismo producto:

- **Candidato** (todos): ve el **catálogo** de vacantes publicadas, revisa si la empresa está en su lista de exclusión y pulsa **«Postular»**. Al postular, la vacante se clona a *Mis postulaciones*, donde la analiza con su CV (embeddings), prepara la carta y aprueba el envío (simulado). El candidato **ya no crea vacantes** — ese era el punto confuso del feedback.
- **Reclutador / admin** (`#/admin`): publica, edita, cierra y elimina vacantes del catálogo, y ve cuántas postulaciones recibió cada una (en proceso / enviadas). La gestión es solo para wallets admin.

Quién es admin se controla con la variable `ADMIN_WALLETS` de la función (wallets separadas por coma). Se define al desplegar:

```bash
ADMIN_WALLETS=0xTuWallet,0xOtra ./infra/deploy-backend.sh
```

Si no se pasa en un deploy posterior, conserva el valor ya configurado. Para sembrar las 4 vacantes de ejemplo del Sprint, entra como admin y usa **«Cargar 4 de ejemplo»** (o `POST /api/catalog/seed`). El onboarding del candidato (`POST /api/seed`) ahora carga **solo los 3 perfiles** de Ana Solano.

Modelo de datos: el catálogo es global (`pk=CATALOG`, `sk=VAC#<id>`); al postular se crea una copia personal del candidato (`USER#wallet / VAC#<id>` con `catalogId`), y el análisis/estado viven en esa copia.

## Motor (guía del prototipo)
1. Requisitos y CV por líneas; descarta < 4 palabras.
2. Requisitos → `input_type=search_query`; líneas del CV → `search_document` (equivalente a los prefijos de EmbeddingGemma).
3. `S = Q·Dᵀ` (coseno); `sᵢ = maxⱼ Sᵢⱼ`; cubierto si `sᵢ ≥ τ`; la línea ganadora es la evidencia.
4. Recomendado = más cubiertos; empate → mayor promedio. Sin porcentajes.
5. `τ` y modelo en `backend/src/config.json`.

### Calibración (Tabla 11), 10-nov-2026
Set A = 20 pares de la guía (etiquetados antes de correr modelos). Set B = 12 pares difíciles (misma área con otra habilidad, y paráfrasis sin palabras compartidas). τ = punto medio del rango que maximiza F1.

| Modelo | Dim | ms/texto | τ (A) | F1 (A) | τ (A+B) | F1 (A+B) |
|---|---|---|---|---|---|---|
| **embed-v4.0** (en uso) | 1536 | 21 | 0.25 | 1.000 | **0.28** | **0.897** |
| embed-multilingual-v3.0 | 1024 | 6.1 | 0.50 | 0.947 | 0.50 | 0.867 |
| embed-multilingual-light-v3.0 | 384 | 3.6 | 0.33 | 0.952 | 0.35 | 0.839 |

Hallazgo: con el set A solo (negativos fáciles) τ = 0,25 da F1 = 1, pero en CVs reales produce falsos «cubierto» dentro del mismo dominio (p. ej. «Inglés avanzado» → «Facilité reuniones…», 0,349). Ningún τ los elimina todos, así que la línea de evidencia visible es la salvaguarda.

## Pruebas
- `cd backend && npm test`: 17 pruebas unitarias (exclusión: normalización, S.A., tildes, nombres parecidos, reconocimiento; cobertura: max, τ, evidencia, ranking/empate, F1, frase genérica).
- `cd frontend && ( set -a; source .env.e2e; set +a; node scripts/e2e.mjs )` (`.env.e2e` con `API`, `VITE_THIRDWEB_CLIENT_ID` y opcionalmente `POSTULA_E2E_ADMIN_KEY`; no se versiona): E2E contra prod con login SIWE real de **dos roles** (reclutador + candidato), no destructivo (publica vacantes con un tag único y las borra al final): CU-01/02/03 sobre el catálogo, veredicto de exclusión, idempotencia de postular, contadores del admin, gating admin→403, calibración y borrar datos. Sin la llave del admin, corre solo las verificaciones de candidato.

## Correr localmente
```bash
cd backend && npm install && npm test        # pruebas unitarias del motor y la exclusión
cd ../frontend && npm install
cp .env.example .env.development             # completa VITE_API_URL y VITE_THIRDWEB_CLIENT_ID
npm run dev                                   # http://localhost:5173
```
Para correr la calibración con tu propia clave de Cohere: `cd backend && COHERE_API_KEY=... npm run calibrate`.

## Desplegar en tu propia cuenta AWS
```bash
cp infra/.env.example infra/.env.local        # cuenta, parámetro SSM con la clave de Cohere, orígenes CORS
./infra/deploy-backend.sh                      # build + tabla + rol + Lambda + Function URL (idempotente)
./infra/deploy-frontend.sh                     # build + zip a Amplify
```
El inicio de sesión depende del servicio de autenticación de potenci (`AUTH_API`) y de un client ID de Thirdweb; para un despliegue independiente hay que reemplazarlos por los propios.

## Limitaciones conocidas
- Privacidad: el texto de los CV se envía a Cohere para vectorizarse. Antes de usar datos reales hace falta consentimiento explícito y excluir los datos del entrenamiento del proveedor. Un modo en el dispositivo (EmbeddingGemma + Transformers.js) queda como trabajo futuro.
- La similitud de embeddings mide cercanía de significado, no dominio de una habilidad: por eso la línea de evidencia siempre se muestra.
