# El Campo Entrerriano

Web app para productores y trabajadores rurales de Entre Ríos: clima y alertas del SMN, precios de granos y hacienda, sanidad animal, buscador de medicamentos veterinarios del registro oficial del SENASA, plagas de cultivos y noticias del campo. **Todo se actualiza solo.** Cada dato muestra su fuente y cuándo se actualizó.

---

## 1. Qué fuentes usa (verificadas el 23/09/2026)

| Función | Fuente | ¿Automática? | Frecuencia | API Key | Confiabilidad |
|---|---|---|---|---|---|
| Alertas meteorológicas (fenómeno, nivel, desde/hasta, zona, recomendaciones) | SMN — feed oficial CAP (ssl.smn.gob.ar/CAP/AR.php) | Sí | cada 20 min | No | Oficial y público |
| Pronóstico por localidad (7 días: mín/máx, lluvia %, mm, viento, ráfagas) | Open-Meteo (modelos numéricos) | Sí | cada 60 min | No (uso no comercial) | Modelo: se rotula como tal |
| Tiempo actual | SMN datos abiertos (estación más cercana) → Open-Meteo | Sí | cada 60 min | No | Oficial; el respaldo se marca «estimado» |
| Pronóstico oficial por localidad del SMN | Servicio web interno de smn.gob.ar | **Desactivado**: el SMN bloquea el acceso automatizado (HTTP 403, verificado 23/09/2026) | — | — | Se activa desde /admin solo si el SMN otorga acceso formal |
| Tiempo presente y pronóstico por modelo 5 días | SMN — Datos abiertos (ssl.smn.gob.ar/dpd) | Sí | cada 60 min | No | Oficial y público |
| Milímetros de lluvia estimados, ráfagas, respaldo si falla el SMN | Open-Meteo | Sí | cada 60 min (1 consulta para todas las localidades) | No (uso no comercial) / Sí (comercial) | Modelo numérico, no oficial: se rotula como estimación |
| Soja, maíz, trigo, girasol, sorgo ($/t y US$) | Cámara Arbitral de Cereales — Bolsa de Comercio de Rosario (pizarra) | Sí | cada 60 min (publica 1 vez por día hábil) | No | Referencia profesional nacional |
| Hacienda vacuna ($/kg vivo por categoría) | Mercado Agroganadero de Cañuelas | Sí | cada 60 min (días de remate) | No | Referencia profesional nacional |
| Arroz cáscara ($/quintal) | Secretaría de Agricultura, Ganadería y Pesca | Sí | cada 12 h (publica 1 vez por mes) | No | Oficial — **mensual, no diario** |
| Carne porcina (capón) | SAGyP — informe semanal en PDF | **No** (enlace + carga manual en el panel) | — | — | Oficial |
| Medicamentos veterinarios | SENASA — Registro de Productos Veterinarios (Vademécum) | Sí, **consulta en vivo** con caché de 24 h (fichas 7 días) | a demanda | No | Oficial |
| Alertas sanitarias | SENASA — «Situación epidemiológica» + comunicados SENASA | Sí | cada 3 h / 60 min | No | Oficial |
| Enfermedades animales, vacunación | Páginas de programas del SENASA e INTA | Contenido curado (`content/animales.json`) | revisión manual | — | Oficial, con fuente por ficha |
| Plagas y enfermedades de cultivos | SINAVIMO (SENASA), SENASA, INTA | Contenido curado (`content/cultivos.json`) | revisión manual | — | Oficial, con fuente por ficha |
| Noticias | SENASA, INTA, Bolsa de Cereales de Entre Ríos, La Nación Campo, Bichos de Campo, Infocampo | Sí (RSS y listados oficiales, con filtro de temas) | cada 60 min | No | Oficiales + medios agropecuarios reconocidos |
| Mapa de brotes | — | **No se dibuja**: no hay datos públicos con ubicación exacta. Se agrupan comunicados por provincia/departamento cuando el texto oficial los nombra | — | — | — |

### 1.1 Aviso importante sobre el SMN
El SMN publica en formato abierto sus **alertas (CAP)**, las **observaciones de estaciones** y un **pronóstico por modelo para estaciones**: todo eso se usa. Su pronóstico por localidad (mañana/tarde/noche) solo está en el servicio interno de su web, que **bloquea el acceso automatizado (403)**. No se intenta esquivar ese bloqueo: el pronóstico por localidad sale de Open-Meteo y se indica claramente. Si la app crece, conviene pedir acceso formal al SMN; el conector ya está hecho y se activa desde `/admin`.

### 1.2 API Keys
**Ninguna fuente exige clave hoy.** La única que puede requerirla:

1. **Servicio:** Open-Meteo (pronóstico por modelos).
2. **Clave:** `OPEN_METEO_API_KEY`, solo si la app es **comercial** (tiene publicidad o suscripciones).
3. **Dónde:** https://open-meteo.com/en/pricing
4. **Dónde ponerla:** en el archivo `.env` (o en las variables de entorno del hosting). Nunca en el frontend.
5. **Límites del plan gratis:** 600 consultas/min, 5.000/hora, 10.000/día. La app usa ~24 por día.
6. **Costo:** gratis para uso no comercial; plan pago para uso comercial.

---

## 2. Arquitectura

```
Fuentes externas (SMN, BCR, Cañuelas, SAGyP, SENASA, RSS)
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

**Por qué así:** Node.js 22 sin dependencias externas (ni `npm install`): menos cosas que se rompen, arranca en cualquier hosting y pesa muy poco. SQLite embebida: sin servidor de base de datos que mantener. El usuario nunca espera a una fuente externa (salvo el buscador de medicamentos, que consulta el SENASA con caché).

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
  services/vademecum.js  buscador del registro del SENASA
content/              fichas curadas de sanidad animal y cultivos (con fuente en cada ficha)
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
- **Código:** este repositorio de GitHub. Cada cambio que se sube a `main` se publica solo (`autoDeploy`).
- **Contraseña de `/admin`:** la genera Render; se ve en dashboard.render.com → `campoentrerriano` → *Environment* → `ADMIN_PASSWORD`.
- **Siempre despierta:** el plan gratis se apaga tras 15 minutos sin visitas. La tarea `.github/workflows/mantener-despierta.yml` (GitHub Actions, gratis) la visita cada 10 minutos. GitHub pausa las tareas programadas si el repositorio pasa 60 días sin cambios: en ese caso, entrar a la pestaña *Actions* y reactivarla.
- **Límites del plan gratis:** sin disco persistente, así que el contenido cargado a mano en `/admin` y el historial de precios se pierden cuando Render reinicia la app (los datos de las fuentes se vuelven a descargar solos). Para un uso serio: plan pago con disco (en `render.yaml`: `plan` pago + bloque `disk` con `mountPath: /data` y `DB_PATH=/data/campo.db`), o un VPS usando el `Dockerfile`.
- **Dominio propio (opcional, pago):** comprar `campoentrerriano.com.ar` o `.com` y agregarlo en Render → *Settings* → *Custom Domains*.

### Comandos útiles
```bash
npm start            # arrancar
npm test             # 12 tests de los lectores de cada fuente
npm run update-now   # forzar la actualización de todas las fuentes y ver el resultado
```

---

## 4. Panel de administración (`/admin`)
- Estado de cada fuente: último dato bueno, último error, próxima actualización.
- «Actualizar ahora», activar/desactivar fuentes y cambiar la frecuencia.
- Activar/desactivar cada fuente de noticias; ocultar o destacar noticias; agregar noticias propias.
- Cargar contenido propio: alertas sanitarias, avisos meteorológicos, precios (ej. capón). **La fuente es obligatoria.**
- Registro de actividad (logs).

No hace falta entrar todos los días: todo se actualiza solo.

---

## 5. Cómo crecer
- **Otra provincia:** copiar `server/regions/entre-rios.js`, completar localidades (con el `smnId` del SMN) y registrarla en `server/regions/index.js`. Configurar `REGION=santa-fe`.
- **Otra especie o cultivo:** agregar un bloque en `content/animales.json` o `content/cultivos.json` (siempre con `fuente`) y usar «Recargar contenido» o reiniciar.
- **Otra fuente automática:** crear `server/sources/mi-fuente.js` con `{ id, name, category, everyMin, run() }` y sumarla en `server/sources/index.js`. Agregar una muestra real en `test/fixtures` y su test.

---

## 6. Límites conocidos (honestidad sobre los datos)
- **Medicamentos:** se muestran solo datos del registro del SENASA. **No se muestran dosis** a propósito. El registro público no trae contraindicaciones ni «venta bajo receta» por producto: se remite al prospecto y al veterinario. Se marca cuando el SENASA **no corroboró** los datos de la empresa y cuando el registro es «exclusivo exportación».
- **Precios:** la pizarra de Rosario es de referencia; el precio en Entre Ríos se calcula descontando fletes y gastos. No hay pizarra diaria abierta de la Bolsa de Cereales de Entre Ríos.
- **Fichas sanitarias y de plagas:** contenido curado el 23/09/2026 con fuente en cada ficha. Conviene revisarlas cada temporada (por ejemplo, fechas de campañas de vacunación).
- **Verificación en vivo:** cada fuente se verificó el 23/09/2026 desde un navegador (formato de datos, endpoints y respuestas reales), y los lectores se probaron contra esas respuestas reales. El entorno donde se construyó la app no tenía salida a internet hacia esas fuentes, así que **la primera ejecución completa del servidor contra las fuentes reales ocurre al publicarla**: después de desplegar, correr `npm run update-now` o mirar el panel `/admin` para confirmar que todas quedan en «OK».
