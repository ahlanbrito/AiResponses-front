# PreguntasResponderAi — Extensión de Chrome

Extensión de Chrome (Manifest V3) que detecta preguntas de opción múltiple o texto seleccionado
y devuelve la respuesta usando la API de **PreguntasResponderAi**
(`https://apipreguntasai.runasp.net/api`).

Incluye **control de versión forzado**: si la versión instalada es menor a la mínima que exige el
servidor, el popup muestra un aviso de *“Actualizar extensión”* y el servicio queda bloqueado hasta
que el usuario actualice.

---

## 📥 Instalación (usuarios)

1. Descarga este repositorio (botón **Code → Download ZIP**) o clónalo:

   ```bash
   git clone https://github.com/ahlanbrito/AiResponses-front.git
   ```

2. Abre Chrome y ve a `chrome://extensions/`
3. Activa **Modo desarrollador** (arriba a la derecha)
4. Pulsa **Cargar descomprimida** y selecciona la carpeta del proyecto
5. Fija la extensión en la barra de herramientas y abre el popup para iniciar sesión

> El `manifest.json` incluye una **`key` fija**, por lo que la extensión siempre tiene el mismo
> ID (`jkopcmaiobkfckfhmegpegjpomlocpdm`) en cualquier equipo. Eso es lo que permite que el login
> con Google y los datos guardados funcionen para todos los usuarios.

---

## 🔄 Actualización (usuarios)

Cuando el desarrollador publique una versión nueva:

1. Abre una terminal en la carpeta de la extensión
2. Ejecuta:

   ```bash
   git pull
   ```

3. Ve a `chrome://extensions/` y pulsa el botón **↻ Recargar** en la tarjeta de la extensión

Si el usuario intenta usar la versión antigua, el popup mostrará el aviso de actualización y el
backend responderá `426 EXTENSION_OUTDATED` a las peticiones de IA.

---

## 🚀 Publicar una versión nueva (desarrollador)

1. Sube la versión en `manifest.json`:

   ```json
   "version": "2.3.0"
   ```

2. Actualiza la versión mínima en el backend (`appsettings.json`):

   ```json
   "ExtensionVersion": {
     "Enforce": "true",
     "Latest": "2.3.0",
     "Minimum": "2.3.0",
     "UpdateUrl": "https://github.com/ahlanbrito/AiResponses-front",
     "Message": "Hay una nueva versión de la extensión. Actualiza para seguir usando el servicio."
   }
   ```

3. Commit y push:

   ```bash
   git add -A
   git commit -m "chore: release v2.3.0"
   git push
   ```

4. Redeploy del backend para que tome la nueva versión mínima

> Importante: `Minimum` debe ser la versión más nueva que quieras **obligar**. Si subes el front
> pero no actualizas `Minimum`, los usuarios con la versión vieja seguirán funcionando.

---

## 🔐 Configuración de Google OAuth (una sola vez)

El login usa `chrome.identity.getAuthToken`, que exige un cliente OAuth de tipo **Chrome App**
(no “Web application”).

1. Entra a <https://console.cloud.google.com/>
2. Crea (o selecciona) un proyecto
3. **APIs y servicios → Biblioteca** → habilita **Google Identity** / *People API* si te lo pide
4. **APIs y servicios → Pantalla de consentimiento OAuth**
   - Tipo: **Externo**
   - Agrega los scopes `openid`, `email`, `profile`
   - En **Usuarios de prueba** agrega los correos que probarán la app (mientras esté en *Testing*)
   - Cuando esté listo, publica la app (**Publicar app**)
5. **APIs y servicios → Credenciales → Crear credenciales → ID de cliente OAuth**
   - Tipo de aplicación: **Chrome App** (Chrome Extension)
   - **ID de la aplicación**: `jkopcmaiobkfckfhmegpegjpomlocpdm`
6. Copia el **Client ID** generado y pégalo en `manifest.json`:

   ```json
   "oauth2": {
     "client_id": "TU-NUEVO-CLIENT-ID.apps.googleusercontent.com",
     "scopes": ["openid", "email", "profile"]
   }
   ```

7. Recarga la extensión en `chrome://extensions/`

> Si la pantalla de consentimiento está en modo **Testing**, solo los correos de *Usuarios de
> prueba* podrán iniciar sesión. Para que cualquier persona entre, publica la app.

---

## 🧱 Estructura

| Archivo | Rol |
|---|---|
| `manifest.json` | Configuración MV3, `key` fija, OAuth, permisos |
| `background.js` | Lógica de API, sesión, versión y captura de pantalla |
| `content.js` | Inyección de UI, detección de selección y compatibilidad con modo seguro |
| `popup.html` / `popup.js` | Interfaz, login, planes, pagos y aviso de actualización |
| `styles.css` | Estilos del popup |
| `i18n.js` + `_locales/` | Traducciones (en, es, de, fr, pt_BR, zh_CN) |
| `lucide.min.js` | Iconos |

---

## 🛠️ Solución de problemas

| Problema | Causa | Solución |
|---|---|---|
| `Error 400: invalid_request` al entrar con Google | Client ID no corresponde al ID de la extensión | Crea el OAuth client tipo **Chrome App** con el ID `jkopcmaiobkfckfhmegpegjpomlocpdm` |
| “Acceso bloqueado” en Google | App en modo Testing y el correo no es usuario de prueba | Agrega el correo o publica la app |
| El popup muestra “Actualiza la extensión” | Versión instalada menor a `Minimum` del backend | `git pull` y recargar en `chrome://extensions/` |
| `426 EXTENSION_OUTDATED` en la API | Igual que el anterior | Actualizar la extensión |
| No aparece el botón flotante | Página sin recargar | Recarga la pestaña después de instalar/actualizar |
