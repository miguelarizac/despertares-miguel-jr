# App de iOS «Sueño Mike jr» — especificación para Claude Code

App nativa para iPhone que registra los eventos de sueño de Miguel Jr. contra la **misma API** que
la web (`server.js`, desplegada en Render). La web y los Atajos de iOS siguen funcionando igual;
esta app es otro cliente más.

Se construye y se instala desde el Mac de Miguel con Claude Code. El código va en la carpeta `ios/`
de este repositorio.

## Objetivo

Registrar un despertar de madrugada **en un toque, a oscuras y sin esperas**, aunque el servidor de
Render esté dormido o no haya conexión, y ver de un vistazo cómo va la noche.

## Entorno

- Mac con Xcode 27.x. iPhone de Miguel con iOS 27 y **Modo desarrollador ya activado** y emparejado.
- Firma: cuenta gratuita de Apple → **Personal Team** «Miguel Ariza Colmenares (Personal Team)».
  - La app caduca a los **7 días**: hay que reinstalar (ver «Instalar» abajo).
  - Límite de la cuenta gratuita: **10 App ID nuevos cada 7 días** y 3 apps instaladas a la vez. El
    widget cuenta como App ID propio: no crear y borrar targets o identificadores a la ligera.
  - Antes de usar una capacidad (App Groups, Live Activities…), comprobar que el Personal Team la
    admite. Si no la admite, usar la alternativa indicada en cada sección y avisar a Miguel.
- Bundle ID base: `com.miguelariza.suenomikejr` (widget: `…suenomikejr.widgets`).
- Nombre visible: **Sueño Mike jr**.
- Destino mínimo: iOS 18. SwiftUI + App Intents + WidgetKit + ActivityKit. Sin dependencias externas.
- Generar el proyecto con **XcodeGen** (`brew install xcodegen`, fichero `ios/project.yml`) para no
  editar `.pbxproj` a mano. `ios/*.xcodeproj` puede ir en `.gitignore`.

## API (ya desplegada)

Base: `https://despertares-miguel-jr.onrender.com`. Autenticación con la cabecera
`X-App-Key: <clave>`. La clave **no se escribe en el código ni en el repo**: la app la pide en
Ajustes la primera vez y la guarda en el **Llavero**. Miguel la conoce. No distingue mayúsculas.

| Método | Ruta | Uso |
|---|---|---|
| `POST` | `/api/wakes` | Registrar evento. Cuerpo JSON: `kind`, opcional `ts` (ISO 8601, hora exacta de la pulsación), `client_id` (UUID; si se reenvía no se duplica), `note`. Devuelve `{id, time, iso, night, kind}`. |
| `GET` | `/api/wakes?days=8` | `{tonight, nights: {"YYYY-MM-DD": [{id, time, iso, note, kind}]}}` |
| `PATCH` | `/api/wakes/:id` | Cambiar `note`, `kind` o la hora (`night` + `time` "HH:MM"). |
| `DELETE` | `/api/wakes/:id` | Borrar evento. |
| `GET` | `/healthz` | Despertar el servidor. |

`ts` admite como mucho 10 días atrás y 5 minutos en el futuro; si no, responde 400.

**Noche**: va de las 18:00 a las 17:59 del día siguiente (hora de Madrid) y se etiqueta con la fecha
de la tarde en que empieza. Usar siempre la zona `Europe/Madrid`.

**Tipos (`kind`)**, etiquetas como en la web (`public/index.html`, constante `LABEL`):

| kind | Etiqueta |
|---|---|
| `bath` | Baño |
| `room_in` | Entra en habitación |
| `crib` | A la cuna |
| `room_out` | Sale de habitación |
| `asleep` | Se ha dormido |
| `wake` | Despertar |
| `resleep` | Vuelve a dormirse |
| `df` | Toma (DF) |
| `up` | Despertar mañana |
| `outcrib` | Fuera de la cuna |

El botón principal sigue la **misma máquina de estados que la web** (funciones `summary`/`state` y
el objeto de botones en `public/index.html`). Replicarla: rutina de acostar → «Se ha dormido» →
«Se ha despertado» / «Se ha vuelto a dormir» → «Despertar de la mañana» → «Fuera de la cuna»,
con su acción secundaria en cada estado.

## Requisitos

### 1. Registro sin conexión (lo más importante)
- Al pulsar, guardar **en local al instante** el evento con `ts` = ahora y un `client_id` UUID, y
  dar respuesta háptica más confirmación visual. La interfaz **nunca** espera a la red.
- Una cola persistente envía los pendientes en segundo plano, reintenta con espera creciente y los
  marca como enviados al recibir 201. Gracias a `client_id`, reenviar es seguro.
- Al abrir la app, o al volver a primer plano, hacer `GET /healthz` y luego vaciar la cola.
- Mostrar un indicador discreto si hay eventos pendientes de enviar.

### 2. Pantalla principal (oscura, pensada para la madrugada)
- Fondo negro, poco brillo, letras grandes y botón principal enorme (como la web).
- Debajo: la noche actual en una línea de tiempo (hora + etiqueta), con número de despertares y
  tiempo despierto acumulado.
- Deslizar para borrar un evento y tocarlo para cambiar la hora o la nota.
- Pestaña o hoja de **Historial**: últimas 7 noches en resumen (hora de dormirse, despertares,
  media de minutos despierto, hora de despertar), igual que la tabla de la web.
- **Ajustes**: URL base (con la de arriba por defecto) y clave (Llavero).

### 3. App Intents (Siri, Botón de Acción, Centro de Control)
- `RegistrarEventoIntent(kind)` y atajos directos «Despertar», «Vuelve a dormirse» y «Se ha
  dormido», con frases en español para Siri («Despertar en Sueño Mike jr»).
- Deben funcionar **sin abrir la app** y usar la misma cola local.
- **Control** para el Centro de Control y la pantalla de bloqueo (`ControlWidget`, iOS 18): botón
  «Despertar».

### 4. Widgets
- Pantalla de bloqueo (accesorio rectangular o circular) y pantalla de inicio (pequeño): último
  evento con su hora y nº de despertares de la noche. En el pequeño, botón interactivo «Despertar».
- Los datos compartidos entre app, widget e intents van por un **App Group**. Si el Personal Team
  no lo permite, que el widget lea de la API y que los intents se ejecuten en el proceso de la app.

### 5. Actividad en directo
- Al registrar `wake`, iniciar una Live Activity «Despierto desde 03:12» con contador en la pantalla
  de bloqueo y la Dynamic Island, y un botón «Vuelve a dormirse». Termina con `resleep`, `up` u
  `outcrib`.
- Si la capacidad no está disponible con la cuenta gratuita, dejarla para cuando haya cuenta de pago.

## Orden de trabajo sugerido
1. Proyecto con XcodeGen, cliente de API, cola local y pantalla principal. **Instalar y probar en el
   iPhone** antes de seguir.
2. Historial y Ajustes.
3. App Intents y Control.
4. Widgets.
5. Live Activity.

Instalar en el iPhone al final de cada paso.

## Instalar (y reinstalar cada 7 días)
Crear `ios/scripts/install.sh` que:
1. Localice el iPhone con `xcrun devicectl list devices`.
2. Compile con `xcodebuild -scheme SuenoMikeJr -destination 'id=<UDID>' -allowProvisioningUpdates build`.
3. Instale con `xcrun devicectl device install app --device <UDID> <ruta .app>`.

Así, Miguel solo tiene que decir «reinstala la app» con el iPhone conectado.
Si iOS dice «desarrollador no fiable»: Ajustes → General → VPN y gestión de dispositivos → Confiar.

## Pruebas
- Tests unitarios de la lógica de la noche (corte a las 18:00, horario de verano/invierno) y de la
  máquina de estados, con los mismos casos que la web.
- No dejar eventos de prueba en la base de datos real: si hace falta probar contra la API, borrar
  después lo creado (`DELETE`) o usar un servidor local (`node server.js`, sin `DATABASE_URL` usa
  memoria).
