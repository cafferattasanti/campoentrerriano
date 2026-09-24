# El Campo Entrerriano

Web app para productores y trabajadores rurales de Entre Ríos, pensada para **Gualeguay** (localidad por defecto; se puede cambiar). Muestra el clima y avisos de lluvia, alertas del SMN, alertas sanitarias importantes del SENASA, precios de **novillo, vaca y ternero** (siempre fijados arriba), hacienda en pie, granos, dólar, altura de los ríos y noticias del campo seleccionadas. **Todo se actualiza solo.** Cada dato muestra su fuente y cuándo se actualizó.

No es una guía veterinaria: no tiene fichas de enfermedades, tratamientos ni medicamentos.

---

## 1. Qué fuentes usa (verificadas el 23 y 24/09/2026)

| Función | Fuente | ¿Automática? | Frecuencia | API Key | Confiabilidad |
|---|---|---|---|---|---|
| Alertas meteorológicas oficiales | SMN — feed oficial CAP | Sí | cada 20 min | No | Oficial y público |
| Avisos de lluvia (LLUEVE AHORA / LLUVIA PREVISTA HOY-MAÑANA), tormenta, granizo, viento, helada, calor | Open-Meteo hora por hora (próximas 48 h) + observación SMN si la estación está a ≤ 40 km | Sí | cada 60 min | No (uso no comercial) | Modelo: se rotula como tal. Criterios en `server/lib/avisos.js` |
| Pronóstico 7 días | Open-Meteo (modelos numéricos); si no responde (le pasa al servidor público por límite de consultas compartido), **MET Norway** | Sí | cada 60 min | No | Modelo: se rotula como tal, con la fuente usada |
| Tiempo actual | SMN datos abiertos si la estación está cerca; si no (Gualeguay), Open-Meteo en el punto exacto + la observación oficial más cercana aparte | Sí | cada 60 min | No | Oficial / estimado, siempre indicado |
| **Novillo** | Mercado Agroganadero de Cañuelas — INMAG (Índice Novillo) | Sí | cada 30 min | No | Mercado de referencia nacional |
| **Vaca** | Mercado Agroganadero de Cañuelas — promedio ponderado de Vacas del último remate (+ remate anterior para la variación) | Sí | cada 60 min | No | Mercado de referencia nacional |
| **Ternero** | ROSGAN — Índice Ternero del remate mensual | Sí | cada 6 h (publica **1 vez por mes**) | No | Mercado de referencia de invernada |
| Hacienda en pie | Mercado Agroganadero de Cañuelas — IGMAG (Índice General) y precios por categoría | Sí | cada 30-60 min (días de remate) | No | Mercado de referencia nacional |
| Invernada y cría | ROSGAN — categorías del último remate | Sí | cada 6 h | No | Mercado de referencia |
| Soja, maíz, trigo, girasol, sorgo ($/t y US$) | Cámara Arbitral de Cereales — Bolsa de Comercio de Rosario (pizarra) | Sí | cada 60 min | No | Referencia nacional (en ER se descuenta flete) |
| Arroz cáscara ($/quintal) | Secretaría de Agricultura, Ganadería y Pesca | Sí | cada 12 h (publica 1 vez por mes) | No | Oficial — **mensual** |
| Dólar oficial | Banco de la Nación Argentina (billete) | Sí | cada 30 min | No | Oficial |
| Dólar mayorista y blue | DolarApi.com (respaldo del oficial si el BNA no responde) | Sí | cada 30 min | No | Servicio público; el blue es **informal** |
| Altura de los ríos (Gualeguay en Puerto Ruiz primero, Rosario del Tala, Gualeguaychú, Ibicuy, Paraná, Uruguay) | Prefectura Naval Argentina **y** Dirección de Hidráulica de Entre Ríos (datos del INA + escalas propias del río Gualeguay). Se muestra la lectura más reciente | Sí | 60 / 120 min | No | Oficial. Prefectura no responde a servidores fuera de Argentina; Hidráulica sí |
| Alertas sanitarias importantes | SENASA — «Situación epidemiológica» + comunicados del SENASA filtrados (brotes, detecciones, emergencias, estatus) | Sí | cada 3 h / 60 min | No | Oficial |
| Plagas de cultivos | SINAVIMO (SENASA), INTA | Contenido curado (`content/cultivos.json`) | revisión manual | — | Oficial, con fuente por ficha |
| Noticias | El Debate Pregón (Gualeguay), Gobierno de Entre Ríos, Bolsa de Cereales de ER, SENASA, INTA, La Nación Campo, Bichos de Campo, Infocampo | Sí, con **filtro estricto** (`server/lib/news-classify.js`) | cada 60 min | No | Prioridad: Gualeguay → departamentos → provincia → nacional con impacto |
| Carne porcina (capón) | SAGyP — informe semanal en PDF | **No** (enlace + carga manual en el panel) | — | — | Oficial |

### 1.1 Aviso importante sobre el SMN
El SMN publica en formato abierto sus **alertas (CAP)**, las **observaciones de estaciones** y un **pronóstico por modelo para estaciones**: todo eso se usa. Su pronóstico por localidad (mañana/tarde/noche) solo está en el servicio interno de su web, que **bloquea el acceso automatizado (403)**. No se intenta esquivar ese bloqueo: el pronóstico por localidad sale de Open-Meteo y se indica claramente. Si la app crece, conviene pedir acceso formal al SMN; el conector ya está hecho y se activa desde `/admin`.

### 1.2 API Keys
**Ninguna fuente exige clave hoy.** La única que puede requerirla:

1. **Servicio:** Open-Meteo (pronóstico por modelos).
2. **Clave:** `OPEN_METEO_API_KEY`, solo si la app es **comercial** (tiene publicidad o suscripciones).
3. **Dónde:** https://open-meteo.com/en/pricing
4. **Dónde ponerla:** en el archivo `.env` (o en las variables de entorno del hosting). Nunca en el frontend.
5. **Límites del plan gratis:** 600 consultas/min, 5.000/hora, 10.000/día. La app hace 24 consultas por día que cubren las ~20 localidades (Open-Meteo cuenta unas 500), muy por debajo del límite.
6. **Costo:** gratis para uso no comercial; plan pago para uso comercial.

---

## 2. Arquitectura

```
Fuentes externas (SMN, Open-Meteo, Cañuelas, ROSGAN, BCR, SAGyP, BNA, DolarApi, Prefectura, SENASA, noticias)
        │  (solo el servidor las consulta; ninguna clave llega al navegador)
        ▼
Planificador interno (server/scheduler.js) — cada fuente con su frecuencia, reintentos con espera creciente
        ▼
SQLite (data/campo.db) — último dato bueno + fecha, historial de precios, noticias, logs, contenido manual
        ▼
API JSON (server/api.js) — responde siempre desde la base, al instante
        ▼
Web liviana (public/) — HTML + CSS + JS sin librerías, funciona sin señal con la última información guardada
```

**Por qué así:** Node.js 22 sin dependencias externas (ni `npm install`): menos cosas que se rompen, arranca en cualquier hosting y pesa muy poco. SQLite embebida: sin servidor de base de datos que mantener. El usuario nunca espera a una fuente externa. La página abierta se refresca sola cada 5 minutos.

**Si una fuente falla:** se conserva el último dato bueno con su fecha, la pantalla dice «Estamos teniendo problemas para actualizar esta información. Última actualización: hace X horas» y se reintenta solo (5 min → hasta 6 h de espera). Nunca se muestran datos inventados.

```
server/
  index.js            servidor HTTP, archivos estáticos, seguridad, rutas
  api.js              endpoints públicos
  admin.js, auth.js   panel de administración (sesión firmada, límite de intentos)
  scheduler.js        actualización automática
  db.js               base SQLite
  regions/            provincias (entre-rios.js) — para sumar Santa Fe, Córdoba, etc.
  sources/            un archivo por fuente (conectores)
  lib/avisos.js       criterios de los avisos de lluvia, tormenta, viento, helada y calor
  lib/news-classify.js  filtro de relevancia de noticias
content/              fichas curadas de plagas de cultivos (con fuente en cada ficha)
public/               la web (index.html, admin.html, css, js, service worker)
test/                 tests contra muestras reales de cada fuente
```

---

## 3. Cómo ejecutarla

### En tu PC con Windows (y en el celular dentro de tu casa)
**Uso diario:** doble clic en el ícono **«El Campo Entrerriano»** del Escritorio. Si el servidor no está corriendo, lo arranca en segundo plano (sin ventanas) y abre `http://localhost:3000`.

Archivos de la carpeta:
- **`INICIAR-EN-MI-PC.bat`** — primera instalación: si falta Node.js ≥22.13 lo baja (versión portátil, en `%LOCALAPPDATA%\CampoEntrerriano\node`), crea `.env` con una contraseña de `/admin` al azar y arranca la app en una ventana visible. Deja registro en `registro-inicio.txt`.
- **`CONFIGURAR-ICONO.bat`** — crea el ícono del Escritorio (apunta a `abrir-app.vbs`, con `public/app-icono.ico`).
- **`abrir-app.vbs`** — lo que ejecuta el ícono: comprueba `/salud`, arranca el servidor oculto si hace falta y abre el navegador.
- **`CERRAR-APP.bat`** — apaga la app (servidor Node) y cierra las ventanas auxiliares. El ícono la vuelve a prender y al arrancar actualiza enseguida todo lo vencido.
- **`REINICIAR-APP.bat`** — cierra el servidor (puerto 3000) y lo vuelve a abrir oculto. Usarlo después de actualizar archivos del programa.

Celular: conectado al **mismo Wi-Fi**, entrá a `http://IP-DE-LA-PC:3000` (la IP la muestra `INICIAR-EN-MI-PC.bat` en la línea «En el celular…», por ejemplo `http://192.168.0.15:3000`). Si Windows pregunta por el Firewall, tocá **Permitir** (redes privadas). La PC tiene que estar prendida.

### Publicada en internet
- **Dirección pública:** https://campoentrerriano.onrender.com (Render, plan gratuito).
- **Código:** este repositorio de GitHub. Después de subir cambios a `main`, publicarlos en Render con *Manual Deploy → Deploy latest commit* (el servicio se creó desde la URL pública del repositorio, sin despliegue automático).
- **Contraseña de `/admin`:** la genera Render; se ve en dashboard.render.com → `campoentrerriano` → *Environment* → `ADMIN_PASSWORD`.
- **Siempre despierta:** el plan gratis se apaga tras 15 minutos sin visitas. La tarea `.github/workflows/mantener-despierta.yml` (GitHub Actions, gratis) la visita cada 10 minutos. GitHub pausa las tareas programadas si el repositorio pasa 60 días sin cambios: en ese caso, entrar a la pestaña *Actions* y reactivarla.
- **Límites del plan gratis:** sin disco persistente, así que el contenido cargado a mano en `/admin` y el historial de precios se pierden cuando Render reinicia la app (los datos de las fuentes se vuelven a descargar solos). Para un uso serio: plan pago con disco (en `render.yaml`: `plan` pago + bloque `disk` con `mountPath: /data` y `DB_PATH=/data/campo.db`), o un VPS usando el `Dockerfile`.
- **Dominio propio (opcional, pago):** comprar `campoentrerriano.com.ar` o `.com` y agregarlo en Render → *Settings* → *Custom Domains*.

### Comandos útiles
```bash
npm start            # arrancar
npm test             # 19 tests contra muestras reales de cada fuente
npm run update-now   # forzar la actualización de todas las fuentes y ver el resultado
```

---

## 4. Panel de administración (`/admin`)
- Estado de cada fuente: último dato bueno, último error, próxima actualización.
- «Actualizar ahora», activar/desactivar fuentes y cambiar la frecuencia.
- Activar/desactivar cada fuente de noticias; ocultar o destacar noticias; agregar noticias propias.
- Cargar contenido propio: alertas sanitarias (aparecen en Alertas), avisos meteorológicos, precios (ej. capón). **La fuente es obligatoria.**
- Registro de actividad (logs).

No hace falta entrar todos los días: todo se actualiza solo.

---

## 5. Cómo crecer
- **Otra provincia:** copiar `server/regions/entre-rios.js`, completar localidades (con el `smnId` del SMN) y registrarla en `server/regions/index.js`. Configurar `REGION=santa-fe`.
- **Otro cultivo:** agregar un bloque en `content/cultivos.json` (siempre con `fuente`) y usar «Recargar contenido» o reiniciar.
- **Otro río:** agregar el puerto (tal como figura en la tabla de Prefectura) en `rivers` de `server/regions/entre-rios.js`.
- **Otra fuente automática:** crear `server/sources/mi-fuente.js` con `{ id, name, category, everyMin, run() }` y sumarla en `server/sources/index.js`. Agregar una muestra real en `test/fixtures` y su test.

---

## 6. Límites conocidos (honestidad sobre los datos)
- **Hacienda:** Cañuelas publica solo los días de remate (lunes a viernes, no todos); entre remates se muestra el último con su fecha. El ternero (ROSGAN) es **mensual**. La variación compara con el remate anterior del mismo mercado.
- **Dólar blue:** es un valor del mercado informal relevado por DolarApi.com; se rotula así.
- **Avisos de lluvia:** salen de un modelo numérico (Open-Meteo), no del SMN. Las alertas oficiales siguen siendo las del SMN y se muestran aparte. Gualeguay no tiene estación del SMN con datos abiertos (la más cercana es Gualeguaychú, a ~70 km).
- **Open-Meteo:** gratis solo para uso **no comercial**. Si la web pasa a tener publicidad, hay que contratar el plan comercial y cargar `OPEN_METEO_API_KEY`.
- **Precios:** la pizarra de Rosario es de referencia; el precio en Entre Ríos se calcula descontando fletes y gastos. No hay pizarra diaria abierta de la Bolsa de Cereales de Entre Ríos.
- **Fichas de plagas:** contenido curado el 23/09/2026 con fuente en cada ficha. Conviene revisarlas cada temporada.
- **Verificación en vivo:** cada fuente se verificó el 23/09/2026 desde un navegador (formato de datos, endpoints y respuestas reales), y los lectores se probaron contra esas respuestas reales. El entorno donde se construyó la app no tenía salida a internet hacia esas fuentes, así que **la primera ejecución completa del servidor contra las fuentes reales ocurre al publicarla**: después de desplegar, correr `npm run update-now` o mirar el panel `/admin` para confirmar que todas quedan en «OK».
